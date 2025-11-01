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

OPTIONS:
  --help, -h            Show this help message

EXAMPLES:
  bun run src/cli.ts server
  PORT=8080 bun run src/cli.ts server
`);
        return;
    }

    if (command === 'server') {
        const { startServer } = await import('./http/server');
        await startServer(app);
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
