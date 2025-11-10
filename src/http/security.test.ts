import { ok, strictEqual } from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { createServer, registerRoutes } from './server';

describe('HTTP Security Middleware', () => {
    let app: FastifyInstance;
    const testPort = 3001;
    const baseUrl = `http://localhost:${testPort}`;

    beforeEach(async () => {
        // Set test environment variables
        process.env.PORT = String(testPort);
        process.env.CORS_ALLOWED_ORIGINS = 'https://example.com';
        process.env.RATE_LIMIT_WINDOW_MS = '60000'; // 1 minute
        process.env.RATE_LIMIT_MAX_REQUESTS = '5';
        process.env.MAX_BODY_SIZE = '1mb';
        process.env.MAX_URL_LENGTH = '2048';

        // Create and start server
        app = createServer();
        await registerRoutes(app);
        await app.listen({ port: testPort, host: '127.0.0.1' });
    });

    afterEach(async () => {
        if (app) {
            await app.close();
        }
    });

    test('should apply Helmet security headers', async () => {
        const response = await fetch(`${baseUrl}/health`);

        // Check Helmet security headers
        ok(response.headers.has('x-content-type-options'), 'Should have X-Content-Type-Options header');
        strictEqual(response.headers.get('x-content-type-options'), 'nosniff', 'X-Content-Type-Options should be nosniff');

        ok(response.headers.has('x-frame-options'), 'Should have X-Frame-Options header');
        strictEqual(response.headers.get('x-frame-options'), 'DENY', 'X-Frame-Options should be DENY');

        ok(response.headers.has('strict-transport-security'), 'Should have Strict-Transport-Security header');

        ok(response.headers.has('content-security-policy'), 'Should have Content-Security-Policy header');
    });

    test('should handle CORS properly', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            headers: {
                origin: 'https://example.com',
            },
        });

        // Check CORS headers
        ok(response.headers.has('access-control-allow-origin'), 'Should have Access-Control-Allow-Origin header');
        strictEqual(response.headers.get('access-control-allow-origin'), 'https://example.com', 'Should allow configured origin');
    });

    test('should handle CORS preflight requests', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            method: 'OPTIONS',
            headers: {
                origin: 'https://example.com',
                'access-control-request-method': 'POST',
            },
        });

        strictEqual(response.status, 204, 'Preflight should return 204 No Content');
        ok(response.headers.has('access-control-allow-methods'), 'Should have Access-Control-Allow-Methods header');
    });

    test('should expose MCP-specific CORS headers', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            method: 'OPTIONS',
            headers: {
                origin: 'https://example.com',
                'access-control-request-method': 'POST',
                'access-control-request-headers': 'mcp-session-id',
            },
        });

        strictEqual(response.status, 204, 'Preflight should return 204 No Content');

        // Check that MCP headers are allowed
        const allowedHeaders = response.headers.get('access-control-allow-headers');
        ok(allowedHeaders, 'Should have Access-Control-Allow-Headers');
        ok(allowedHeaders?.toLowerCase().includes('mcp-session-id'), 'Should allow mcp-session-id header for MCP clients');

        const exposedHeaders = response.headers.get('access-control-expose-headers');
        ok(exposedHeaders, 'Should have Access-Control-Expose-Headers');
        ok(exposedHeaders?.includes('Mcp-Session-Id'), 'Should expose Mcp-Session-Id header for MCP clients to read');
    });

    test('should apply rate limiting', async () => {
        // Make requests up to the limit
        const responses = [];
        for (let i = 0; i < 6; i++) {
            const response = await fetch(`${baseUrl}/health`);
            responses.push(response);
        }

        // First 5 should succeed
        for (let i = 0; i < 5; i++) {
            strictEqual(responses[i].status, 200, `Request ${i + 1} should succeed`);
        }

        // 6th request should be rate limited
        strictEqual(responses[5].status, 429, 'Request beyond limit should return 429 Too Many Requests');

        // Check rate limit headers
        const lastResponse = responses[5];
        ok(lastResponse.headers.has('x-ratelimit-limit'), 'Should have X-RateLimit-Limit header');
        ok(lastResponse.headers.has('x-ratelimit-remaining'), 'Should have X-RateLimit-Remaining header');
        ok(lastResponse.headers.has('x-ratelimit-reset'), 'Should have X-RateLimit-Reset header');

        // Verify error message
        const body = (await lastResponse.json()) as { statusCode: number; error: string };
        strictEqual(body.statusCode, 429, 'Should return statusCode 429');
        strictEqual(body.error, 'Too Many Requests', 'Should return Too Many Requests error');
    });

    test('should block CORS requests from disallowed origins', async () => {
        const response = await fetch(`${baseUrl}/health`, {
            headers: {
                origin: 'https://evil.com',
            },
        });

        // CORS should not allow disallowed origin
        const allowOrigin = response.headers.get('access-control-allow-origin');
        ok(allowOrigin !== 'https://evil.com', 'Should not allow origin not in whitelist');
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

        strictEqual(response.status, 413, 'Should return 413 Payload Too Large');
    });

    test('should handle valid requests within size limits', async () => {
        const response = await fetch(`${baseUrl}/api/v1/hello`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ number: 12345, locale: 'en-US' }),
        });

        strictEqual(response.status, 200, 'Should accept valid payload');
    });

    test('should include security headers on all responses', async () => {
        const endpoints = ['/health', '/hello', '/docs/json'];

        for (const endpoint of endpoints) {
            const response = await fetch(`${baseUrl}${endpoint}`);
            ok(response.headers.has('x-content-type-options'), `${endpoint} should have security headers`);
        }
    });
});

