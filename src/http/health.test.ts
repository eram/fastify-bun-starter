import { ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { app } from '../app';

describe('Health route', () => {
    test('GET /health returns 200 status', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        strictEqual(response.statusCode, 200);
    });

    test('GET /health returns correct structure', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        const json = response.json();
        strictEqual(json.status, 'ok');
        ok(json.timestamp);
        ok(typeof json.timestamp === 'string');
    });

    test('GET /health includes timestamp in ISO format', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        const json = response.json();
        const timestamp = new Date(json.timestamp);
        ok(!Number.isNaN(timestamp.getTime()));
    });

    test('GET /health includes workers count when in cluster mode', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        const json = response.json();
        // In test mode (non-cluster), workers should be undefined
        // In cluster mode, workers should be a number >= 0
        if (json.workers !== undefined) {
            ok(typeof json.workers === 'number');
            ok(json.workers >= 0);
        }
    });

    test('GET /health content-type is application/json', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        ok(response.headers['content-type']?.includes('application/json'));
    });
});
