/* istanbul ignore file */
/**
 * @file  A resilient fetch client with retry logic, timeout and abort.
 * Client adds default headers and a bearer token, if provided.
 * Based on code from https://medium.com/@orami98/the-5-layer-architecture-that-will-replace-your-fragile-web-applications-in-2026-f4c35ccd6bed
 *
 * Features and optimizations:
 * - Exponential backoff with jitter for retries
 * - Connection pooling via client reuse
 * - HTTP/2 multiplexing (via undici)
 * - DNS caching: OS-level (basic) - for advanced caching use undici Agent with dns interceptor
 * - Automatic response decompression (gzip, deflate, brotli)
 */

import { isDebugging } from '@libs/utils/debugger';
import { ErrorEx } from '@libs/utils/error';
import { sleep } from '@libs/utils/time';
import { SSESession } from './sse-session';

export class ClientOptions {
    readonly maxTries: number = 5; // max number of failures before giving up
    readonly baseDelay: number = 100; // initial delay between retries
    readonly maxDelay: number = 10000; // max delay between retries
    readonly timeout: number = isDebugging() ? 0 : 60000; // 0 = no timeout in debug mode
    readonly afterFn: // client calls the specified function to read the response
        | 'json' // >> returns a JSON object
        | 'text' // >> returns a string/html
        | 'arrayBuffer'
        | 'bytes' // >> returns a Uint8Array
        | 'blob' // >> returns a Blob
        | 'formData' // >> returns a FormData
        | 'stream' // >> returns the body stream of type ReadableStream<Uint8Array>
        | 'sse' // >> returns an SSESession for Server-Sent Events
        | (<R>(res: Response) => Promise<R>) = 'json'; // custom Response reader // defaults to json
    readonly lock?: 'write' | 'read' | string; // optional lock for synchronizing requests (name is based on fetch URL)
    readonly defaultHeaders?: Record<string, string>; // added to all requests on this client
    readonly bearerToken?: string; // when set adds an Authorization: Bearer <token> header
    readonly userAgent?: string; // when set adds a User-Agent header

    constructor(opts?: Partial<ClientOptions>) {
        if (opts) {
            // Replace POJO.copyIn with Object.assign
            Object.assign(this, opts);
        }

        this.defaultHeaders ??= {
            'Accept-Encoding': 'gzip, deflate, br',
        };

        // Add User-Agent header if provided
        if (this.userAgent) {
            this.defaultHeaders['User-Agent'] = this.userAgent;
        }

        switch (this.afterFn) {
            case 'arrayBuffer':
            case 'bytes':
                this.defaultHeaders['Accept'] = 'application/octet-stream';
                break;

            case 'blob':
                this.defaultHeaders['Accept'] = 'image/*, application/octet-stream';
                break;

            case 'formData':
                this.defaultHeaders['Accept'] = '*/*';
                break;

            case 'text':
                this.defaultHeaders['Accept'] = 'text/plain, text/html';
                break;

            case 'sse':
                this.defaultHeaders['Accept'] = 'application/json, text/event-stream';
                break;

            default: // 'json':
                this.defaultHeaders['Accept'] = 'application/json';
                break;
        }
    }
}

// implements a promise with exponential backoff with jitter, timer and abort signal.
// note! one should not subclass Promise, hence using composition.
export class PromiseRetry<T> implements PromiseLike<T> {
    private readonly _created = Date.now();
    private readonly _opts: ClientOptions;
    private _timer: NodeJS.Timeout | undefined;
    private _failures = 0;
    private _lastFailure = 0;
    private _lastReason = '';
    private _ctl: AbortController = new AbortController();
    private _signalUsed = false;

    // withResolvers pattern in composition
    resolve!: (value: T | PromiseLike<T>) => void;
    reject!: (reason?: unknown) => void;
    promise: Promise<T>;

