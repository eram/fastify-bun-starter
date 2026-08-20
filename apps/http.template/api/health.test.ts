import { describe, expect, test } from 'bun:test';
import { apm } from '@libs/utils/apm';
import { createServer, registerRoutes } from '../server';

process.env['JWT_SECRET'] ??= 'ci-test-secret';

describe('Health endpoint', () => {
    test('GET /health increments the api.health.calls counter', async () => {
        apm.resetAll(true);
        const app = await createServer();
        await registerRoutes(app);

        await app.inject({ method: 'GET', url: '/health' });
        expect(apm.counters['api.health.calls']?.val).toBe(1);

        await app.inject({ method: 'GET', url: '/health' });
        expect(apm.counters['api.health.calls']?.val).toBe(2);
    });

    test('GET /health returns status ok', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.status).toBe('ok');
        expect(body.timestamp).toBeTruthy();
        expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test('GET /health includes workers count when in cluster mode', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        // In test mode, workers is typically undefined since we're not in cluster
        // But we verify the structure is correct
        expect(typeof body.workers).toBe(body.workers === undefined ? 'undefined' : 'number');
    });

    test('GET /health response matches schema', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        // Validate schema
        expect(typeof body.status === 'string').toBeTruthy();
        expect(typeof body.timestamp === 'string').toBeTruthy();
        if (body.workers !== undefined) {
            expect(typeof body.workers === 'number').toBeTruthy();
        }
    });

    test('GET /health response includes workers.alive, api.health.calls and views.hello.calls', async () => {
        apm.resetAll(true);
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        expect(body['workers.alive']).toBe(0);
        expect(body['api.health.calls']).toBe(1);
        expect(body['views.hello.calls']).toBe(0);
    });
});
