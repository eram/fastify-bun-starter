/**
 * CI Test for MCP aggregator functionality
 * Tests that the MCP server correctly aggregates tools from multiple configured MCP servers
 * Each tool should be prefixed with {serverName}:{toolName}
 *
 * Note: This test uses app.inject() for faster, more reliable testing without spawning processes
 */

import { ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { app } from '../src/app';

describe('MCP Aggregator (CI)', () => {
    test('lists available tools including aggregated from configured MCP servers', async () => {
        // Call tools/list on the server using inject
        const response = await app.inject({
            method: 'POST',
            url: '/mcp',
            headers: {
                'Content-Type': 'application/json',
            },
            payload: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            },
        });

        strictEqual(response.statusCode, 200);
        const data = response.json() as {
            jsonrpc: string;
            id: number;
            result: { tools: { name: string; description: string }[] };
        };

        strictEqual(data.jsonrpc, '2.0');
        strictEqual(data.id, 1);
        ok(data.result, 'Response should have result');
        ok(Array.isArray(data.result.tools), 'Result should have tools array');

        // Check we have local tools
        const localTools = data.result.tools.filter((t) => !t.name.includes(':'));
        ok(localTools.length > 0, 'Should have local tools');
        ok(
            localTools.some((t) => t.name === 'health'),
            'Should have health tool',
        );
        ok(
            localTools.some((t) => t.name === 'format_number'),
            'Should have format_number tool',
        );

        // Log all tools for debugging
        console.log('\nAll available tools:');
        for (const tool of data.result.tools) {
            const desc = tool.description.length > 80 ? `${tool.description.substring(0, 80)}...` : tool.description;
            console.log(`  - ${tool.name}: ${desc}`);
        }

        // Check if we have any aggregated tools (optional - depends on config)
        const aggregatedTools = data.result.tools.filter((t) => t.name.includes(':'));
        if (aggregatedTools.length > 0) {
            console.log(`\nFound ${aggregatedTools.length} aggregated tools from remote MCP servers:`);

            // Verify aggregated tools are properly prefixed
            for (const tool of aggregatedTools) {
                const parts = tool.name.split(':');
                strictEqual(parts.length, 2, `Tool ${tool.name} should have format serverName:toolName`);
                const [serverName, toolName] = parts;
                ok(serverName, `Tool ${tool.name} should have server name prefix`);
                ok(toolName, `Tool ${tool.name} should have tool name after colon`);
                ok(tool.description.includes(`[${serverName}]`), `Tool ${tool.name} description should include [${serverName}]`);
                console.log(`    ${tool.name} (from ${serverName})`);
            }
        } else {
            console.log('\nNo aggregated tools found (no MCP servers configured or all failed to connect)');
        }
    });

    test('can call local tools via MCP interface', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/mcp',
            headers: {
                'Content-Type': 'application/json',
            },
            payload: {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                    name: 'health',
                    arguments: {},
                },
            },
        });

        strictEqual(response.statusCode, 200);
        const data = response.json() as {
            jsonrpc: string;
            id: number;
            result: { content: { type: string; text: string }[]; isError: boolean };
        };

        strictEqual(data.jsonrpc, '2.0');
        strictEqual(data.id, 2);
        ok(data.result, 'Should have result');
        ok(Array.isArray(data.result.content), 'Result should have content array');
        ok(data.result.content[0].text.includes('ok'), 'Health check should return ok status');
        strictEqual(data.result.isError, false, 'Health check should not be an error');
    });

    test('can call aggregated tools from remote MCP servers', async () => {
        // First, get the list of all available tools to see what's aggregated
        const listResponse = await app.inject({
            method: 'POST',
            url: '/mcp',
            headers: {
                'Content-Type': 'application/json',
            },
            payload: {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            },
        });

        strictEqual(listResponse.statusCode, 200);
        const listData = listResponse.json() as {
            result: { tools: { name: string; description: string; inputSchema: unknown }[] };
        };

        // Get aggregated tools (tools with server prefix)
        const aggregatedTools = listData.result.tools.filter((t) => t.name.includes(':'));
        console.log(`\n\nTesting ${aggregatedTools.length} aggregated tools...`);

        if (aggregatedTools.length === 0) {
            console.log('No aggregated tools available - skipping tool call tests');
            return;
        }

        // Group tools by server
        const toolsByServer = new Map<string, typeof aggregatedTools>();
        for (const tool of aggregatedTools) {
            const [serverName] = tool.name.split(':');
            if (!toolsByServer.has(serverName)) {
                toolsByServer.set(serverName, []);
            }
            toolsByServer.get(serverName)!.push(tool);
        }

        console.log(`\nTools available from ${toolsByServer.size} remote servers:`);
        for (const [serverName, tools] of toolsByServer) {
            console.log(`  ${serverName}: ${tools.length} tools`);
        }

        // Test calling one tool from each server
        let requestId = 100;
        for (const [_serverName, tools] of toolsByServer) {
            // Pick the first tool from this server
            const tool = tools[0];
            console.log(`\n\nCalling ${tool.name}...`);

            // Try to call the tool with empty arguments (some tools may require specific args)
            const callResponse = await app.inject({
                method: 'POST',
                url: '/mcp',
                headers: {
                    'Content-Type': 'application/json',
                },
                payload: {
                    jsonrpc: '2.0',
                    id: requestId++,
                    method: 'tools/call',
                    params: {
                        name: tool.name,
                        arguments: {},
                    },
                },
            });

            // Response should be 200 even if the tool returns an error
            strictEqual(callResponse.statusCode, 200, `Should get 200 response for ${tool.name}`);

            const callData = callResponse.json() as {
                jsonrpc: string;
                id: number;
                result?: { content: { type: string; text: string }[]; isError?: boolean };
                error?: { code: number; message: string };
            };

            strictEqual(callData.jsonrpc, '2.0');
            strictEqual(callData.id, requestId - 1);

            // Check if we got a result or an error
            if (callData.result) {
                ok(callData.result.content, `Tool ${tool.name} should return content`);
                ok(Array.isArray(callData.result.content), `Tool ${tool.name} content should be an array`);
                console.log(`  ✓ Result: ${JSON.stringify(callData.result.content[0]).substring(0, 100)}...`);
                console.log(`  ✓ IsError: ${callData.result.isError ?? false}`);
            } else if (callData.error) {
                // Some tools may require specific arguments, so errors are acceptable
                console.log(`  ℹ Error (expected for tools requiring args): ${callData.error.message}`);
                ok(callData.error.message, `Error should have a message for ${tool.name}`);
            } else {
                throw new Error(`Tool ${tool.name} returned neither result nor error`);
            }
        }
    });
});
