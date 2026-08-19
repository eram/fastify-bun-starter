/**
 * Unit tests for SSESession class in sse-session.ts
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { sleep } from '@libs/utils/time';
import { SSESession } from './sse-session';

// Type-safe globalThis for spyOn calls
const getGlobalScope = (): typeof globalThis => globalThis as unknown as typeof globalThis;

describe('SSESession', () => {
    test('should parse sessionId from endpoint event', async () => {
        // Mock stream with endpoint event
        const text = new TextEncoder().encode('event:endpoint\ndata:/messages?sessionId=abc123\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        await sleep(10);
        expect(session.sessionId).toBe('abc123');
        expect(session.endpoint).toBe('/messages?sessionId=abc123');
    });

    test('should emit sse:message event', async () => {
        const text = new TextEncoder().encode('event:message\ndata:{"foo":"bar"}\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        let eventReceived = false;
        session.addEventListener('sse:message', (e: Event) => {
            if (e instanceof CustomEvent) {
                eventReceived = true;
                expect(e.detail.foo).toBe('bar');
            }
        });

        await sleep(10);
        expect(eventReceived).toBeTruthy();
    });

    test('should reconnect on stream end if not closed', async () => {
        let reconnectCalled = false;

        class TestSession extends SSESession {
            protected override async _reconnect(): Promise<void> {
                reconnectCalled = true;
            }
        }

        const text = new TextEncoder().encode('event:message\ndata:test\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        new TestSession('http://localhost', {}, dummyRetry, mockStream);
        await sleep(20);
        expect(reconnectCalled).toBeTruthy();
    });

    test('should close session and emit disconnected', async () => {
        const text = new TextEncoder().encode('event:message\ndata:test\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const abortController = new AbortController();
        const dummyRetry = {
            signal: abortController.signal,
            nextDelay: () => 1,
            failed: false,
            abort: (reason?: string) => abortController.abort(reason),
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        let disconnected = false;
        session.addEventListener('disconnected', () => {
            disconnected = true;
        });

        session.close();
        await sleep(10);
        expect(disconnected).toBeTruthy();
        expect(session.closed).toBeTruthy();
    });

    test('should handle multiple SSE events', async () => {
        const text = new TextEncoder().encode(
            'event:endpoint\ndata:/messages?sessionId=xyz\n\n' +
                'event:message\ndata:{"msg":"first"}\n\n' +
                'event:message\ndata:{"msg":"second"}\n\n',
        );
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        const messages: unknown[] = [];
        session.addEventListener('sse:message', (e: Event) => {
            if (e instanceof CustomEvent) {
                messages.push(e.detail);
            }
        });

        await sleep(20);
        expect(session.sessionId).toBe('xyz');
        expect(messages.length).toBe(2);
    });

    test('should handle error events', async () => {
        const text = new TextEncoder().encode('event:error\ndata:{"error":"something went wrong"}\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        let errorReceived = false;
        session.addEventListener('sse:error', (e: Event) => {
            if (e instanceof CustomEvent) {
                errorReceived = true;
                expect(e.detail.error).toBe('something went wrong');
            }
        });

        await sleep(10);
        expect(errorReceived).toBeTruthy();
    });

    test('should handle custom events', async () => {
        const text = new TextEncoder().encode('event:custom\ndata:{"custom":"data"}\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        let customEventReceived = false;
        session.addEventListener('sse:custom', (e: Event) => {
            if (e instanceof CustomEvent) {
                customEventReceived = true;
                expect(e.detail.custom).toBe('data');
            }
        });

        await sleep(10);
        expect(customEventReceived).toBeTruthy();
    });

    test('should handle partial events across chunks', async () => {
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                // Send incomplete event first
                controller.enqueue(new TextEncoder().encode('event:message\nda'));
                // Then complete it
                controller.enqueue(new TextEncoder().encode('ta:{"test":true}\n\n'));
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        let eventReceived = false;
        session.addEventListener('sse:message', (e: Event) => {
            if (e instanceof CustomEvent) {
                eventReceived = true;
                expect(e.detail.test).toBe(true);
            }
        });

        await sleep(20);
        expect(eventReceived).toBeTruthy();
    });

    test('should test endpoint and sessionId getters', async () => {
        const text = new TextEncoder().encode(
            'event:endpoint\ndata:/messages?sessionId=gen123\n\n' + 'event:message\ndata:{"id":1,"msg":"test1"}\n\n',
        );
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                setTimeout(() => controller.close(), 50);
            },
        });

        const abortController = new AbortController();
        const dummyRetry = {
            signal: abortController.signal,
            nextDelay: () => 1,
            failed: false,
            abort: (reason?: string) => abortController.abort(reason),
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        await sleep(30); // Let events be processed

        // Test getters
        expect(session.sessionId).toBe('gen123');
        expect(session.endpoint).toBeTruthy();
        expect(session.connected).toBeTruthy();
        expect(session.reconnecting).toBe(false);

        session.close();
    });

    test('should test sendRequest method with endpoint', async () => {
        const text = new TextEncoder().encode('event:endpoint\ndata:/api/test\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                // Keep stream open
            },
        });

        const abortController = new AbortController();
        const dummyRetry = {
            signal: abortController.signal,
            nextDelay: () => 1,
            failed: false,
            abort: (reason?: string) => abortController.abort(reason),
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        await sleep(20); // Wait for endpoint to be set

        // Test that endpoint is set
        expect(session.endpoint).toBeTruthy();
        expect(session.endpoint).toBe('/api/test');

        session.close();
    });

    test('should handle sendRequest when closed', async () => {
        const text = new TextEncoder().encode('event:endpoint\ndata:/api/test\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const abortController = new AbortController();
        const dummyRetry = {
            signal: abortController.signal,
            nextDelay: () => 1,
            failed: false,
            abort: (reason?: string) => abortController.abort(reason),
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        session.close();

        // sendRequest should throw when session is closed
        await expect(session.sendRequest('test.method')).rejects.toThrow(/Session is closed/);
    });

    test('should test connected and reconnecting properties', async () => {
        const text = new TextEncoder().encode('event:message\ndata:{"test":true}\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                setTimeout(() => controller.close(), 50);
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);

        // Initially should be connected (not reconnecting, not closed)
        expect(session.connected).toBeTruthy();
        expect(session.reconnecting).toBe(false);
        expect(session.closed).toBe(false);

        await sleep(10);
    });

    test('should handle stream read errors', async () => {
        const errorPromise = new Promise<boolean>((resolve) => {
            const mockStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    // Delay error to allow event listener to be registered
                    setTimeout(() => {
                        controller.error(new Error('Stream error'));
                    }, 50);
                },
            });

            const dummyRetry = {
                signal: new AbortController().signal,
                nextDelay: () => 1,
                failed: false,
                abort: () => {},
                state: { failures: 0 },
            };

            const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);

            session.addEventListener('error', (e: Event) => {
                if (e instanceof CustomEvent) {
                    resolve(true);
                }
            });

            // Timeout in case error never arrives
            setTimeout(() => resolve(false), 200);
        });

        const errorReceived = await errorPromise;
        expect(errorReceived, 'Error event should be received').toBeTruthy();
    });

    test('should parse sessionId from endpoint URL', async () => {
        const text = new TextEncoder().encode('event:endpoint\ndata:/messages?sessionId=abc123\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        await sleep(10);

        expect(session.sessionId).toBe('abc123');
        expect(session.endpoint).toBe('/messages?sessionId=abc123');
    });

    test('should trigger session-changed event when sessionId changes', async () => {
        const text = new TextEncoder().encode('event:endpoint\ndata:/messages\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                controller.close();
            },
        });

        const dummyRetry = {
            signal: new AbortController().signal,
            nextDelay: () => 1,
            failed: false,
            abort: () => {},
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        let sessionChanged = false;
        let oldId: string | undefined;
        let newId: string | undefined;

        session.addEventListener('session-changed', (e: Event) => {
            if (e instanceof CustomEvent) {
                sessionChanged = true;
                oldId = e.detail.oldId;
                newId = e.detail.newId;
            }
        });

        await sleep(10);
        session.sessionId = 'new-session-123';
        await sleep(5);

        expect(sessionChanged).toBeTruthy();
        expect(oldId).toBe(undefined);
        expect(newId).toBe('new-session-123');
        expect(session.sessionId).toBe('new-session-123');
    });

    test('should handle sendRequest error without endpoint', async () => {
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                // Don't send endpoint event
                controller.close();
            },
        });

        const abortController = new AbortController();
        const dummyRetry = {
            signal: abortController.signal,
            nextDelay: () => 1,
            failed: false,
            abort: (reason?: string) => abortController.abort(reason),
            state: { failures: 0 },
        };

        const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
        await sleep(20);

        await expect(session.sendRequest('test.method')).rejects.toThrow(/Not connected - no endpoint URL/);

        session.close();
    });

    test('should handle sendRequest with successful HTTP response (non-202)', async () => {
        const text = new TextEncoder().encode('event:endpoint\ndata:/messages\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                // Keep stream open
            },
        });

        const abortController = new AbortController();
        const dummyRetry = {
            signal: abortController.signal,
            nextDelay: () => 1,
            failed: false,
            abort: (reason?: string) => abortController.abort(reason),
            state: { failures: 0 },
        };

        const mockFetch = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
            });
        });

        try {
            const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
            await sleep(20);

            const result = await session.sendRequest<{ success: boolean }>('test.method');
            expect(result).toBeTruthy();
            expect(result.success).toBe(true);
            expect(mockFetch.mock.calls.length > 0).toBeTruthy(); // bun:test mock.calls is compatible

            session.close();
        } finally {
            mockFetch.mockRestore();
        }
    });

    test('should handle sendRequest with HTTP error status', async () => {
        const text = new TextEncoder().encode('event:endpoint\ndata:/messages\n\n');
        const mockStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(text);
                // Keep stream open
            },
        });

        const abortController = new AbortController();
        const dummyRetry = {
            signal: abortController.signal,
            nextDelay: () => 1,
            failed: false,
            abort: (reason?: string) => abortController.abort(reason),
            state: { failures: 0 },
        };

        const mockFetch = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return new Response('Server Error', { status: 500, statusText: 'Internal Server Error' });
        });
        try {
            const session = new SSESession('http://localhost', {}, dummyRetry, mockStream);
            await sleep(20);

            await expect(session.sendRequest('test.method')).rejects.toThrow(/HTTP 500/);

            expect(mockFetch.mock.calls.length > 0).toBeTruthy(); // bun:test mock.calls is compatible
            session.close();
        } finally {
            mockFetch.mockRestore();
        }
    });
});
