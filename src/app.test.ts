import { ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { app } from './app';

describe('app', () => {
    test('instance is exported and is a Fastify instance', () => {
        ok(app, 'app should be defined');
        ok(app.inject, 'app.inject should be defined (Fastify method)');
        strictEqual(typeof app.listen, 'function', 'app.listen should be a function');
    });

    test('has routes registered', async () => {
        await app.ready();
        // Check routes are available by testing them
        const healthResponse = await app.inject({ method: 'GET', url: '/health' });
        strictEqual(healthResponse.statusCode, 200, 'Health endpoint should be available');

        const helloResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: { number: 12345, locale: 'en-US' },
        });
        strictEqual(helloResponse.statusCode, 200, 'Number formatting endpoint should be available');

        const docsResponse = await app.inject({ method: 'GET', url: '/api/v1/swagger' });
        strictEqual(docsResponse.statusCode, 200, 'Swagger UI endpoint should be available');

        const docsJsonResponse = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
        strictEqual(docsJsonResponse.statusCode, 200, 'OpenAPI spec endpoint should be available');
    });

    test('GET /health returns ok status', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        strictEqual(response.statusCode, 200, 'Should return 200 status code');

        const json = response.json();
        strictEqual(json.status, 'ok', 'Should return ok status');
        ok(json.timestamp, 'Should include timestamp');
        // workers field is optional (only available in cluster mode)
    });

    test('POST /api/v1/hello formats number with valid locale', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 123456,
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 200, 'Should return 200 status code');

        const json = response.json();
        ok(json.formatted, 'Should have formatted field');
        strictEqual(json.formatted, '123,456');
    });

    test('POST /api/v1/hello validates required number field', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 400, 'Should return 400 for missing number');
    });

    test('POST /api/v1/hello validates required locale field', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 12345,
            },
        });

        strictEqual(response.statusCode, 400, 'Should return 400 for missing locale');
    });

    test('POST /api/v1/hello validates locale format', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 12345,
                locale: 'invalid_format',
            },
        });

        strictEqual(response.statusCode, 400, 'Should return 400 for invalid locale format');
    });

    test('POST /api/v1/hello rejects unsupported locale with available locales list', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 12345,
                locale: 'xx-XX',
            },
        });

        strictEqual(response.statusCode, 400, 'Should return 400 for unsupported locale');
        const json = response.json();
        ok(json.message, 'Should include error message');
        ok(json.availableLocales, 'Should include available locales list');
    });

    test('GET /api/v1/swagger returns HTML', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/swagger',
        });

        strictEqual(response.statusCode, 200, 'Should return 200 status code');
        ok(response.headers['content-type']?.includes('text/html'), 'Should return HTML content type');
        ok(response.body.includes('swagger-ui'), 'Should contain Swagger UI HTML');
    });

    test('GET /api/v1/openapi.json returns OpenAPI spec', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        strictEqual(response.statusCode, 200, 'Should return 200 status code');

        const json = response.json();
        strictEqual(json.openapi, '3.0.0', 'Should have OpenAPI version');
        ok(json.info, 'Should have info section');
        ok(json.info.title, 'Should have title');
        ok(json.paths, 'Should have paths');
    });
});
