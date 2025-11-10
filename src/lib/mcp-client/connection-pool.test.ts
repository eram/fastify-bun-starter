/**
 * Tests for MCP Client Connection Pool
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { MCPClient } from './client';
import { connectionPool } from './connection-pool';

describe('MCPConnectionPool', () => {
    beforeEach(() => {
        // Clear pool before each test
        connectionPool.clear();
    });

    afterEach(() => {
        // Clean up after each test
        connectionPool.clear();
    });

    test('should be a singleton instance', () => {
        assert.ok(connectionPool instanceof Map);
    });

    test('should add and retrieve connections', () => {
        const mockClient: Partial<MCPClient> = {
            connect: async () => {},
            connected: true,
            refCount: 1,
            listTools: async () => [],
            callTool: async () => ({ content: [], isError: false }),
            close: async () => {},
        };

        connectionPool.set('test-server', mockClient as MCPClient);

        assert.equal(connectionPool.size, 1);
        assert.equal(connectionPool.get('test-server'), mockClient);
    });

    test('should delete connections', () => {
        const mockClient: Partial<MCPClient> = {
            connect: async () => {},
            connected: true,
            refCount: 1,
            listTools: async () => [],
            callTool: async () => ({ content: [], isError: false }),
            close: async () => {},
        };

        connectionPool.set('test-server', mockClient as MCPClient);
        assert.equal(connectionPool.size, 1);

        connectionPool.delete('test-server');
        assert.equal(connectionPool.size, 0);
    });

    test('should close all connections', async () => {
        let close1Called = false;
        let close2Called = false;

        const mockClient1: Partial<MCPClient> = {
            connect: async () => {},
            connected: true,
            refCount: 1,
            listTools: async () => [],
            callTool: async () => ({ content: [], isError: false }),
            close: async () => {
                close1Called = true;
            },
        };

        const mockClient2: Partial<MCPClient> = {
            connect: async () => {},
            connected: true,
            refCount: 1,
            listTools: async () => [],
            callTool: async () => ({ content: [], isError: false }),
            close: async () => {
                close2Called = true;
            },
        };

        connectionPool.set('server1', mockClient1 as MCPClient);
        connectionPool.set('server2', mockClient2 as MCPClient);

        assert.equal(connectionPool.size, 2);

        await connectionPool.closeAll();

        // Verify close was called on both clients
        assert.equal(close1Called, true);
        assert.equal(close2Called, true);

        // Verify pool is cleared
        assert.equal(connectionPool.size, 0);
    });

    test('should handle close errors gracefully', async () => {
        let closeCalled = false;

        const mockClient: Partial<MCPClient> = {
            connect: async () => {},
            connected: true,
            refCount: 1,
            listTools: async () => [],
            callTool: async () => ({ content: [], isError: false }),
            close: async () => {
                closeCalled = true;
                throw new Error('Close failed');
            },
        };

        connectionPool.set('error-server', mockClient as MCPClient);

        // Should not throw
        await connectionPool.closeAll();

        // Verify close was called
        assert.equal(closeCalled, true);

        // Verify pool is cleared despite error
        assert.equal(connectionPool.size, 0);
    });

    test('should manage multiple connections independently', () => {
        const mockClient1: Partial<MCPClient> = {
            connect: async () => {},
            connected: true,
            refCount: 1,
            listTools: async () => [],
            callTool: async () => ({ content: [], isError: false }),
            close: async () => {},
        };

        const mockClient2: Partial<MCPClient> = {
            connect: async () => {},
            connected: false,
            refCount: 0,
            listTools: async () => [],
            callTool: async () => ({ content: [], isError: false }),
            close: async () => {},
        };

        connectionPool.set('server1', mockClient1 as MCPClient);
        connectionPool.set('server2', mockClient2 as MCPClient);

        assert.equal(connectionPool.get('server1')?.connected, true);
        assert.equal(connectionPool.get('server2')?.connected, false);
        assert.equal(connectionPool.get('server1')?.refCount, 1);
        assert.equal(connectionPool.get('server2')?.refCount, 0);
    });
});
