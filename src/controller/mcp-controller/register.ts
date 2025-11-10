/**
 * MCP Controller - MCP server tool registration and connection management
 * Combines server connection factory and tool aggregation
 */

import { connectionPool, HttpClient, type MCPClient, SseClient, StdioClient } from '../../lib/mcp-client';
import { MCPServer, McpError, type ToolResult } from '../../lib/mcp-server';
import { Env } from '../../util';
import { getManager } from './config';
import { registerFormatNumberTool } from './format-number-tool';
import { registerHealthTool } from './health-tool';
import type { MCPServerConfig } from './types';

/**
 * Connect to an MCP server based on its configuration
 * Returns a unified MCPClient interface regardless of transport
 */
export async function connectToMCPServer(config: MCPServerConfig): Promise<MCPClient> {
    switch (config.transport) {
        case 'stdio': {
            const args = (Array.isArray(config.args) ? config.args : []) as string[];
            const client = new StdioClient(config.command, args, { cwd: process.cwd() });
            await client.connect();
            return client;
        }

        case 'sse': {
            const urlObj = new URL(config.url);
            const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
            const endpoint = urlObj.pathname || '/sse';

            const client = new SseClient(baseUrl, {
                endpoint,
                capabilities: {},
                clientInfo: { name: Env.appName, version: Env.appVersion },
            });

            await client.connect();
            return client;
        }

        case 'http': {
            return new HttpClient(config.url);
        }

        default:
            throw new Error(`Unsupported transport: ${(config as { transport: string }).transport}`);
    }
}

/**
 * Register all tools with the MCP server
 * Includes both local tools and tools from all enabled MCP servers
 */
export async function registerOwnTools(server: MCPServer): Promise<void> {
    // Register local tools
    registerHealthTool(server);
    registerFormatNumberTool(server);
}

/**
 * Register tools from all enabled MCP servers
 * Tools are prefixed with {serverName}:{toolName}
 */
export async function registerMCPServerTools(server: MCPServer): Promise<void> {
    try {
        // Get manager (auto-initializes on first call)
        const manager = getManager();
        const enabled = await manager.getEnabled();

        // Connect to all servers in parallel
        const connectionPromises = enabled.map(async (conf) => {
            const serverName = String(conf.name);

            try {
                // Get or create connection to MCP server
                let connection = connectionPool.get(serverName);

                if (!connection) {
                    connection = await connectToMCPServer(conf);
                    connectionPool.set(serverName, connection);
                }

                // Get tools list from the MCP server
                const tools = await connection.listTools();

                return { serverName, connection, tools, error: undefined };
            } catch (err) {
                const error = new McpError(err);
                console.warn(`Failed to register tools from MCP server ${serverName}:`, error);
                return { serverName, connection: undefined, tools: [], error };
            }
        });

        // Wait for all connections to complete (success or failure)
        const results = await Promise.allSettled(connectionPromises);

        // Register tools from successful connections
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.tools.length > 0) {
                const { serverName, connection, tools } = result.value;

                // Initialize or increment ref count for this connection
                connection!.refCount += tools.length;

                // Register each tool with prefixed name and cleanup callback
                for (const tool of tools) {
                    const name = `${serverName}:${tool.name}`;

                    server.register(
                        {
                            name,
                            description: `[${serverName}] ${tool.description}`,
                            inputSchema: tool.inputSchema,
                        },
                        async (args): Promise<ToolResult> => {
                            // Forward the tool call to the MCP server
                            return await connection!.callTool(tool.name, args);
                        },
                        async () => {
                            // Cleanup callback: decrement ref count and close connection if no more refs
                            const conn = connectionPool.get(serverName);
                            if (!conn) return;

                            if (--conn.refCount <= 0) {
                                // No more tools using this connection, close it
                                connectionPool.delete(serverName);
                                try {
                                    await conn.close();
                                    console.log(`Closed MCP connection: ${serverName}`);
                                } catch (error) {
                                    console.warn(`Error closing MCP connection ${serverName}:`, error);
                                }
                            }
                        },
                    );
                }

                console.log(`Registered ${tools.length} tools from MCP server: ${serverName}`);
            }
        }
    } catch (err) {
        const error = new McpError(err);
        console.warn('Failed to load enabled MCP servers:', error);
    }
}
