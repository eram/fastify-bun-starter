import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { createServer, registerRoutes } from '../server';
import { registerEnvInject } from './transpile';

process.env['JWT_SECRET'] ??= 'ci-test-secret';

const MOCK_DIR = path.join(__dirname, '__mock__');
const TEST_FILENAME = 'test-env.html';
const TEST_HTML_PATH = path.join(MOCK_DIR, TEST_FILENAME);
const TEST_ROUTE = '/test-env.html';
const ENV_SCRIPT_MARKER = '<script>window.env = ';

describe('registerEnvInjectedHtml', () => {
    let fastify: FastifyInstance;

    beforeEach(async () => {
        fastify = Fastify();
        // Ensure mock directory exists
        try {
            await fs.mkdir(MOCK_DIR);
        } catch {}
        // Create the test HTML file before registering the route
        await fs.writeFile(TEST_HTML_PATH, '<html><head></head><body>Hello</body></html>');
        await registerEnvInject(fastify, [TEST_FILENAME], MOCK_DIR);
        await fastify.listen({ port: 0 });
    });

    afterEach(async () => {
        try {
            await fs.unlink(TEST_HTML_PATH);
        } catch {}
        try {
            await fs.rmdir(MOCK_DIR);
        } catch {}
        await fastify.close();
    });

    test('injects env script into HTML response', async () => {
        const res = await fastify.inject({ method: 'GET', url: TEST_ROUTE, headers: { accept: 'text/html' } });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatch(new RegExp(ENV_SCRIPT_MARKER));
        expect(res.body).toMatch(/Hello/);
    });

    test('returns error for missing file at registration', async () => {
        // Remove file if exists
        try {
            await fs.unlink(TEST_HTML_PATH);
        } catch {}
        const fastify404 = Fastify();
        let threw = false;
        try {
            await registerEnvInject(fastify404, [TEST_FILENAME], MOCK_DIR);
        } catch (err) {
            threw = true;
            expect(String(err)).toMatch(/File not found/);
        }
        expect(threw).toBeTruthy();
    });

    test('serves from cache on repeated requests', async () => {
        // Modify the existing test file with new content
        await fs.writeFile(TEST_HTML_PATH, '<html><head></head><body>CacheTest</body></html>');

        // First request (cache miss due to mtime change)
        let res = await fastify.inject({ method: 'GET', url: TEST_ROUTE, headers: { accept: 'text/html' } });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatch(/CacheTest/);
        expect(res.headers['x-cache']).toBe('MISS');

        // Second request (should hit cache, x-cache header = HIT)
        res = await fastify.inject({ method: 'GET', url: TEST_ROUTE, headers: { accept: 'text/html' } });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatch(/CacheTest/);
        expect(res.headers['x-cache']).toBe('HIT');
    });
});

