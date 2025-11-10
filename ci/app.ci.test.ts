// ci/app.ci.test.ts
// Integration tests for the app CLI using node:test

import { match } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, test } from 'node:test';

/**
 * Helper function to run the app and capture output
 */
async function runApp(args = ''): Promise<string> {
    const cmd = args ? `bun src/cli/index.ts ${args}` : 'bun src/cli/index.ts';

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
        match(output, /mcp/);
    });

    test('shows help with --help flag', async () => {
        const output = await runApp('--help');
        match(output, /USAGE/);
        match(output, /COMMANDS/);
        match(output, /mcp/);
    });

    test('shows error for unknown command', async () => {
        const output = await runApp('unknown');
        match(output, /Unknown command: unknown/);
        match(output, /Run with --help/);
    });
});
