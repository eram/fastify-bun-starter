import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { createServer, registerRoutes } from '../server';

process.env['JWT_SECRET'] ??= 'ci-test-secret';

/** process.env values are always strings; assigning `undefined` back stores the literal string "undefined". */
function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}

describe('HTTP Security Middleware', () => {
    let app: FastifyInstance;
    let baseUrl: string;

    beforeEach(async () => {
        // Set test environment variables
        process.env['CORS_ALLOWED_ORIGINS'] = 'https://example.com';
        process.env['RATE_LIMIT_WINDOW_MS'] = '60000'; // 1 minute
        process.env['RATE_LIMIT_MAX_REQUESTS'] = '5';
        process.env['MAX_BODY_SIZE'] = '1mb';
        process.env['MAX_URL_LENGTH'] = '2048';

        // Create and start server
        app = await createServer();
        await registerRoutes(app);
        // Use port 0 to get a random available port
        await app.listen({ port: 0, host: '127.0.0.1' });
        const addr = app.server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
        if (app) {
            await app.close();
        }
    });

    test('should apply Helmet security headers', async () => {
        const response = await fetch(`${baseUrl}/health`);

        // Check Helmet security headers
        expect(response.headers.has('x-content-type-options')).toBeTruthy();
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');

        expect(response.headers.has('x-frame-options')).toBeTruthy();
        expect(response.headers.get('x-frame-options')).toBe('DENY');

        expect(response.headers.has('strict-transport-security')).toBeTruthy();

        expect(response.headers.has('content-security-policy')).toBeTruthy();
        const csp = response.headers.get('content-security-policy');
        expect(csp?.includes("frame-src 'self' blob:")).toBeTruthy();
        expect(csp?.includes("object-src 'none'")).toBeTruthy();
    });

    test('should handle CORS properly', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            headers: {
                origin: 'https://example.com',
            },
        });

        // Check CORS headers
        expect(response.headers.has('access-control-allow-origin')).toBeTruthy();
        expect(response.headers.get('access-control-allow-origin')).toBe('https://example.com');
    });

    test('should handle CORS preflight requests', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            method: 'OPTIONS',
            headers: {
                origin: 'https://example.com',
                'access-control-request-method': 'POST',
            },
        });

        expect(response.status).toBe(204);
        expect(response.headers.has('access-control-allow-methods')).toBeTruthy();
    });

    test('should expose session-id CORS headers', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            method: 'OPTIONS',
            headers: {
                origin: 'https://example.com',
                'access-control-request-method': 'POST',
                'access-control-request-headers': 'x-session-id',
            },
        });

        expect(response.status).toBe(204);

        // Check that the session-id header is allowed
        const allowedHeaders = response.headers.get('access-control-allow-headers');
        expect(allowedHeaders).toBeTruthy();
        expect(allowedHeaders?.toLowerCase().includes('x-session-id')).toBeTruthy();

        const exposedHeaders = response.headers.get('access-control-expose-headers');
        expect(exposedHeaders).toBeTruthy();
        expect(exposedHeaders?.includes('X-Session-Id')).toBeTruthy();
    });

    test('should apply rate limiting', async () => {
        // Make requests up to the limit
        const responses: Response[] = [];
        for (let i = 0; i < 6; i++) {
            const response = await fetch(`${baseUrl}/health`);
            responses.push(response);
        }

        // First 5 should succeed
        for (let i = 0; i < 5; i++) {
            expect(responses[i]?.status).toBe(200);
        }

        // 6th request should be rate limited
        expect(responses[5]?.status).toBe(429);

        // Check rate limit headers
        const lastResponse = responses[5];
        expect(lastResponse).toBeTruthy();
        expect(lastResponse?.headers.has('x-ratelimit-limit')).toBeTruthy();
        expect(lastResponse?.headers.has('x-ratelimit-remaining')).toBeTruthy();
        expect(lastResponse?.headers.has('x-ratelimit-reset')).toBeTruthy();

        // Verify error message
        const body = (await lastResponse?.json()) as { statusCode: number; error: string };
        expect(body.statusCode).toBe(429);
        expect(body.error.includes('Rate limit exceeded')).toBeTruthy();
    });

    test('should block CORS requests from disallowed origins', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            headers: {
                origin: 'https://evil.com',
            },
        });

        // CORS should not allow disallowed origin
        const allowOrigin = response.headers.get('access-control-allow-origin');
        expect(allowOrigin !== 'https://evil.com').toBeTruthy();
    });

    test('should enforce body size limits', async () => {
        // Create payload larger than 1MB
        const largePayload = 'x'.repeat(2 * 1024 * 1024); // 2MB

        const response = await fetch(`${baseUrl}/hello`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ data: largePayload }),
        });

        expect(response.status).toBe(413);
    });

    test('should handle valid requests within size limits', async () => {
        const response = await fetch(`${baseUrl}/api/v1/hello`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ number: 12345, locale: 'en-US' }),
        });

        expect(response.status).toBe(200);
    });

    test('should include security headers on all responses', async () => {
        const endpoints = ['/health', '/hello', '/docs/json'];

        for (const endpoint of endpoints) {
            const response = await fetch(`${baseUrl}${endpoint}`);
            expect(response.headers.has('x-content-type-options')).toBeTruthy();
        }
    });

    test('should block requests with disallowed Host header', async () => {
        // Configure DNS rebinding protection for this test
        const savedAllowedHosts = process.env['ALLOWED_HOSTS'];
        process.env['ALLOWED_HOSTS'] = 'localhost,127.0.0.1';

        // Close and recreate server with new config
        await app.close();
        app = await createServer();
        await registerRoutes(app);
        await app.listen({ port: 0, host: '127.0.0.1' });
        const addr = app.server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;

        // Request with malicious Host header
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: {
                Host: 'evil.com',
            },
        });

        expect(response.status).toBe(403);
        const body = (await response.json()) as { error: string; message: string };
        expect(body.error).toBe('Forbidden');
        expect(body.message).toBe('Host header not allowed');

        // Restore env
        restoreEnv('ALLOWED_HOSTS', savedAllowedHosts);
    });

    test('should allow requests with allowed Host header', async () => {
        const savedAllowedHosts = process.env['ALLOWED_HOSTS'];
        process.env['ALLOWED_HOSTS'] = 'localhost,127.0.0.1';

        await app.close();
        app = await createServer();
        await registerRoutes(app);
        await app.listen({ port: 0, host: '127.0.0.1' });
        const addr = app.server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;

        // Request with allowed Host header
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: {
                Host: 'localhost',
            },
        });

        expect(response.status).toBe(200);
        restoreEnv('ALLOWED_HOSTS', savedAllowedHosts);
    });

    test('should skip DNS rebinding protection when not configured', async () => {
        const savedAllowedHosts = process.env['ALLOWED_HOSTS'];
        delete process.env['ALLOWED_HOSTS'];

        await app.close();
        app = await createServer();
        await registerRoutes(app);
        await app.listen({ port: 0, host: '127.0.0.1' });
        const addr = app.server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;

        // Request with any Host header should be allowed when protection is disabled
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: {
                Host: 'any-random-host.com',
            },
        });

        expect(response.status).toBe(200);
        restoreEnv('ALLOWED_HOSTS', savedAllowedHosts);
    });

    test('should handle multiple allowed hosts', async () => {
        const savedAllowedHosts = process.env['ALLOWED_HOSTS'];
        process.env['ALLOWED_HOSTS'] = 'localhost,127.0.0.1,example.local';

        await app.close();
        app = await createServer();
        await registerRoutes(app);
        await app.listen({ port: 0, host: '127.0.0.1' });
        const addr = app.server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;

        // Test each allowed host
        for (const host of ['localhost', '127.0.0.1', 'example.local']) {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
                headers: { Host: host },
            });
            expect(response.status).toBe(200);
        }

        // Test disallowed host
        const badResponse = await fetch(`http://127.0.0.1:${port}/health`, {
            headers: { Host: 'evil.com' },
        });
        expect(badResponse.status).toBe(403);
        restoreEnv('ALLOWED_HOSTS', savedAllowedHosts);
    });
});
