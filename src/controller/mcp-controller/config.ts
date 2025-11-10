/**
 * MCP Configuration File Manager
 *
 * Event-based manager for MCP server configurations
 * - Class-based design with EventEmitter
 * - No circular dependencies
 * - Synchronous broadcast via events
 * - File watching in cluster mode
 */

import { EventEmitter } from 'node:events';
import { readFile, watch } from 'node:fs/promises';
import * as path from 'node:path';
import { McpError } from '../../lib/mcp-server';
import { access, atExit, copyFile, Env, ErrorEx, mkdir, writeFile } from '../../util';
import {
    type MCPConfigFile,
    type MCPEnv,
    type MCPServerConfig,
    type MCPTransport,
    mcpConfigFileSchema,
    mcpServerConfigSchema,
} from './types';

/** MCPConfigManager events */
export interface MCPConfigManagerEvents {
    'config:changed': () => void;
}

export class MCPConfigManager extends EventEmitter {
    // Event emitter type augmentation for proper typing
    declare on: <K extends keyof MCPConfigManagerEvents>(event: K, listener: MCPConfigManagerEvents[K]) => this;
    declare emit: <K extends keyof MCPConfigManagerEvents>(event: K, ...args: Parameters<MCPConfigManagerEvents[K]>) => boolean;
    private _configPath: string;
    private _abort: AbortController | undefined;

    constructor(configPath?: string, watch = true) {
        super();
        this.setMaxListeners(50); // Increase max listeners to prevent warnings in tests
        const file = configPath || Env.get('MCP_CONFIG_FILE', 'var/.mcp.json');
        this._configPath = path.resolve(Env.__dirname, file);

        // if we dont need to watch for file changes we only generate an abort controller.
        if (watch) {
            this._startWatching();
        } else {
            this._abort = new AbortController();
        }
    }

    isValidConfig(config: unknown): config is MCPServerConfig {
        try {
            mcpServerConfigSchema.parse(config);
            return true;
        } catch {
            return false;
        }
    }

    async readConfig(): Promise<MCPConfigFile> {
        try {
            const content = await readFile(this._configPath, 'utf-8');
            const parsed = JSON.parse(content);
            return mcpConfigFileSchema.parse(parsed);
        } catch (error) {
            // If file exists but is corrupt, try loading backup
            const [exists] = await access(this._configPath);
            if (exists) {
                console.error('Config file is corrupt, attempting to load backup:', error);
                const backupPath = `${this._configPath}.backup`;
                const [backupExists] = await access(backupPath);
                if (backupExists) {
                    try {
                        const backupContent = await readFile(backupPath, 'utf-8');
                        const backupParsed = JSON.parse(backupContent);
                        const validBackup = mcpConfigFileSchema.parse(backupParsed);
                        console.log('Successfully loaded config from backup');
                        return validBackup;
                    } catch (backupError) {
                        console.error('Backup file is also corrupt:', backupError);
                    }
                }
            }

            // Return empty config if no valid backup exists
            console.error('Failed to parse MCP config, returning empty config:', new ErrorEx(error));
            return { mcpServers: new Map() };
        }
    }

    async writeConfig(config: MCPConfigFile): Promise<void> {
        // Check if file exists before writing
        const [, accessErr] = await access(this._configPath);
        const fileExistedBefore = !accessErr;

        // create folder
        const dir = path.dirname(this._configPath);
        const [, mkdirErr] = await mkdir(dir, { recursive: true });
        if (mkdirErr) {
            throw new McpError(`Failed to create config directory: ${mkdirErr.message}`);
        }

        // Create backup if file exists
        if (fileExistedBefore) {
            const backupPath = `${this._configPath}.backup`;
            await copyFile(this._configPath, backupPath);
        }

        // Write config - convert Maps to plain objects for JSON serialization
        // Exclude 'name' field since it's redundant (used as key)
        const serializableConfig = {
            mcpServers: Object.fromEntries(
                Array.from(config.mcpServers.entries()).map(([name, value]) => {
                    const { env, ...rest } = value;
                    return [
                        name,
                        {
                            ...rest,
                            // Convert env Map to object if present
                            env: env ? Object.fromEntries(env) : undefined,
                        },
                    ];
                }),
            ),
        };
        const content = JSON.stringify(serializableConfig, null, 2);
        const [, writeErr] = await writeFile(this._configPath, content, 'utf-8');
        if (writeErr) {
            throw new McpError(`Failed to write MCP config: ${writeErr.message}`);
        }

        // Start watching if not already watching (file was just created)
        if (!this._abort) {
            // Start watching but emit the event now since we just wrote the file
            this._startWatching(false);
            this.emit('config:changed');
        }
        // If watcher is already running, it will detect the change and emit the event
    }

    // ============================================================================
    // Server Config Creation & Validation
    // ============================================================================

