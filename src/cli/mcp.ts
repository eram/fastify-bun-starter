/**
 * MCP CLI command - Start MCP server with stdio transport
 * Usage: bun run src/cli/mcp.ts
 */

import { startStdioServer } from '../lib/mcp/stdio';

const SERVER_INFO = {
    name: 'fastify-bun-starter-mcp',
    version: '1.0.0',
};

// Start the stdio server
startStdioServer(SERVER_INFO).catch((error) => {
    console.error('Failed to start MCP stdio server:', error);
    process.exit(1);
});
