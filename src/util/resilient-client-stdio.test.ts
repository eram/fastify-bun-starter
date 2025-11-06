/**
 * @file Unit tests for MCP stdio transport using StdioSession
 * Tests stdio-based JSON-RPC communication with MCP server running as a child process
 *
 * Note: These tests spawn a local MCP server process
 * Server: mcp_weather_server in stdio mode
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { StdioSession } from './resilient-client';

// Test configuration
const SERVER_COMMAND = 'python';
const SERVER_ARGS = ['-m', 'mcp_weather_server.server', '--mode', 'stdio'];
const SERVER_CWD = 'c:\\src\\eram\\temp\\mcp_weather_server';

describe('MCP Stdio Transport', () => {
    test('should spawn MCP server and connect via stdio', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        try {
            let connectedEventReceived = false;
            session.addEventListener('connected', () => {
                connectedEventReceived = true;
            });

            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 500));

            assert.equal(connectedEventReceived, true, 'Connected event should be emitted');
            assert.equal(session.connected, true, 'Session should be connected');
            assert.equal(session.closed, false, 'Session should not be closed');
        } finally {
            session.close();
        }
    });

    test('should initialize MCP session via stdio', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        try {
            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 500));

            const initResult = await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                    name: 'test-client',
                    version: '1.0.0',
                },
            });

            assert.ok(initResult, 'Should receive result');
            assert.equal(initResult.protocolVersion, '2024-11-05', 'Protocol version should match');
            assert.ok(initResult.capabilities, 'Should have capabilities');
            assert.ok(initResult.serverInfo, 'Should have server info');
            assert.equal(initResult.serverInfo.name, 'mcp-weather-server', 'Server name should be mcp-weather-server');
        } finally {
            session.close();
        }
    });

    test('should list available tools', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        try {
            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Initialize first
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            const toolsResult = await session.sendRequest('tools/list', {});

            assert.ok(toolsResult.tools, 'Should have tools');
            assert.ok(Array.isArray(toolsResult.tools), 'Tools should be an array');
            assert.ok(toolsResult.tools.length > 0, 'Should have at least one tool');

            // Verify get_current_weather tool exists
            const weatherTool = toolsResult.tools.find((t: any) => t.name === 'get_current_weather');
            assert.ok(weatherTool, 'get_current_weather tool should exist');
            assert.ok(weatherTool.description, 'Tool should have description');
            assert.ok(weatherTool.inputSchema, 'Tool should have input schema');
            assert.deepEqual(weatherTool.inputSchema.required, ['city'], 'Tool should require city parameter');
        } finally {
            session.close();
        }
    });

    test('should call get_current_weather tool', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        try {
            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Initialize first
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            const weatherResult = await session.sendRequest('tools/call', {
                name: 'get_current_weather',
                arguments: {
                    city: 'San Francisco',
                },
            });

            assert.ok(weatherResult.content, 'Result should have content');
            assert.ok(Array.isArray(weatherResult.content), 'Content should be an array');
            assert.ok(weatherResult.content.length > 0, 'Content should not be empty');
            assert.equal(weatherResult.content[0].type, 'text', 'Content type should be text');
            assert.ok(weatherResult.content[0].text, 'Content should have text');
            assert.match(weatherResult.content[0].text, /San Francisco/i, 'Response should mention San Francisco');
            assert.match(weatherResult.content[0].text, /temperature|weather/i, 'Response should mention temperature or weather');
            assert.equal(weatherResult.isError, false, 'Result should not be an error');
        } finally {
            session.close();
        }
    });

    test('should handle invalid tool call', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        try {
            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Initialize first
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            const result = await session.sendRequest('tools/call', {
                name: 'get_current_weather',
                arguments: {}, // Missing required 'city' parameter
            });

            assert.ok(result.content, 'Result should have content');
            assert.ok(result.isError, 'Result should be an error');
            assert.match(result.content[0].text, /city.*required/i, 'Error should mention city is required');
        } finally {
            session.close();
        }
    });

    test('should handle JSON-RPC error responses', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        try {
            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Initialize first
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            // Try to call a non-existent method
            await assert.rejects(
                session.sendRequest('nonexistent/method', {}),
                /JSON-RPC error/i,
                'Should reject with JSON-RPC error for invalid method',
            );
        } finally {
            session.close();
        }
    });

    test('should emit message events', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        try {
            const messages: any[] = [];
            session.addEventListener('message', (e: Event) => {
                if (e instanceof CustomEvent) {
                    messages.push(e.detail);
                }
            });

            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Send initialize request
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            // Should have received at least one message
            assert.ok(messages.length > 0, 'Should have received messages');
            assert.ok(
                messages.some((m) => m.result?.serverInfo),
                'Should have received initialize response',
            );
        } finally {
            session.close();
        }
    });

    test('should handle session close gracefully', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        let disconnectedEventReceived = false;

        session.addEventListener('disconnected', () => {
            disconnectedEventReceived = true;
        });

        // Wait for connection
        await new Promise((resolve) => setTimeout(resolve, 500));

        assert.equal(session.closed, false, 'Session should not be closed initially');

        session.close();

        // Wait a bit for events
        await new Promise((resolve) => setTimeout(resolve, 200));

        assert.equal(session.closed, true, 'Session should be closed');
        assert.equal(disconnectedEventReceived, true, 'Disconnected event should be emitted');
    });

    test('should timeout on slow request', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        try {
            // Wait for connection
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Initialize first
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            // Send a request with very short timeout
            await assert.rejects(
                session.sendRequest('tools/list', {}, 1), // 1ms timeout
                /Request timeout/i,
                'Should timeout',
            );
        } finally {
            session.close();
        }
    });

    test('should reject requests after session is closed', async () => {
        const session = new StdioSession(SERVER_COMMAND, SERVER_ARGS, { cwd: SERVER_CWD });

        // Wait for connection
        await new Promise((resolve) => setTimeout(resolve, 500));

        session.close();

        // Try to send request after close
        await assert.rejects(
            session.sendRequest('initialize', {}),
            /Session is closed/i,
            'Should reject with session closed error',
        );
    });
});
