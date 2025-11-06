/**
 * MCP Client - Connect to and communicate with remote MCP servers
 * Supports stdio, SSE, and HTTP transports
 */

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { Interface as ReadlineInterface } from 'node:readline';
import { createInterface } from 'node:readline';
import type { JSONRPCRequest, JSONRPCResponse, ToolDefinition, ToolResult } from '../../lib/mcp';
import { McpError } from '../../lib/mcp';
import { ResilientClient } from '../../util/resilient-client';
import type { MCPServerConfig } from '../mcp-config/types';

export interface MCPClient {
    listTools(): Promise<ToolDefinition[]>;
    callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;
    close(): Promise<void>;
}

/**
 * Connect to an MCP server based on its configuration
 */
export async function connectToMCPServer(config: MCPServerConfig): Promise<MCPClient> {
    switch (config.transport) {
        case 'stdio':
            if (!('command' in config)) throw new McpError('stdio transport requires a command');
            return connectToStdioServer(config as MCPServerConfig & { command: string });
        case 'sse':
            if (!('url' in config)) throw new McpError('SSE transport requires a url');
            return connectToSSEServer(config as MCPServerConfig & { url: string });
        case 'http':
            if (!('url' in config)) throw new McpError('HTTP transport requires a url');
            return connectToHTTPServer(config as MCPServerConfig & { url: string });
        default:
            throw new McpError(`Unsupported transport type: ${(config as { transport: string }).transport}`);
    }
}

/**
 * Connect to an MCP server via stdio transport
 * Spawns a child process and communicates via stdin/stdout
 */
function connectToStdioServer(config: MCPServerConfig & { command: string }): MCPClient {
    let process: ChildProcess | undefined;
    let readline: ReadlineInterface | undefined;
    let requestId = 1;
    const pending = new Map<
        number,
        {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
        }
    >();

    // Initialize the process
    const initialize = () => {
        const args = (config.transport === 'stdio' && Array.isArray(config.args) ? config.args : []) as string[];
        const envObj = config.env && typeof config.env === 'object' ? config.env : {};
        const env: NodeJS.ProcessEnv = {};
        for (const [key, val] of Object.entries(envObj)) {
            if (typeof val === 'string') {
                env[key] = val;
            }
        }

        const options: SpawnOptions = {
            env: { ...globalThis.process.env, ...env },
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        const child = spawn(config.command, args, options) as ChildProcess;
        process = child;

        if (!child.stdout || !child.stdin) {
            throw new McpError('Failed to create stdio streams');
        }

        // Set up readline for line-by-line reading
        readline = createInterface({
            input: child.stdout,
            output: undefined,
            terminal: false,
        });

        // Handle responses
        readline.on('line', (line) => {
            try {
                const message = JSON.parse(line) as JSONRPCResponse;
                if ('id' in message && typeof message.id === 'number') {
                    const req = pending.get(message.id);
                    if (req) {
                        pending.delete(message.id);
                        if ('error' in message && message.error) {
                            req.reject(new McpError(message.error.message, message.error.code));
                        } else {
                            req.resolve(message.result);
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to parse response:', error);
            }
        });

        // Handle process errors
        child.on('error', (error) => {
            console.error('MCP process error:', error);
            for (const [, req] of pending) {
                req.reject(new McpError(error.message));
            }
            pending.clear();
        });
    };

    const sendRequest = <T>(method: string, params?: unknown): Promise<T> => {
        if (!process?.stdin) {
            throw new McpError('Process not initialized');
        }

        const id = requestId++;
        const request: JSONRPCRequest = {
            jsonrpc: '2.0',
            id,
            method,
            ...(params ? { params: params as Record<string, unknown> } : {}),
        };

        return new Promise((resolve, reject) => {
            pending.set(id, { resolve: resolve as (value: unknown) => void, reject });

            const line = JSON.stringify(request);
            process!.stdin!.write(`${line}\n`);

            // Timeout after 30 seconds
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    reject(new McpError('Request timeout'));
                }
            }, 30000);
        });
    };

    // Initialize on first use
    initialize();

    return {
        async listTools(): Promise<ToolDefinition[]> {
            const result = await sendRequest<{ tools: ToolDefinition[] }>('tools/list');
            return result.tools;
        },

        async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
            return await sendRequest<ToolResult>('tools/call', { name: toolName, arguments: args });
        },

        async close(): Promise<void> {
            if (readline) {
                readline.close();
            }
            if (process) {
                process.kill();
            }
            pending.clear();
        },
    };
}

/**
 * Connect to an MCP server via SSE transport
 */
function connectToSSEServer(config: MCPServerConfig & { url: string }): MCPClient {
    // Use resilient client for HTTP requests
    const client = new ResilientClient(config.url, {
        timeout: 30000, // 30 second timeout
        maxTries: 3,
    });

    let requestId = 1;

    async function sendRequest<T>(method: string, params?: unknown): Promise<T> {
        const request: JSONRPCRequest = {
            jsonrpc: '2.0',
            id: requestId++,
            method,
            ...(params ? { params: params as Record<string, unknown> } : {}),
        };

        try {
            const response = await client.fetch<JSONRPCResponse>('/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                },
                body: JSON.stringify(request),
            });

            if ('error' in response && response.error) {
                throw new McpError(`JSON-RPC error: ${response.error.message}`, response.error.code);
            }

            return response.result as T;
        } catch (error) {
            throw new McpError(error instanceof Error ? error.message : String(error));
        }
    }

    return {
        async listTools(): Promise<ToolDefinition[]> {
            const result = await sendRequest<{ tools: ToolDefinition[] }>('tools/list');
            return result.tools;
        },

        async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
            return await sendRequest<ToolResult>('tools/call', { name: toolName, arguments: args });
        },

        async close(): Promise<void> {
            // SSE connections don't require explicit closing
        },
    };
}

/**
 * Connect to an MCP server via HTTP transport
 */
function connectToHTTPServer(config: MCPServerConfig & { url: string }): MCPClient {
    // Use resilient client for HTTP requests
    const client = new ResilientClient(config.url, {
        timeout: 30000, // 30 second timeout
        maxTries: 3,
    });

    let requestId = 1;

    async function sendRequest<T>(method: string, params?: unknown): Promise<T> {
        const request: JSONRPCRequest = {
            jsonrpc: '2.0',
            id: requestId++,
            method,
            ...(params ? { params: params as Record<string, unknown> } : {}),
        };

        try {
            const response = await client.fetch<JSONRPCResponse>('/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(request),
            });

            if ('error' in response && response.error) {
                throw new McpError(`JSON-RPC error: ${response.error.message}`, response.error.code);
            }

            return response.result as T;
        } catch (error) {
            throw new McpError(error instanceof Error ? error.message : String(error));
        }
    }

    return {
        async listTools(): Promise<ToolDefinition[]> {
            const result = await sendRequest<{ tools: ToolDefinition[] }>('tools/list');
            return result.tools;
        },

        async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
            return await sendRequest<ToolResult>('tools/call', { name: toolName, arguments: args });
        },

        async close(): Promise<void> {
            // HTTP connections are stateless and managed by the client pool
            ResilientClient.clearPool();
        },
    };
}
