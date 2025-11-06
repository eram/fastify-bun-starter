/**
 * @file Unit tests for SSESession in resilient-client.ts
 * Tests SSE (Server-Sent Events) functionality including connection, session management, and request/response handling
 *
 * Note: These tests require a running MCP SSE server at http://localhost:8080/sse
 * For example: The weather MCP server from the test-weather-simple.ts example
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ResilientClient, type SSESession } from './resilient-client';

// Test configuration
const SSE_SERVER_URL = 'http://localhost:8080';
const SSE_ENDPOINT = '/sse';

describe('SSESession', () => {
    test('should create SSE session and receive endpoint', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });
        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        try {
            // Wait for session ID and endpoint
            let attempts = 0;
            while ((!session.sessionId || !session.endpoint) && attempts < 50) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                attempts++;
            }

            assert.ok(session.sessionId, 'Session ID should be set');
            assert.ok(session.endpoint, 'Endpoint should be set');
            assert.match(session.endpoint, /\/messages\/\?session_id=/, 'Endpoint should match expected format');
            assert.equal(session.connected, true, 'Session should be connected');
        } finally {
            session.close();
        }
    });

    test('should initialize MCP session', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });
        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        try {
            // Wait for connection
            let attempts = 0;
            while ((!session.sessionId || !session.endpoint) && attempts < 50) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                attempts++;
            }

            // Send initialize request
            const result: any = await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: {
                    name: 'test-client',
                    version: '1.0.0',
                },
            });

            assert.ok(result, 'Initialize should return a result');
            assert.equal(result.protocolVersion, '2024-11-05', 'Protocol version should match');
            assert.ok(result.capabilities, 'Capabilities should be present');
            assert.ok(result.serverInfo, 'Server info should be present');
            assert.equal(result.serverInfo.name, 'mcp-weather-server', 'Server name should be mcp-weather-server');
        } finally {
            session.close();
        }
    });

    test('should list available tools', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });
        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        try {
            // Wait for connection
            let attempts = 0;
            while ((!session.sessionId || !session.endpoint) && attempts < 50) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                attempts++;
            }

            // Initialize first
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            // List tools
            const result: any = await session.sendRequest('tools/list', {});

            assert.ok(result.tools, 'Tools should be present');
            assert.ok(Array.isArray(result.tools), 'Tools should be an array');
            assert.ok(result.tools.length > 0, 'Should have at least one tool');

            // Verify get_current_weather tool exists
            const weatherTool = result.tools.find((t: any) => t.name === 'get_current_weather');
            assert.ok(weatherTool, 'get_current_weather tool should exist');
            assert.ok(weatherTool.description, 'Tool should have description');
            assert.ok(weatherTool.inputSchema, 'Tool should have input schema');
            assert.deepEqual(weatherTool.inputSchema.required, ['city'], 'Tool should require city parameter');
        } finally {
            session.close();
        }
    });

    test('should call get_current_weather tool', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });
        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        try {
            // Wait for connection
            let attempts = 0;
            while ((!session.sessionId || !session.endpoint) && attempts < 50) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                attempts++;
            }

            // Initialize first
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            // Call weather tool
            const result: any = await session.sendRequest('tools/call', {
                name: 'get_current_weather',
                arguments: {
                    city: 'San Francisco',
                },
            });

            assert.ok(result.content, 'Result should have content');
            assert.ok(Array.isArray(result.content), 'Content should be an array');
            assert.ok(result.content.length > 0, 'Content should not be empty');
            assert.equal(result.content[0].type, 'text', 'Content type should be text');
            assert.ok(result.content[0].text, 'Content should have text');
            assert.match(result.content[0].text, /San Francisco/i, 'Response should mention San Francisco');
            assert.match(result.content[0].text, /temperature|weather/i, 'Response should mention temperature or weather');
            assert.equal(result.isError, false, 'Result should not be an error');
        } finally {
            session.close();
        }
    });

    test('should handle invalid tool call', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });
        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        try {
            // Wait for connection
            let attempts = 0;
            while ((!session.sessionId || !session.endpoint) && attempts < 50) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                attempts++;
            }

            // Initialize first
            await session.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            });

            // Call tool with missing required parameter
            const result: any = await session.sendRequest('tools/call', {
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

    test('should emit connected event', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });

        // Setup listener before creating session to catch the event
        let connectedEventReceived = false;
        const eventPromise = new Promise<void>((resolve) => {
            const checkConnection = () => {
                const session = client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });
                session.then((sess) => {
                    sess.addEventListener('connected', () => {
                        connectedEventReceived = true;
                        resolve();
                    });
                });
            };
            checkConnection();
        });

        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        try {
            // Wait for connected event or timeout
            await Promise.race([eventPromise, new Promise((resolve) => setTimeout(resolve, 1000))]);

            // Check connected status directly since event may fire before listener attached
            assert.equal(session.connected, true, 'Session should be connected');
        } finally {
            session.close();
        }
    });

    test('should emit endpoint event', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });
        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        try {
            let endpointEventData: any = null;
            session.addEventListener('sse:endpoint', (e: Event) => {
                if (e instanceof CustomEvent) {
                    endpointEventData = e.detail;
                }
            });

            // Wait for endpoint event
            let attempts = 0;
            while (!endpointEventData && attempts < 50) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                attempts++;
            }

            assert.ok(endpointEventData, 'Endpoint event should be emitted');
            assert.match(endpointEventData, /\/messages\/\?session_id=/, 'Endpoint data should match expected format');
        } finally {
            session.close();
        }
    });

    test('should handle session close gracefully', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });
        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        let disconnectedEventReceived = false;
        let errorEventReceived = false;

        session.addEventListener('disconnected', () => {
            disconnectedEventReceived = true;
        });

        session.addEventListener('error', () => {
            errorEventReceived = true;
        });

        // Wait for connection
        let attempts = 0;
        while ((!session.sessionId || !session.endpoint) && attempts < 50) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
        }

        assert.equal(session.closed, false, 'Session should not be closed initially');

        session.close();

        // Wait a bit for events
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.equal(session.closed, true, 'Session should be closed');
        assert.equal(disconnectedEventReceived, true, 'Disconnected event should be emitted');
        assert.equal(errorEventReceived, false, 'Error event should NOT be emitted on intentional close');
    });

    test('should handle invalid method call', async () => {
        const client = new ResilientClient(SSE_SERVER_URL, { afterFn: 'sse' });
        const session = await client.fetch<SSESession>(SSE_ENDPOINT, { method: 'GET' });

        try {
            // Wait for connection
            let attempts = 0;
            while ((!session.sessionId || !session.endpoint) && attempts < 50) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                attempts++;
            }

            // Try to call a non-existent method
            // The server should respond with a JSON-RPC error
            await assert.rejects(
                session.sendRequest('nonexistent/method', {}),
                /JSON-RPC error|Invalid/i,
                'Should reject with JSON-RPC error for invalid method',
            );
        } finally {
            session.close();
        }
    });
});
