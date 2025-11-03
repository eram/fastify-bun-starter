import { parseArgs } from 'node:util';
import { app } from './app';

// CLI mode using node:util.parseArgs
async function runCLI() {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            help: {
                type: 'boolean',
                short: 'h',
                default: false,
            },
        },
        allowPositionals: true,
    });

    const command = positionals[0];

    if (values.help || !command) {
        console.log(`
USAGE:
  bun run src/cli.ts <command> [options]

COMMANDS:
  server                Start HTTP server (default port 3000)
  mcp                   Start MCP server with stdio transport

OPTIONS:
  --help, -h            Show this help message

EXAMPLES:
  bun run src/cli.ts server
  PORT=8080 bun run src/cli.ts server
  bun run src/cli.ts mcp
`);
        return;
    }

    if (command === 'server') {
        const { startServer } = await import('./http/server');
        await startServer(app);
    } else if (command === 'mcp') {
        const { startStdioServer } = await import('./lib/mcp/stdio');
        await startStdioServer({
            name: 'fastify-bun-starter-mcp',
            version: '1.0.0',
        });
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
