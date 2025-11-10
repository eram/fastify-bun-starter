import { createInterface } from 'node:readline';
import * as readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import {
    connectToMCPServer,
    getManager,
    type MCPServerConfig,
    registerMCPServerTools,
    registerOwnTools,
} from '../controller/mcp-controller';
import { MCPConfigManager } from '../controller/mcp-controller/config';
import { type JSONRPCMessage, MCPServer, McpError } from '../lib/mcp-server';
import { green, red, yellow } from '../util';

const HELP_TEXT = `
Usage: bun run mcp [options] [command]
   or: npm run mcp [options] [command]

Configure and manage MCP servers

Options:
  -h, --help                                     Display help for command

Commands:
  serve                                          Start the MCP server with stdio transport
  list [options]                                 List configured MCP servers
    Options:
      --json                                     Output as JSON

  add <name> <commandOrUrl> [args...]            Add an MCP server
    Options:
      --transport <type>                         Transport type: stdio, sse, http (required)
      --env <key=value>                          Environment variables (can be used multiple times)
      --force                                    Skip connection validation

  remove <name>                                  Remove an MCP server
  get <name> [options]                           Get details about an MCP server
    Options:
      --json                                     Output as JSON

  enable <name>                                  Enable an MCP server
  disable <name>                                 Disable an MCP server
  add-json <name> <json>                         Add an MCP server with a JSON string

Examples:
  # List servers in table format
  bun run mcp list

  # List servers as JSON
  bun run mcp list --json

  # Add HTTP server (validates connection)
  bun run mcp add --transport http sentry https://mcp.sentry.dev/mcp

  # Add SSE server (tries /sse and /mcp endpoints)
  bun run mcp add --transport sse weather http://localhost:8080

  # Add without validation
  bun run mcp add --transport http api https://example.com --force

  # Add stdio server with environment variables
  bun run mcp add --transport stdio airtable --env AIRTABLE_API_KEY=YOUR_KEY -- npx -y airtable-mcp-server

  # Get server details
  bun run mcp get my-server

  # Remove a server
  bun run mcp remove my-server

  # Enable/disable servers
  bun run mcp enable my-server
  bun run mcp disable my-server
`;

/**
 * Main MCP CLI entry point
 */
export async function runMCPCLI(args: string[] = process.argv.slice(2)) {
    let exitCode = 1;
    let errorMsg: string | undefined;

    try {
        // Dynamic import to defer env module loading
        // This prevents "Loaded .env file: ..." message when using --json or --help flags
        // The env module checks process.argv internally and suppresses the message
        await import('../util/env');

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
            console.log(HELP_TEXT);
            return 1;
        }

        // For 'serve' command, we need file watching enabled
        // For all other CLI commands, disable watching to allow process to exit cleanly
        const needsWatching = subcommand === 'serve';
        const manager = getManager(undefined, needsWatching);

        // Route to appropriate subcommand
        switch (subcommand) {
            case 'serve':
                await serveCommand();
                exitCode = 0;
                break;
            case 'add':
                exitCode = await addCommand(manager, positionals.slice(1), values);
                break;
            case 'remove':
                exitCode = await removeCommand(manager, positionals.slice(1));
                break;
            case 'list':
                exitCode = await listCommand(manager, values);
                break;
            case 'get':
                exitCode = await getCommand(manager, positionals.slice(1), values);
                break;
            case 'add-json':
                exitCode = await addJsonCommand(manager, positionals.slice(1));
                break;
            case 'enable':
                exitCode = await enableCommand(manager, positionals.slice(1), true);
                break;
            case 'disable':
                exitCode = await enableCommand(manager, positionals.slice(1), false);
                break;
            default:
                console.error(`Unknown subcommand: ${subcommand}`);
                console.error('Run with --help to see available commands');
        }
    } catch (e) {
        errorMsg = `Fatal error: ${e}`;
    } finally {
        if (errorMsg) {
            console.error(errorMsg);
        }
    }

    return exitCode;
}

/**
 * Start MCP stdio server
 * Reads JSON-RPC messages from stdin, writes responses to stdout
 */
/* istanbul ignore next - integration level testing, covered in ci/ */
async function serveCommand() {
    const { Env } = await import('../util');
    const { promise, reject, resolve } = Promise.withResolvers<number>();
    const SERVER_INFO = {
        name: Env.appName,
        version: Env.appVersion,
    };
    const server = new MCPServer(SERVER_INFO);
    await registerOwnTools(server);
    await registerMCPServerTools(server);

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
        resolve(0);
    });

    process.stdin.on('error', (error) => {
        console.error(error);
        reject(1);
    });

    return promise;
}

/**
 * Validate stdio command by attempting to spawn it
 * If npx fails, retries with bunx and updates config
 */
