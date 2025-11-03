/**
 * MCP Tools registration
 * Registers hello and health endpoints as MCP tools
 */

import type { MCPServer } from './server';
import type { ToolResult } from './types';

/**
 * Register health check tool
 */
export function registerHealthTool(server: MCPServer): void {
    server.registerTool(
        {
            name: 'health',
            description: 'Check server health status',
            inputSchema: {
                type: 'object',
                properties: {},
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
            };
        },
    );
}

/**
 * Register number formatting tool (hello endpoint)
 */
export function registerNumberFormatTool(server: MCPServer): void {
    server.registerTool(
        {
            name: 'format_number',
            description: 'Format a number according to a specific locale (IETF BCP 47 format like en-US, de-DE)',
            inputSchema: {
                type: 'object',
                properties: {
                    number: {
                        type: 'number',
                        description: 'Number to format (1-15 digits, positive or negative)',
                    },
                    locale: {
                        type: 'string',
                        description: 'Locale in IETF BCP 47 format (e.g., en-US, de-DE, fr-FR)',
                    },
                },
                required: ['number', 'locale'],
            },
        },
        async (args): Promise<ToolResult> => {
            const number = args.number as number;
            const locale = args.locale as string;

            // Validate inputs
            if (typeof number !== 'number') {
                return {
                    content: [{ type: 'text', text: 'Error: number must be a number' }],
                    isError: true,
                };
            }

            if (typeof locale !== 'string') {
                return {
                    content: [{ type: 'text', text: 'Error: locale must be a string' }],
                    isError: true,
                };
            }

            // Check number has max 15 digits
            const absNum = Math.abs(number);
            const digits = absNum === 0 ? 1 : Math.floor(Math.log10(absNum)) + 1;
            if (digits > 15) {
                return {
                    content: [{ type: 'text', text: 'Error: Number must have at most 15 digits' }],
                    isError: true,
                };
            }

            // Check locale format (IETF BCP 47: language-COUNTRY)
            const localePattern = /^[a-z]{2,3}(-[A-Z]{2})?$/;
            if (!localePattern.test(locale)) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Error: Locale must be in IETF BCP 47 format (e.g., en-US, de-DE)',
                        },
                    ],
                    isError: true,
                };
            }

            // Try to format the number
            try {
                const formatter = new Intl.NumberFormat(locale);
                const formatted = formatter.format(number);

                const result = {
                    formatted,
                    number,
                    locale,
                };

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: ${error instanceof Error ? error.message : 'Unknown error formatting number'}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );
}

/**
 * Register all tools
 */
export function registerAllTools(server: MCPServer): void {
    registerHealthTool(server);
    registerNumberFormatTool(server);
}
