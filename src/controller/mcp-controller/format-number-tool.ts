/**
 * Number formatting tool
 * Formats numbers according to locale (IETF BCP 47 format)
 */

import type { MCPServer, ToolResult } from '../../lib/mcp-server';

export function registerFormatNumberTool(server: MCPServer): void {
    const properties = new Map<string, unknown>();
    properties.set('number', {
        type: 'number',
        description: 'Number to format (1-15 digits, positive or negative)',
    });
    properties.set('locale', {
        type: 'string',
        description: 'Locale in IETF BCP 47 format (e.g., en-US, de-DE, fr-FR)',
    });

    server.register(
        {
            name: 'format_number',
            description: 'Format a number according to a specific locale (IETF BCP 47 format like en-US, de-DE)',
            inputSchema: {
                type: 'object',
                properties,
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
            const abs = Math.abs(number);
            const digits = abs === 0 ? 1 : Math.floor(Math.log10(abs)) + 1;
            if (digits > 15) {
                return {
                    content: [{ type: 'text', text: 'Error: Number must have at most 15 digits' }],
                    isError: true,
                };
            }

            // Check locale format (IETF BCP 47: language-COUNTRY)
            const pattern = /^[a-z]{2,3}(-[A-Z]{2})?$/;
            if (!pattern.test(locale)) {
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
                const loc = new Intl.NumberFormat(locale);
                const formatted = loc.format(number);

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
                    isError: false,
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
        async () => {
            // No cleanup needed for format_number tool
        },
    );
}