    static create(
        name: string,
        transport: MCPTransport,
        commandOrUrl: string,
        args?: string[],
        env?: MCPEnv,
        enabled = true,
    ): MCPServerConfig {
        if (transport === 'stdio') {
            const config: MCPServerConfig = { name, transport, command: commandOrUrl, args: args ?? [], enabled };
            if (env) config.env = env;
            return config;
        }
        if (transport === 'http' || transport === 'sse') {
            const config: MCPServerConfig = { name, transport, url: commandOrUrl, enabled };
            if (env) config.env = env;
            return config;
        }
        throw new McpError(`Unsupported transport type: ${transport}`);
    }

    async getAllServers(): Promise<MCPServerConfig[]> {
        const config = await this.readConfig();
        return Array.from(config.mcpServers.values());
    }

    async getServer(name: string): Promise<MCPServerConfig | undefined> {
        const config = await this.readConfig();
        return config.mcpServers.get(name);
    }

    async upsertServer(serverConfig: MCPServerConfig): Promise<void> {
        this.isValidConfig(serverConfig);
        const config = await this.readConfig();
        config.mcpServers.set(serverConfig.name, serverConfig);
        await this.writeConfig(config);
        // writeConfig already handles event emission
    }

    async removeServer(name: string): Promise<boolean> {
        const config = await this.readConfig();
        if (!config.mcpServers.has(name)) {
            return false;
        }

        config.mcpServers.delete(name);
        await this.writeConfig(config);
        // writeConfig already handles event emission
        return true;
    }

    async serverExists(name: string): Promise<boolean> {
        const server = await this.getServer(name);
        return server !== undefined;
    }

    async getEnabled(): Promise<MCPServerConfig[]> {
        const servers = await this.getAllServers();
        return servers.filter((s) => s.enabled !== false);
    }

    async enable(name: string, enabled: boolean): Promise<void> {
        const config = await this.readConfig();
        const server = config.mcpServers.get(name);
        if (!server) {
            throw new McpError(`Server "${name}" not found`);
        }

        server.enabled = enabled;
        await this.writeConfig(config);
        // writeConfig already handles event emission
    }

    /**
     * Start watching the config file for external changes.
     * Required for cluster environments where other workers might modify the config.
     *
     * @private - automatically called from constructor
     */
    /**
     * Start watching the config file for external changes.
     * Required for cluster environments where other workers might modify the config.
     *
     * @param emit - If true, emits a config:changed event immediately after starting the watcher.
     * @private - automatically called from constructor
     */
    private _startWatching(emit = false): void {
        if (this._abort) return;

        // Only try to watch if the file exists
        access(this._configPath)
            .then((exists) => {
                if (!exists) {
                    // File doesn't exist yet, don't watch
                    return;
                }

                // Watch for file changes using async iterator
                try {
                    const ac = new AbortController();
                    const { signal } = ac;
                    const watcher = watch(this._configPath, { persistent: true, signal });

                    (async () => {
                        try {
                            for await (const _event of watcher) {
                                this.emit('config:changed');
                            }
                        } catch (error) {
                            console.info('Config file watcher:', error);
                            if (Object(error).name === 'AbortError') return;
                            throw new ErrorEx(error);
                        }
                    })();

                    this._abort = ac;
                    atExit(this._stopWatching.bind(this));
                    if (emit) this.emit('config:changed');
                } catch (_error) {
                    // Watch not supported or other error
                    console.warn('Failed to start config file watcher:', new ErrorEx(_error));
                    this._abort = undefined;
                }
            })
            .catch(() => {
                // File doesn't exist or can't be accessed
                // Silently ignore and don't start watcher
            });
    }

    /**
     * Stop watching the config file
     * @private - called via atExit
     */
    private _stopWatching(): void {
        if (this._abort) {
            this._abort.abort();
            this._abort = undefined;
        }
    }

    /**
     * Clean up resources (stop file watcher)
     * Call this when done with the manager to allow process to exit
     */
    public cleanup(): void {
        this._stopWatching();
    }
}

// ============================================================================
// Global Instance (Lazy Singleton Pattern)
// ============================================================================

let _globalManager: MCPConfigManager | undefined;

/**
 * Get or create the global MCPConfigManager instance
 *
 * @param configPath - Optional custom config file path (uses MCP_CONFIG_FILE env var or default if not provided)
 * @param watch - Enable file watching for config changes (default: true)
 *                Set to false for short-running CLI commands to allow process to exit cleanly
 *                Set to true for long-running processes (e.g., MCP serve) that need to react to config changes
 *
 * @example
 * // For long-running server that needs to react to config changes
 * const manager = getManager(undefined, true);
 *
 * @example
 * // For short-running CLI commands (add, list, get, etc.)
 * const manager = getManager(undefined, false);
 *
 * @returns The global MCPConfigManager singleton instance
 */
export function getManager(configPath?: string, watch = true): MCPConfigManager {
    if (!_globalManager) {
        _globalManager = new MCPConfigManager(configPath, watch);
    }
    return _globalManager;
}
