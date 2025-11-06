/**
 * Tests for MCP Configuration Manager
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { MCPConfigManager } from './manager';
import { DEFAULT_MCP_CONFIG } from './types';

const testConfigDir = path.resolve(__dirname, '../../var/test');

// Ensure test directory exists
mkdirSync(testConfigDir, { recursive: true });

// Create a helper to get unique test config path
function getTestConfigPath(testName: string): string {
    const safeName = testName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    return path.join(testConfigDir, `test-mcp-${safeName}.json`);
}

// Helper function to run a test with an isolated manager
async function withManager<T>(testName: string, fn: (manager: MCPConfigManager) => Promise<T>): Promise<T> {
    const testPath = getTestConfigPath(testName);

    // Clean up any existing files
    if (existsSync(testPath)) unlinkSync(testPath);
    if (existsSync(`${testPath}.backup`)) unlinkSync(`${testPath}.backup`);

    const manager = new MCPConfigManager(testPath);

    try {
        return await fn(manager);
    } finally {
        // Cleanup test files
        if (existsSync(testPath)) unlinkSync(testPath);
        if (existsSync(`${testPath}.backup`)) unlinkSync(`${testPath}.backup`);
    }
}

describe('readConfig', () => {
    test('creates default config if file does not exist', async (t) => {
        await withManager(t.name, async (manager) => {
            const config = await manager.readConfig();
            deepStrictEqual(config, DEFAULT_MCP_CONFIG);
        });
    });

    test('reads existing config file', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('test-server', 'stdio', 'node', ['server.js']);
            await manager.upsertServer(serverConfig);

            const config = await manager.readConfig();
            ok(config.mcpServers.has('test-server'));
            const server = config.mcpServers.get('test-server');
            ok(server);
            strictEqual(server.transport, 'stdio');
            if (server.transport === 'stdio') {
                strictEqual(server.command, 'node');
            }
        });
    });

    test('returns default config on invalid JSON', async (t) => {
        await withManager(t.name, async (manager) => {
            const testPath = getTestConfigPath(t.name);
            mkdirSync(path.dirname(testPath), { recursive: true });
            const fs = await import('node:fs/promises');
            await fs.writeFile(testPath, 'invalid json', 'utf8');

            const config = await manager.readConfig();
            deepStrictEqual(config, DEFAULT_MCP_CONFIG);
        });
    });

    test('returns default config on invalid schema', async (t) => {
        await withManager(t.name, async (manager) => {
            const testPath = getTestConfigPath(t.name);
            const invalidConfig = { invalid: 'structure' };
            const fs = await import('node:fs/promises');
            await fs.writeFile(testPath, JSON.stringify(invalidConfig), 'utf8');

            const config = await manager.readConfig();
            deepStrictEqual(config, DEFAULT_MCP_CONFIG);
        });
    });
});

describe('writeConfig', () => {
    test('writes config to file', async (t) => {
        await withManager(t.name, async (manager) => {
            const testPath = getTestConfigPath(t.name);
            const serverConfig = MCPConfigManager.create('write-test', 'sse', 'http://example.com/sse');
            await manager.upsertServer(serverConfig);

            ok(existsSync(testPath));

            const config = await manager.readConfig();
            ok(config.mcpServers.has('write-test'));
            const server = config.mcpServers.get('write-test');
            ok(server);
            strictEqual(server.transport, 'sse');
            if (server.transport === 'sse') {
                strictEqual(server.url, 'http://example.com/sse');
            }
        });
    });

    test('creates backup when overwriting', async (t) => {
        await withManager(t.name, async (manager) => {
            const testPath = getTestConfigPath(t.name);
            const server1 = MCPConfigManager.create('server1', 'stdio', 'node');
            await manager.upsertServer(server1);

            const server2 = MCPConfigManager.create('server2', 'stdio', 'bun');
            await manager.upsertServer(server2);

            ok(existsSync(`${testPath}.backup`));

            // Verify backup contains old config (server1 only)
            const backupManager = new MCPConfigManager(`${testPath}.backup`);
            const backupConfig = await backupManager.readConfig();
            ok(backupConfig.mcpServers.has('server1'));
            ok(!backupConfig.mcpServers.has('server2'));

            // Verify current contains both servers
            const currentConfig = await manager.readConfig();
            ok(currentConfig.mcpServers.has('server1'));
            ok(currentConfig.mcpServers.has('server2'));
        });
    });
});

describe('createServerConfig', () => {
    test('creates stdio server config', async (t) => {
        await withManager(t.name, async (_manager) => {
            const config = MCPConfigManager.create('test', 'stdio', 'node', ['server.js']);
            deepStrictEqual(config, {
                name: 'test',
                transport: 'stdio',
                command: 'node',
                args: ['server.js'],
                enabled: true,
            });
        });
    });

    test('creates sse server config', async (t) => {
        await withManager(t.name, async (_manager) => {
            const config = MCPConfigManager.create('test', 'sse', 'http://example.com');
            deepStrictEqual(config, {
                name: 'test',
                transport: 'sse',
                url: 'http://example.com',
                enabled: true,
            });
        });
    });

    test('creates http server config', async (t) => {
        await withManager(t.name, async (_manager) => {
            const config = MCPConfigManager.create('test', 'http', 'http://example.com');
            deepStrictEqual(config, {
                name: 'test',
                transport: 'http',
                url: 'http://example.com',
                enabled: true,
            });
        });
    });

    test('includes environment variables', async (t) => {
        await withManager(t.name, async (_manager) => {
            const env = new Map([['API_KEY', 'secret']]);
            const config = MCPConfigManager.create('test', 'stdio', 'node', [], env);
            deepStrictEqual(config.env, env);
        });
    });

    test('respects enabled flag', async (t) => {
        await withManager(t.name, async (_manager) => {
            const config = MCPConfigManager.create('test', 'stdio', 'node', [], undefined, false);
            strictEqual(config.enabled, false);
        });
    });
});

describe('isValidConfig', () => {
    test('validates correct stdio config', async (t) => {
        await withManager(t.name, async (manager) => {
            const config = MCPConfigManager.create('test', 'stdio', 'node');
            ok(manager.isValidConfig(config));
        });
    });

    test('validates correct sse config', async (t) => {
        await withManager(t.name, async (manager) => {
            const config = MCPConfigManager.create('test', 'sse', 'http://example.com');
            ok(manager.isValidConfig(config));
        });
    });

    test('rejects invalid config', async (t) => {
        await withManager(t.name, async (manager) => {
            ok(!manager.isValidConfig({ invalid: 'config' }));
        });
    });

    test('rejects missing required fields', async (t) => {
        await withManager(t.name, async (manager) => {
            ok(!manager.isValidConfig({ name: 'test' }));
        });
    });
});

describe('CRUD operations', () => {
    test('getAllServers returns empty array for default config', async (t) => {
        await withManager(t.name, async (manager) => {
            const servers = await manager.getAllServers();
            deepStrictEqual(servers, []);
        });
    });

    test('upsertServer adds new server', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('new-server', 'stdio', 'node', ['test.js']);
            await manager.upsertServer(serverConfig);

            const servers = await manager.getAllServers();
            strictEqual(servers.length, 1);
            deepStrictEqual(servers[0], serverConfig);
        });
    });

    test('upsertServer updates existing server', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig1 = MCPConfigManager.create('server', 'stdio', 'node');
            await manager.upsertServer(serverConfig1);

            const serverConfig2 = MCPConfigManager.create('server', 'stdio', 'bun');
            await manager.upsertServer(serverConfig2);

            const servers = await manager.getAllServers();
            strictEqual(servers.length, 1);
            if (servers[0].transport === 'stdio') {
                strictEqual(servers[0].command, 'bun');
            }
        });
    });

    test('getServer returns undefined for non-existent server', async (t) => {
        await withManager(t.name, async (manager) => {
            const server = await manager.getServer('non-existent');
            strictEqual(server, undefined);
        });
    });

    test('getServer returns server config', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('test-server', 'stdio', 'node');
            await manager.upsertServer(serverConfig);

            const server = await manager.getServer('test-server');
            deepStrictEqual(server, serverConfig);
        });
    });

    test('removeServer removes existing server', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('to-remove', 'stdio', 'node');
            await manager.upsertServer(serverConfig);

            const removed = await manager.removeServer('to-remove');
            ok(removed);

            const servers = await manager.getAllServers();
            strictEqual(servers.length, 0);
        });
    });

    test('removeServer returns false for non-existent server', async (t) => {
        await withManager(t.name, async (manager) => {
            const removed = await manager.removeServer('non-existent');
            strictEqual(removed, false);
        });
    });

    test('serverExists returns true for existing server', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('exists', 'stdio', 'node');
            await manager.upsertServer(serverConfig);

            const exists = await manager.serverExists('exists');
            ok(exists);
        });
    });

    test('serverExists returns false for non-existent server', async (t) => {
        await withManager(t.name, async (manager) => {
            const exists = await manager.serverExists('non-existent');
            strictEqual(exists, false);
        });
    });
});

describe('enabled/disabled servers', () => {
    test('getEnabledServers returns only enabled servers', async (t) => {
        await withManager(t.name, async (manager) => {
            const enabled1 = MCPConfigManager.create('enabled1', 'stdio', 'node', [], undefined, true);
            const enabled2 = MCPConfigManager.create('enabled2', 'stdio', 'bun', [], undefined, true);
            const disabled = MCPConfigManager.create('disabled', 'stdio', 'deno', [], undefined, false);

            await manager.upsertServer(enabled1);
            await manager.upsertServer(enabled2);
            await manager.upsertServer(disabled);

            const enabledServers = await manager.getEnabled();
            strictEqual(enabledServers.length, 2);
            ok(enabledServers.every((s) => s.enabled !== false));
        });
    });

    test('setServerEnabled enables server', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('test', 'stdio', 'node', [], undefined, false);
            await manager.upsertServer(serverConfig);

            await manager.enable('test', true);

            const server = await manager.getServer('test');
            strictEqual(server?.enabled, true);
        });
    });

    test('setServerEnabled disables server', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('test', 'stdio', 'node', [], undefined, true);
            await manager.upsertServer(serverConfig);

            await manager.enable('test', false);

            const server = await manager.getServer('test');
            strictEqual(server?.enabled, false);
        });
    });

    test('setServerEnabled throws for non-existent server', async (t) => {
        await withManager(t.name, async (manager) => {
            let error: Error | undefined;
            try {
                await manager.enable('non-existent', true);
            } catch (err) {
                error = err as Error;
            }
            ok(error);
            ok(error?.message.includes('not found'));
        });
    });
});

describe('multiple servers', () => {
    test('handles multiple servers correctly', async (t) => {
        await withManager(t.name, async (manager) => {
            const servers = [
                MCPConfigManager.create('server1', 'stdio', 'node'),
                MCPConfigManager.create('server2', 'sse', 'http://example.com'),
                MCPConfigManager.create('server3', 'http', 'http://api.example.com'),
            ];

            for (const server of servers) {
                await manager.upsertServer(server);
            }

            const allServers = await manager.getAllServers();
            strictEqual(allServers.length, 3);
        });
    });

    test('maintains server order across operations', async (t) => {
        await withManager(t.name, async (manager) => {
            const server1 = MCPConfigManager.create('a-server', 'stdio', 'node');
            const server2 = MCPConfigManager.create('b-server', 'stdio', 'bun');
            const server3 = MCPConfigManager.create('c-server', 'stdio', 'deno');

            await manager.upsertServer(server1);
            await manager.upsertServer(server2);
            await manager.upsertServer(server3);

            // Remove middle server
            await manager.removeServer('b-server');

            const servers = await manager.getAllServers();
            strictEqual(servers.length, 2);
            strictEqual(servers[0].name, 'a-server');
            strictEqual(servers[1].name, 'c-server');
        });
    });
});

describe('event emitter', () => {
    test('emits config:changed event on upsertServer (add)', async (t) => {
        await withManager(t.name, async (manager) => {
            // Watcher is automatically started in constructor
            let eventFired = false;

            manager.on('config:changed', () => {
                eventFired = true;
            });

            const serverConfig = MCPConfigManager.create('test', 'stdio', 'node');
            await manager.upsertServer(serverConfig);

            // Wait for file watcher to detect the change
            await new Promise((resolve) => setTimeout(resolve, 200));

            ok(eventFired);
        });
    });

    test('emits config:changed event on upsertServer (update)', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig1 = MCPConfigManager.create('test', 'stdio', 'node');
            await manager.upsertServer(serverConfig1);

            // Watcher is automatically started in constructor
            let eventFired = false;

            manager.on('config:changed', () => {
                eventFired = true;
            });

            const serverConfig2 = MCPConfigManager.create('test', 'stdio', 'bun');
            await manager.upsertServer(serverConfig2);

            // Wait for file watcher to detect the change
            await new Promise((resolve) => setTimeout(resolve, 200));

            ok(eventFired);
        });
    });

    test('emits config:changed event on removeServer', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('test', 'stdio', 'node');
            await manager.upsertServer(serverConfig);

            // Watcher is automatically started in constructor
            let eventFired = false;

            manager.on('config:changed', () => {
                eventFired = true;
            });

            await manager.removeServer('test');

            // Wait for file watcher to detect the change
            await new Promise((resolve) => setTimeout(resolve, 200));

            ok(eventFired);
        });
    });

    test('emits config:changed event on setServerEnabled', async (t) => {
        await withManager(t.name, async (manager) => {
            const serverConfig = MCPConfigManager.create('test', 'stdio', 'node', [], undefined, true);
            await manager.upsertServer(serverConfig);

            // Watcher is automatically started in constructor
            let eventFired = 0;

            manager.on('config:changed', () => {
                eventFired++;
            });

            await manager.enable('test', false);

            // Wait for file watcher to detect the change
            await new Promise((resolve) => setTimeout(resolve, 200));

            strictEqual(eventFired, 1);
        });
    });

    test('detects external file changes', async (t) => {
        await withManager(t.name, async (manager) => {
            let eventFired = 0;
            manager.on('config:changed', () => {
                eventFired++;
            });

            // Create initial server >> fire once
            const serverConfig = MCPConfigManager.create('initial', 'stdio', 'node');
            await manager.upsertServer(serverConfig);

            // Wait for first event to complete
            await new Promise((resolve) => setTimeout(resolve, 20));

            // Simulate external file change by writing directly to the file
            const fs = await import('node:fs/promises');
            const config = await manager.readConfig();
            config.mcpServers.set('external', {
                name: 'external',
                transport: 'stdio',
                command: 'external',
                args: [],
                env: new Map(),
                enabled: true,
                description: '',
            });
            const configPath = Object(manager)._configPath as string;
            await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

            // Wait for file watcher to detect the change
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Verify event was fired
            strictEqual(eventFired, 2);
        });
    });

    test('does not start file watcher when watch=false', async (t) => {
        const testPath = getTestConfigPath(t.name);

        // Clean up any existing files
        if (existsSync(testPath)) unlinkSync(testPath);
        if (existsSync(`${testPath}.backup`)) unlinkSync(`${testPath}.backup`);

        const manager = new MCPConfigManager(testPath, false);

        try {
            let eventFired = 0;
            manager.on('config:changed', () => {
                eventFired++;
            });

            // Add a server
            const serverConfig = MCPConfigManager.create('test-server', 'stdio', 'node');
            await manager.upsertServer(serverConfig);

            // Wait to ensure no events fire from file watching
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify no watch events fired (only the direct modification events count)
            // Since we're not watching, external file changes won't trigger events
            strictEqual(eventFired, 0, 'No config:changed events should fire when watch=false');

            // Verify the manager still works normally for direct operations
            const config = await manager.readConfig();
            ok(config.mcpServers.has('test-server'), 'Server should be added');
        } finally {
            // Cleanup test files
            if (existsSync(testPath)) unlinkSync(testPath);
            if (existsSync(`${testPath}.backup`)) unlinkSync(`${testPath}.backup`);
        }
    });
});
