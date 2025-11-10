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

import { isDebugging } from './debugger';
import { ErrorEx } from './error';
import { sleep } from './sleep';

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

    constructor(opts?: Readonly<Partial<ClientOptions>>) {
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
                this.defaultHeaders.Accept = 'application/octet-stream';
                break;

            case 'blob':
                this.defaultHeaders.Accept = 'image/*, application/octet-stream';
                break;

            case 'formData':
                this.defaultHeaders.Accept = '*/*';
                break;

            case 'text':
                this.defaultHeaders.Accept = 'text/plain, text/html';
                break;

            case 'sse':
                this.defaultHeaders.Accept = 'application/json, text/event-stream';
                break;

            default: // 'json':
                this.defaultHeaders.Accept = 'application/json';
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

    static withResolvers<T>(opts?: Readonly<Partial<ClientOptions>>, extSignal?: AbortSignal): PromiseRetry<T> {
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
export class ResilientClient {
    private _baseURL: string;
    private _opt = new ClientOptions();
    private static _pool = new Map<string, ResilientClient>();
    private static _maxPoolSize = 50; // Limit pool size to prevent memory leaks

    /**
     * @param baseURL - The base URL for the service.
     * @param options - Configuration for the client.
     */
    constructor(baseURL: string, options?: Readonly<Partial<ClientOptions>>) {
        this._baseURL = baseURL;
        if (options) {
            // Replace POJO.copyIn with Object.assign
            Object.assign(this._opt, options);
        }
    }

    /**
     * Clear the static client pool (useful for testing or memory management)
     */
    static clearPool(): void {
        ResilientClient._pool.clear();
    }

    /**
     * Get pool statistics
     */
    static getPoolStats() {
        return {
            size: ResilientClient._pool.size,
            maxSize: ResilientClient._maxPoolSize,
            origins: Array.from(ResilientClient._pool.keys()),
        };
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
                (init.headers as Record<string, string>).Authorization ??= `Bearer ${this._opt.bearerToken}`;
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
    static fetch<T>(input: string, init: RequestInit = {}, options?: Readonly<Partial<ClientOptions>>): PromiseRetry<T> {
        const url = new URL(input);
        const origin = url.origin;

        // LRU pool key based on origin + ALL options: ensures different
        // configurations get separate pooled clients.
        const poolKey = `${origin}:${JSON.stringify(options)}`;
        let client = ResilientClient._pool.get(poolKey);

        if (!client) {
            if (ResilientClient._pool.size >= ResilientClient._maxPoolSize) {
                const firstKey = ResilientClient._pool.keys().next().value;
                ResilientClient._pool.delete(firstKey!);
            }

            client = new ResilientClient(origin, options);
        } else {
            // remove to get proper LRU
            ResilientClient._pool.delete(poolKey);
        }
        ResilientClient._pool.set(poolKey, client);

        // Make request with path + search + hash
        const path = url.pathname + url.search + url.hash;
        return client.fetch<T>(path, init);
    }
}

/**
 * SSE (Server-Sent Events) session with automatic reconnection.
 * Extends EventTarget to emit events for lifecycle and SSE messages.
 *
 * Events emitted:
 * - 'connected': When connection is established
 * - 'disconnected': When connection is closed
 * - 'reconnecting': When attempting to reconnect (detail: { attempt: number })
 * - 'session-changed': When session ID changes (detail: { oldId?: string, newId?: string })
 * - 'error': When an error occurs (detail: { error: Error })
 * - 'sse:{eventType}': For each SSE event received (detail: data object)
 */
export class SSESession extends EventTarget {
    private _url: string;
    private _init: RequestInit;
    private _sessionId?: string;
    private _endpoint?: string; // POST endpoint from 'endpoint' event
    private _reconnecting = false;
    private _retry: PromiseRetry<unknown>;

    constructor(url: string, init: RequestInit, retry: PromiseRetry<unknown>, stream: ReadableStream<Uint8Array>) {
        super();
        this._url = url;
        this._init = init;
        this._retry = retry;

        // Start reading the stream
        this._readStream(stream).catch((error) => {
            // Don't emit error if session was intentionally closed
            if (this.closed) return;

            const err = error instanceof Error ? error : new ErrorEx(error);
            this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));
        });
    }

    get sessionId(): string | undefined {
        return this._sessionId;
    }

    set sessionId(value: string | undefined) {
        const oldId = this._sessionId;
        this._sessionId = value;
        if (oldId !== value) {
            this.dispatchEvent(new CustomEvent('session-changed', { detail: { oldId, newId: value } }));
        }
    }

    get endpoint(): string | undefined {
        return this._endpoint;
    }

    get connected(): boolean {
        return !this._reconnecting && !this.closed;
    }

    get reconnecting(): boolean {
        return this._reconnecting;
    }

    get closed(): boolean {
        return this._retry.signal.aborted;
    }

    /**
     * Async iterator for SSE events.
     * Usage: for await (const event of session.readEvents()) { ... }
     */
    async *readEvents(): AsyncGenerator<{ event: string; data: unknown }> {
        const events: Array<{ event: string; data: unknown }> = [];
        let resolve: ((value: boolean) => void) | undefined;
        let waiting = false;

        const handler = (e: Event) => {
            if (e instanceof CustomEvent && e.type.startsWith('sse:')) {
                events.push({ event: e.type.slice(4), data: e.detail });
                if (waiting && resolve) {
                    resolve(true);
                    waiting = false;
                }
            }
        };

        this.addEventListener('sse:message', handler as EventListener);

        try {
            while (!this.closed) {
                if (events.length > 0) {
                    yield events.shift()!;
                } else {
                    waiting = true;
                    await new Promise<boolean>((res) => {
                        resolve = res;
                        setTimeout(() => res(false), 1000); // timeout to check closed state
                    });
                    waiting = false;
                }
            }
        } finally {
            this.removeEventListener('sse:message', handler as EventListener);
        }
    }

    /**
     * Send a JSON-RPC request using the same client instance.
     * For SSE transport, the response comes via the SSE stream, not as the HTTP response body.
     */
    async sendRequest<T>(method: string, params?: unknown): Promise<T> {
        if (this.closed) {
            throw new ErrorEx('Session is closed');
        }

        // Use the endpoint URL from the 'endpoint' event, not the original SSE connection URL
        if (!this._endpoint) {
            throw new ErrorEx('Not connected - no endpoint URL received from SSE stream');
        }

        // Construct full endpoint URL by combining base URL with endpoint path
        const endpointUrl = new URL(this._endpoint, this._url);

        const headers = { ...this._init.headers };
        if (this._sessionId) {
            Object(headers)['Mcp-Session-Id'] = this._sessionId;
        }
        Object(headers)['Content-Type'] = 'application/json';

        const requestId = Date.now();
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            method,
            params,
        });

        // Set up promise to wait for response via SSE stream BEFORE sending request
        // This ensures we don't miss the response if server is very fast
        const responsePromise = new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.removeEventListener('sse:message', handler as EventListener);
                reject(new ErrorEx('Request timeout - no response received', 408, 'Timeout'));
            }, 30000); // 30 second timeout

            const handler = (e: Event) => {
                if (!(e instanceof CustomEvent)) return;

                const data = e.detail;
                if (typeof data === 'object' && data !== null && 'id' in data && data.id === requestId) {
                    clearTimeout(timeout);
                    this.removeEventListener('sse:message', handler as EventListener);

                    if ('error' in data) {
                        reject(new ErrorEx(`JSON-RPC error: ${JSON.stringify(data.error)}`));
                    } else if ('result' in data) {
                        resolve(data.result as T);
                    } else {
                        reject(new ErrorEx('Invalid JSON-RPC response - missing result/error'));
                    }
                }
            };

            // Register listener BEFORE making the POST request
            this.addEventListener('sse:message', handler as EventListener);
        });

        // POST to the endpoint URL, not the SSE connection URL
        // For SSE transport, server returns 202 Accepted and sends response via SSE
        const res = await fetch(endpointUrl, {
            method: 'POST',
            headers,
            body,
            signal: this._retry.signal,
        });

        if (!res.ok && res.status !== 202) {
            throw new ErrorEx(`HTTP ${res.status}: ${res.statusText}`, res.status, res.statusText);
        }

        // For SSE transport, response comes via stream, not HTTP response body
        if (res.status === 202) {
            return responsePromise;
        }

        // Fallback: if server returns 200 with JSON body (non-SSE mode)
        return res.json() as Promise<T>;
    }

    /**
     * Close the session and stop reconnection attempts.
     */
    close(): void {
        this._retry.abort('Session closed');
        this.dispatchEvent(new CustomEvent('disconnected'));
    }

    private async _readStream(stream: ReadableStream<Uint8Array>): Promise<void> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        this.dispatchEvent(new CustomEvent('connected'));

        try {
            while (!this.closed) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                let eventType = 'message';
                let data = '';

                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        eventType = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        data += line.slice(5).trim();
                    } else if (line.trim() === '') {
                        if (data) {
                            let parsedData: unknown = data;

                            // Try to parse as JSON, fall back to string
                            try {
                                parsedData = JSON.parse(data);
                            } catch {
                                // Keep as string if not JSON
                            }

                            // Extract session ID and endpoint from endpoint event
                            if (eventType === 'endpoint' && typeof parsedData === 'string') {
                                // Format: /messages?sessionId=xxx or /messages?session_id=xxx
                                this._endpoint = parsedData; // Store the endpoint path
                                const match = parsedData.match(/[?&]session[_-]?id=([^&]+)/i);
                                if (match) {
                                    this.sessionId = match[1];
                                }
                            } else if (typeof parsedData === 'object' && parsedData !== null && 'sessionId' in parsedData) {
                                // Also handle JSON with sessionId field
                                this.sessionId = (parsedData as { sessionId: string }).sessionId;
                            }

                            // Emit typed SSE event
                            this.dispatchEvent(new CustomEvent(`sse:${eventType}`, { detail: parsedData }));

                            data = '';
                            eventType = 'message';
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();

            // Attempt reconnection if not intentionally closed
            if (!this.closed && !this._retry.failed) {
                await this._reconnect();
            }
        }
    }

    private async _reconnect(): Promise<void> {
        this._reconnecting = true;

        const attempt = this._retry.state.failures + 1;
        this.dispatchEvent(new CustomEvent('reconnecting', { detail: { attempt } }));

        await sleep(this._retry.nextDelay());

        // Reconnect by making a new fetch call
        try {
            const headers = { ...this._init.headers };
            if (this._sessionId) {
                Object(headers)['Mcp-Session-Id'] = this._sessionId;
            }

            const res = await fetch(this._url, {
                ...this._init,
                headers,
                signal: this._retry.signal,
            });

            if (!res.ok) {
                throw new ErrorEx(`HTTP ${res.status}: ${res.statusText}`, res.status, res.statusText);
            }

            if (!res.body) {
                throw new ErrorEx('Response body is null');
            }

            this._reconnecting = false;
            await this._readStream(res.body);
        } catch (error) {
            const err = error instanceof Error ? error : new ErrorEx(error);
            this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));

            if (!this.closed && !this._retry.failed) {
                await this._reconnect();
            }
        }
    }
}
