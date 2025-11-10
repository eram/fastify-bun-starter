import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { getManager } from '../controller/mcp-controller/config';
import { createServer, registerRoutes } from './server';

describe('MCP Configuration REST API', () => {
    let manager: ReturnType<typeof getManager>;

    beforeEach(async () => {
        // Get the global manager (singleton) - routes use the same instance
        manager = getManager(undefined, false);
        // Clean up any existing servers from previous tests
        const servers = await manager.getAllServers();
        for (const server of servers) {
            await manager.removeServer(server.name);
        }
    });

    afterEach(async () => {
        // Clean up all servers after each test
        const servers = await manager.getAllServers();
        for (const server of servers) {
            await manager.removeServer(server.name);
        }
        manager.cleanup();
    });

    test('GET /api/v1/config lists all servers', async () => {
        const app = createServer();
        await registerRoutes(app);

        // Add a test server
        await manager.upsertServer({
            name: 'test-server',
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            enabled: true,
        });

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/config',
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.ok(Array.isArray(body.servers));
        assert.ok(body.total >= 1);
        assert.ok(body.servers.some((s: { name: string }) => s.name === 'test-server'));
    });

    test('GET /api/v1/config/:name returns specific server', async () => {
        const app = createServer();
        await registerRoutes(app);

        await manager.upsertServer({
            name: 'test-server',
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            enabled: true,
        });

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/config/test-server',
        });

        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.name, 'test-server');
        assert.equal(body.transport, 'stdio');
        assert.equal(body.command, 'node');
    });

    test('GET /api/v1/config/:name returns 404 for non-existent server', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'GET',
            url: '/api/v1/config/non-existent',
        });

        assert.equal(response.statusCode, 404);
        const body = JSON.parse(response.body);
        assert.ok(body.error);
    });

    test('POST /api/v1/config creates new stdio server', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/config',
            payload: {
                name: 'new-server',
                transport: 'stdio',
                command: 'bun',
                args: ['run', 'server.ts'],
                enabled: true,
            },
        });

        assert.equal(response.statusCode, 201);
        const body = JSON.parse(response.body);
        assert.equal(body.name, 'new-server');

        // Verify it was actually created
        const server = await manager.getServer('new-server');
        assert.ok(server);
        assert.equal(server.transport, 'stdio');
    });

    test('POST /api/v1/config creates new SSE server', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/config',
            payload: {
                name: 'sse-server',
                transport: 'sse',
                url: 'http://localhost:8080/sse',
                enabled: true,
            },
        });

        assert.equal(response.statusCode, 201);
        const body = JSON.parse(response.body);
        assert.equal(body.name, 'sse-server');

        const server = await manager.getServer('sse-server');
        assert.ok(server);
        assert.equal(server.transport, 'sse');
    });

    test('POST /api/v1/config rejects invalid transport', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/config',
            payload: {
                name: 'invalid-server',
                transport: 'invalid-transport',
                command: 'node',
            },
        });

        assert.equal(response.statusCode, 400);
    });

    test('POST /api/v1/config rejects duplicate server name', async () => {
        const app = createServer();
        await registerRoutes(app);

        // Create first server
        await manager.upsertServer({
            name: 'duplicate',
            transport: 'stdio',
            command: 'node',
            enabled: true,
        });

        // Try to create duplicate
        const response = await app.inject({
            method: 'POST',
            url: '/api/v1/config',
            payload: {
                name: 'duplicate',
                transport: 'stdio',
                command: 'bun',
            },
        });

        assert.equal(response.statusCode, 409);
    });

    test('PUT /api/v1/config/:name updates existing server', async () => {
        const app = createServer();
        await registerRoutes(app);

        await manager.upsertServer({
            name: 'update-me',
            transport: 'stdio',
            command: 'node',
            enabled: true,
        });

        const response = await app.inject({
            method: 'PUT',
            url: '/api/v1/config/update-me',
            payload: {
                transport: 'stdio',
                command: 'bun',
                enabled: false,
            },
        });

        assert.equal(response.statusCode, 200);
        const server = await manager.getServer('update-me');
        assert.ok(server);
        if (server.transport === 'stdio') {
            assert.equal(server.command, 'bun');
        }
        assert.equal(server.enabled, false);
    });

    test('PUT /api/v1/config/:name returns 404 for non-existent server', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'PUT',
            url: '/api/v1/config/non-existent',
            payload: {
                enabled: false,
            },
        });

        assert.equal(response.statusCode, 404);
    });

    test('DELETE /api/v1/config/:name removes server', async () => {
        const app = createServer();
        await registerRoutes(app);

        await manager.upsertServer({
            name: 'delete-me',
            transport: 'stdio',
            command: 'node',
            enabled: true,
        });

        const response = await app.inject({
            method: 'DELETE',
            url: '/api/v1/config/delete-me',
        });

        assert.equal(response.statusCode, 200);

        // Verify it was deleted
        const server = await manager.getServer('delete-me');
        assert.equal(server, undefined);
    });

    test('DELETE /api/v1/config/:name returns 404 for non-existent server', async () => {
        const app = createServer();
        await registerRoutes(app);

        const response = await app.inject({
            method: 'DELETE',
            url: '/api/v1/config/non-existent',
        });

        assert.equal(response.statusCode, 404);
    });

    test('PATCH /api/v1/config/:name/enabled toggles server status', async () => {
        const app = createServer();
        await registerRoutes(app);

        await manager.upsertServer({
            name: 'toggle-me',
            transport: 'stdio',
            command: 'node',
            enabled: true,
        });

        // Disable it
        const response1 = await app.inject({
            method: 'PATCH',
            url: '/api/v1/config/toggle-me/enabled',
            payload: {
                enabled: false,
            },
        });

        assert.equal(response1.statusCode, 200);
        let server = await manager.getServer('toggle-me');
        assert.equal(server?.enabled, false);

        // Enable it again
        const response2 = await app.inject({
            method: 'PATCH',
            url: '/api/v1/config/toggle-me/enabled',
            payload: {
                enabled: true,
            },
        });

        assert.equal(response2.statusCode, 200);
        server = await manager.getServer('toggle-me');
        assert.equal(server?.enabled, true);
    });
});
