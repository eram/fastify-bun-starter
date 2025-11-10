/**
 * Tests for health tool
 */

import { strict as assert } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MCPServer, type ToolResult } from '../../lib/mcp-server';
import { registerHealthTool } from './health-tool';

async function callTool(server: MCPServer, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const response = await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
    });

    if (!response || 'error' in response) {
        throw new Error(response?.error?.message || 'Tool call failed');
    }

    return response.result as ToolResult;
}

async function listTools(server: MCPServer): Promise<Array<{ name: string; description: string }>> {
    const response = await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
    });

    if (!response || 'error' in response) {
        throw new Error('Failed to list tools');
    }

    return (response.result as { tools: Array<{ name: string; description: string }> }).tools;
}

describe('health-tool', () => {
    test('registers health tool with correct schema', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerHealthTool(server);

        const tools = await listTools(server);
        assert.equal(tools.length, 1);
        assert.equal(tools[0].name, 'health');
        assert.ok(tools[0].description.includes('health status'));
    });

    test('returns health status', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerHealthTool(server);

        const result = await callTool(server, 'health', {});

        assert.equal(result.isError, false);
        assert.equal(result.content.length, 1);
        assert.equal(result.content[0].type, 'text');

        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.status, 'ok');
        assert.ok(parsed.timestamp);
    });

    test('returns valid ISO timestamp', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerHealthTool(server);

        const before = new Date();
        const result = await callTool(server, 'health', {});
        const after = new Date();

        const parsed = JSON.parse(result.content[0].text);
        const timestamp = new Date(parsed.timestamp);

        assert.ok(timestamp >= before);
        assert.ok(timestamp <= after);
    });

    test('works with no arguments', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerHealthTool(server);

        const result = await callTool(server, 'health', {});

        assert.equal(result.isError, false);
        assert.ok(result.content[0].text.includes('ok'));
    });

    test('ignores extra arguments', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerHealthTool(server);

        const result = await callTool(server, 'health', {
            extra: 'ignored',
            more: 'data',
        });

        assert.equal(result.isError, false);
        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.status, 'ok');
    });
});