/* istanbul ignore next - integration level testing, covered in ci/ */
async function validateStdioCommand(config: MCPServerConfig): Promise<MCPServerConfig> {
    const { spawn } = await import('node:child_process');
    const stdioConfig = config as MCPServerConfig & { command: string; args?: string[] };

    console.log(`  Validating command: ${stdioConfig.command}`);

    // Try to spawn the command with --help to validate it exists
    const testCommand = async (cmd: string): Promise<boolean> => {
        return new Promise((resolve) => {
            const proc = spawn(cmd, ['--help'], {
                stdio: 'ignore',
                shell: true,
            });

            const timeout = setTimeout(() => {
                proc.kill();
                resolve(false);
            }, 5000); // 5 second timeout

            proc.on('error', () => {
                clearTimeout(timeout);
                resolve(false);
            });

            proc.on('close', (code) => {
                clearTimeout(timeout);
                // Exit code 0 or 1 both indicate the command exists
                // (1 might be "command found but --help not supported")
                resolve(code !== null && code !== 127);
            });
        });
    };

    // Test original command
    const originalWorks = await testCommand(stdioConfig.command);
    if (originalWorks) {
        console.log(`  ✓ Command validated: ${stdioConfig.command}`);
        return config;
    }

    console.log(`  ✗ Command failed: ${stdioConfig.command}`);

    // If command is npx, try bunx
    if (stdioConfig.command === 'npx') {
        console.log('  Retrying with bunx...');
        const bunxWorks = await testCommand('bunx');

        if (bunxWorks) {
            console.log('  ✓ Command validated: bunx');
            return {
                ...stdioConfig,
                command: 'bunx',
            } as MCPServerConfig;
        }

        console.log('  ✗ bunx also failed');
    }

    throw new Error(`Command validation failed: ${stdioConfig.command} not found or not executable`);
}

/**
 * Validate MCP server connection
 * For HTTP/SSE servers, tries both /mcp and /sse endpoints
 * For stdio servers, validates command exists and retries with bunx if npx fails
 * Returns the validated config with corrected URL/command if needed
 */
