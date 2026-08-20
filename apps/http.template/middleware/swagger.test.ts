import { describe, expect, test } from 'bun:test';
import { createServer, registerRoutes } from '../server';

process.env['JWT_SECRET'] ??= 'ci-test-secret';

describe('Swagger documentation', () => {
    test('GET /api/v1/openapi.json returns OpenAPI spec', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        if (response.statusCode !== 200) {
            console.error('OpenAPI endpoint error:', response.statusCode, response.body);
        }
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.openapi).toBe('3.0.0');
        expect(body.info).toBeTruthy();
        expect(body.info.title).toBeTruthy();
        expect(body.info.version).toBeTruthy();
    });

    test('GET /api/v1/openapi.json includes registered paths', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.paths).toBeTruthy();
        expect(typeof body.paths).toBe('object');
        // Should have at least the health endpoint
        expect(Object.keys(body.paths).length > 0).toBeTruthy();
    });

    test('GET /api/v1/swagger returns Scalar API Reference HTML', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/swagger',
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type'] || '').toMatch(/text\/html/);
        expect(response.body).toMatch(/api-reference/i);
    });

    test('OpenAPI spec has correct structure', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        const spec = JSON.parse(response.body);

        // Verify required OpenAPI fields
        expect(spec.openapi).toBeTruthy();
        expect(spec.info).toBeTruthy();
        expect(spec.info.title).toBeTruthy();
        expect(spec.info.version).toBeTruthy();
        expect(spec.servers).toBeTruthy();
        expect(Array.isArray(spec.servers)).toBeTruthy();
        expect(spec.paths).toBeTruthy();
        expect(typeof spec.paths).toBe('object');
    });

    test('OpenAPI spec includes application routes', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        const spec = JSON.parse(response.body);
        const pathKeys = Object.keys(spec.paths);

        // Should include application routes like /health and /api/v1/hello
        expect(pathKeys.includes('/health')).toBeTruthy();
        expect(pathKeys.includes('/api/v1/hello')).toBeTruthy();
        // Note: With @fastify/swagger, swagger/openapi routes ARE included in the spec
        // This is expected behavior - they're documented endpoints too
    });
});
