/**
 * Integration tests for MCP CLI commands
 * Tests the CLI interface for managing MCP server configurations
 */

import { strict as assert } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';

// Test config path
const TEST_CONFIG_PATH = path.resolve(process.cwd(), 'var', '.mcp.cli-test.json');

/**
 * Helper to run CLI command and capture output
 */
function runCLI(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn('bun', ['src/cli.ts', 'mcp', ...args], {
            env: {
                ...process.env,
                MCP_CONFIG_FILE: TEST_CONFIG_PATH,
            },
            stdio: 'pipe',
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({ code: code ?? 0, stdout, stderr });
        });
    });
}

describe('MCP CLI Integration Tests', () => {
    before(() => {
        // Ensure var directory exists
        const varDir = path.dirname(TEST_CONFIG_PATH);
        if (!fs.existsSync(varDir)) {
            fs.mkdirSync(varDir, { recursive: true });
        }

        // Clean up any existing test config
        if (fs.existsSync(TEST_CONFIG_PATH)) {
            fs.unlinkSync(TEST_CONFIG_PATH);
        }
    });

    after(() => {
        // Clean up test files
        if (fs.existsSync(TEST_CONFIG_PATH)) {
            fs.unlinkSync(TEST_CONFIG_PATH);
        }
        const backupPath = `${TEST_CONFIG_PATH}.backup`;
        if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
        }
    });

    test('mcp --help shows help message', async () => {
        const { code, stdout } = await runCLI(['--help']);
        assert.equal(code, 0);
        assert.ok(stdout.includes('Usage:'));
        assert.ok(stdout.includes('Commands:'));
        assert.ok(stdout.includes('serve'));
        assert.ok(stdout.includes('add'));
        assert.ok(stdout.includes('remove'));
        assert.ok(stdout.includes('list'));
        assert.ok(stdout.includes('get'));
    });

    test('mcp list shows empty list initially', async () => {
        const { code, stdout } = await runCLI(['list']);
        assert.equal(code, 0);
        assert.ok(stdout.includes('No MCP servers configured'));
    });

    test('mcp add creates stdio server', async () => {
        const { code, stdout } = await runCLI(['add', '--transport', 'stdio', 'test-stdio', 'npx', '-y', 'test-server']);

        assert.equal(code, 0);
        assert.ok(stdout.includes('Added MCP server'));
        assert.ok(stdout.includes('test-stdio'));
    });

    test('mcp add creates HTTP server', async () => {
        const { code, stdout } = await runCLI(['add', '--transport', 'http', 'test-http', 'https://example.com/mcp']);

        assert.equal(code, 0);
        assert.ok(stdout.includes('Added MCP server'));
        assert.ok(stdout.includes('test-http'));
    });

    test('mcp add creates SSE server', async () => {
        const { code, stdout } = await runCLI(['add', '--transport', 'sse', 'test-sse', 'https://example.com/sse']);

        assert.equal(code, 0);
        assert.ok(stdout.includes('Added MCP server'));
        assert.ok(stdout.includes('test-sse'));
    });

    test('mcp list shows all servers', async () => {
        const { code, stdout } = await runCLI(['list']);
        assert.equal(code, 0);
        assert.ok(stdout.includes('test-stdio'));
        assert.ok(stdout.includes('test-http'));
        assert.ok(stdout.includes('test-sse'));
    });

    test('mcp get shows server details', async () => {
        const { code, stdout } = await runCLI(['get', 'test-stdio']);
        assert.equal(code, 0);
        assert.ok(stdout.includes('test-stdio'));
        assert.ok(stdout.includes('stdio'));
    });

    test('mcp remove deletes server with --force', async () => {
        const { code, stdout } = await runCLI(['remove', 'test-http', '--force']);
        assert.equal(code, 0);
        assert.ok(stdout.includes('Removed MCP server'));
    });

    test('Config file persists between commands', async () => {
        // Add server
        await runCLI(['add', '--transport', 'stdio', 'persist-test', 'node', 'test.js']);

        // Verify it exists in a new command
        const { stdout } = await runCLI(['get', 'persist-test']);
        assert.ok(stdout.includes('persist-test'));
    });

    test('Unknown command shows error', async () => {
        const { code, stderr } = await runCLI(['unknown-command']);
        assert.equal(code, 1);
        assert.ok(stderr.includes('Unknown subcommand'));
    });
});
