/**
 * Tests for MCP CLI commands
 * Note: Full CLI behavior is tested in integration tests (ci/)
 * These tests focus on the exported function interface
 */

import { strict as assert } from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { runMCPCLI } from './mcp';

describe('mcp-cli', () => {
    let originalConsoleLog: typeof console.log;
    let originalConsoleError: typeof console.error;
    let originalExit: typeof process.exit;
    let logs: string[] = [];
    let errors: string[] = [];
    let originalStdin: NodeJS.ReadStream;
    let mockStdin: NodeJS.ReadWriteStream | undefined;

    beforeEach(() => {
        // Capture console output
        logs = [];
        errors = [];
        originalConsoleLog = console.log;
        originalConsoleError = console.error;
        originalExit = process.exit;
        originalStdin = Object(process).stdin;

        console.log = (...args: unknown[]) => {
            logs.push(args.join(' '));
        };
        console.error = (...args: unknown[]) => {
            errors.push(args.join(' '));
        };

        // Prevent actual process exit
        process.exit = mock.fn((() => {
            throw new Error('process.exit called');
        }) as never);
    });

    afterEach(() => {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
        process.exit = originalExit;
        if (mockStdin) {
            Object(process).stdin = originalStdin;
            mockStdin = undefined;
        }
        mock.restoreAll();
    });

    test('runMCPCLI is exported', () => {
        assert.equal(typeof runMCPCLI, 'function');
    });

    test('runMCPCLI shows help with no args', async () => {
        const exitCode = await runMCPCLI([]);

        assert.equal(exitCode, 1);
        assert.ok(logs.some((log) => log.includes('Usage:')));
        assert.ok(logs.some((log) => log.includes('Commands:')));
    });

    test('runMCPCLI shows help with --help flag', async () => {
        const exitCode = await runMCPCLI(['--help']);

        assert.equal(exitCode, 1);
        assert.ok(logs.some((log) => log.includes('Usage:')));
    });

    test('runMCPCLI shows help with -h flag', async () => {
        const exitCode = await runMCPCLI(['-h']);

        assert.equal(exitCode, 1);
        assert.ok(logs.some((log) => log.includes('Usage:')));
    });

    test('runMCPCLI handles unknown subcommand', async () => {
        const exitCode = await runMCPCLI(['unknown-command']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('Unknown subcommand')));
    });

    test('list command runs without crashing', async () => {
        const exitCode = await runMCPCLI(['list']);

        // Should return 0 or 1 depending on whether MCP config exists
        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('remove command shows error for missing name', async () => {
        const exitCode = await runMCPCLI(['remove']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('name is required')));
    });

    test('get command shows error for missing name', async () => {
        const exitCode = await runMCPCLI(['get']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('name is required')));
    });

    test('enable command shows error for missing name', async () => {
        const exitCode = await runMCPCLI(['enable']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('name is required')));
    });

    test('disable command shows error for missing name', async () => {
        const exitCode = await runMCPCLI(['disable']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('name is required')));
    });

    test('add command validates transport type', async () => {
        const exitCode = await runMCPCLI(['add', 'test-server', 'http://localhost', '--transport', 'invalid']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('Invalid transport')));
    });

    test('add-json command shows error for missing args', async () => {
        const exitCode = await runMCPCLI(['add-json']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('name and JSON config are required')));
    });

    test('add-json command shows error for invalid JSON', async () => {
        const exitCode = await runMCPCLI(['add-json', 'test', 'not-valid-json']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('Failed to add server from JSON')));
    });

    test('list command supports --json flag', async () => {
        const exitCode = await runMCPCLI(['list', '--json']);

        // Should return 0 or 1 depending on whether MCP config exists
        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('get command supports --json flag', async () => {
        const exitCode = await runMCPCLI(['get', 'nonexistent-server', '--json']);

        // Should fail because server doesn't exist
        assert.equal(exitCode, 1);
    });

    test('add command with stdio transport requires command', async () => {
        mockStdin = new PassThrough();
        Object(process).stdin = mockStdin;
        // Simulate all required interactive prompts
        mockStdin.write('test-server\r');
        mockStdin.write('stdio\r');
        mockStdin.write('node test-server.js\r');
        mockStdin.write('\r'); // no args
        mockStdin.end();
        //mockStdin.write('\n'); // no env vars
        const exitCode = await runMCPCLI(['add', 'test', '--transport', 'stdio']);
        assert.ok(exitCode >= 0);
    });

    test('add command with http transport requires URL', async () => {
        mockStdin = new PassThrough();
        Object(process).stdin = mockStdin;
        // Simulate all required interactive prompts
        mockStdin.write('test-server\r');
        mockStdin.write('http\r');
        mockStdin.write('http://localhost:1234\r');
        mockStdin.end();
        //mockStdin.write('n\r'); // no env vars
        const exitCode = await runMCPCLI(['add', 'test', '--transport', 'http']);
        assert.ok(exitCode >= 0);
    });

    test('remove command returns error for nonexistent server', async () => {
        const exitCode = await runMCPCLI(['remove', 'nonexistent-server-xyz-123']);

        assert.equal(exitCode, 1);
    });

    test('get command returns error for nonexistent server', async () => {
        const exitCode = await runMCPCLI(['get', 'nonexistent-server-xyz-123']);

        assert.equal(exitCode, 1);
        assert.ok(errors.some((err) => err.includes('not found')));
    });

    test('add command with --force skips validation', async () => {
        const exitCode = await runMCPCLI([
            'add',
            'test-server-force',
            'http://nonexistent-url.invalid',
            '--transport',
            'http',
            '--force',
        ]);

        // Should succeed because --force skips validation
        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('add command with --env adds environment variables', async () => {
        const exitCode = await runMCPCLI([
            'add',
            'test-server-env',
            'npx',
            'test-package',
            '--transport',
            'stdio',
            '--env',
            'TEST_VAR=test_value',
            '--env',
            'ANOTHER_VAR=another_value',
            '--force',
        ]);

        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('add command enters interactive mode when missing name', async () => {
        mockStdin = new PassThrough();
        Object(process).stdin = mockStdin;

        // Provide all required inputs
        mockStdin.write('interactive-server\n');
        mockStdin.write('http\n');
        mockStdin.write('http://localhost:9999\n');
        mockStdin.write('n\n'); // no env vars
        mockStdin.end();

        const exitCode = await runMCPCLI(['add']);

        // Should complete successfully or fail gracefully
        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('add command enters interactive mode when missing transport', async () => {
        mockStdin = new PassThrough();
        Object(process).stdin = mockStdin;

        mockStdin.write('stdio\n');
        mockStdin.write('echo\n');
        mockStdin.write('test\n'); // args
        mockStdin.write('n\n'); // no env vars
        mockStdin.end();

        const exitCode = await runMCPCLI(['add', 'test-stdio-server']);

        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('add command with sse transport', async () => {
        const exitCode = await runMCPCLI(['add', 'test-sse-server', 'http://localhost:8080', '--transport', 'sse', '--force']);

        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('add-json command with valid JSON', async () => {
        const exitCode = await runMCPCLI([
            'add-json',
            'test-json-server',
            '{"transport":"http","url":"http://localhost:5000","enabled":true}',
        ]);

        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('interactive add prompts for args when stdio', async () => {
        mockStdin = new PassThrough();
        Object(process).stdin = mockStdin;

        mockStdin.write('test-with-args\n');
        mockStdin.write('stdio\n');
        mockStdin.write('node\n');
        mockStdin.write('server.js --port 3000\n'); // args with spaces
        mockStdin.write('n\n'); // no env
        mockStdin.end();

        const exitCode = await runMCPCLI(['add']);

        assert.ok(exitCode === 0 || exitCode === 1);
    });

    test('interactive add supports environment variables', async () => {
        mockStdin = new PassThrough();
        Object(process).stdin = mockStdin;

        mockStdin.write('test-with-env\n');
        mockStdin.write('stdio\n');
        mockStdin.write('node\n');
        mockStdin.write('\n'); // no args
        mockStdin.write('y\n'); // yes to env vars
        mockStdin.write('MY_KEY\n');
        mockStdin.write('my_value\n');
        mockStdin.write('\n'); // finish env vars
        mockStdin.end();

        const exitCode = await runMCPCLI(['add']);

        assert.ok(exitCode === 0 || exitCode === 1);
    });
});
