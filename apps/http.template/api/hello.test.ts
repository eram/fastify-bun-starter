import { describe, expect, test } from 'bun:test';
import { apm } from '@libs/utils/apm';
import { createServer, registerRoutes } from '../server';

process.env['JWT_SECRET'] ??= 'ci-test-secret';

describe('Hello endpoint', () => {
    test('GET /api/v1/hello increments the views.hello.calls counter', async () => {
        apm.resetAll(true);
        const app = await createServer();
        await registerRoutes(app);

        await app.inject({ method: 'GET', url: '/api/v1/hello?number=123456789&locale=en-US' });
        expect(apm.counters['views.hello.calls']?.val).toBe(1);

        await app.inject({ method: 'GET', url: '/api/v1/hello?number=42&locale=en-US' });
        expect(apm.counters['views.hello.calls']?.val).toBe(2);
    });

    test('GET /api/v1/hello formats number successfully', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/hello?number=123456789&locale=en-US',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.formatted).toBeTruthy();
        expect(typeof body.formatted).toBe('string');
    });

    test('GET /api/v1/hello validates query parameters', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/hello?number=123456',
            // missing locale
        });

        expect(response.statusCode).toBe(400);
    });

    test('GET /api/v1/hello rejects invalid locale format', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/hello?number=123456&locale=invalid',
        });

        expect(response.statusCode).toBe(400);
    });

    test('POST /api/v1/hello formats number successfully', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 123456789,
                locale: 'en-US',
            },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.formatted).toBeTruthy();
        expect(typeof body.formatted).toBe('string');
    });

    test('POST /api/v1/hello validates request schema', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 123456,
                // missing locale
            },
        });

        expect(response.statusCode).toBe(400);
    });

    test('POST /api/v1/hello rejects invalid locale format', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 123456,
                locale: 'invalid',
            },
        });

        expect(response.statusCode).toBe(400);
    });
});
