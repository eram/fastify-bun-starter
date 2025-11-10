import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createServer, registerRoutes } from './server';

describe('Hello endpoint', () => {
    test('POST /api/v1/hello formats number successfully', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 123456789,
                locale: 'en-US',
            },
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.ok(body.formatted);
        assert.equal(typeof body.formatted, 'string');
    });

    test('POST /api/v1/hello validates request schema', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 123456,
                // missing locale
            },
        });

        assert.equal(response.statusCode, 400);
    });

    test('POST /api/v1/hello rejects invalid locale format', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/hello',
            payload: {
                number: 123456,
                locale: 'invalid',
            },
        });

        assert.equal(response.statusCode, 400);
    });
});