describe('DNS Rebinding Protection', () => {
    let app: FastifyInstance;
    const testPort = 3002;

    afterEach(async () => {
        if (app) {
            await app.close();
        }
        // Clean up environment
        delete process.env.ALLOWED_HOSTS;
    });

    test('should block requests with disallowed Host header', async () => {
        // Configure DNS rebinding protection
        process.env.ALLOWED_HOSTS = 'localhost,127.0.0.1';
        process.env.PORT = String(testPort);

        app = createServer();
        await registerRoutes(app);
        await app.listen({ port: testPort, host: '127.0.0.1' });

        // Request with malicious Host header
        const response = await fetch(`http://127.0.0.1:${testPort}/health`, {
            headers: {
                Host: 'evil.com',
            },
        });

        strictEqual(response.status, 403, 'Should return 403 Forbidden for disallowed host');
        const body = (await response.json()) as { error: string; message: string };
        strictEqual(body.error, 'Forbidden');
        strictEqual(body.message, 'Host header not allowed');
    });

    test('should allow requests with allowed Host header', async () => {
        process.env.ALLOWED_HOSTS = 'localhost,127.0.0.1';
        process.env.PORT = String(testPort);

        app = createServer();
        await registerRoutes(app);
        await app.listen({ port: testPort, host: '127.0.0.1' });

        // Request with allowed Host header
        const response = await fetch(`http://127.0.0.1:${testPort}/health`, {
            headers: {
                Host: 'localhost',
            },
        });

        strictEqual(response.status, 200, 'Should allow request with allowed host');
    });

    test('should skip DNS rebinding protection when not configured', async () => {
        // Do not set ALLOWED_HOSTS
        process.env.PORT = String(testPort);

        app = createServer();
        await registerRoutes(app);
        await app.listen({ port: testPort, host: '127.0.0.1' });

        // Request with any Host header should be allowed when protection is disabled
        const response = await fetch(`http://127.0.0.1:${testPort}/health`, {
            headers: {
                Host: 'any-random-host.com',
            },
        });

        strictEqual(response.status, 200, 'Should allow all hosts when ALLOWED_HOSTS is not configured');
    });

    test('should handle multiple allowed hosts', async () => {
        process.env.ALLOWED_HOSTS = 'localhost,127.0.0.1,example.local';
        process.env.PORT = String(testPort);

        app = createServer();
        await registerRoutes(app);
        await app.listen({ port: testPort, host: '127.0.0.1' });

        // Test each allowed host
        for (const host of ['localhost', '127.0.0.1', 'example.local']) {
            const response = await fetch(`http://127.0.0.1:${testPort}/health`, {
                headers: { Host: host },
            });
            strictEqual(response.status, 200, `Should allow ${host}`);
        }

        // Test disallowed host
        const badResponse = await fetch(`http://127.0.0.1:${testPort}/health`, {
            headers: { Host: 'evil.com' },
        });
        strictEqual(badResponse.status, 403, 'Should block disallowed host');
    });
});