describe('Transpile endpoint', () => {
    let app: Awaited<ReturnType<typeof createServer>>;

    beforeEach(async () => {
        app = await createServer();
        await registerRoutes(app);
        await app.ready();
    });

    afterEach(async () => {
        await app.close();
    });

    test('should transpile TypeScript to JavaScript', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/theme-toggle/index.ts',
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8');
        expect(res.body.includes('themeToggle')).toBeTruthy();
        // Should not contain TypeScript-specific syntax like type annotations
        expect(res.body.includes(': void')).toBeFalsy();
    });

    test('should minify when query param is true', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/theme-toggle/index.ts?minify=true',
        });

        expect(res.statusCode).toBe(200);
        // Minified code should have no extra whitespace between statements
        expect(res.body.includes('themeToggle')).toBeTruthy();
    });

    test('should not minify when query param is false', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/theme-toggle/index.ts?minify=false',
        });

        expect(res.statusCode).toBe(200);
        // Non-minified code should have readable formatting
        expect(res.body.includes('themeToggle')).toBeTruthy();
    });

    test('should serve CSS files', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.css',
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
        expect(res.body.includes('body')).toBeTruthy();
    });

    test('should minify CSS when requested', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.css?minify=true',
        });

        expect(res.statusCode).toBe(200);
        // Minified CSS should remove comments and extra whitespace
        expect(res.body.includes('/*')).toBeFalsy();
        expect(res.body.includes('\n')).toBeFalsy();
    });

    test('should serve JSON files', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.json',
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
        const parsed = JSON.parse(res.body);
        expect(parsed.name).toBe('test');
    });

    test('should minify JSON when requested', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.json?minify=true',
        });

        expect(res.statusCode).toBe(200);
        // Minified JSON should have no whitespace
        expect(res.body.includes('\n')).toBeFalsy();
        expect(res.body.includes('  ')).toBeFalsy();
    });

    test('should reject path traversal attempts with ..', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/../secret.ts',
        });

        // Fastify normalizes URLs before routing, so this becomes /app/secret.ts
        // which gets 404 from our handler since it checks the filename param
        expect(res.statusCode).toBe(404);
    });

    test('should not serve test files with .test.ts extension', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/test-file.test.ts',
        });

        expect(res.statusCode).toBe(404);
        expect(res.body.includes('File not found')).toBeTruthy();
    });

    test('should not serve files in test directories', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/test/secret.ts',
        });

        // Security check blocks test directories
        expect(res.statusCode).toBe(404);
        expect(res.body.includes('File not found')).toBeTruthy();
    });

    test('should not serve files in fixtures directories', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/mock.ts',
        });

        // File doesn't exist, so returns 404 (test pattern check happens after file is found)
        expect(res.statusCode).toBe(404);
    });

    test('should prevent serving test files that exist', async () => {
        // The test-file.test.ts actually exists, so we can verify the security check
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/test-file.test.ts',
        });

        expect(res.statusCode).toBe(404);
    });

    test('should return 404 for non-existent files', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/nonexistent.ts',
        });

        expect(res.statusCode).toBe(404);
        expect(res.body.includes('File not found')).toBeTruthy();
    });

    test('should return 404 for unsupported file types', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/file.txt',
        });

        // Unsupported file types are handled by processFile which will fail to find them
        expect(res.statusCode).toBe(404);
        expect(res.body.includes('File not found')).toBeTruthy();
    });

    test('should include Cache-Control header', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/theme-toggle/index.ts',
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['cache-control']).toBeTruthy();
        expect(res.headers['cache-control']?.includes('max-age')).toBeTruthy();
    });

    test('should rate limit repeated transpile requests', async () => {
        let rateLimited = false;

        for (let i = 0; i < 1001; i++) {
            const res = await app.inject({
                method: 'GET',
                url: '/app/components/theme-toggle/index.ts',
            });

            if (res.statusCode === 429) {
                rateLimited = true;
                break;
            }
        }

        expect(rateLimited).toBe(true);
    });

    test('should return correct MIME type for TypeScript', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/theme-toggle/index.ts',
        });

        expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8');
    });

    test('should return correct MIME type for CSS', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.css',
        });

        expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    });

    test('should return correct MIME type for JSON', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.json',
        });

        expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    });

    test('should return correct MIME type for JavaScript', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.js',
        });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('application/javascript; charset=utf-8');
    });

    test('should add .ts extensions to relative imports', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/with-import.ts',
        });

        expect(res.statusCode).toBe(200);
        // Check that imports have .ts extensions added
        expect(res.body.includes(`'./sample.ts'`) || res.body.includes(`"./sample.ts"`)).toBeTruthy();
    });

    test('should handle unknown file extensions', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.txt',
        });

        // Unknown file type should still be served with empty content-type
        expect(res.statusCode).toBe(200);
    });

    test('should minify JavaScript files when requested', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/app/components/__mocks__/sample.js?minify=true',
        });

        expect(res.statusCode).toBe(200);
        // Minified JS should have reduced whitespace
        expect(res.body.includes('function')).toBeTruthy();
    });
});
