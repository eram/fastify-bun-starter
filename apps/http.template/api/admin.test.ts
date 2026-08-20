import { describe, expect, test } from 'bun:test';
import { createToken } from '@libs/utils';
import { createServer, registerRoutes } from '../server';

process.env['JWT_SECRET'] ??= 'ci-test-secret';
const SECRET = process.env['JWT_SECRET'];

describe('Admin endpoint', () => {
    test('GET /api/v1/admin without a token returns 401', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({ method: 'GET', url: '/api/v1/admin' });
        expect(response.statusCode).toBe(401);
    });

    test('GET /api/v1/admin with an invalid token returns 401', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin',
            headers: { authorization: 'Bearer not-a-real-token' },
        });
        expect(response.statusCode).toBe(401);
    });

    test('GET /api/v1/admin with an expired token returns 401', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const expired = createToken({ sub: 'cli', iat: Math.floor(Date.now() / 1000) - 7200 }, 3600, SECRET);
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin',
            headers: { authorization: `Bearer ${expired}` },
        });
        expect(response.statusCode).toBe(401);
    });

    test('GET /api/v1/admin with a valid token but no role:admin claim returns 401', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const token = createToken({ sub: 'cli', iat: Math.floor(Date.now() / 1000) }, '1h', SECRET);
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin',
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.message).toBe('requires role:admin claim.');
    });

    test('GET /api/v1/admin with a valid token but wrong role claim returns 401', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const token = createToken({ sub: 'cli', iat: Math.floor(Date.now() / 1000), role: 'viewer' }, '1h', SECRET);
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin',
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body);
        expect(body.message).toBe('requires role:admin claim.');
    });

    test('GET /api/v1/admin with a valid token and role:admin claim returns the JWT claims', async () => {
        const app = await createServer();
        await registerRoutes(app);

        const token = createToken({ sub: 'cli', iat: Math.floor(Date.now() / 1000), role: 'admin' }, '1h', SECRET);
        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/admin',
            headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.sub).toBe('cli');
        expect(body.role).toBe('admin');
        expect(typeof body.exp).toBe('number');
    });
});
