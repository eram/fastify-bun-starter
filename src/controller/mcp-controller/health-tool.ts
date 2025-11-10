/**
 * Health check tool
 * Returns server health status
 */

import type { MCPServer, ToolResult } from '../../lib/mcp-server';

export function registerHealthTool(server: MCPServer): void {
    server.register(
        {
            name: 'health',
            description: 'Check server health status',
            inputSchema: {
                type: 'object',
                properties: new Map(),
                required: [],
            },
        },
        async (): Promise<ToolResult> => {
            const result = {
                status: 'ok',
                timestamp: new Date().toISOString(),
            };

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                    },
                ],
                isError: false,
            };
        },
        async () => {
            // No cleanup needed for health tool
        },
    );
}
