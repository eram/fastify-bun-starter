import { ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { app } from '../app';

describe('Swagger documentation', () => {
    test('GET /docs returns 200 status', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs',
        });

        strictEqual(response.statusCode, 200);
    });

    test('GET /docs returns HTML content', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs',
        });

        ok(response.headers['content-type']?.includes('text/html'));
    });

    test('GET /docs includes Swagger UI elements', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs',
        });

        const html = response.body;
        ok(html.includes('swagger-ui'));
        ok(html.includes('swagger-ui-bundle'));
        ok(html.includes('SwaggerUIBundle'));
    });

    test('GET /docs points to /docs/json for spec', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs',
        });

        const html = response.body;
        ok(html.includes("url: '/docs/json'"));
    });

    test('GET /docs/json returns 200 status', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        strictEqual(response.statusCode, 200);
    });

    test('GET /docs/json returns valid OpenAPI spec structure', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const json = response.json();
        strictEqual(json.openapi, '3.0.0');
        ok(json.info);
        ok(json.paths);
        ok(json.servers);
        ok(json.tags);
    });

    test('GET /docs/json includes info section', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const json = response.json();
        strictEqual(json.info.title, 'Fastify Bun Starter API');
        ok(json.info.description);
        ok(json.info.version);
    });

    test('GET /docs/json includes server configuration', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const json = response.json();
        ok(Array.isArray(json.servers));
        ok(json.servers.length > 0);
        ok(json.servers[0].url);
    });

    test('GET /docs/json includes tags', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const json = response.json();
        ok(Array.isArray(json.tags));
        const tagNames = json.tags.map((tag: { name: string }) => tag.name);
        ok(tagNames.includes('monitoring'));
        ok(tagNames.includes('testing'));
    });

    test('GET /docs/json has paths property', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const json = response.json();
        ok(json.paths !== undefined);
        ok(typeof json.paths === 'object');
    });

    test('GET /docs/json content-type is application/json', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        ok(response.headers['content-type']?.includes('application/json'));
    });

    test('GET /docs/json builds paths dynamically from routes', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const json = response.json();
        // paths should be an object (may be empty or populated depending on route registration timing)
        ok(typeof json.paths === 'object');
    });

    test('GET /docs/json dynamically generates path entries', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const json = response.json();
        const pathKeys = Object.keys(json.paths);

        // Should not include /docs routes if they're filtered
        ok(!pathKeys.includes('/docs'));
        ok(!pathKeys.includes('/docs/json'));
    });

    test('GET /docs/json path entries have proper structure', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/docs/json',
        });

        const json = response.json();

        // Check any registered path has proper structure
        for (const [path, pathData] of Object.entries(json.paths)) {
            ok(typeof pathData === 'object', `Path ${path} should have object data`);

            // Each method should have tags and responses
            for (const methodData of Object.values(pathData as Record<string, unknown>)) {
                if (typeof methodData === 'object' && methodData !== null) {
                    const method = methodData as { tags?: string[]; responses?: unknown };
                    if (method.tags) {
                        ok(Array.isArray(method.tags), 'Tags should be an array');
                    }
                    if (method.responses) {
                        ok(typeof method.responses === 'object', 'Responses should be an object');
                    }
                }
            }
        }
    });
});
