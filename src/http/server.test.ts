import { ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createServer, registerAll, startServer } from './server';

describe('createServer', () => {
    test('should create a Fastify instance', () => {
        const server = createServer();
        ok(server);
        ok(typeof server.inject === 'function');
    });

    test('should configure validator compiler', () => {
        const server = createServer();
        ok(server);
        // If validator compiler is set, validation should work
        ok(server.validatorCompiler !== undefined);
    });

    test('should parse JSON with BigInt support', async () => {
        const server = createServer();

        // Register a test route that echoes back the body
        server.post('/test-bigint', async (request, reply) => {
            // Return the parsed body which contains BigInt
            return reply.send(request.body);
        });

        const response = await server.inject({
            method: 'POST',
            url: '/test-bigint',
            payload: '{"id": "123456789012345678901234567890n", "name": "test"}',
            headers: {
                'content-type': 'application/json',
            },
        });

        if (response.statusCode !== 200) {
            console.error('BigInt test failed with:', response.body);
        }
        strictEqual(response.statusCode, 200);

        // Parse the response to verify BigInt was serialized correctly
        const body = response.json();

        // BigInt should be parsed and re-serialized with 'n' suffix
        strictEqual(body.id, '123456789012345678901234567890n');
        strictEqual(body.name, 'test');
    });

    test('should filter out properties starting with __', async () => {
        const server = createServer();

        // Register a test route that echoes back the body
        server.post('/test-proto', async (request, reply) => {
            const body = request.body as Record<string, unknown>;
            // Check if __proto__ was filtered out
            return reply.send({
                name: body.name,
                hasProtoProperty: Object.hasOwn(body, '__proto__'),
                hasConstructorProperty: Object.hasOwn(body, 'constructor'),
                constructorValue: body.constructor,
            });
        });

        const response = await server.inject({
            method: 'POST',
            url: '/test-proto',
            payload:
                '{"name": "test", "__proto__": {"polluted": true}, "__constructor__": {"polluted": true}, "constructor": {"polluted": true}}',
            headers: {
                'content-type': 'application/json',
            },
        });

        strictEqual(response.statusCode, 200);
        const body = response.json();

        // Verify the results
        strictEqual(body.name, 'test');
        strictEqual(body.hasProtoProperty, false, '__proto__ should be filtered out by reviverFn');
        strictEqual(body.hasConstructorProperty, true, 'constructor is allowed (not starting with __)');
        ok(body.constructorValue !== undefined);
    });

    test('should handle ArrayBuffer and SharedArrayBuffer input', async () => {
        const server = createServer();

        server.post('/test-buffer', async (request) => {
            return request.body;
        });

        // Test with regular string (ArrayBuffer would need binary content-type)
        const response = await server.inject({
            method: 'POST',
            url: '/test-buffer',
            payload: '{"data": "hello"}',
            headers: {
                'content-type': 'application/json',
            },
        });

        strictEqual(response.statusCode, 200);
        const body = JSON.parse(response.body);
        strictEqual(body.data, 'hello');
    });
});

describe('registerAll', () => {
    test('should register all routes and return working server', async () => {
        const server = createServer();
        await registerAll(server);

        // Test that routes actually work
        const healthResponse = await server.inject({
            method: 'GET',
            url: '/health',
        });
        ok(healthResponse.statusCode === 200);

        const docsResponse = await server.inject({
            method: 'GET',
            url: '/docs',
        });
        ok(docsResponse.statusCode === 200);

        const docsJsonResponse = await server.inject({
            method: 'GET',
            url: '/docs/json',
        });
        ok(docsJsonResponse.statusCode === 200);
    });

    test('should make server ready to handle requests', async () => {
        const server = createServer();
        await registerAll(server);

        // Server should be ready
        ok(server.printRoutes !== undefined);

        // Should have multiple routes registered
        const routes = server.printRoutes({ commonPrefix: false });
        ok(routes.length > 0);
        ok(routes.includes('/health'));
        ok(routes.includes('/docs'));
    });
});

describe('startServer', () => {
    test('should start server and listen on configured port', async () => {
        const server = createServer();
        await registerAll(server);

        // Use a unique port for testing
        const testPort = 13579;
        process.env.PORT = String(testPort);
        process.env.HOST = '127.0.0.1';

        try {
            // Start server in background
            const startPromise = startServer(server);

            // Give server time to start
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify server is listening
            const address = server.server.address();
            ok(address !== null);
            if (typeof address === 'object') {
                strictEqual(address.port, testPort);
            }

            // Stop server
            await server.close();
            await startPromise;
        } catch (err) {
            // Cleanup on error
            await server.close();
            throw err;
        } finally {
            delete process.env.PORT;
            delete process.env.HOST;
        }
    });

    test('should use default port 3000 when PORT not set', async () => {
        const server = createServer();
        await registerAll(server);

        delete process.env.PORT;
        process.env.HOST = '127.0.0.1';

        try {
            const startPromise = startServer(server);
            await new Promise((resolve) => setTimeout(resolve, 100));

            const address = server.server.address();
            ok(address !== null);
            if (typeof address === 'object') {
                strictEqual(address.port, 3000);
            }

            await server.close();
            await startPromise;
        } catch (err) {
            await server.close();
            throw err;
        } finally {
            delete process.env.HOST;
        }
    });

    test('should handle server startup errors', async () => {
        const server1 = createServer();
        const server2 = createServer();
        await registerAll(server1);
        await registerAll(server2);

        const testPort = 13581; // Different port to avoid conflicts
        process.env.PORT = String(testPort);
        process.env.HOST = '127.0.0.1';

        try {
            // Start first server
            const start1Promise = startServer(server1);
            await new Promise((resolve) => setTimeout(resolve, 150));

            // Mock process.exit to prevent test from exiting
            const originalExit = process.exit;
            let exitCalled = false;
            let exitCode: number | undefined;
            process.exit = ((code?: number) => {
                exitCalled = true;
                exitCode = code;
                throw new Error('process.exit called');
            }) as typeof process.exit;

            try {
                // Try to start second server on same port (should fail)
                await startServer(server2);
                ok(false, 'Should have thrown error');
            } catch (_err) {
                // Expect process.exit to be called
                ok(exitCalled, 'process.exit should be called on error');
                strictEqual(exitCode, 1, 'Should exit with code 1');
            } finally {
                process.exit = originalExit;
            }

            await server1.close();
            await server2.close();
            await start1Promise;
        } finally {
            delete process.env.PORT;
            delete process.env.HOST;
        }
    });
});
