#!/usr/bin/env bun
//
// script is called by 'bun run test' command
// Usage examples:
//    bun run script/run-tests.ts                     - runs all tests with quiet output (only errors and summary)
//    bun run script/run-tests.ts --verbose           - runs all tests with full verbose output
//    bun run script/run-tests.ts --port 4000         - runs all tests on port 4000 (default: 13582)
//    bun run script/run-tests.ts src/util            - runs specific test files with verbose output
//

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

// Parse command line arguments using node:util.parseArgs
const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
        verbose: {
            type: 'boolean',
            short: 'v',
            default: false,
        },
        port: {
            type: 'string',
            short: 'p',
            default: '5000',
        },
    },
    allowPositionals: true,
});

const hasSpecificFiles = positionals.length > 0;
const filesToTest = positionals.length > 0 ? positionals : ['src'];
let verbose = values.verbose || hasSpecificFiles;
let buffer = '';
const start = Date.now();

// Determine if a line should be shown in quiet mode
const shouldShow = (line: string, stream: NodeJS.WriteStream): boolean => {
    if (!line?.trim()) return false;

    // // Once summary starts, show everything
    if (!verbose && /^\s*\d+\s+(pass|fail|skip)/.test(line)) {
        stream.write(`\n`);
        verbose = true;
    }

    if (verbose) return true;

    // Show errors and failures
    if (
        line.includes('✗') ||
        line.includes('(fail)') ||
        line.includes('Error:') ||
        line.includes('Assertion') ||
        line.includes('Expected') ||
        line.includes('Timed out') ||
        line.includes('error TS') ||
        // Show coverage summary line
        line.includes('Coverage meets threshold') ||
        line.includes('Coverage below threshold')
    ) {
        return true;
    }

    // Hide everything else in quiet mode
    return false;
};

// Process output line by line
const processOutput = (data: string, stream: NodeJS.WriteStream): void => {
    buffer += data;
    const lines = buffer.split('\n');

    // Keep the last incomplete line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
        if (shouldShow(line, stream)) {
            // Always reset ANSI codes after each line to prevent color bleeding
            stream.write(`${line}\x1b[0m\n`);
        } else {
            stream.write(`${Math.round((Date.now() - start) / 100) / 10}  \r`);
        }
    }
};

// Flush remaining buffer
const flushBuffer = (stream: NodeJS.WriteStream): void => {
    if (shouldShow(buffer, stream)) {
        stream.write(`${buffer}\x1b[0m\n`);
    }
};

// Run tests
async function runTests() {
    // Clean up coverage folder
    const coveragePath = join(process.cwd(), 'coverage');
    if (existsSync(coveragePath)) {
        rmSync(coveragePath, { recursive: true, force: true });
    }

    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const args = ['--coverage', '--coverage-reporter=lcov', ...filesToTest];
    const cmd = `bun test ${args.join(' ')}`;
    if (!verbose) {
        console.log(`\x1b[2m${cmd}\x1b[0m\n`);
    } else {
        console.log(cmd);
    }

    const proc = spawn('bun', ['test', ...args], {
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: true,
        env: { ...process.env, LOG_FORMAT: 'line', PORT: values.port, NODE_TEST_CONTEXT: 'true', AT_TERMINATE_TIMEOUT: '10000' },
    });

    // Process stdout
    proc.stdout?.on('data', (data) => {
        processOutput(data.toString(), process.stdout);
    });

    // Process stderr (errors go here)
    proc.stderr?.on('data', (data) => {
        processOutput(data.toString(), process.stderr);
    });

    proc.on('close', (code) => {
        flushBuffer(process.stdout);
        flushBuffer(process.stderr);
        resolve(code || 0);
    });

    proc.on('error', (err) => {
        console.error('\x1b[31mFailed to start test runner:\x1b[0m', err);
        reject(err);
    });

    return promise;
}

// Run tests and exit with the same code
runTests()
    .then((code) => {
        process.exit(code);
    })
    .catch((_err) => {
        process.exit(1);
    });
