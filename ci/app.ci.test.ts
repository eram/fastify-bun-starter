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
		match(output, /server/);
	});

	test('shows help with --help flag', async () => {
		const output = await runApp('--help');
		match(output, /USAGE/);
		match(output, /COMMANDS/);
		match(output, /test \[name\] \[count\]/);
		match(output, /server/);
		match(output, /--verbose/);
	});

	test('runs test command with default parameters', async () => {
		const output = await runApp('test');
		match(output, /Fastify Type System Test/);
		match(output, /Hello World!/);
		match(output, /Count: 1/);
		match(output, /Type compiler is working/);
		match(output, /JSON Validator validation is working/);
		match(output, /CLI is working/);
	});

	test('accepts custom parameters for test command', async () => {
		const output = await runApp('test "TestUser" 5');
		match(output, /Hello TestUser!/);
		match(output, /Count: 5/);
	});

	test('supports verbose flag', async () => {
		const output = await runApp('test "TestUser" 3 --verbose');
		match(output, /Verbose mode: true/);
		match(output, /User object with JSON Validator types/);
		match(output, /John Doe/);
		match(output, /john@example.com/);
	});

	test('validates minimum string length', async () => {
		const output = await runApp('test "AB" 1');
		match(output, /Error: name must have at least 3 characters/);
		match(output, /Min length is 3/);
	});

	test('validates positive count', async () => {
		const output = await runApp('test "Test" 0');
		match(output, /Error: count must be positive/);
	});

	test('shows error for unknown command', async () => {
		const output = await runApp('unknown');
		match(output, /Unknown command: unknown/);
		match(output, /Run with --help/);
	});
});