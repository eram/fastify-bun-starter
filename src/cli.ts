/**
 * CLI - Command-line interface for various tools
 *
 * This provides CLI commands for different operations.
 * For running the HTTP server, use: bun src/app.ts
 */

import { parseArgs } from 'node:util';

async function runCLI() {
    const { positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            help: {
                type: 'boolean',
                short: 'h',
                default: false,
            },
        },
        allowPositionals: true,
        strict: false, // Allow passing options to subcommands
    });

    const command = positionals[0];

    // Only show help if no command provided, or if help is requested without a command
    if (!command) {
        console.log(`
CLI - Command-line tools

USAGE:
  bun src/cli.ts <command> [options]

COMMANDS:
  mcp <subcommand>         Manage MCP server configurations
                           (serve, add, remove, list, get, enable, disable, add-json)

OPTIONS:
  --help, -h              Show this help message

EXAMPLES:
  bun src/cli.ts mcp list
  bun src/cli.ts mcp add my-server --transport stdio --command "node server.js"
  npm run mcp list

For HTTP server:
  npm run start           Start HTTP server
  npm run dev             Start with hot reload
  npm run cluster         Start in cluster mode
`);
        return;
    }

    if (command === 'mcp') {
        // Pass remaining args to MCP CLI - pass ALL original args
        // This is needed because parseArgs consumes options
        const allArgs = process.argv.slice(2);
        const mcpArgs = allArgs.slice(1); // Everything after 'mcp'
        const { runMCPCLI } = await import('./cli/mcp');
        await runMCPCLI(mcpArgs);
    } else {
        console.error(`Unknown command: ${command}`);
        console.error('Run with --help to see available commands');
        process.exit(1);
    }
}

// Auto-run CLI
runCLI().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
