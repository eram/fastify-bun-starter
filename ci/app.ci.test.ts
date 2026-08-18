// ci/app.ci.test.ts
// Integration tests for the app CLI using bun:test

import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';

/**
 * Helper function to run the app and capture output
 */
async function runApp(args = '') {
    const cmd = args ? `bun apps/cli/index.ts ${args}` : 'bun apps/cli/index.ts';

    return new Promise<string>((resolve, reject) => {
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
        expect(output).toMatch(/USAGE/);
        expect(output).toMatch(/OPTIONS/);
    });

    test('shows help with --help flag', async () => {
        const output = await runApp('--help');
        expect(output).toMatch(/USAGE/);
        expect(output).toMatch(/OPTIONS/);
    });

    test('shows error for unknown command', async () => {
        const output = await runApp('unknown');
        expect(output).toMatch(/Unknown command: unknown/);
        expect(output).toMatch(/Run with --help/);
    });
});
