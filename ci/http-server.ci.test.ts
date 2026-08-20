// ci/http-server.ci.test.ts
// Black-box integration test: spawns the real http.template server process
// and exercises its APIs, views, and static assets over real HTTP.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { createToken } from '@libs/utils';

const PORT = 5000 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'ci-test-secret';

let server: ChildProcess;

async function waitForServer(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${BASE_URL}/health`);
            if (res.ok) return;
        } catch {
            // server not up yet, keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become ready on port ${PORT} within ${timeoutMs}ms`);
}

beforeAll(async () => {
    server = spawn('bun', ['apps/http.template/instance.ts'], {
        env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET },
        stdio: 'pipe',
    });
    await waitForServer();
});

afterAll(async () => {
    server.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
});

describe('GET /health', () => {
    test('returns ok status with expected shape', async () => {
        const res = await fetch(`${BASE_URL}/health`);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(typeof body['workers.alive']).toBe('number');
        expect(typeof body['api.health.calls']).toBe('number');
        expect(typeof body['views.hello.calls']).toBe('number');
    });

    test('increments api.health.calls across requests', async () => {
        const before = (await (await fetch(`${BASE_URL}/health`)).json())['api.health.calls'];
        const after = (await (await fetch(`${BASE_URL}/health`)).json())['api.health.calls'];
        expect(after).toBe(before + 1);
    });
});

describe('GET/POST /api/v1/hello', () => {
    test('GET formats a number for a valid locale', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/hello?number=1234567&locale=en-US`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.formatted).toBe('1,234,567');
    });

    test('GET rejects unsupported locale', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/hello?number=123&locale=xx-XX`);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.message).toMatch(/Unsupported locale/);
        expect(Array.isArray(body.availableLocales)).toBe(true);
    });

    test('POST formats a number for a valid locale', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/hello`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ number: 42, locale: 'de-DE' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.formatted).toBe('42');
    });

    test('POST rejects invalid body', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/hello`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ number: 'not-a-number', locale: 'en-US' }),
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
    });
});

describe('OpenAPI / Swagger', () => {
    test('GET /api/v1/openapi.json exposes generated spec', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/openapi.json`);
        expect(res.status).toBe(200);
        const spec = await res.json();
        expect(spec.openapi).toBe('3.0.0');
        expect(spec.paths).toHaveProperty('/health');
        expect(spec.paths).toHaveProperty('/api/v1/hello');
    });

    test('GET /api/v1/swagger serves the API reference page', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/swagger`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/html/);
        const html = await res.text();
        expect(html).toContain('id="api-reference"');
    });
});

describe('Static assets and views', () => {
    test('GET / serves the index page', async () => {
        const res = await fetch(`${BASE_URL}/`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/text\/html/);
        const html = await res.text();
        expect(html).toContain('id="app"');
        expect(html).toContain('/app/views/index.ts');
    });

    test('GET /favicon.ico is served', async () => {
        const res = await fetch(`${BASE_URL}/favicon.ico`);
        expect(res.status).toBe(200);
    });

    test('GET /favicon.svg is served', async () => {
        const res = await fetch(`${BASE_URL}/favicon.svg`);
        expect(res.status).toBe(200);
    });

    test('GET /app/views/index.ts serves transpiled JS', async () => {
        const res = await fetch(`${BASE_URL}/app/views/index.ts`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/javascript/);
        const js = await res.text();
        // Transpiled output should not contain the raw decorator/type syntax of the .ts source
        expect(js).toContain('mount');
    });

    test('GET /app/components/icon/index.ts serves transpiled component', async () => {
        const res = await fetch(`${BASE_URL}/app/components/icon/index.ts`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/javascript/);
    });
});

describe('GET /api/v1/admin', () => {
    test('without a token returns 401', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/admin`);
        expect(res.status).toBe(401);
    });

    test('with an invalid token returns 401', async () => {
        const res = await fetch(`${BASE_URL}/api/v1/admin`, {
            headers: { authorization: 'Bearer not-a-real-token' },
        });
        expect(res.status).toBe(401);
    });

    test('with a valid token but no role:admin claim returns 401', async () => {
        const token = createToken({ sub: 'cli', iat: Math.floor(Date.now() / 1000) }, '1h', JWT_SECRET);
        const res = await fetch(`${BASE_URL}/api/v1/admin`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.message).toBe('requires role:admin claim.');
    });

    test('with a valid token but the wrong role claim returns 401', async () => {
        const token = createToken({ sub: 'cli', iat: Math.floor(Date.now() / 1000), role: 'viewer' }, '1h', JWT_SECRET);
        const res = await fetch(`${BASE_URL}/api/v1/admin`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.message).toBe('requires role:admin claim.');
    });

    test('with a valid token and role:admin claim returns the JWT claims', async () => {
        const token = createToken({ sub: 'cli', iat: Math.floor(Date.now() / 1000), role: 'admin' }, '1h', JWT_SECRET);
        const res = await fetch(`${BASE_URL}/api/v1/admin`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.sub).toBe('cli');
        expect(body.role).toBe('admin');
    });
});

describe('Startup guard: JWT_SECRET', () => {
    test('server refuses to start when JWT_SECRET is unset', async () => {
        const badPort = PORT + 1;
        const { JWT_SECRET: _omit, ...restEnv } = process.env;

        const badServer = spawn('bun', ['apps/http.template/instance.ts'], {
            env: { ...restEnv, PORT: String(badPort), HOST: '127.0.0.1' },
            stdio: 'pipe',
        });
        const exitCode = await new Promise<number | null>((resolve) => {
            badServer.on('exit', (code) => resolve(code));
        });

        expect(exitCode).not.toBe(0);
    });

    test('server refuses to start when JWT_SECRET is the literal default "secret"', async () => {
        const badPort = PORT + 2;
        const env = { ...process.env, PORT: String(badPort), HOST: '127.0.0.1', JWT_SECRET: 'secret' };

        const badServer = spawn('bun', ['apps/http.template/instance.ts'], { env, stdio: 'pipe' });
        const exitCode = await new Promise<number | null>((resolve) => {
            badServer.on('exit', (code) => resolve(code));
        });

        expect(exitCode).not.toBe(0);
    });
});

describe('Error handling', () => {
    test('GET unknown JSON route returns 404 JSON error', async () => {
        const res = await fetch(`${BASE_URL}/does-not-exist`, {
            headers: { accept: 'application/json' },
        });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.statusCode).toBe(404);
    });

    test('GET unknown browser route returns 404 HTML error page', async () => {
        const res = await fetch(`${BASE_URL}/does-not-exist`, {
            headers: { accept: 'text/html' },
        });
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toMatch(/text\/html/);
    });
});
