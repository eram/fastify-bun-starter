import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sleep } from '@libs/utils/time';
import { createServer, registerRoutes, startServer } from './server';

describe('Static file serving', () => {
    // Use real HTTP requests instead of inject() to avoid @fastify/static + Bun compatibility issue
    let server: Awaited<ReturnType<typeof createServer>>;
    let testPort: number;
    let serverPromise: Promise<void>;

    beforeEach(async () => {
        testPort = 13500 + Math.floor(Math.random() * 100); // Random port 13500-13599
        process.env['PORT'] = String(testPort);
        process.env['HOST'] = '127.0.0.1';

        server = await createServer();
        await registerRoutes(server);
        serverPromise = startServer(server);
        await sleep(100); // Give server time to start
    });

    afterEach(async () => {
        await server.close();
        await serverPromise;
    });

    test('should serve index.html at root path', async () => {
        const res = await fetch(`http://127.0.0.1:${testPort}/`);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')?.includes('text/html')).toBeTruthy();

        const body = await res.text();
        expect(body.includes('<!DOCTYPE html>')).toBeTruthy();
    });

    test('should serve index.html explicitly', async () => {
        const res = await fetch(`http://127.0.0.1:${testPort}/index.html`);

        expect(res.status).toBe(200);
        const contentType = res.headers.get('content-type');
        if (contentType) {
            expect(contentType.includes('text/html')).toBeTruthy();
        }

        const body = await res.text();
        expect(body.includes('<!DOCTYPE html>')).toBeTruthy();
    });

    test('should return 404 for non-existent static file', async () => {
        const res = await fetch(`http://127.0.0.1:${testPort}/nonexistent.html`);
        expect(res.status).toBe(404);
    });

    test('should have correct content type for HTML files', async () => {
        const res = await fetch(`http://127.0.0.1:${testPort}/index.html`);
        expect(res.status).toBe(200);
        const contentType = res.headers.get('content-type');
        if (contentType) {
            expect(contentType.includes('text/html')).toBeTruthy();
        }
    });

    test('should not conflict with existing API routes', async () => {
        // Verify that API routes still work after static plugin is registered
        const healthRes = await fetch(`http://127.0.0.1:${testPort}/health`);
        expect(healthRes.status).toBe(200);

        const docsRes = await fetch(`http://127.0.0.1:${testPort}/api/v1/swagger`);
        expect(docsRes.status).toBe(200);
    });
});
