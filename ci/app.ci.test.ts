// ci/app.ci.test.ts
// Integration tests for the app CLI using node:test

import { describe, test } from 'node:test';
import { match } from 'node:assert/strict';
import { spawn } from 'node:child_process';

/**
 * Helper function to run the app and capture output
 */
async function runApp(args = ''): Promise<string> {
    const cmd = args ? `bun run src/app.ts ${args}` : 'bun run src/app.ts';

    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, { shell: true });
        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', () => {
            resolve(stdout + stderr);
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

describe('CLI Integration Tests', () => {
    test('shows help when no command provided', async () => {
        const output = await runApp();
        match(output, /USAGE/);
        match(output, /COMMANDS/);
        match(output, /test/);
    });

    test('shows help for test command', async () => {
        const output = await runApp('test --help');
        match(output, /Test command to verify Deepkit type system/);
        match(output, /name/);
        match(output, /count/);
        match(output, /--verbose/);
        match(output, /default=World/);
        match(output, /default=1/);
    });

    test('runs with default parameters', async () => {
        const output = await runApp('test');
        match(output, /Deepkit Type System Test/);
        match(output, /Hello World!/);
        match(output, /Count: 1/);
        match(output, /Type compiler is working/);
        match(output, /Decorators are working/);
        match(output, /Dependency injection is working/);
    });

    test('accepts custom parameters', async () => {
        const output = await runApp('test "TestUser" 5');
        match(output, /Hello TestUser!/);
        match(output, /Count: 5/);
    });

    test('supports verbose flag', async () => {
        const output = await runApp('test "TestUser" 3 --verbose');
        match(output, /Verbose mode: true/);
        match(output, /User object with Deepkit types/);
        match(output, /John Doe/);
    });

    test('validates minimum string length', async () => {
        const output = await runApp('test "AB" 1');
        match(output, /Min length is 3/);
    });
});
