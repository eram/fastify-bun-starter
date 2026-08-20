import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { createServer, registerRoutes } from '../server';

process.env['JWT_SECRET'] ??= 'ci-test-secret';

describe('Error Handler', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        app = await createServer();
        await registerRoutes(app);
    });

    afterEach(async () => {
        await app.close();
    });

    test('should return HTML error page for 404 on text request', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/nonexistent-page',
            headers: {
                accept: 'text/html',
            },
        });

        expect(res.statusCode).toBe(404);
        expect(res.headers['content-type']?.includes('text/html')).toBeTruthy();
        expect(res.body.includes('404')).toBeTruthy();
        expect(res.body.includes('Not Found')).toBeTruthy();
        expect(res.body.includes('Go to Homepage')).toBeTruthy();
    });

    test('should return JSON error for 404 on non-text request', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/nonexistent',
        });

        expect(res.statusCode).toBe(404);
        expect(res.headers['content-type']?.includes('application/json')).toBeTruthy();
        const body = JSON.parse(res.body);
        expect(body.statusCode).toBe(404);
        expect(body.error).toBe('Not Found');
    });

    test('should return HTML error page for 404 when Accept includes text/html with wildcards', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/nonexistent-page',
            headers: {
                accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
            },
        });

        expect(res.statusCode).toBe(404);
        expect(res.headers['content-type']?.includes('application/json')).toBeTruthy();
        const body = JSON.parse(res.body);
        expect(body.statusCode).toBe(404);
        expect(body.error).toBe('Not Found');
    });

    test('should return JSON for 404 when no Accept header provided', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/nonexistent-file',
        });

        expect(res.statusCode).toBe(404);
        expect(res.headers['content-type']?.includes('application/json')).toBeTruthy();
        const body = JSON.parse(res.body);
        expect(body.statusCode).toBe(404);
        expect(body.error).toBe('Not Found');
    });
});
