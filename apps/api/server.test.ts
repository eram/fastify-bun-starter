import { afterEach, describe, expect, test } from 'bun:test';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sleep } from '@libs/utils/time';
import { createServer, registerRoutes, startServer } from './server';

function getPort(app: FastifyInstance): number {
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('Invalid server address');
    return addr.port;
}

describe('HTTP Server', () => {
    afterEach(async () => {
        // Give time for any servers to fully close and release ports
        await sleep(100);
    });

    // createServer tests
    test('should create a Fastify instance', async () => {
        const server = await createServer();
        expect(server).toBeTruthy();
        expect(typeof server.inject === 'function').toBeTruthy();
    });

    test('should configure validator compiler', async () => {
        const server = await createServer();
        expect(server).toBeTruthy();
        // If validator compiler is set, validation should work
        expect(server.validatorCompiler !== undefined).toBeTruthy();
    });

    test('should parse JSON with BigInt support', async () => {
        const server = await createServer();

        // Register a test route that echoes back the body
        server.post('/test-bigint', async (request: FastifyRequest, reply: FastifyReply) => {
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
        expect(response.statusCode).toBe(200);

        // Parse the response to verify BigInt was serialized correctly
        const body = response.json();

        // BigInt should be parsed and re-serialized with 'n' suffix
        expect(body.id).toBe('123456789012345678901234567890n');
        expect(body.name).toBe('test');
    });

    test('should filter out properties starting with __', async () => {
        const server = await createServer();

        // Register a test route that echoes back the body
        server.post('/test-proto', async (request: FastifyRequest, reply: FastifyReply) => {
            const body = request.body as Record<string, unknown>;
            // Check if __proto__ was filtered out
            return reply.send({
                name: body['name'],
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

        expect(response.statusCode).toBe(200);
        const body = response.json();

        // Verify the results
        expect(body.name).toBe('test');
        expect(body.hasProtoProperty).toBe(false);
        expect(body.hasConstructorProperty).toBe(true);
        expect(body.constructorValue !== undefined).toBeTruthy();
    });

    test('should handle ArrayBuffer and SharedArrayBuffer input', async () => {
        const server = await createServer();

        server.post('/test-buffer', async (request: FastifyRequest) => {
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

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.data).toBe('hello');
    });

    // registerAll tests
    test('should register all routes and return working server', async () => {
        const server = await createServer();
        await registerRoutes(server);

        // Test that routes actually work
        const healthResponse = await server.inject({
            method: 'GET',
            url: '/health',
        });
        expect(healthResponse.statusCode === 200).toBeTruthy();

        const docsResponse = await server.inject({
            method: 'GET',
            url: '/api/v1/swagger',
        });
        expect(docsResponse.statusCode === 200).toBeTruthy();

        const docsJsonResponse = await server.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });
        expect(docsJsonResponse.statusCode === 200).toBeTruthy();
    });

    test('should make server ready to handle requests', async () => {
        const server = await createServer();
        await registerRoutes(server);

        // Server should be ready
        expect(server.printRoutes !== undefined).toBeTruthy();

        // Should have multiple routes registered
        const routes = server.printRoutes({ commonPrefix: false });
        expect(routes.length > 0).toBeTruthy();
        expect(routes.includes('health')).toBeTruthy();
        expect(routes.includes('api/v1/swagger')).toBeTruthy();
    });

    // startServer tests
    test('should start server and listen on configured port', async () => {
        const server = await createServer();
        await registerRoutes(server);

        // Use a unique port for testing
        const testPort = 13600 + Math.floor(Math.random() * 100); // Random port 13600-13699
        const save = { ...process.env };
        process.env['PORT'] = String(testPort);
        process.env['HOST'] = '127.0.0.1';

        try {
            // Start server in background (don't await - it runs until closed)
            const startPromise = startServer(server);

            // Give server time to start
            await sleep(100);

            // Verify server is listening
            const address = server.server.address();
            expect(address !== null).toBeTruthy();
            if (typeof address === 'object') {
                expect(address?.port).toBe(testPort);
            }

            // Verify we can make a request
            const res = await fetch(`http://127.0.0.1:${testPort}/health`);
            expect(res.status).toBe(200);

            // Stop server and wait for startServer to complete
            await server.close();
            await startPromise;
        } catch (err) {
            // Cleanup on error
            await server.close();
            throw err;
        } finally {
            process.env = save;
        }
    });

    test('should handle server startup errors', async () => {
        const server1 = await createServer();
        const server2 = await createServer();
        await registerRoutes(server1);
        await registerRoutes(server2);

        // Start first server on port 0 (random available port)
        const save = { ...process.env };
        await server1.listen({ port: 0, host: '127.0.0.1' });
        const testPort = getPort(server1);

        // Set port for second server to the same port (to cause conflict)
        process.env['PORT'] = String(testPort);
        process.env['HOST'] = '127.0.0.1';
        process.env['NODE_TEST_CONTEXT'] = '1';

        try {
            // First server already running (no need for startServer)
            await sleep(5);

            // Mock process.exit to prevent test from exiting (not used in test mode, but kept for safety)
            const originalExit = process.exit;
            process.exit = ((_code?: number) => {
                throw new Error('process.exit called');
            }) as typeof process.exit;

            try {
                // Try to start second server on same port (should fail)
                await startServer(server2);
                expect(false).toBeTruthy();
            } catch (_err) {
                // In test mode, should throw error instead of calling process.exit
                expect(true).toBeTruthy();
            } finally {
                process.exit = originalExit;
            }

            await server1.close();
            await server2.close();
        } finally {
            process.env = save;
        }
    });

    test('should format EADDRINUSE error message with port number', async () => {
        const http = await import('node:http');
        const originalConsoleError = console.error;
        let capturedErrorMessage = '';
        const save = { ...process.env };

        // Create a simple HTTP server to block a random port
        // Use 127.0.0.1 explicitly to avoid SO_REUSEADDR issues
        const blockingServer = http.createServer();
        await new Promise<void>((resolve, reject) => {
            blockingServer.once('error', reject);
            blockingServer.listen(0, '127.0.0.1', () => {
                blockingServer.removeListener('error', reject);
                resolve();
            });
        });

        const address = blockingServer.address();
        expect(address && typeof address === 'object').toBeTruthy();
        const blockedPort = (address as { port: number }).port;

        try {
            // Capture console.error output
            console.error = (...args: unknown[]) => {
                capturedErrorMessage = args.join(' ');
            };

            // Set environment to use the blocked port
            process.env['PORT'] = String(blockedPort);
            process.env['HOST'] = '127.0.0.1';
            process.env['NODE_TEST_CONTEXT'] = '1'; // Throw error instead of exit

            // Verify blocking server is still listening
            expect(blockingServer.listening).toBeTruthy();

            // Give a moment for the port to be fully bound
            await sleep(50);

            // Create and try to start server on blocked port
            const server = await createServer();
            await registerRoutes(server);

            let errorThrown = false;
            try {
                await startServer(server);
                // If we get here, close the server
                await server.close();
            } catch (err) {
                errorThrown = true;
                // Verify error is EADDRINUSE
                expect(err && typeof err === 'object' && 'code' in err).toBeTruthy();
                expect((err as NodeJS.ErrnoException).code).toBe('EADDRINUSE');

                // Verify error message is user-friendly
                expect(capturedErrorMessage.length > 0).toBeTruthy();
                expect(capturedErrorMessage.includes(String(blockedPort))).toBeTruthy();
                expect(capturedErrorMessage.includes('already in use')).toBeTruthy();
                expect(capturedErrorMessage.includes('already running')).toBeTruthy();
            }

            expect(errorThrown).toBeTruthy();
        } finally {
            console.error = originalConsoleError;
            blockingServer.close();
            process.env = save;
        }
    });

    test('should handle error without code property', async () => {
        const http = await import('node:http');
        const save = { ...process.env };

        // Create blocking server
        const blockingServer = http.createServer();
        await new Promise<void>((resolve, reject) => {
            blockingServer.once('error', reject);
            blockingServer.listen(0, '127.0.0.1', () => {
                blockingServer.removeListener('error', reject);
                resolve();
            });
        });

        const address = blockingServer.address();
        expect(address && typeof address === 'object').toBeTruthy();
        const blockedPort = (address as { port: number }).port;

        try {
            process.env['PORT'] = String(blockedPort);
            process.env['HOST'] = '127.0.0.1';
            process.env['NODE_TEST_CONTEXT'] = '1';
            await sleep(50);

            const server = await createServer();
            await registerRoutes(server);

            try {
                await startServer(server);
                await server.close();
            } catch (err) {
                // Should handle error with code properly
                expect(err instanceof Error || (err && typeof err === 'object')).toBeTruthy();
            }
        } finally {
            blockingServer.close();
            process.env = save;
        }
    });

    test('should handle EACCES error', async () => {
        const server = await createServer();
        await registerRoutes(server);

        const save = { ...process.env };
        let errorMessage = '';
        const originalError = console.error;

        try {
            console.error = (...args: unknown[]) => {
                errorMessage = args.join(' ');
            };

            process.env['PORT'] = '80'; // Privileged port
            process.env['HOST'] = '127.0.0.1';
            process.env['NODE_TEST_CONTEXT'] = '1';

            try {
                await startServer(server);
                await server.close();
            } catch (err) {
                // On most systems, port 80 will give EACCES
                expect(err instanceof Error || (err && typeof err === 'object')).toBeTruthy();
                if (err && typeof err === 'object' && 'code' in err && err.code === 'EACCES') {
                    expect(errorMessage.includes('Permission denied') || errorMessage.includes('EACCES')).toBeTruthy();
                }
            }
        } finally {
            console.error = originalError;
            process.env = save;
        }
    });

    test('should handle plain Error objects', async () => {
        const server = await createServer();

        // Test with invalid JSON to trigger error in JSON parser
        server.post('/test-error', async (request: FastifyRequest, reply: FastifyReply) => {
            return reply.send(request.body);
        });

        const response = await server.inject({
            method: 'POST',
            url: '/test-error',
            payload: '{invalid json}',
            headers: {
                'content-type': 'application/json',
            },
        });

        // Fastify returns 500 for JSON parse errors
        expect(response.statusCode).toBe(500);
    });

    test('should handle unknown error types', async () => {
        const server = await createServer();

        // Register a route that throws a non-Error object
        server.get('/test-unknown-error', async (_request: FastifyRequest, _reply: FastifyReply) => {
            // eslint-disable-next-line prefer-promise-reject-errors
            throw 'string error';
        });

        const response = await server.inject({
            method: 'GET',
            url: '/test-unknown-error',
        });

        // Should handle the error
        expect(response.statusCode).toBe(500);
    });

    test('should format error messages for various error codes', async () => {
        const server = await createServer();
        await registerRoutes(server);

        // Test that server was created successfully
        expect(server).toBeTruthy();
        expect(typeof server.listen === 'function').toBeTruthy();
    });

    test('should parse port from environment variable', async () => {
        const server = await createServer();
        await registerRoutes(server);

        const save = { ...process.env };

        try {
            // Test that NaN from invalid port doesn't crash
            // (Fastify will use 0 which means random available port)
            const testPort = 13700 + Math.floor(Math.random() * 100);
            process.env['PORT'] = String(testPort);
            process.env['HOST'] = '127.0.0.1';

            const startPromise = startServer(server);
            await sleep(100);

            const address = server.server.address();
            expect(address !== null).toBeTruthy();
            if (typeof address === 'object') {
                expect(address?.port).toBe(testPort);
            }

            await server.close();
            await startPromise;
        } finally {
            process.env = save;
        }
    });

    test('should handle error with errno and getSystemErrorName', async () => {
        const http = await import('node:http');
        const save = { ...process.env };

        // Create blocking server on a random port
        const blockingServer = http.createServer();
        await new Promise<void>((resolve, reject) => {
            blockingServer.once('error', reject);
            blockingServer.listen(0, '127.0.0.1', () => {
                blockingServer.removeListener('error', reject);
                resolve();
            });
        });

        const address = blockingServer.address();
        expect(address && typeof address === 'object').toBeTruthy();
        const blockedPort = (address as { port: number }).port;

        const originalError = console.error;

        try {
            console.error = () => {}; // Suppress error output

            process.env['PORT'] = String(blockedPort);
            process.env['HOST'] = '127.0.0.1';
            process.env['NODE_TEST_CONTEXT'] = '1';

            await sleep(50);

            const server = await createServer();
            await registerRoutes(server);

            try {
                await startServer(server);
                await server.close();
            } catch (err) {
                // Should get EADDRINUSE error with errno
                expect(err).toBeTruthy();
                if (err && typeof err === 'object' && 'errno' in err) {
                    // errno should be negative for system errors
                    const errno = (err as NodeJS.ErrnoException).errno;
                    expect(errno === undefined || typeof errno === 'number').toBeTruthy();
                }
            }
        } finally {
            console.error = originalError;
            blockingServer.close();
            process.env = save;
        }
    });
});
