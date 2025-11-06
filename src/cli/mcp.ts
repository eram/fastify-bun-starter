/**
 * MCP CLI command - Manage MCP servers
 * Usage: bun run mcp [subcommand] [options]
 *    or: npm run mcp [subcommand] [options]
 */

import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import * as readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { getManager, MCPConfigManager } from '../controller/mcp-config/manager';
import type { MCPServerConfig } from '../controller/mcp-config/types';
import { registerAllTools } from '../controller/tools';
import type { JSONRPCMessage } from '../lib/mcp';
import { MCPServer } from '../lib/mcp';
import { Env } from '../util';

const SERVER_INFO = {
    name: Env.appName,
    version: Env.appVersion,
};

/**
 * Main MCP CLI entry point
 */
export async function runMCPCLI(args: string[] = process.argv.slice(2)) {
    const { values, positionals } = parseArgs({
        args,
        options: {
            help: {
                type: 'boolean',
                short: 'h',
                default: false,
            },
            transport: {
                type: 'string',
                short: 't',
            },
            env: {
                type: 'string',
                multiple: true,
            },
            json: {
                type: 'boolean',
                default: false,
            },
            force: {
                type: 'boolean',
                default: false,
            },
        },
        allowPositionals: true,
        strict: false, // Allow unknown options
    });

    const subcommand = positionals[0];

    // Show help if no subcommand or --help flag
    if (!subcommand || values.help) {
        showHelp();
        return;
    }

    // For 'serve' command, we need file watching enabled
    // For all other CLI commands, disable watching to allow process to exit cleanly
    const needsWatching = subcommand === 'serve';
    const manager = getManager(undefined, needsWatching);

    // Route to appropriate subcommand
    switch (subcommand) {
        case 'serve':
            await serveCommand();
            break;
        case 'add':
            await addCommand(manager, positionals.slice(1), values);
            break;
        case 'remove':
            await removeCommand(manager, positionals.slice(1));
            break;
        case 'list':
            await listCommand(manager, values);
            break;
        case 'get':
            await getCommand(manager, positionals.slice(1), values);
            break;
        case 'add-json':
            await addJsonCommand(manager, positionals.slice(1));
            break;
        case 'enable':
            await enableCommand(manager, positionals.slice(1), true);
            break;
        case 'disable':
            await enableCommand(manager, positionals.slice(1), false);
            break;
        default:
            console.error(`Unknown subcommand: ${subcommand}`);
            console.error('Run with --help to see available commands');
            process.exit(1);
    }
}

/**
 * Show help message
 */
function showHelp() {
    console.log(`
Usage: bun run mcp [options] [command]
   or: npm run mcp [options] [command]

Configure and manage MCP servers

Options:
  -h, --help                                     Display help for command

Commands:
  serve [options]                                Start the MCP server with stdio transport
  add [options] <name> <commandOrUrl> [args...]  Add an MCP server

  Examples:
    # Add HTTP server:
    bun run mcp add --transport http sentry https://mcp.sentry.dev/mcp

    # Add SSE server:
    bun run mcp add --transport sse asana https://mcp.asana.com/sse

    # Add stdio server:
    bun run mcp add --transport stdio airtable --env AIRTABLE_API_KEY=YOUR_KEY -- npx -y airtable-mcp-server

  remove [options] <name>                        Remove an MCP server
  list                                           List configured MCP servers
  get <name>                                     Get details about an MCP server
  enable <name>                                  Enable an MCP server
  disable <name>                                 Disable an MCP server
  add-json [options] <name> <json>               Add an MCP server (stdio or SSE) with a JSON string
  help [command]                                 Display help for command

Examples:
  bun run mcp serve
  bun run mcp list
  bun run mcp add my-server https://example.com/mcp
  bun run mcp get my-server
  bun run mcp remove my-server
`);
}

/**
 * Start MCP stdio server
 * Reads JSON-RPC messages from stdin, writes responses to stdout
 */
async function serveCommand() {
    const server = new MCPServer(SERVER_INFO);
    await registerAllTools(server);

    const rl = createInterface({
        input: process.stdin,
        output: undefined, // Don't echo to stdout
        terminal: false,
    });

    console.error('MCP Server started with stdio transport');
    console.error(`Server: ${SERVER_INFO.name} v${SERVER_INFO.version}`);
    console.error('Listening for JSON-RPC messages on stdin...');
    console.error('');

    rl.on('line', async (line) => {
        try {
            const message = JSON.parse(line) as JSONRPCMessage;
            const response = await server.handleMessage(message);
            if (response) {
                // Write response to stdout
                process.stdout.write(`${JSON.stringify(response)}\n`);
            }
        } catch (e) {
            const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32700,
                    message: `Parse error: ${Object(e).message}`,
                },
            };
            process.stdout.write(`${JSON.stringify(errorResponse)}\n`);
        }
    });

    rl.on('close', () => {
        console.error('Stdin closed, shutting down...');
        process.exit(0);
    });

    process.stdin.on('error', (error) => {
        console.error('Stdin error:', error);
        process.exit(1);
    });
}