/* istanbul ignore next - integration level testing, covered in ci/ */
async function validateServerConnection(config: MCPServerConfig): Promise<MCPServerConfig> {
    console.log(`\nValidating connection to ${config.name}...`);

    // For stdio, validate the command works
    if (config.transport === 'stdio') {
        return validateStdioCommand(config);
    }

    // For HTTP/SSE, try to connect
    const originalUrl = config.url!;
    const urlsToTry = [originalUrl];

    // Parse base URL
    const urlObj = new URL(originalUrl);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    const path = urlObj.pathname;

    // Add alternative endpoints to try
    if (config.transport === 'sse') {
        if (!path.endsWith('/sse')) {
            urlsToTry.push(`${baseUrl}/sse`);
        }
        if (!path.endsWith('/mcp')) {
            urlsToTry.push(`${baseUrl}/mcp`);
        }
    } else if (config.transport === 'http') {
        if (!path.endsWith('/mcp')) {
            urlsToTry.push(`${baseUrl}/mcp`);
        }
        if (!path.endsWith('/sse')) {
            urlsToTry.push(`${baseUrl}/sse`);
        }
    }

    // Try each URL
    let lastError: unknown;
    for (const url of urlsToTry) {
        try {
            console.log(`  Trying ${url}...`);
            const testConfig = { ...config, url };
            const client = await connectToMCPServer(testConfig);

            // Try to list tools
            const tools = await client.listTools();
            await client.close();

            console.log(`  ✓ Connected successfully! Found ${tools.length} tools`);

            // Return config with corrected URL
            return { ...config, url };
        } catch (error) {
            lastError = error;
            console.log(`  ✗ Failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // All attempts failed
    throw new Error(
        `Failed to connect to ${config.name} at any endpoint. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
}

/**
 * Add MCP server command
 */
async function addCommand(manager: MCPConfigManager, args: string[], options: Record<string, unknown>) {
    const transport = (options.transport as string) ?? '';
    const name = args[0];
    const commandOrUrl = args[1];
    const restArgs = args.slice(2);
    const force = options.force as boolean;

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
        return interactiveAddCommand(manager, name, transport, commandOrUrl, restArgs, envVars);
    }

    // Validate transport
    const validTransports = ['stdio', 'sse', 'http'];
    if (!validTransports.includes(transport)) {
        console.error(`Invalid transport: ${transport}`);
        console.error(`Valid transports: ${validTransports.join(', ')}`);
        return 1;
    }

    try {
        const envMap = Object.keys(envVars).length > 0 ? new Map(Object.entries(envVars)) : undefined;

        let serverConfig =
            transport === 'stdio'
                ? MCPConfigManager.create(name, 'stdio', commandOrUrl, restArgs.length > 0 ? restArgs : undefined, envMap, true)
                : MCPConfigManager.create(name, transport as 'sse' | 'http', commandOrUrl, undefined, envMap, true);

        // Validate connection unless --force is used
        if (!force) {
            serverConfig = await validateServerConnection(serverConfig);
        } else {
            console.log('⚠ Skipping validation (--force flag used)');
        }

        await manager.upsertServer(serverConfig);
        console.log(`✓ Added MCP server: ${name}`);
        console.log(JSON.stringify(serverConfig, null, 2));
        return 0;
    } catch (err) {
        const error = new McpError(err);
        console.error('✗ Failed to add server:', error);
        console.error('  Use --force to skip validation');
        return 1;
    } finally {
        manager.cleanup();
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
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    try {
        console.log('\n=== Interactive MCP Server Configuration ===\n');

        // Prompt for name
        if (!name) {
            name = await rl.question('Server name: ');
            if (!name) {
                console.error('Server name is required');
                return 1;
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
            return 1;
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
            return 1;
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
        return 0;
    } catch (err) {
        const error = new McpError(err);
        console.error('✗ Failed to add server:', error);
        return 1;
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
        return 1;
    }

    try {
        const removed = await manager.removeServer(name);
        if (removed) {
            console.log(`✓ Removed MCP server: ${name}`);
            return 0;
        }
        console.error(`Server not found: ${name}`);
        return 1;
    } catch (err) {
        const error = new McpError(err);
        console.error('Failed to remove server:', error);
        return 1;
    }
}

/**
 * List all MCP servers
 */
async function listCommand(manager: ReturnType<typeof getManager>, options: Record<string, unknown> = {}): Promise<number> {
    let mcpServer: MCPServer | undefined;

    try {
        // Create MCP server instance and register all tools to get accurate counts
        const { Env } = await import('../util');
        const servers = await manager.getAllServers();
        const SERVER_INFO = {
            name: Env.appName,
            version: Env.appVersion,
        };
        mcpServer = new MCPServer(SERVER_INFO);
        await registerOwnTools(mcpServer);

        const tableData: Record<string, { status: string; transport: string; tools: number; 'command/url': string }> = {};

        for (const server of servers) {
            let status: string;
            let commandOrUrl = '';
            let tools = 0;

            if (server.transport === 'stdio') {
                const stdioServer = server as MCPServerConfig & { command: string; args?: string[] };
                commandOrUrl = stdioServer.command;
                if (stdioServer.args && stdioServer.args.length > 0) {
                    commandOrUrl += ` ${stdioServer.args.join(' ')}`;
                }
            } else {
                commandOrUrl = (server as MCPServerConfig & { url?: string }).url || '';
            }

            // Determine status based on enabled state and tool count availability
            if (server.enabled === false) {
                status = 'disabled';
            } else {
                const toolsArr = mcpServer.getToolsByPrefix(server.name);
                if (toolsArr.length > 0) {
                    status = 'enabled';
                    tools = toolsArr.length;
                } else {
                    status = 'error';
                    tools = 0;
                }
            }

            tableData[server.name] = {
                status,
                transport: server.transport,
                tools,
                'command/url': commandOrUrl,
            };
        }

        if (options.json) {
            process.stdout.write(`${JSON.stringify(tableData, null, 2)}\n`);
            return 0;
        }

        // Convert status text to symbols for table display
        for (const key in tableData) {
            const status = tableData[key].status;
            tableData[key].status = status === 'disabled' ? yellow`✗` : status === 'enabled' ? green`✓` : red`err`;
        }

        console.log(`Configured MCP servers (${servers.length}):`);
        console.table(tableData, ['status', 'transport', 'tools', 'command/url']);

        return 0;
    } catch (err) {
        console.error(`Failed to list servers: ${new McpError(err)}`);
        return 1;
    } finally {
        // Clean up MCP server instance and all registered tools
        // Force close all connections (in case any refCounts are wrong)
        if (mcpServer) {
            await mcpServer.close(true);
        }

        manager.cleanup(); // Stop file watcher to allow process to exit
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
        return 1;
    }

    try {
        const server = await manager.getServer(name);

        if (!server) {
            console.error(`Server not found: ${name}`);
            return 1;
        }

        if (options.json) {
            process.stdout.write(`${JSON.stringify(server, null, 2)}\n`);
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
        return 0;
    } catch (err) {
        const error = new McpError(err);
        console.error('Failed to get server:', error);
        return 1;
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
        return 1;
    }

    try {
        await manager.enable(name, enabled);
        console.log(`✓ MCP server '${name}' ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
        console.error(
            `Failed to ${enabled ? 'enable' : 'disable'} server: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
    }

    return 0;
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
        return 1;
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
        return 1;
    }

    return 0;
}

// Auto-run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const exitCode = await runMCPCLI();
    // Force exit to prevent hanging on active connections/timers
    // This is safe because all cleanup has been done by this point
    process.exit(exitCode);
}
