import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createServer, registerRoutes } from './server';

describe('Swagger documentation', () => {
    test('GET /api/v1/openapi.json returns OpenAPI spec', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.openapi, '3.0.0');
        assert.ok(body.info);
        assert.ok(body.info.title);
        assert.ok(body.info.version);
    });

    test('GET /api/v1/openapi.json includes registered paths', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.ok(body.paths);
        assert.ok(typeof body.paths === 'object');
        // Should have at least the health endpoint
        assert.ok(Object.keys(body.paths).length > 0);
    });

    test('GET /api/v1/swagger returns Swagger UI HTML', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/swagger',
        });

        assert.equal(response.statusCode, 200);
        assert.match(response.headers['content-type'] || '', /text\/html/);
        assert.match(response.body, /swagger-ui/i);
        assert.match(response.body, /SwaggerUIBundle/);
    });

    test('GET /api/v1/swagger references correct JSON spec URL', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/swagger',
        });

        assert.equal(response.statusCode, 200);
        assert.match(response.body, /url:\s*['"]\/api\/v1\/openapi\.json['"]/);
    });

    test('OpenAPI spec has correct structure', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        const spec = JSON.parse(response.body);

        // Verify required OpenAPI fields
        assert.ok(spec.openapi);
        assert.ok(spec.info);
        assert.ok(spec.info.title);
        assert.ok(spec.info.version);
        assert.ok(spec.servers);
        assert.ok(Array.isArray(spec.servers));
        assert.ok(spec.paths);
        assert.ok(typeof spec.paths === 'object');
    });

    test('OpenAPI spec excludes swagger/openapi routes from paths', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        const spec = JSON.parse(response.body);
        const pathKeys = Object.keys(spec.paths);

        // /api/v1/swagger and /api/v1/openapi.json should not be in the paths
        assert.ok(!pathKeys.includes('/api/v1/swagger'));
        assert.ok(!pathKeys.includes('/api/v1/openapi.json'));
    });
});