    constructor(opts: ClientOptions, extSignal?: AbortSignal) {
        this._opts = opts;

        // mimic external signal abort
        if (extSignal) {
            if (extSignal.aborted) {
                this.abort(extSignal.reason ?? 'Aborted');
            } else {
                extSignal.addEventListener(
                    'abort',
                    () => {
                        this.abort(extSignal.reason ?? 'Aborted');
                    },
                    { once: true },
                );
            }
            this._signalUsed = true;
        }

        this.promise = new Promise<T>((resolve, reject) => {
            this.resolve = (value: T | PromiseLike<T>) => {
                this.clearTimeout();
                if (this.signal.aborted) {
                    reject(this.signal.reason);
                } else {
                    resolve(value);
                }
            };
            this.reject = (reason?: unknown) => {
                this.clearTimeout();
                reject(reason);
            };
        });
        if (this._opts.timeout) {
            this._timer = setTimeout(() => {
                this._timer = undefined;
                this.abort('Timeout');
            }, this._opts.timeout);
        }
    }

    markFailure(reason = ''): number {
        this._lastFailure = Date.now();
        this._lastReason = reason;
        return ++this._failures;
    }

    // when retrying call this to get the next delay timeout
    nextDelay(): number {
        const exponentialDelay = Math.min(this._opts.baseDelay * 2 ** this._failures, this._opts.maxDelay);
        const jitter = Math.random() * 0.1 * exponentialDelay;
        return exponentialDelay + jitter;
    }

    clearTimeout() {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
    }

    abort(reason?: string) {
        reason ??= 'Aborted';
        // if signal is not in use we need to reject instead
        if (this._signalUsed) {
            this._ctl.abort(reason);
        } else {
            this._lastReason = reason;
            this.reject(reason);
        }
        this.clearTimeout();
    }

    get state() {
        return {
            ...this._opts,
            failures: this._failures,
            lastFailure: this._lastFailure,
            created: this._created,
            aborted: this._ctl.signal.aborted,
            reason: this._ctl.signal.reason || this._lastReason,
        };
    }

    get failed(): boolean {
        const { timeout, failures, created, aborted } = this.state;
        const rc = failures >= this._opts.maxTries || (timeout > 0 && Date.now() > created + timeout) || aborted;
        return rc;
    }

    get signal(): AbortSignal {
        this._signalUsed = true;
        return this._ctl.signal;
    }

    /**
     * the rest of Promise-like methods
     */

    static withResolvers<T>(opts?: Partial<ClientOptions>, extSignal?: AbortSignal): PromiseRetry<T> {
        return new PromiseRetry<T>(new ClientOptions(opts), extSignal);
    }

    // biome-ignore lint/suspicious/noThenProperty: composition
    then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
    ): Promise<TResult1 | TResult2> {
        return this.promise.then(onfulfilled, onrejected);
    }

    catch<TResult = never>(
        onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null,
    ): Promise<T | TResult> {
        return this.promise.catch(onrejected);
    }

    finally(onfinally?: (() => void) | undefined | null): Promise<T> {
        return this.promise.finally(onfinally);
    }
}

/**
 * A resilient fetch client with retry logic, timeout and abort.
 */
export class ApiClient {
    private _baseURL: string;
    private _opt = new ClientOptions();
    private static _pool = new Map<string, ApiClient>();
    private static _maxPoolSize = 50; // Limit pool size to prevent memory leaks

    /**
     * @param baseURL - The base URL for the service.
     * @param options - Configuration for the client.
     */
    constructor(baseURL: string, options?: Partial<ClientOptions>) {
        this._baseURL = baseURL;
        if (options) {
            // Replace POJO.copyIn with Object.assign
            Object.assign(this._opt, options);
        }
    }

