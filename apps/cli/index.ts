/**
 * CLI - Command-line interface for various tools
 *
 * This provides CLI commands for different operations.
 * For running the HTTP server, use: bun src/app.ts
 */

import { parseArgs } from 'node:util';
import { createLogger, hookConsole } from '@libs/utils/logger';

const HELP_TEXT = `
CLI - Command-line tools

USAGE:
  bun src/cli <command> [options]

OPTIONS:
  --help, -h              Show this help message

For HTTP server:
  npm run start           Start HTTP server
  npm run dev             Start with hot reload
  npm run cluster         Start in cluster mode
`;

async function runCLI() {
    let unhook = () => {};

    try {
        const { positionals, values } = parseArgs({
            args: process.argv.slice(2),
            options: {
                help: {
                    type: 'boolean',
                    short: 'h',
                    default: false,
                },
                json: {
                    type: 'boolean',
                    default: false,
                },
            },
            allowPositionals: true,
            strict: false, // Allow passing options to subcommands
        });

        // Hook console BEFORE any output if --json flag is used
        if (values.json) {
            // Hook console to suppress all console output when --json is used
            // This ensures only the JSON blob goes to stdout
            const nullLogger = createLogger('null', 0, { log: () => {}, error: () => {} });
            unhook = hookConsole(nullLogger);
        }

        const command = positionals[0];

        // Only show help if no command provided, or if help is requested without a command
        if (!command) {
            console.log(HELP_TEXT);
            return;
        }

        console.error(`Unknown command: ${command}`);
        console.error('Run with --help to see available commands');
        process.exit(1);
    } finally {
        unhook();
    }
}

// Auto-run CLI
runCLI().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
