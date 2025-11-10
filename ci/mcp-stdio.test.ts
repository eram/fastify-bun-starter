/**
 * CI Test for MCP stdio transport
 * Spawns the stdio CLI and tests communication via stdin/stdout
 */

import { ok, strictEqual } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, test } from 'node:test';

/**
 * Send a request to stdio process and wait for response
 */
async function sendStdioRequest(
    process: ReturnType<typeof spawn>,
    request: Record<string, unknown>,
    timeoutMs = 5000,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let responseData = '';
        let timeoutHandle: NodeJS.Timeout;

        const onData = (chunk: Buffer) => {
            responseData += chunk.toString();

            // Check if we have a complete JSON-RPC response line
            const lines = responseData.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                // Only try to parse lines that look like JSON-RPC responses
                if (trimmed.startsWith('{') && trimmed.includes('"jsonrpc"')) {
                    try {
                        const json = JSON.parse(trimmed);
                        // Verify it's actually a JSON-RPC response
                        if (json.jsonrpc === '2.0') {
                            clearTimeout(timeoutHandle);
                            process.stdout?.off('data', onData);
                            resolve(json);
                            return;
                        }
                    } catch {
                        // Not valid JSON yet, continue
                    }
                }
            }
        };

        timeoutHandle = setTimeout(() => {
            process.stdout?.off('data', onData);
            reject(new Error(`Timeout waiting for response. Got: ${responseData}`));
        }, timeoutMs);

        process.stdout?.on('data', onData);

        // Send the request
        process.stdin?.write(`${JSON.stringify(request)}\n`);
    });
}

describe('MCP stdio transport (CI)', () => {
    test('can list tools via stdio', async () => {
        const mcpProcess = spawn('bun src/cli/index.ts mcp serve', {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        try {
            // Wait for server to initialize
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Send tools/list request
            const response = await sendStdioRequest(mcpProcess, {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
            });

            // Validate response
            strictEqual(response.jsonrpc, '2.0');
            strictEqual(response.id, 1);
            ok(response.result);
            ok((response.result as { tools: unknown[] }).tools);
            ok(Array.isArray((response.result as { tools: unknown[] }).tools));

            const tools = (response.result as { tools: { name: string }[] }).tools;
            ok(tools.some((t) => t.name === 'health'));
            ok(tools.some((t) => t.name === 'format_number'));
        } finally {
            mcpProcess.kill('SIGTERM');
            await new Promise((resolve) => {
                mcpProcess.on('exit', resolve);
                setTimeout(() => {
                    mcpProcess.kill('SIGKILL');
                    resolve(undefined);
                }, 1000);
            });
        }
    });

    test('can call health tool via stdio', async () => {
        const mcpProcess = spawn('bun src/cli/index.ts mcp serve', {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        try {
            await new Promise((resolve) => setTimeout(resolve, 500));

            const response = await sendStdioRequest(mcpProcess, {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                    name: 'health',
                    arguments: {},
                },
            });

            strictEqual(response.jsonrpc, '2.0');
            strictEqual(response.id, 2);
            ok(response.result);
            ok((response.result as { content: { text: string }[] }).content);

            const content = (response.result as { content: { text: string }[] }).content;
            ok(content[0].text.includes('ok'));
            ok(content[0].text.includes('timestamp'));
        } finally {
            mcpProcess.kill('SIGTERM');
            await new Promise((resolve) => {
                mcpProcess.on('exit', resolve);
                setTimeout(() => {
                    mcpProcess.kill('SIGKILL');
                    resolve(undefined);
                }, 1000);
            });
        }
    });

    test('can call format_number tool via stdio', async () => {
        const mcpProcess = spawn('bun src/cli/index.ts mcp serve', {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        try {
            await new Promise((resolve) => setTimeout(resolve, 500));

            const response = await sendStdioRequest(mcpProcess, {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                    name: 'format_number',
                    arguments: {
                        number: 999999,
                        locale: 'en-US',
                    },
                },
            });

            strictEqual(response.jsonrpc, '2.0');
            strictEqual(response.id, 3);
            ok(response.result);
            ok((response.result as { content: { text: string }[] }).content);

            const content = (response.result as { content: { text: string }[] }).content;
            const result = JSON.parse(content[0].text);
            strictEqual(result.formatted, '999,999');
            strictEqual(result.number, 999999);
            strictEqual(result.locale, 'en-US');
        } finally {
            mcpProcess.kill('SIGTERM');
            await new Promise((resolve) => {
                mcpProcess.on('exit', resolve);
                setTimeout(() => {
                    mcpProcess.kill('SIGKILL');
                    resolve(undefined);
                }, 1000);
            });
        }
    });

    test('handles multiple sequential requests via stdio', async () => {
        const mcpProcess = spawn('bun src/cli/index.ts mcp serve', {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        try {
            await new Promise((resolve) => setTimeout(resolve, 500));

            // First request
            const response1 = await sendStdioRequest(mcpProcess, {
                jsonrpc: '2.0',
                id: 10,
                method: 'tools/list',
            });
            strictEqual(response1.id, 10);
            ok(response1.result);

            // Second request
            const response2 = await sendStdioRequest(mcpProcess, {
                jsonrpc: '2.0',
                id: 11,
                method: 'tools/call',
                params: {
                    name: 'health',
                    arguments: {},
                },
            });
            strictEqual(response2.id, 11);
            ok(response2.result);

            // Third request
            const response3 = await sendStdioRequest(mcpProcess, {
                jsonrpc: '2.0',
                id: 12,
                method: 'tools/call',
                params: {
                    name: 'format_number',
                    arguments: {
                        number: 42,
                        locale: 'de-DE',
                    },
                },
            });
            strictEqual(response3.id, 12);
            ok(response3.result);
        } finally {
            mcpProcess.kill('SIGTERM');
            await new Promise((resolve) => {
                mcpProcess.on('exit', resolve);
                setTimeout(() => {
                    mcpProcess.kill('SIGKILL');
                    resolve(undefined);
                }, 1000);
            });
        }
    });
});