    /**
     * Makes a request to an endpoint with retry logic.
     * Returns the response processed by afterFn (default json).
     * @param input - The endpoint to fetch, relative to the baseURL.
     * @param init - Fetch options.
     * @returns A promise that resolves with the processed response.
     * Fetch is aborted when reaching the timeout.
     */
    fetch<T>(input: string, init: RequestInit = { headers: {} }): PromiseRetry<T> {
        // Set Content-Type only for POST/PUT/PATCH with a body if not present
        const method = (init.method || 'GET').toUpperCase();
        const hasBody = !!init.body;
        if (hasBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
            const hasCT = !!init && !!init.headers && Object(init.headers)['Content-Type'];
            if (!hasCT && this._opt.afterFn === 'json') {
                Object(init.headers)['Content-Type'] = 'application/json';
            }
        }

        const uri = new URL(input, this._baseURL).href;
        const retry = PromiseRetry.withResolvers<T>(this._opt, init.signal || undefined);

        // Merge default headers with request headers (request headers take precedence)
        init.headers = { ...this._opt.defaultHeaders, ...init.headers };

        // Add bearer token if configured
        if (this._opt.bearerToken) {
            if (Array.isArray(init.headers) && !init.headers.find((h) => h[0].toLowerCase() === 'authorization')) {
                init.headers.push(['Authorization', `Bearer ${this._opt.bearerToken}`]);
            } else if (!Array.isArray(init.headers)) {
                (init.headers as Record<string, string>)['Authorization'] ??= `Bearer ${this._opt.bearerToken}`;
            }
        }

        const initOpts = { ...init, signal: retry.signal };
        let err: Error | undefined;

        (async () => {
            try {
                do {
                    if (err) await sleep(retry.nextDelay());
                    try {
                        const res = await fetch(uri, initOpts);
                        if (!res.ok) {
                            throw new ErrorEx(`HTTP ${res.status}: ${res.statusText}`, res.status, res.statusText);
                        }

                        // process response
                        let data: T;
                        switch (this._opt.afterFn) {
                            case 'sse': {
                                if (!res.body) {
                                    throw new ErrorEx('Response body is null');
                                }
                                // Return SSESession after successful connection
                                const session = new SSESession(uri, initOpts, retry as PromiseRetry<unknown>, res.body);
                                data = session as unknown as T;
                                break;
                            }
                            case 'stream':
                                data = res.body as T;
                                break;
                            case 'bytes': {
                                const buffer = await res.arrayBuffer();
                                data = new Uint8Array(buffer) as unknown as T;
                                break;
                            }
                            case 'json':
                            case 'text':
                            case 'arrayBuffer':
                            case 'blob':
                            case 'formData':
                                // Type assertion is safe here because we've checked the method exists
                                data = await (res[this._opt.afterFn] as () => Promise<T>).call(res);
                                break;
                            default:
                                if (typeof this._opt.afterFn === 'function') {
                                    data = await this._opt.afterFn<T>(res);
                                } else {
                                    throw new ErrorEx(`Invalid afterFn`);
                                }
                        }

                        if (retry.signal.aborted) {
                            throw new ErrorEx(retry.signal.reason);
                        }

                        retry.resolve(data);
                        return;
                    } catch (e) {
                        err = e instanceof ErrorEx ? e : retry.signal.aborted ? new ErrorEx(retry.signal.reason) : new ErrorEx(e);
                        retry.markFailure(err.message);
                    }
                } while (!retry.failed);
                retry.reject(err);
            } finally {
                retry.clearTimeout();
            }
        })();

        return retry;
    }

    /**
     * Makes a request to an endpoint with retry logic using a pooled client.
     * Returns the response processed as json (or as configured in options).
     * @param input - The full URL to fetch.
     * @param init - Fetch options.
     * @param options - Client configuration options.
     * @returns A promise that resolves with the processed response.
     * Fetch is aborted when reaching the timeout.
     */
    static fetch<T>(input: string, init: RequestInit = {}, options?: Partial<ClientOptions>): PromiseRetry<T> {
        const url = new URL(input);
        const origin = url.origin;

        // LRU pool key based on origin + ALL options: ensures different
        // configurations get separate pooled clients.
        const poolKey = `${origin}:${JSON.stringify(options)}`;
        let client = ApiClient._pool.get(poolKey);

        if (!client) {
            if (ApiClient._pool.size >= ApiClient._maxPoolSize) {
                const firstKey = ApiClient._pool.keys().next().value;
                ApiClient._pool.delete(firstKey!);
            }

            client = new ApiClient(origin, options);
        } else {
            // remove to get proper LRU
            ApiClient._pool.delete(poolKey);
        }
        ApiClient._pool.set(poolKey, client);

        // Make request with path + search + hash
        const path = url.pathname + url.search + url.hash;
        return client.fetch<T>(path, init);
    }

    get baseUrl() {
        return this._baseURL;
    }
    get options() {
        return this._opt;
    }

    /**
     * Clear the static client pool (useful for testing or memory management)
     */
    static clearPool(): void {
        ApiClient._pool.clear();
    }

    /**
     * Get pool statistics
     */
    static getPoolStats() {
        return {
            size: ApiClient._pool.size,
            maxSize: ApiClient._maxPoolSize,
            origins: Array.from(ApiClient._pool.keys()),
        };
    }
}
