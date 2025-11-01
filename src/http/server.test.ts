import { ok } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createServer, registerAll } from './server';

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
