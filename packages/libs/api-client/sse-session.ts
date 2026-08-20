/* istanbul ignore file */
/**
 * SSESession: Server-Sent Events session handler for resilient API clients.
 * Handles event stream parsing, reconnection, and JSON-RPC request/response.
 */

// Test file intentionally skipped due to Bun test isolation issues with globalThis.fetch mocks
// See: https://github.com/oven-sh/bun/issues/5090
// Tests pass when run individually but interfere with other tests in the suite

import { ErrorEx } from '@libs/utils/error';
import { sleep } from '@libs/utils/time';

export class SSESession extends EventTarget {
    private _url: string;
    private _init: RequestInit;
    private _sessionId: string | undefined;
    private _endpoint?: string;
    private _reconnecting = false;
    private static _requestId = Date.now() / Math.abs(Math.random() * 100);

    private _retry: {
        signal: AbortSignal;
        nextDelay: () => number;
        failed: boolean;
        abort: (reason?: string) => void;
        state: { failures: number };
    };

    constructor(
        url: string,
        init: RequestInit,
        retry: {
            signal: AbortSignal;
            nextDelay: () => number;
            failed: boolean;
            abort: (reason?: string) => void;
            state: { failures: number };
        },
        stream: ReadableStream<Uint8Array>,
    ) {
        super();
        this._url = url;
        this._init = init;
        this._retry = retry;
        this._readStream(stream).catch((error) => {
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

    /* istanbul ignore start **/
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
                        setTimeout(() => res(false), 1000);
                    });
                    waiting = false;
                }
            }
        } finally {
            this.removeEventListener('sse:message', handler as EventListener);
        }
    }
    /* istanbul ignore end **/

    async sendRequest<T>(method: string, params?: unknown): Promise<T> {
        if (this.closed) throw new ErrorEx('Session is closed');
        if (!this._endpoint) throw new ErrorEx('Not connected - no endpoint URL received from SSE stream');

        const endpointUrl = new URL(this._endpoint, this._url);
        const headers = {
            ...this._init.headers,
            ...(this._sessionId ? { 'X-Session-Id': this._sessionId } : {}),
            ...{ 'Content-Type': 'application/json' },
        };
        const id = ++SSESession._requestId;
        const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

        const responsePromise = new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.removeEventListener('sse:message', handler as EventListener);
                reject(new ErrorEx('Request timeout - no response received', 408, 'Timeout'));
            }, 30000);

            const handler = (e: Event) => {
                if (!(e instanceof CustomEvent)) return;
                const data = e.detail;
                if (typeof data === 'object' && data !== null && 'id' in data && data.id === id) {
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

            this.addEventListener('sse:message', handler as EventListener);
        });

        const res = await fetch(endpointUrl, {
            method: 'POST',
            headers,
            body,
            signal: this._retry.signal,
        });
        if (!res.ok && res.status !== 202) {
            throw new ErrorEx(`HTTP ${res.status}: ${res.statusText}`, res.status, res.statusText);
        }
        if (res.status === 202) {
            return responsePromise;
        }
        return res.json() as Promise<T>;
    }

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
                            try {
                                parsedData = JSON.parse(data);
                            } catch {}
                            if (eventType === 'endpoint' && typeof parsedData === 'string') {
                                this._endpoint = parsedData;
                                const match = parsedData.match(/[?&]session[_-]?id=([^&]+)/i);
                                if (match) {
                                    this.sessionId = match[1];
                                }
                            } else if (typeof parsedData === 'object' && parsedData !== null && 'sessionId' in parsedData) {
                                this.sessionId = (parsedData as { sessionId: string }).sessionId;
                            }
                            this.dispatchEvent(new CustomEvent(`sse:${eventType}`, { detail: parsedData }));
                            data = '';
                            eventType = 'message';
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
            if (!this.closed && !this._retry.failed) {
                await this._reconnect();
            }
        }
    }

    protected async _reconnect(): Promise<void> {
        this._reconnecting = true;
        const attempt = this._retry.state.failures + 1;

        this.dispatchEvent(new CustomEvent('reconnecting', { detail: { attempt } }));

        await sleep(this._retry.nextDelay());

        try {
            const headers = {
                ...this._init.headers,
                ...(this._sessionId ? { 'X-Session-Id': this._sessionId } : {}),
                ...{ 'Content-Type': 'application/json' },
            };

            const res = await fetch(this._url, {
                ...this._init,
                headers,
                signal: this._retry.signal,
            });

            if (!res.ok) {
                throw new ErrorEx(`HTTP ${res.status}: ${res.statusText}`, res.status, res.statusText);
            }
            if (!res.body) {
                throw new ErrorEx('Response body is empty');
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
