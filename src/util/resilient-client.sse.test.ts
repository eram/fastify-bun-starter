/**
 * Unit tests for SSESession class in resilient-client.ts
 * Tests SSE (Server-Sent Events) functionality with proper mocking
 */

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { ResilientClient, SSESession } from './resilient-client';
import { sleep } from './sleep';

// Helper to create a controlled SSE stream
function createSSEStream(data: string, autoClose = false) {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(data));
            if (autoClose) {
                setTimeout(() => controller.close(), 50);
            }
        },
    });
}

describe('SSESession', () => {
    test('should create SSE session and parse endpoint event', async () => {
        const sseData = 'event: endpoint\ndata: /messages?session_id=test123\n\n';
        const stream = createSSEStream(sseData);

        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            // Wait for session ID to be parsed
            await sleep(200);

            strictEqual(session.sessionId, 'test123', 'Session ID should be parsed from endpoint event');
            strictEqual(session.endpoint, '/messages?session_id=test123', 'Endpoint should be stored');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');

            session.close();
            await sleep(50);
        } finally {
            mock.reset();
        }
    });

    test('should handle SSE message events', async () => {
        const sseData =
            'event: endpoint\ndata: /messages?session_id=abc\n\n' +
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":"test"}\n\n';

        const stream = new ReadableStream({
            start(controller) {
                // Delay sending data to allow event listeners to be registered
                setTimeout(() => {
                    controller.enqueue(new TextEncoder().encode(sseData));
                    setTimeout(() => controller.close(), 100);
                }, 50);
            },
        });

        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            // Collect events
            const events: Array<{ event: string; data: unknown }> = [];
            const handler = (e: Event) => {
                if (e instanceof CustomEvent && e.type.startsWith('sse:')) {
                    events.push({ event: e.type.slice(4), data: e.detail });
                }
            };

            session.addEventListener('sse:message', handler as EventListener);
            session.addEventListener('sse:endpoint', handler as EventListener);

            // Wait for events to be processed
            await new Promise((resolve) => setTimeout(resolve, 300));

            ok(events.length >= 2, 'Should receive endpoint and message events');
            strictEqual(events[0].event, 'endpoint');
            strictEqual(events[1].event, 'message');
            deepStrictEqual(events[1].data, { jsonrpc: '2.0', id: 1, result: 'test' });

            strictEqual(fn.mock.calls.length, 1);
            session.close();
        } finally {
            mock.reset();
        }
    });

    test('should parse various SSE data formats', async () => {
        // Test 1: JSON data
        let sseData = 'data: {"type":"test","value":42}\n\n';
        let stream = new ReadableStream({
            start(controller) {
                setTimeout(() => {
                    controller.enqueue(new TextEncoder().encode(sseData));
                    setTimeout(() => controller.close(), 100);
                }, 50);
            },
        });

        let fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            let receivedData: unknown;
            const handler = (e: Event) => {
                if (e instanceof CustomEvent && e.type === 'sse:message') {
                    receivedData = e.detail;
                }
            };

            session.addEventListener('sse:message', handler as EventListener);
            await new Promise((resolve) => setTimeout(resolve, 300));

            deepStrictEqual(receivedData, { type: 'test', value: 42 }, 'Should parse JSON data');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');
            session.close();
        } finally {
            mock.reset();
        }

        // Test 2: Non-JSON data as string
        sseData = 'data: plain text message\n\n';
        stream = new ReadableStream({
            start(controller) {
                setTimeout(() => {
                    controller.enqueue(new TextEncoder().encode(sseData));
                    setTimeout(() => controller.close(), 100);
                }, 50);
            },
        });

        fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            let receivedData: unknown;
            const handler = (e: Event) => {
                if (e instanceof CustomEvent && e.type === 'sse:message') {
                    receivedData = e.detail;
                }
            };

            session.addEventListener('sse:message', handler as EventListener);
            await new Promise((resolve) => setTimeout(resolve, 300));

            strictEqual(receivedData, 'plain text message', 'Should handle non-JSON as string');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');
            session.close();
        } finally {
            mock.reset();
        }

        // Test 3: Multi-line data
        sseData = 'data: line1\ndata: line2\ndata: line3\n\n';
        stream = new ReadableStream({
            start(controller) {
                setTimeout(() => {
                    controller.enqueue(new TextEncoder().encode(sseData));
                    setTimeout(() => controller.close(), 100);
                }, 50);
            },
        });

        fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            let receivedData: unknown;
            const handler = (e: Event) => {
                if (e instanceof CustomEvent && e.type === 'sse:message') {
                    receivedData = e.detail;
                }
            };

            session.addEventListener('sse:message', handler as EventListener);
            await new Promise((resolve) => setTimeout(resolve, 300));

            strictEqual(receivedData, 'line1line2line3', 'Multi-line data should be concatenated');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');
            session.close();
        } finally {
            mock.reset();
        }
    });

    test('should track connection state and emit events', async () => {
        // Test 1: Connected state on connection
        let stream = new ReadableStream({
            start(controller) {
                setTimeout(() => {
                    controller.enqueue(new TextEncoder().encode('data: test\n\n'));
                    setTimeout(() => controller.close(), 100);
                }, 50);
            },
        });

        let fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            await new Promise((resolve) => setTimeout(resolve, 300));

            strictEqual(session.connected, true, 'Session should be connected');
            strictEqual(session.closed, false, 'Session should not be closed initially');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');

            session.close();
        } finally {
            mock.reset();
        }

        // Test 2: Disconnected event and closed state
        stream = new ReadableStream({
            start(controller) {
                setTimeout(() => controller.close(), 500);
            },
        });

        fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            let disconnectedEmitted = false;
            const handler = () => {
                disconnectedEmitted = true;
            };

            session.addEventListener('disconnected', handler);
            await new Promise((resolve) => setTimeout(resolve, 50));

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));

            strictEqual(disconnectedEmitted, true, 'Disconnected event should be emitted');
            strictEqual(session.closed, true, 'Session should be marked as closed');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');
        } finally {
            mock.reset();
        }
    });

    test('should reject sendRequest when closed', async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /msg?session_id=test\n\n'));
                controller.close();
            },
        });

        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            await new Promise((resolve) => setTimeout(resolve, 100));

            session.close();

            await rejects(
                async () => {
                    await session.sendRequest('test');
                },
                /Session is closed/,
                'Should reject when session is closed',
            );

            strictEqual(fn.mock.calls.length, 1);
        } finally {
            mock.reset();
        }
    });

    test('should send JSON-RPC request and wait for response', async () => {
        const requestId = Date.now();
        const stream = new ReadableStream({
            start(controller) {
                // Delay all data to allow listener registration
                setTimeout(() => {
                    // Send endpoint first
                    controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /messages?session_id=xyz\n\n'));
                    // Then send response after another delay
                    setTimeout(() => {
                        const response = `data: ${JSON.stringify({ jsonrpc: '2.0', id: requestId, result: { success: true } })}\n\n`;
                        controller.enqueue(new TextEncoder().encode(response));
                        setTimeout(() => controller.close(), 100);
                    }, 200);
                }, 50);
            },
        });

        let postCallCount = 0;
        const _fn = mock.method(globalThis, 'fetch', async (_input: string, init?: RequestInit) => {
            if (init?.method === 'POST') {
                postCallCount++;
                return new Response(null, { status: 202 }); // SSE returns 202 Accepted
            }
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            // Wait for endpoint to be set
            await new Promise((resolve) => setTimeout(resolve, 250));

            // Mock Date.now to return consistent request ID
            const originalDateNow = Date.now;
            Date.now = () => requestId;

            try {
                const result = await session.sendRequest('test_method', { param: 'value' });

                deepStrictEqual(result, { success: true });
                strictEqual(postCallCount, 1, 'Should make POST request');
            } finally {
                Date.now = originalDateNow;
            }

            session.close();
        } finally {
            mock.reset();
        }
    });

    test('should use readEvents async iterator', async () => {
        let sendMessages: (() => void) | undefined;

        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /msg?session_id=test\n\n'));
                // Set up function to send messages on demand
                sendMessages = () => {
                    controller.enqueue(new TextEncoder().encode('event: message\ndata: {"type":"test1"}\n\n'));
                    controller.enqueue(new TextEncoder().encode('event: message\ndata: {"type":"test2"}\n\n'));
                };
            },
        });

        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 200));

            const events: Array<{ event: string; data: unknown }> = [];

            // Start iterator
            const iteratorPromise = (async () => {
                for await (const event of session.readEvents()) {
                    events.push(event);
                    if (events.length >= 2) {
                        break;
                    }
                }
            })();

            // Send messages after iterator is listening
            await new Promise((resolve) => setTimeout(resolve, 100));
            sendMessages?.();

            // Wait for iterator with timeout
            await Promise.race([
                iteratorPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
            ]);

            // Verify events
            ok(events.length >= 2, `Should have at least 2 events, got ${events.length}`);
            strictEqual(events[0].event, 'message', 'First event should be message');
            deepStrictEqual(events[0].data, { type: 'test1' }, 'First event data should match');
            strictEqual(events[1].event, 'message', 'Second event should be message');
            deepStrictEqual(events[1].data, { type: 'test2' }, 'Second event data should match');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
        }
    });

    test('should handle stream errors gracefully', async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /msg?session_id=test\n\n'));
                setTimeout(() => {
                    controller.error(new Error('Stream error'));
                }, 100);
            },
        });

        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            let errorEmitted = false;
            session.addEventListener('error', () => {
                errorEmitted = true;
            });

            // Wait for stream error
            await new Promise((resolve) => setTimeout(resolve, 200));

            ok(errorEmitted, 'Error event should be emitted');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
        }
    });

    test('should handle sendRequest errors', async () => {
        // Test 1: No endpoint error
        let stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('event: message\ndata: test\n\n'));
            },
        });

        let fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            await new Promise((resolve) => setTimeout(resolve, 100));

            await rejects(
                async () => session.sendRequest('test.method'),
                /Not connected - no endpoint URL received/,
                'Should reject when no endpoint',
            );
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
        }

        // Test 2: JSON-RPC error response
        let fetchCallCount = 0;
        let sendErrorResponse: (() => void) | undefined;

        stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /msg?session_id=test\n\n'));
                sendErrorResponse = () => {
                    const errorResponse = {
                        jsonrpc: '2.0',
                        id: 0,
                        error: { code: -32601, message: 'Method not found' },
                    };
                    controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`));
                };
            },
        });

        fn = mock.method(globalThis, 'fetch', async () => {
            fetchCallCount++;
            if (fetchCallCount === 1) {
                return new Response(stream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                });
            }
            setTimeout(() => sendErrorResponse?.(), 10);
            return new Response(null, { status: 202 });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            await new Promise((resolve) => setTimeout(resolve, 200));

            const originalDateNow = Date.now;
            mock.method(Date, 'now', () => 0);

            await rejects(async () => session.sendRequest('test.method'), /JSON-RPC error/, 'Should reject with JSON-RPC error');
            strictEqual(fn.mock.calls.length, 2, 'fetch should be called twice (SSE + POST)');

            Date.now = originalDateNow;

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
        }

        // Test 3: Invalid JSON-RPC response (missing result/error)
        fetchCallCount = 0;
        let streamController: ReadableStreamDefaultController<Uint8Array>;

        stream = new ReadableStream({
            start(controller) {
                streamController = controller;
                controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /msg?session_id=test\n\n'));
            },
        });

        fn = mock.method(globalThis, 'fetch', async () => {
            fetchCallCount++;
            if (fetchCallCount === 1) {
                return new Response(stream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                });
            }
            setTimeout(() => {
                const invalidResponse = {
                    jsonrpc: '2.0',
                    id: 0,
                };
                streamController.enqueue(
                    new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(invalidResponse)}\n\n`),
                );
            }, 50);
            return new Response(null, { status: 202 });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            await new Promise((resolve) => setTimeout(resolve, 150));

            const originalDateNow = Date.now;
            mock.method(Date, 'now', () => 0);

            await rejects(
                async () => session.sendRequest('test.method'),
                /Invalid JSON-RPC response/,
                'Should reject with invalid response error',
            );
            strictEqual(fn.mock.calls.length, 2, 'fetch should be called twice (SSE + POST)');

            Date.now = originalDateNow;

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
        }

        // Test 4: HTTP error response
        fetchCallCount = 0;
        stream = createSSEStream('event: endpoint\ndata: /msg?session_id=test\n\n');

        fn = mock.method(globalThis, 'fetch', async () => {
            fetchCallCount++;
            if (fetchCallCount === 1) {
                return new Response(stream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                });
            }
            return new Response('Not Found', { status: 404, statusText: 'Not Found' });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            await new Promise((resolve) => setTimeout(resolve, 200));

            await rejects(
                async () => session.sendRequest<{ result: string }>('test.method'),
                /HTTP 404/,
                'Should reject with HTTP error',
            );
            strictEqual(fn.mock.calls.length, 2, 'fetch should be called twice (SSE + POST)');

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
        }
    });

    test('should handle sessionId in JSON format', async () => {
        const sseData = 'event: endpoint\ndata: {"sessionId":"json-session-123","url":"/msg"}\n\n';
        const stream = createSSEStream(sseData);

        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            await new Promise((resolve) => setTimeout(resolve, 200));

            strictEqual(session.sessionId, 'json-session-123', 'Session ID should be parsed from JSON object');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
        }
    });

    test('should handle 200 OK with JSON body (non-SSE mode)', async () => {
        let fetchCallCount = 0;
        const stream = createSSEStream('event: endpoint\ndata: /msg?session_id=test\n\n');

        const fn = mock.method(globalThis, 'fetch', async () => {
            fetchCallCount++;
            if (fetchCallCount === 1) {
                return new Response(stream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' },
                });
            }
            // POST request returns 200 with JSON body
            return new Response(JSON.stringify({ result: 'direct-response' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('/sse');

            await new Promise((resolve) => setTimeout(resolve, 200));

            const result = await session.sendRequest<{ result: string }>('test.method');
            deepStrictEqual(result, { result: 'direct-response' }, 'Should return direct JSON response');
            strictEqual(fn.mock.calls.length, 2, 'fetch should be called twice (SSE + POST)');

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
        }
    });

    test('should handle static ResilientClient.fetch with pool', async () => {
        const stream = createSSEStream('event: endpoint\ndata: /msg?session_id=test\n\n');

        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            // Clear pool first
            ResilientClient.clearPool();
            const stats1 = ResilientClient.getPoolStats();
            strictEqual(stats1.size, 0, 'Pool should be empty after clear');

            // Use static fetch
            const session = await ResilientClient.fetch<SSESession>('http://test.local/sse', {}, { afterFn: 'sse', maxTries: 0 });

            await new Promise((resolve) => setTimeout(resolve, 200));

            const stats2 = ResilientClient.getPoolStats();
            strictEqual(stats2.size, 1, 'Pool should have 1 client');
            ok(stats2.origins.length > 0, 'Pool should contain at least one origin');
            ok(stats2.origins[0].includes('http://test.local'), 'Pool origin should include test.local');
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');

            session.close();
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            mock.reset();
            ResilientClient.clearPool();
        }
    });

    test('should handle PromiseRetry timeout', async () => {
        const stream = new ReadableStream({
            start() {
                // Never send endpoint event - will timeout
            },
        });

        const fn = mock.method(globalThis, 'fetch', async () => {
            // Delay response to exceed timeout
            await new Promise((resolve) => setTimeout(resolve, 200));
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ResilientClient('http://test.local', { afterFn: 'sse', timeout: 50, maxTries: 0 });

            await rejects(
                async () => {
                    const session = await client.fetch<SSESession>('/sse');
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    return session;
                },
                /Timeout|Aborted/,
                'Should reject with timeout',
            );
            strictEqual(fn.mock.calls.length, 1, 'fetch should be called once');

            await new Promise((resolve) => setTimeout(resolve, 200));
        } finally {
            mock.reset();
        }
    });
});
