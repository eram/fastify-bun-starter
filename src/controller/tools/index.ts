/**
 * MCP Tools - Tool registration for MCP server
 *
 * Each tool is defined in its own file.
 * Add new tools here and export them.
 *
 * Tools aggregator: Also registers tools from all enabled MCP servers
 * with prefixed names like {serverName}:{toolName}
 */

import type { MCPServer, ToolResult } from '../../lib/mcp';
import { getManager } from '../mcp-config/manager';
import { registerFormatNumberTool } from './format-number';
import { registerHealthTool } from './health';
import type { MCPClient } from './mcp-client';
import { connectToMCPServer } from './mcp-client';

// Cache of active MCP client connections
const connections = new Map<string, MCPClient>();

/**
 * Register all tools with the MCP server
 * Includes both local tools and tools from all enabled MCP servers
 */
export async function registerAllTools(server: MCPServer): Promise<void> {
    // Register local tools
    registerHealthTool(server);
    registerFormatNumberTool(server);

    // Register tools from all enabled MCP servers
    await registerMCPServerTools(server);
}

/**
 * Register tools from all enabled MCP servers
 * Tools are prefixed with {serverName}:{toolName}
 */
async function registerMCPServerTools(server: MCPServer): Promise<void> {
    try {
        // Get manager (auto-initializes on first call)
        const manager = getManager();
        const enabled = await manager.getEnabled();

        for (const conf of enabled) {
            try {
                const serverName = String(conf.name);
                // Get or create connection to MCP server
                let connection = connections.get(serverName);

                if (!connection) {
                    connection = await connectToMCPServer(conf);
                    connections.set(serverName, connection);
                }

                // Get tools list from the MCP server
                const tools = await connection.listTools();

                // Register each tool with prefixed name
                for (const tool of tools) {
                    const name = `${serverName}:${tool.name}`;

                    server.registerTool(
                        {
                            name,
                            description: `[${serverName}] ${tool.description}`,
                            inputSchema: tool.inputSchema,
                        },
                        async (args): Promise<ToolResult> => {
                            // Forward the tool call to the MCP server
                            return await connection.callTool(tool.name, args);
                        },
                    );
                }

                console.log(`Registered ${tools.length} tools from MCP server: ${serverName}`);
            } catch (error) {
                console.error(`Failed to register tools from MCP server ${conf.name}:`, error);
                // Continue with other servers even if one fails
            }
        }
    } catch (error) {
        console.error('Failed to load enabled MCP servers:', error);
    }
}

/**
 * Close all MCP client connections
 * Should be called on shutdown
 */
export async function closeAllMCPConnections(): Promise<void> {
    for (const [name, connection] of connections.entries()) {
        try {
            await connection.close();
            console.log(`Closed MCP connection: ${name}`);
        } catch (error) {
            console.error(`Failed to close MCP connection ${name}:`, error);
        }
    }
    connections.clear();
}
