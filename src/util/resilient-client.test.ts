import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { ClientOptions, PromiseRetry, ResilientClient } from './resilient-client';
import { sleep } from './sleep';

describe('ResilientClient', () => {
    const baseURL = 'https://api.example.com';

    test('ResilientClient positive', async (t) => {
        const mockResponse = { data: 'success' };
        const fn = mock.method(globalThis, 'fetch', async (input: string) => {
            ok(input.startsWith(baseURL));
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            const result = await ResilientClient.fetch<typeof mockResponse>(`${baseURL}/${t.name}`, {}, { maxTries: 0 });
            deepStrictEqual(result, mockResponse);
            ok(fn.mock.calls.length === 1);
        } finally {
            mock.reset();
        }
    });

    test('retry on failure and eventually succeed', async (t) => {
        const mockResponse = { data: 'ok' };
        const fn = mock.method(globalThis, 'fetch', async () => {
            if (fn.mock.calls.length < 2) {
                return new Response('Error', { status: 500 });
            }
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });

        try {
            const client = new ResilientClient(baseURL, { maxTries: 5, baseDelay: 5 });
            const retry = client.fetch<typeof mockResponse>(t.name);
            const result = await retry;

            strictEqual(fn.mock.calls.length, 2);
            deepStrictEqual(result, mockResponse);
            ok(!retry.state.aborted);
        } finally {
            mock.reset();
        }
    });

    test('fail after max retries', async (t) => {
        const fn = mock.method(globalThis, 'fetch', async () => new Response('Error', { status: 500 }));
        try {
            const client = new ResilientClient(baseURL, { maxTries: 2, baseDelay: 1 });
            const retry = client.fetch(t.name);

            await rejects(async () => {
                await retry;
            }, /500/);
            strictEqual(fn.mock.calls.length, 2);
            ok(!retry.state.aborted);
        } finally {
            mock.reset();
        }
    });

    test('fetch with timeout', async (t) => {
        const fn = mock.method(globalThis, 'fetch', async () => {
            // Mock fetch takes 100ms but timeout is set to 50ms
            await sleep(100);
            return new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
        });
        try {
            // Set a short timeout (50ms) and mock fetch to take longer (100ms)
            const client = new ResilientClient(baseURL, { baseDelay: 10, maxTries: 10, timeout: 50 });

            const retry = client.fetch(t.name);
            await rejects(async () => {
                await retry;
            }, /timeout/i);
            ok(fn.mock.calls.length > 0);
            ok(retry.state.aborted);
        } finally {
            mock.reset();
        }
    });

    test('fetch with abort', async (t) => {
        const fn = mock.method(globalThis, 'fetch', async () => {
            await sleep(10);
            return new Response('OK', { status: 200 });
        });
        try {
            const client = new ResilientClient(baseURL, { timeout: 10000 });
            const retry = client.fetch(t.name);
            retry.abort('test');
            await rejects(async () => {
                await retry;
            }, /test/i);
            strictEqual(fn.mock.calls.length, 1);
            ok(retry.state.aborted);
            strictEqual(retry.state.reason, 'test');
        } finally {
            mock.reset();
        }
    });

    test('fetch with external signal', async (t) => {
        const fn = mock.method(globalThis, 'fetch', async () => {
            await sleep(10);
            return new Response('OK', { status: 200 });
        });
        try {
            const controller = new AbortController();
            const client = new ResilientClient(baseURL);
            const retry = client.fetch(t.name, { signal: controller.signal });
            controller.abort('caller abort');
            await rejects(async () => {
                await retry;
            }, /caller abort/i);
            ok(fn.mock.calls.length === 1);
            ok(controller.signal.aborted);
            ok(retry.signal.aborted);
            strictEqual(retry.state.reason, 'caller abort');
        } finally {
            mock.reset();
        }
    });

    test('signal not used', async () => {
        const retry = new PromiseRetry(new ClientOptions());
        retry.abort('no signal'); // should not throw even if signal was not passed
        await rejects(async () => await retry, /no signal/i);
        strictEqual(retry.state.aborted, false);
    });

    test('afterFn = stream', async (t) => {
        const fn = mock.method(globalThis, 'fetch', async () => {
            // Create a ReadableStream that returns Uint8Array data
            const text = new TextEncoder().encode('stream-data');
            const mockStream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(text);
                    controller.close();
                },
            });
            return new Response(mockStream, { status: 200 });
        });
        try {
            const client = new ResilientClient(baseURL, { afterFn: 'stream' });
            const result = await client.fetch<ReadableStream<Uint8Array>>(t.name);
            // Read from the stream and check the data
            const reader = result.getReader();
            const { value, done } = await reader.read();
            strictEqual(done, false);
            strictEqual(new TextDecoder().decode(value), 'stream-data');
            const { done: done2 } = await reader.read();
            strictEqual(done2, true);
            strictEqual(fn.mock.calls.length, 1);
        } finally {
            mock.reset();
        }
    });

    test('afterFn = function', async (t) => {
        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response('text-data', { status: 200 });
        });
        try {
            const afterFn = async <T = string>(res: Response) => {
                return res.text() as Promise<T>;
            };
            const client = new ResilientClient(baseURL, { afterFn });
            const result = await client.fetch<string>(t.name);
            strictEqual(result, 'text-data');
            strictEqual(fn.mock.calls.length, 1);
        } finally {
            mock.reset();
        }
    });

    test('static fetch uses client pool for same origin and options', async (_t) => {
        const mockResponse = { data: 'pooled' };
        const fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            // Clear pool before test
            ResilientClient.clearPool();

            const url1 = `${baseURL}/endpoint1`;
            const url2 = `${baseURL}/endpoint2`;
            const opts = { maxTries: 1 };

            // First request creates client in pool
            await ResilientClient.fetch(url1, {}, opts);
            const statsAfterFirst = ResilientClient.getPoolStats();
            strictEqual(statsAfterFirst.size, 1);
            // Pool key includes origin + JSON-stringified options
            ok(statsAfterFirst.origins[0].startsWith('https://api.example.com:'));

            // Second request to same origin WITH SAME OPTIONS reuses client
            await ResilientClient.fetch(url2, {}, opts);
            const statsAfterSecond = ResilientClient.getPoolStats();
            strictEqual(statsAfterSecond.size, 1); // Still only 1 client

            strictEqual(fn.mock.calls.length, 2);
        } finally {
            mock.reset();
            ResilientClient.clearPool();
        }
    });

    test('static fetch creates separate clients for different origins', async (_t) => {
        const mockResponse = { data: 'separate' };
        const _fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            ResilientClient.clearPool();

            const opts = { maxTries: 1 };
            await ResilientClient.fetch('https://api1.example.com/test', {}, opts);
            await ResilientClient.fetch('https://api2.example.com/test', {}, opts);

            const stats = ResilientClient.getPoolStats();
            strictEqual(stats.size, 2);
            // Pool keys include origin + options, so check if origins are present
            ok(stats.origins.some((k) => k.startsWith('https://api1.example.com:')));
            ok(stats.origins.some((k) => k.startsWith('https://api2.example.com:')));
        } finally {
            mock.reset();
            ResilientClient.clearPool();
        }
    });

    test('static fetch pool respects maxPoolSize with LRU eviction', async (_t) => {
        const mockResponse = { data: 'lru' };
        const _fn = mock.method(globalThis, 'fetch', async () => {
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            ResilientClient.clearPool();

            const opts = { maxTries: 1 };
            // Create clients up to the pool limit (50) + 2
            for (let i = 0; i <= 51; i++) {
                await ResilientClient.fetch(`https://api${i}.example.com/test`, {}, opts);
            }

            const stats = ResilientClient.getPoolStats();
            strictEqual(stats.size, stats.maxSize); // Should not exceed maxSize
            // First origins should be evicted (LRU), latest should remain
            ok(!stats.origins.some((k) => k.startsWith('https://api0.example.com:')));
            ok(!stats.origins.some((k) => k.startsWith('https://api1.example.com:')));
            ok(stats.origins.some((k) => k.startsWith('https://api51.example.com:')));
        } finally {
            mock.reset();
            ResilientClient.clearPool();
        }
    });

    test('static fetch creates separate pool entries for different bearer tokens', async (_t) => {
        const mockResponse = { data: 'token' };
        const fn = mock.method(globalThis, 'fetch', async () => {
            return Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }));
        });
        try {
            ResilientClient.clearPool();

            const url = 'https://api.example.com/test';
            await ResilientClient.fetch(url, {}, { maxTries: 1, bearerToken: 'token123' });
            await ResilientClient.fetch(url, {}, { maxTries: 1, bearerToken: 'token456' });

            const stats = ResilientClient.getPoolStats();
            strictEqual(stats.size, 2); // Different tokens = different pool entries
            strictEqual(fn.mock.calls.length, 2);
        } finally {
            mock.reset();
            ResilientClient.clearPool();
        }
    });

    test('userAgent sets User-Agent header', async (t) => {
        const mockResponse = { data: 'success' };
        const fn = mock.method(globalThis, 'fetch', async (_input: string, init?: RequestInit) => {
            // Verify User-Agent header is set
            const headers = new Headers(init?.headers);
            strictEqual(headers.get('User-Agent'), 'test-agent/1.0.0', 'User-Agent header should be set');
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            const client = new ResilientClient(baseURL, { userAgent: 'test-agent/1.0.0' });
            const result = await client.fetch<typeof mockResponse>(t.name);
            deepStrictEqual(result, mockResponse);
            strictEqual(fn.mock.calls.length, 1);
        } finally {
            mock.reset();
        }
    });

    test('userAgent merges with request headers', async (t) => {
        const mockResponse = { data: 'success' };
        const fn = mock.method(globalThis, 'fetch', async (_input: string, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            strictEqual(headers.get('User-Agent'), 'test-agent/2.0.0', 'User-Agent should be set');
            strictEqual(headers.get('X-Custom'), 'custom-value', 'Custom header should be set');
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            const client = new ResilientClient(baseURL, { userAgent: 'test-agent/2.0.0' });
            const result = await client.fetch<typeof mockResponse>(t.name, {
                headers: { 'X-Custom': 'custom-value' },
            });
            deepStrictEqual(result, mockResponse);
            strictEqual(fn.mock.calls.length, 1);
        } finally {
            mock.reset();
        }
    });
});