/**
 * Add MCP server command
 */
async function addCommand(manager: ReturnType<typeof getManager>, args: string[], options: Record<string, unknown>) {
    const transport = (options.transport as string) ?? '';
    const name = args[0];
    const commandOrUrl = args[1];
    const restArgs = args.slice(2);

    // Parse environment variables
    const envVars: Record<string, string> = {};
    if (options.env && Array.isArray(options.env)) {
        for (const envStr of options.env) {
            const [key, value] = String(envStr).split('=');
            if (key && value) {
                envVars[key] = value;
            }
        }
    }

    // If any required param is missing, start interactive mode
    if (!name || !transport || !commandOrUrl) {
        await interactiveAddCommand(manager, name, transport, commandOrUrl, restArgs, envVars);
        return;
    }

    // Validate transport
    const validTransports = ['stdio', 'sse', 'http'];
    if (!validTransports.includes(transport)) {
        console.error(`Invalid transport: ${transport}`);
        console.error(`Valid transports: ${validTransports.join(', ')}`);
        process.exit(1);
    }

    try {
        const envMap = Object.keys(envVars).length > 0 ? new Map(Object.entries(envVars)) : undefined;

        const serverConfig =
            transport === 'stdio'
                ? MCPConfigManager.create(name, 'stdio', commandOrUrl, restArgs.length > 0 ? restArgs : undefined, envMap, true)
                : MCPConfigManager.create(name, transport as 'sse' | 'http', commandOrUrl, undefined, envMap, true);

        await manager.upsertServer(serverConfig);
        console.log(`✓ Added MCP server: ${name}`);
        console.log(JSON.stringify(serverConfig, null, 2));
    } catch (error) {
        console.error(`Failed to add server: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

/**
 * Interactive add command - prompts for missing parameters
 */
async function interactiveAddCommand(
    manager: ReturnType<typeof getManager>,
    name?: string,
    transport?: string,
    commandOrUrl?: string,
    args?: string[],
    envVars?: Record<string, string>,
) {
    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
        console.log('\n=== Interactive MCP Server Configuration ===\n');

        // Prompt for name
        if (!name) {
            name = await rl.question('Server name: ');
            if (!name) {
                console.error('Server name is required');
                process.exit(1);
            }
        } else {
            console.log(`Server name: ${name}`);
        }

        // Prompt for transport
        if (!transport) {
            transport = await rl.question('Transport type (stdio/sse/http): ');
        } else {
            console.log(`Transport type: ${transport}`);
        }

        const validTransports = ['stdio', 'sse', 'http'];
        if (!validTransports.includes(transport)) {
            console.error(`Invalid transport: ${transport}`);
            console.error(`Valid transports: ${validTransports.join(', ')}`);
            process.exit(1);
        }

        // Prompt for command or URL
        if (!commandOrUrl) {
            if (transport === 'stdio') {
                commandOrUrl = await rl.question('Command: ');
            } else {
                commandOrUrl = await rl.question('URL: ');
            }
        } else {
            console.log(`${transport === 'stdio' ? 'Command' : 'URL'}: ${commandOrUrl}`);
        }

        if (!commandOrUrl) {
            console.error(`${transport === 'stdio' ? 'Command' : 'URL'} is required`);
            process.exit(1);
        }

        // Prompt for args (stdio only)
        let finalArgs = args;
        if (transport === 'stdio') {
            if (!finalArgs || finalArgs.length === 0) {
                const argsStr = await rl.question('Arguments (space-separated, optional): ');
                finalArgs = argsStr ? argsStr.split(' ').filter((a) => a.length > 0) : [];
            }
        }

        // Prompt for env vars
        const finalEnvVars = envVars || {};
        const addEnv = await rl.question('Add environment variable? (y/N): ');
        if (addEnv.toLowerCase() === 'y' || addEnv.toLowerCase() === 'yes') {
            while (true) {
                const envKey = await rl.question('Env variable name (or press Enter to finish): ');
                if (!envKey) break;

                const envValue = await rl.question(`Value for ${envKey}: `);
                finalEnvVars[envKey] = envValue;
            }
        }

        // Create and save
        const envMap = Object.keys(finalEnvVars).length > 0 ? new Map(Object.entries(finalEnvVars)) : undefined;
        const serverConfig =
            transport === 'stdio'
                ? MCPConfigManager.create(
                      name,
                      'stdio',
                      commandOrUrl,
                      finalArgs && finalArgs.length > 0 ? finalArgs : undefined,
                      envMap,
                      true,
                  )
                : MCPConfigManager.create(name, transport as 'sse' | 'http', commandOrUrl, undefined, envMap, true);

        await manager.upsertServer(serverConfig);
        console.log(`\n✓ Added MCP server: ${name}`);
        console.log(JSON.stringify(serverConfig, null, 2));
    } finally {
        rl.close();
    }
}

/**
 * Remove MCP server command
 */
async function removeCommand(manager: ReturnType<typeof getManager>, args: string[]) {
    const name = args[0];

    if (!name) {
        console.error('Server name is required');
        console.error('Usage: bun run mcp remove <name>');
        process.exit(1);
    }

    try {
        const removed = await manager.removeServer(name);
        if (removed) {
            console.log(`✓ Removed MCP server: ${name}`);
        } else {
            console.error(`Server not found: ${name}`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`Failed to remove server: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

/**
 * List all MCP servers
 */
async function listCommand(manager: ReturnType<typeof getManager>, options: Record<string, unknown> = {}) {
    try {
        const servers = await manager.getAllServers();

        if (servers.length === 0) {
            if (options.json) {
                console.log('[]');
            } else {
                console.log('No MCP servers configured');
            }
            return;
        }

        if (options.json) {
            console.log(JSON.stringify(servers, null, 2));
            return;
        }

        console.log(`\nConfigured MCP servers (${servers.length}):\n`);
        for (const server of servers) {
            const status = server.enabled !== false ? '✓' : '✗';
            console.log(`${status} ${server.name} (${server.transport})`);
            if (server.transport === 'stdio') {
                const stdioServer = server as MCPServerConfig & { command: string; args?: string[] };
                console.log(`    Command: ${stdioServer.command}`);
                if (stdioServer.args && stdioServer.args.length > 0) {
                    console.log(`    Args: ${stdioServer.args.join(' ')}`);
                }
            } else {
                console.log(`    URL: ${(server as MCPServerConfig & { url?: string }).url}`);
            }
            if (server.env && Object.keys(server.env).length > 0) {
                console.log(`    Env: ${Object.keys(server.env).join(', ')}`);
            }
            console.log('');
        }
    } catch (error) {
        console.error(`Failed to list servers: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

/**
 * Get specific MCP server details
 */
async function getCommand(manager: ReturnType<typeof getManager>, args: string[], options: Record<string, unknown> = {}) {
    const name = args[0];

    if (!name) {
        console.error('Server name is required');
        console.error('Usage: bun run mcp get <name>');
        process.exit(1);
    }

    try {
        const server = await manager.getServer(name);

        if (!server) {
            console.error(`Server not found: ${name}`);
            process.exit(1);
        }

        if (options.json) {
            console.log(JSON.stringify(server, null, 2));
        } else {
            // Pretty print for human-readable output
            console.log(`\nServer: ${server.name}`);
            console.log(`Transport: ${server.transport}`);
            console.log(`Enabled: ${server.enabled !== false ? 'yes' : 'no'}`);

            if (server.transport === 'stdio') {
                const stdioServer = server as MCPServerConfig & { command: string; args?: string[] };
                console.log(`Command: ${stdioServer.command}`);
                if (stdioServer.args && stdioServer.args.length > 0) {
                    console.log(`Args: ${stdioServer.args.join(' ')}`);
                }
            } else {
                const urlServer = server as MCPServerConfig & { url?: string };
                if (urlServer.url) {
                    console.log(`URL: ${urlServer.url}`);
                }
            }

            if (server.env && server.env.size > 0) {
                console.log('Environment variables:');
                for (const [key] of server.env) {
                    console.log(`  ${key}`);
                }
            }
        }
    } catch (error) {
        console.error(`Failed to get server: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

/**
 * Enable or disable an MCP server
 */
async function enableCommand(manager: ReturnType<typeof getManager>, args: string[], enabled: boolean) {
    const name = args[0];

    if (!name) {
        console.error('Server name is required');
        console.error(`Usage: bun run mcp ${enabled ? 'enable' : 'disable'} <name>`);
        process.exit(1);
    }

    try {
        await manager.enable(name, enabled);
        console.log(`✓ MCP server '${name}' ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
        console.error(
            `Failed to ${enabled ? 'enable' : 'disable'} server: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
    }
}

/**
 * Add MCP server from JSON string
 */
async function addJsonCommand(manager: ReturnType<typeof getManager>, args: string[]) {
    const name = args[0];
    const jsonStr = args[1];

    if (!name || !jsonStr) {
        console.error('Server name and JSON config are required');
        console.error('Usage: bun run mcp add-json <name> <json>');
        console.error('Example: bun run mcp add-json my-server \'{"transport":"sse","url":"https://example.com"}\'');
        process.exit(1);
    }

    try {
        const config = JSON.parse(jsonStr);
        const serverConfig: MCPServerConfig = {
            name,
            ...config,
        };

        await manager.upsertServer(serverConfig);
        console.log(`✓ Added MCP server: ${name}`);
        console.log(JSON.stringify(serverConfig, null, 2));
    } catch (error) {
        console.error(`Failed to add server from JSON: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

// Auto-run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runMCPCLI().catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
