/**
 * @file Unit tests for MCP HTTP transport using ResilientClient
 * Tests HTTP-based JSON-RPC communication with MCP server
 *
 * Note: These tests require a running MCP HTTP server at http://localhost:8080/mcp
 * For example: The weather MCP server from the test-weather-http.ts example
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ResilientClient } from './resilient-client';

// Test configuration
const MCP_SERVER_URL = 'http://localhost:8080';
const MCP_ENDPOINT = '/mcp';

/**
 * Parse SSE format response
 * MCP HTTP transport returns responses in SSE format even for POST requests
 * Format: "event: message\ndata: {...}\n\n"
 */
function parseSseResponse(text: string): any {
    const lines = text.trim().split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            return JSON.parse(line.substring(6));
        }
    }
    throw new Error('No data line found in SSE response');
}

describe('MCP HTTP Transport', () => {
    test('should initialize MCP session via HTTP', async () => {
        const client = new ResilientClient(MCP_SERVER_URL, { afterFn: 'text' });

        const responseText = await client.fetch<string>(MCP_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: {
                        name: 'test-client',
                        version: '1.0.0',
                    },
                },
            }),
        });

        const data = parseSseResponse(responseText);

        assert.ok(data, 'Should receive response');
        assert.ok(data.result, 'Response should have result');
        assert.equal(data.result.protocolVersion, '2024-11-05', 'Protocol version should match');
        assert.ok(data.result.capabilities, 'Should have capabilities');
        assert.ok(data.result.serverInfo, 'Should have server info');
        assert.equal(data.result.serverInfo.name, 'mcp-weather-server', 'Server name should be mcp-weather-server');
    });

    test('should list available tools', async () => {
        const client = new ResilientClient(MCP_SERVER_URL, { afterFn: 'text' });

        const responseText = await client.fetch<string>(MCP_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/list',
                params: {},
            }),
        });

        const data = parseSseResponse(responseText);

        assert.ok(data.result, 'Should have result');
        assert.ok(data.result.tools, 'Result should have tools');
        assert.ok(Array.isArray(data.result.tools), 'Tools should be an array');
        assert.ok(data.result.tools.length > 0, 'Should have at least one tool');

        // Verify get_current_weather tool exists
        const weatherTool = data.result.tools.find((t: any) => t.name === 'get_current_weather');
        assert.ok(weatherTool, 'get_current_weather tool should exist');
        assert.ok(weatherTool.description, 'Tool should have description');
        assert.ok(weatherTool.inputSchema, 'Tool should have input schema');
        assert.deepEqual(weatherTool.inputSchema.required, ['city'], 'Tool should require city parameter');
    });

    test('should call get_current_weather tool', async () => {
        const client = new ResilientClient(MCP_SERVER_URL, { afterFn: 'text' });

        const responseText = await client.fetch<string>(MCP_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                    name: 'get_current_weather',
                    arguments: {
                        city: 'San Francisco',
                    },
                },
            }),
        });

        const data = parseSseResponse(responseText);

        assert.ok(data.result, 'Should have result');
        assert.ok(data.result.content, 'Result should have content');
        assert.ok(Array.isArray(data.result.content), 'Content should be an array');
        assert.ok(data.result.content.length > 0, 'Content should not be empty');
        assert.equal(data.result.content[0].type, 'text', 'Content type should be text');
        assert.ok(data.result.content[0].text, 'Content should have text');
        assert.match(data.result.content[0].text, /San Francisco/i, 'Response should mention San Francisco');
        assert.match(data.result.content[0].text, /temperature|weather/i, 'Response should mention temperature or weather');
        assert.equal(data.result.isError, false, 'Result should not be an error');
    });

    test('should handle invalid tool call', async () => {
        const client = new ResilientClient(MCP_SERVER_URL, { afterFn: 'text' });

        const responseText = await client.fetch<string>(MCP_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 4,
                method: 'tools/call',
                params: {
                    name: 'get_current_weather',
                    arguments: {}, // Missing required 'city' parameter
                },
            }),
        });

        const data = parseSseResponse(responseText);

        assert.ok(data.result, 'Should have result');
        assert.ok(data.result.content, 'Result should have content');
        assert.ok(data.result.isError, 'Result should be an error');
        assert.match(data.result.content[0].text, /city.*required/i, 'Error should mention city is required');
    });

    test('should handle JSON-RPC error responses', async () => {
        const client = new ResilientClient(MCP_SERVER_URL, { afterFn: 'text' });

        const responseText = await client.fetch<string>(MCP_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 5,
                method: 'nonexistent/method',
                params: {},
            }),
        });

        const data = parseSseResponse(responseText);

        assert.ok(data.error, 'Response should have error');
        assert.ok(data.error.code, 'Error should have code');
        assert.ok(data.error.message, 'Error should have message');
    });

    test('should parse SSE format correctly', () => {
        const sseText = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"test":"value"}}\n\n';
        const parsed = parseSseResponse(sseText);

        assert.ok(parsed, 'Should parse SSE text');
        assert.equal(parsed.jsonrpc, '2.0', 'Should have jsonrpc version');
        assert.equal(parsed.id, 1, 'Should have id');
        assert.ok(parsed.result, 'Should have result');
        assert.equal(parsed.result.test, 'value', 'Should parse nested result');
    });

    test('should handle multi-line SSE data', () => {
        const sseText =
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"long":"value"}}\n\nevent: ping\ndata: keep-alive\n\n';
        const parsed = parseSseResponse(sseText);

        // Should parse first data line
        assert.ok(parsed, 'Should parse multi-line SSE');
        assert.equal(parsed.jsonrpc, '2.0', 'Should get first message');
    });

    test('should require both Accept headers', async () => {
        const client = new ResilientClient(MCP_SERVER_URL, { afterFn: 'text' });

        // Server requires: Accept: application/json, text/event-stream
        // Testing with only application/json should fail with 406
        await assert.rejects(
            async () => {
                await client.fetch<string>(MCP_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json', // Missing text/event-stream
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 6,
                        method: 'initialize',
                        params: {},
                    }),
                });
            },
            /406|Not Acceptable/i,
            'Should reject with 406 Not Acceptable',
        );
    });
});
