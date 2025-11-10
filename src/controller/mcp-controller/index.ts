/**
 * MCP Tools - Tool registration for MCP server
 *
 * Each tool is defined in its own file.
 * Add new tools here and export them.
 *
 * Tools aggregator: Also registers tools from all enabled MCP servers
 * with prefixed names like {serverName}:{toolName}
 */

export { getManager, type MCPConfigManager } from './config';
export { connectToMCPServer, registerMCPServerTools, registerOwnTools } from './register';
export type { MCPServerConfig } from './types';
