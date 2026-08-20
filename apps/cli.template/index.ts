/**
 * CLI - Command-line interface for various tools
 *
 * This provides CLI commands for different operations.
 * For running the HTTP server, use: bun src/app.ts
 */

import type { ParseArgsConfig } from 'node:util';
import { parseArgs } from 'node:util';

import { createLogger, hookConsole } from '@libs/utils/logger';

type GlobalOptions = {
    help: boolean;
    json: boolean;
    verbose: boolean;
    quiet: boolean;
    claim?: string[];
};

type OptionDesc = {
    type: 'string' | 'boolean';
    short?: string;
    description?: string;
    default?: string | boolean;
};

type CommandDef = {
    name: string;
    description: string;
    options?: Record<string, OptionDesc>;
};

const COMMANDS: Record<string, CommandDef> = {
    start: {
        name: 'start',
        description: 'Start HTTP server',
        options: {
            port: { type: 'string', short: 'p', description: 'Server port (default: 3000)' },
            host: { type: 'string', description: 'Server host (default: 0.0.0.0)' },
        },
    },
    dev: {
        name: 'dev',
        description: 'Start HTTP server with hot reload',
        options: {
            port: { type: 'string', short: 'p', description: 'Server port (default: 3000)' },
            host: { type: 'string', description: 'Server host (default: 0.0.0.0)' },
        },
    },
    cluster: {
        name: 'cluster',
        description: 'Start HTTP server in cluster mode',
        options: {
            port: { type: 'string', short: 'p', description: 'Server port (default: 3000)' },
            host: { type: 'string', description: 'Server host (default: 0.0.0.0)' },
            workers: { type: 'string', short: 'w', description: 'Number of workers (default: CPU count)' },
        },
    },
    token: {
        name: 'token',
        description: 'Manage JWT tokens (create, validate)',
        options: {
            claim: { type: 'string', short: 'c', description: 'Add a custom claim to the token (key=value). Repeatable.' },
        },
    },
};

const GLOBAL_OPTIONS_DESC: Record<string, OptionDesc> = {
    help: { type: 'boolean', short: 'h', description: 'Show help message' },
    json: { type: 'boolean', description: 'Output as JSON' },
    verbose: { type: 'boolean', short: 'v', description: 'Verbose logging' },
    quiet: { type: 'boolean', short: 'q', description: 'Suppress non-essential output' },
};

// Build parseArgs config from descriptions
const GLOBAL_PARSE_OPTIONS: ParseArgsConfig['options'] = {};
for (const [key, desc] of Object.entries(GLOBAL_OPTIONS_DESC)) {
    const { type, short, default: def } = desc;
    const opt: Record<string, unknown> = {
        type: type as 'boolean' | 'string',
    };
    if (short) opt['short'] = short;
    if (def !== undefined) opt['default'] = def;
    GLOBAL_PARSE_OPTIONS[key] = opt as never;
}

// 'claim' is parsed globally (parseArgs runs once over the whole argv) but only
// documented/used under `token create` — kept out of GLOBAL_OPTIONS_DESC on purpose.
GLOBAL_PARSE_OPTIONS['claim'] = { type: 'string', short: 'c', multiple: true } as never;

function printHelp(commandName?: string) {
    const cmd = commandName ? COMMANDS[commandName] : undefined;

    if (cmd) {
        console.log(`${cmd.name} - ${cmd.description}\n`);
        console.log('USAGE:');
        console.log(`  bun apps/cli ${cmd.name} [options]\n`);
        console.log('OPTIONS:');
        if (cmd.options) {
            for (const [key, opt] of Object.entries(cmd.options)) {
                const short = opt.short ? `, -${opt.short}` : '';
                console.log(`  --${key}${short}  ${opt.description || ''}`);
            }
        }
        return;
    }

    console.log('CLI - Command-line tools\n');
    console.log('USAGE:');
    console.log('  bun apps/cli <command> [options]\n');
    console.log('COMMANDS:');
    for (const [, cmd] of Object.entries(COMMANDS)) {
        console.log(`  ${cmd.name.padEnd(10)} ${cmd.description}`);
    }
    console.log('\nGLOBAL OPTIONS:');
    for (const [key, opt] of Object.entries(GLOBAL_OPTIONS_DESC)) {
        const short = opt.short ? `, -${opt.short}` : '';
        console.log(`  --${key}${short}  ${opt.description || ''}`);
    }
    console.log('\nFor HTTP server via npm scripts:');
    console.log('  npm run start           Start HTTP server');
    console.log('  npm run dev             Start with hot reload');
    console.log('  npm run cluster         Start in cluster mode');
}

async function runCLI() {
    let unhook = () => {};

    try {
        const { positionals, values } = parseArgs({
            args: process.argv.slice(2),
            options: GLOBAL_PARSE_OPTIONS,
            allowPositionals: true,
            strict: false,
        });

        const globalOpts = values as Partial<GlobalOptions>;

        // Hook console BEFORE any output if --json flag is used
        if (globalOpts.json) {
            const nullLogger = createLogger('null', 0, { log: () => {}, error: () => {} });
            unhook = hookConsole(nullLogger);
        }

        // Show help if requested
        if (globalOpts.help) {
            const cmd = positionals[0];
            printHelp(cmd);
            return;
        }

        const command = positionals[0];

        // Show help if no command provided
        if (!command) {
            printHelp();
            return;
        }

        // Validate command exists
        if (!COMMANDS[command]) {
            console.error(`Unknown command: ${command}`);
            console.error("Run 'bun apps/cli --help' to see available commands");
            process.exit(1);
        }

        // Route to command handlers
        if (command === 'token') {
            const { handleTokenCreate, handleTokenValidate } = await import('./commands/token');
            const subcommand = positionals[1];

            if (subcommand === 'create') {
                await handleTokenCreate(positionals[2], globalOpts.claim);
            } else if (subcommand === 'validate') {
                await handleTokenValidate(positionals[2]);
            } else {
                console.error('token: missing subcommand');
                console.error('Usage: bun apps/cli token <create|validate> [token]');
                process.exit(1);
            }
            return;
        }

        console.error(`Command '${command}' is not yet implemented`);
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
