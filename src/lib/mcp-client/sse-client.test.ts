/**
 * Tests for SSE MCP client
 */

import { strict as assert } from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { ResilientClient } from '../../util';
import { SseClient } from './sse-client';

describe('sse-client', () => {
    afterEach(() => {
        mock.restoreAll();
        ResilientClient.clearPool();
    });

    test('constructor accepts URL and options', () => {
        const client = new SseClient('http://localhost:3000', {
            endpoint: '/custom-sse',
            timeout: 10000,
            capabilities: { tools: true },
            clientInfo: { name: 'test-client', version: '1.0.0' },
        });

        assert.ok(client);
        assert.equal(client.refCount, 0);
    });

    test('constructor uses default endpoint', () => {
        const client = new SseClient('http://localhost:3000');
        assert.ok(client);
    });

    test('connected returns false before connect', () => {
        const client = new SseClient('http://localhost:3000');
        assert.equal(client.connected, false);
    });

    test('refCount is initialized to 0', () => {
        const client = new SseClient('http://localhost:3000');
        assert.equal(client.refCount, 0);
    });

    test('refCount can be incremented', () => {
        const client = new SseClient('http://localhost:3000');
        client.refCount++;
        assert.equal(client.refCount, 1);
    });

    test('sessionId is undefined before connect', () => {
        const client = new SseClient('http://localhost:3000');
        assert.equal(client.sessionId, undefined);
    });

    test('endpoint is undefined before connect', () => {
        const client = new SseClient('http://localhost:3000');
        assert.equal(client.endpoint, undefined);
    });

    test('connect throws if already connected', async () => {
        const client = new SseClient('http://localhost:3000');

        // Mock successful connection
        const mockSession = {
            sessionId: 'test-session',
            endpoint: '/test',
            connected: true,
            addEventListener: () => undefined,
            sendRequest: async () => ({ result: {} }),
        };

        const mockFetch = mock.fn(async () => mockSession);
        ResilientClient.prototype.fetch = mockFetch as never;

        await client.connect();

        await assert.rejects(
            async () => await client.connect(),
            (err: Error) => {
                assert.ok(err.message.includes('Already connected'));
                return true;
            },
        );
    });

    test('close is idempotent', () => {
        const client = new SseClient('http://localhost:3000');

        client.close();
        client.close(); // Should not throw

        assert.ok(true);
    });

    test('sendRequest rejects if not connected', async () => {
        const client = new SseClient('http://localhost:3000');

        await assert.rejects(
            async () => await client.sendRequest('test', {}),
            (err: Error) => {
                assert.ok(err.message.includes('Not connected'));
                return true;
            },
        );
    });

    test('close sets connected to false', () => {
        const client = new SseClient('http://localhost:3000');

        client.close();

        assert.equal(client.connected, false);
    });

    test('uses MCP protocol version 2024-11-05', () => {
        const client = new SseClient('http://localhost:3000');

        // Access private field via type assertion
        const initParams = (client as never as { _initParams: { protocolVersion: string } })._initParams;
        assert.equal(initParams.protocolVersion, '2024-11-05');
    });

    test('stores custom capabilities', () => {
        const customCaps = { tools: true, resources: false };
        const client = new SseClient('http://localhost:3000', {
            capabilities: customCaps,
        });

        const initParams = (client as never as { _initParams: { capabilities: unknown } })._initParams;
        assert.deepEqual(initParams.capabilities, customCaps);
    });

    test('stores custom clientInfo', () => {
        const clientInfo = { name: 'my-client', version: '2.0.0' };
        const client = new SseClient('http://localhost:3000', {
            clientInfo,
        });

        const initParams = (client as never as { _initParams: { clientInfo: unknown } })._initParams;
        assert.deepEqual(initParams.clientInfo, clientInfo);
    });

    test('uses default clientInfo if not provided', () => {
        const client = new SseClient('http://localhost:3000');

        const initParams = (client as never as { _initParams: { clientInfo: { name: string; version: string } } })._initParams;
        assert.equal(initParams.clientInfo.name, 'mcp-client');
        assert.equal(initParams.clientInfo.version, '1.0.0');
    });

    test('listTools and callTool methods exist', () => {
        const client = new SseClient('http://localhost:3000');

        assert.equal(typeof client.listTools, 'function');
        assert.equal(typeof client.callTool, 'function');
    });

    test('listTools requires connection', async () => {
        const client = new SseClient('http://localhost:3000');

        await assert.rejects(async () => await client.listTools());
    });

    test('callTool requires connection', async () => {
        const client = new SseClient('http://localhost:3000');

        await assert.rejects(async () => await client.callTool('test', {}));
    });
});
