import { describe, expect, test } from 'bun:test';
import { app } from './app';

describe('app', () => {
    test('instance is exported and is a Fastify instance', () => {
        expect(app).toBeTruthy();
        expect(app.inject).toBeTruthy();
        expect(typeof app.listen).toBe('function');
    });

    test('has routes registered', async () => {
        await app.ready();
        // Check routes are available by testing them
        const healthResponse = await app.inject({ method: 'GET', url: '/health' });
        expect(healthResponse.statusCode).toBe(200);

        const helloResponse = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: { number: 12345, locale: 'en-US' },
        });
        expect(helloResponse.statusCode).toBe(200);

        const docsResponse = await app.inject({ method: 'GET', url: '/api/v1/swagger' });
        expect(docsResponse.statusCode).toBe(200);

        const docsJsonResponse = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
        expect(docsJsonResponse.statusCode).toBe(200);
    });

    test('GET /health returns ok status', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        expect(response.statusCode).toBe(200);

        const json = response.json();
        expect(json.status).toBe('ok');
        expect(json.timestamp).toBeTruthy();
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

        expect(response.statusCode).toBe(200);

        const json = response.json();
        expect(json.formatted).toBeTruthy();
        expect(json.formatted).toBe('123,456');
    });

    test('POST /api/v1/hello validates required number field', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                locale: 'en-US',
            },
        });

        expect(response.statusCode).toBe(400);
    });

    test('POST /api/v1/hello validates required locale field', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 12345,
            },
        });

        expect(response.statusCode).toBe(400);
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

        expect(response.statusCode).toBe(400);
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

        expect(response.statusCode).toBe(400);
        const json = response.json();
        expect(json.message).toBeTruthy();
        expect(json.availableLocales).toBeTruthy();
    });

    test('GET /api/v1/swagger returns HTML', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/swagger',
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']?.includes('text/html')).toBeTruthy();
        expect(response.body.includes('api-reference')).toBeTruthy();
    });

    test('GET /api/v1/openapi.json returns OpenAPI spec', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/openapi.json',
        });

        expect(response.statusCode).toBe(200);

        const json = response.json();
        expect(json.openapi).toBe('3.0.0');
        expect(json.info).toBeTruthy();
        expect(json.info.title).toBeTruthy();
        expect(json.paths).toBeTruthy();
    });
});
