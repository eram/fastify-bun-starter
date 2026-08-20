import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { sleep } from '@libs/utils/time';
import { ApiClient, ClientOptions, PromiseRetry } from './api-client';
import { SSESession } from './sse-session';

// Type-safe globalThis for spyOn calls
// fetch is typed with a required `preconnect` static, which real mock functions never implement;
// narrow the perceived type to a plain callable so mockImplementation accepts our test fetches.
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const getGlobalScope = (): { fetch: FetchLike } => globalThis as unknown as { fetch: FetchLike };

describe('ApiClient', () => {
    const baseURL = 'https://api.example.com';

    afterEach(() => {
        // Clear the pool after each test to prevent state leakage
        ApiClient.clearPool();
    });

    test('ApiClient positive', async () => {
        const mockResponse = { data: 'success' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async (input: string) => {
            expect(input.startsWith(baseURL)).toBeTruthy();
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            const result = await ApiClient.fetch<typeof mockResponse>(`${baseURL}/${'test-api'}`, {}, { maxTries: 0 });
            expect(result).toStrictEqual(mockResponse);
            expect(fn.mock.calls.length === 1).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('retry on failure and eventually succeed', async () => {
        const mockResponse = { data: 'ok' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            if (fn.mock.calls.length < 2) {
                return new Response('Error', { status: 500 });
            }
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });

        try {
            const client = new ApiClient(baseURL, { maxTries: 5, baseDelay: 5 });
            const retry = client.fetch<typeof mockResponse>('test-api');
            const result = await retry;

            expect(fn.mock.calls.length).toBe(2);
            expect(result).toStrictEqual(mockResponse);
            expect(!retry.state.aborted).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('fail after max retries', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => new Response('Error', { status: 500 }));
        try {
            const client = new ApiClient(baseURL, { maxTries: 2, baseDelay: 1 });
            const retry = client.fetch('test-api');

            await expect(Promise.resolve(retry)).rejects.toThrow(/500/);
            expect(fn.mock.calls.length).toBe(2);
            expect(!retry.state.aborted).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('fetch with timeout', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            // Mock fetch takes 100ms but timeout is set to 50ms
            await sleep(100);
            return new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
        });
        try {
            // Set a short timeout (50ms) and mock fetch to take longer (100ms)
            const client = new ApiClient(baseURL, { baseDelay: 10, maxTries: 10, timeout: 50 });

            const retry = client.fetch('test-api');
            await expect(Promise.resolve(retry)).rejects.toThrow(/timeout/i);
            expect(fn.mock.calls.length > 0).toBeTruthy();
            expect(retry.state.aborted).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('fetch with abort', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            await sleep(10);
            return new Response('OK', { status: 200 });
        });
        try {
            const client = new ApiClient(baseURL, { timeout: 10000 });
            const retry = client.fetch('test-api');
            retry.abort('test');
            await expect(Promise.resolve(retry)).rejects.toThrow(/test/i);
            expect(fn.mock.calls.length).toBe(1);
            expect(retry.state.aborted).toBeTruthy();
            expect(retry.state.reason).toBe('test');
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('fetch with external signal', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            await sleep(10);
            return new Response('OK', { status: 200 });
        });
        try {
            const controller = new AbortController();
            const client = new ApiClient(baseURL);
            const retry = client.fetch('test-api', { signal: controller.signal });
            controller.abort('caller abort');
            await expect(Promise.resolve(retry)).rejects.toThrow(/caller abort/i);
            expect(fn.mock.calls.length === 1).toBeTruthy();
            expect(controller.signal.aborted).toBeTruthy();
            expect(retry.signal.aborted).toBeTruthy();
            expect(retry.state.reason).toBe('caller abort');
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('signal not used', async () => {
        const retry = new PromiseRetry(new ClientOptions());
        retry.abort('no signal'); // should not throw even if signal was not passed
        await expect(Promise.resolve(retry)).rejects.toThrow(/no signal/i);
        expect(retry.state.aborted).toBe(false);
    });

    test('afterFn = stream', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
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
            const client = new ApiClient(baseURL, { afterFn: 'stream' });
            const result = await client.fetch<ReadableStream<Uint8Array>>('test-api');
            // Read from the stream and check the data
            const reader = result.getReader();
            const { value, done } = await reader.read();
            expect(done).toBe(false);
            expect(new TextDecoder().decode(value)).toBe('stream-data');
            const { done: done2 } = await reader.read();
            expect(done2).toBe(true);
            expect(fn.mock.calls.length).toBe(1);
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('afterFn = function', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return new Response('text-data', { status: 200 });
        });
        try {
            const afterFn = async <T = string>(res: Response) => {
                return res.text() as Promise<T>;
            };
            const client = new ApiClient(baseURL, { afterFn });
            const result = await client.fetch<string>('test-api');
            expect(result).toBe('text-data');
            expect(fn.mock.calls.length).toBe(1);
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('static fetch uses client pool for same origin and options', async () => {
        const mockResponse = { data: 'pooled' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            // Clear pool before test
            ApiClient.clearPool();

            const url1 = `${baseURL}/endpoint1`;
            const url2 = `${baseURL}/endpoint2`;
            const opts = { maxTries: 1 };

            // First request creates client in pool
            await ApiClient.fetch(url1, {}, opts);
            const statsAfterFirst = ApiClient.getPoolStats();
            expect(statsAfterFirst.size).toBe(1);
            // Pool key includes origin + JSON-stringified options
            expect(statsAfterFirst.origins[0]?.startsWith('https://api.example.com:')).toBeTruthy();

            // Second request to same origin WITH SAME OPTIONS reuses client
            await ApiClient.fetch(url2, {}, opts);
            const statsAfterSecond = ApiClient.getPoolStats();
            expect(statsAfterSecond.size).toBe(1); // Still only 1 client

            expect(fn.mock.calls.length).toBe(2);
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('static fetch creates separate clients for different origins', async () => {
        const mockResponse = { data: 'separate' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            ApiClient.clearPool();

            const opts = { maxTries: 1 };
            await ApiClient.fetch('https://api1.example.com/test', {}, opts);
            await ApiClient.fetch('https://api2.example.com/test', {}, opts);

            const stats = ApiClient.getPoolStats();
            expect(stats.size).toBe(2);
            // Pool keys include origin + options, so check if origins are present
            expect(stats.origins.some((k: string) => k.startsWith('https://api1.example.com:'))).toBeTruthy();
            expect(stats.origins.some((k: string) => k.startsWith('https://api2.example.com:'))).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('static fetch pool respects maxPoolSize with LRU eviction', async () => {
        const mockResponse = { data: 'lru' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            ApiClient.clearPool();

            const opts = { maxTries: 1 };
            // Create clients up to the pool limit (50) + 2
            for (let i = 0; i <= 51; i++) {
                await ApiClient.fetch(`https://api${i}.example.com/test`, {}, opts);
            }

            const stats = ApiClient.getPoolStats();
            expect(stats.size).toBe(stats.maxSize); // Should not exceed maxSize
            // First origins should be evicted (LRU), latest should remain
            expect(!stats.origins.some((k: string) => k.startsWith('https://api0.example.com:'))).toBeTruthy();
            expect(!stats.origins.some((k: string) => k.startsWith('https://api1.example.com:'))).toBeTruthy();
            expect(stats.origins.some((k: string) => k.startsWith('https://api51.example.com:'))).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('static fetch creates separate pool entries for different bearer tokens', async () => {
        const mockResponse = { data: 'token' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }));
        });
        try {
            ApiClient.clearPool();

            const url = 'https://api.example.com/test';
            await ApiClient.fetch(url, {}, { maxTries: 1, bearerToken: 'token123' });
            await ApiClient.fetch(url, {}, { maxTries: 1, bearerToken: 'token456' });

            const stats = ApiClient.getPoolStats();
            expect(stats.size).toBe(2); // Different tokens = different pool entries
            expect(fn.mock.calls.length).toBe(2);
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('userAgent sets User-Agent header', async () => {
        const mockResponse = { data: 'success' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async (_input: string, init?: RequestInit) => {
            // Verify User-Agent header is set
            const headers = new Headers(init?.headers);
            expect(headers.get('User-Agent')).toBe('test-agent/1.0.0');
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            const client = new ApiClient(baseURL, { userAgent: 'test-agent/1.0.0' });
            const result = await client.fetch<typeof mockResponse>('test-api');
            expect(result).toStrictEqual(mockResponse);
            expect(fn.mock.calls.length).toBe(1);
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('userAgent merges with request headers', async () => {
        const mockResponse = { data: 'success' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async (_input: string, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            expect(headers.get('User-Agent')).toBe('test-agent/2.0.0');
            expect(headers.get('X-Custom')).toBe('custom-value');
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            const client = new ApiClient(baseURL, { userAgent: 'test-agent/2.0.0' });
            const result = await client.fetch<typeof mockResponse>('test-api', {
                headers: { 'X-Custom': 'custom-value' },
            });
            expect(result).toStrictEqual(mockResponse);
            expect(fn.mock.calls.length).toBe(1);
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('retry handles catch callback', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => new Response('Error', { status: 500 }));
        try {
            const client = new ApiClient(baseURL, { maxTries: 1, baseDelay: 1 });
            const retry = client.fetch('test-api');

            let caughtError: unknown;
            await retry.catch((err: unknown) => {
                caughtError = err;
            });

            expect(caughtError).toBeTruthy();
            expect(fn.mock.calls.length === 1).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('retry handles finally callback', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(
            async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        let finallyCalled = false;
        try {
            const client = new ApiClient(baseURL);
            await client.fetch('test-api').finally(() => {
                finallyCalled = true;
            });

            expect(finallyCalled).toBeTruthy();
            expect(fn.mock.calls.length === 1).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('retry with non-200 status retries', async () => {
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            if (fn.mock.calls.length < 2) {
                return new Response('Not Found', { status: 404 });
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });
        try {
            const client = new ApiClient(baseURL, { maxTries: 3, baseDelay: 1 });
            const result = await client.fetch<{ ok: boolean }>('test-api');

            expect(result).toStrictEqual({ ok: true });
            expect(fn.mock.calls.length === 2).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('bearerToken adds Authorization header', async () => {
        const mockResponse = { data: 'authorized' };
        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async (_input: string, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            expect(headers.get('Authorization')).toBe('Bearer secret-token');
            return new Response(JSON.stringify(mockResponse), { status: 200 });
        });
        try {
            const client = new ApiClient(baseURL, { bearerToken: 'secret-token' });
            const result = await client.fetch<typeof mockResponse>('test-api');
            expect(result).toStrictEqual(mockResponse);
            expect(fn.mock.calls.length === 1).toBeTruthy();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('afterFn = sse creates SSESession', async () => {
        const sseData = 'event: endpoint\ndata: /messages?session_id=test123\n\n';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(sseData));
            },
        });

        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            const client = new ApiClient(baseURL, { afterFn: 'sse', timeout: 5000, maxTries: 0 });
            const session = await client.fetch<SSESession>('test-api');

            await sleep(10);

            expect(session instanceof SSESession).toBeTruthy();
            expect(session.sessionId).toBe('test123');
            expect(session.endpoint).toBe('/messages?session_id=test123');
            expect(fn.mock.calls.length).toBe(1);

            session.close();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });

    test('static fetch with SSE uses pool', async () => {
        const sseData = 'event: endpoint\ndata: /msg?session_id=pooled\n\n';
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(sseData));
            },
        });

        const fn = spyOn(getGlobalScope(), 'fetch').mockImplementation(async () => {
            return new Response(stream, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        });

        try {
            ApiClient.clearPool();

            const session = await ApiClient.fetch<SSESession>(`${baseURL}/sse`, {}, { afterFn: 'sse', maxTries: 0 });

            await sleep(10);

            const stats = ApiClient.getPoolStats();
            expect(stats.size).toBe(1);
            expect(stats.origins.length > 0).toBeTruthy();
            expect(fn.mock.calls.length).toBe(1);

            session.close();
        } finally {
            fn.mockRestore();
            ApiClient.clearPool();
        }
    });
});
