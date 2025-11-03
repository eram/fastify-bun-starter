/**
 * Stdio transport for MCP
 * Enables MCP communication over stdin/stdout for CLI usage
 */

import { createInterface } from 'node:readline';
import { MCPServer } from './server';
import { registerAllTools } from './tools';
import type { JSONRPCMessage } from './types';

/**
 * Start MCP server with stdio transport
 * Reads JSON-RPC messages from stdin, writes responses to stdout
 */
export async function startStdioServer(serverInfo: { name: string; version: string }) {
    const server = new MCPServer(serverInfo);
    registerAllTools(server);

    const readline = createInterface({
        input: process.stdin,
        output: undefined, // Don't echo to stdout
        terminal: false,
    });

    console.error('MCP Server started with stdio transport');
    console.error(`Server: ${serverInfo.name} v${serverInfo.version}`);
    console.error('Tools available: health, format_number');
    console.error('Listening for JSON-RPC messages on stdin...');
    console.error('');

    readline.on('line', async (line) => {
        try {
            const message = JSON.parse(line) as JSONRPCMessage;
            const response = await server.handleMessage(message);

            if (response) {
                // Write response to stdout
                process.stdout.write(`${JSON.stringify(response)}\n`);
            }
        } catch (error) {
            // Write error to stdout as JSON-RPC error
            const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32700,
                    message: 'Parse error',
                    data: error instanceof Error ? error.message : String(error),
                },
            };
            process.stdout.write(`${JSON.stringify(errorResponse)}\n`);
        }
    });

    readline.on('close', () => {
        console.error('Stdin closed, shutting down...');
        process.exit(0);
    });

    process.stdin.on('error', (error) => {
        console.error('Stdin error:', error);
        process.exit(1);
    });
}
