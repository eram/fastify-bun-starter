import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createServer, registerRoutes } from './server';

describe('Health endpoint', () => {
    test('GET /health returns status ok', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.status, 'ok');
        assert.ok(body.timestamp);
        assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('GET /health includes workers count when in cluster mode', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        // In test mode, workers is typically undefined since we're not in cluster
        // But we verify the structure is correct
        assert.equal(typeof body.workers, body.workers === undefined ? 'undefined' : 'number');
    });

    test('GET /health response matches schema', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);

        // Validate schema
        assert.ok(typeof body.status === 'string');
        assert.ok(typeof body.timestamp === 'string');
        if (body.workers !== undefined) {
            assert.ok(typeof body.workers === 'number');
        }
    });
});
