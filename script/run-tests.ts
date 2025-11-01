#!/usr/bin/env bun
//
// script is called by 'bun run test' command
// Usage examples:
//    bun run script/run-tests.ts                - runs all tests with quiet output (only errors and summary)
//    bun run script/run-tests.ts --verbose      - runs all tests with full verbose output
//    bun run script/run-tests.ts src/util       - runs specific test files with verbose output
//

import { spawn } from 'node:child_process';

// Parse command line arguments
// If we have specific test files (non-default pattern) or --verbose flag, turn on verbose
const args = process.argv.slice(2);
const filteredArgs = args.filter((arg) => arg !== '--verbose' && arg !== '-v');
const hasVerboseFlag = args.length > filteredArgs.length;
const hasSpecificFiles = filteredArgs.length > 0;
let verbose = hasVerboseFlag || hasSpecificFiles;

// State tracking for filtering
let buffer = '';

// Strip ANSI codes for filtering logic
const stripAnsi = (str: string): string => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use control characters
    return str.replace(/\u001b\[\d*m/g, '');
};

// Determine if a line should be shown in quiet mode
const shouldShow = (line: string): boolean => {
    if (!line.trim()) return false;

    // Always output the summary report till the end
    if (!verbose && /^\s*\d+\s+(pass|fail|skip)/.test(line)) {
        verbose = true; // Once summary starts, show everything
    }

    if (verbose) return true;

    const clean = stripAnsi(line);

    // Show errors and failures
    if (
        clean.includes('✗') ||
        clean.includes('(fail)') ||
        clean.includes('Error:') ||
        clean.includes('AssertionError') ||
        clean.includes('Expected') ||
        clean.includes('Timed out') ||
        clean.includes('error TS')
    ) {
        return true;
    }

    // Show coverage summary line
    if (clean.includes('Coverage meets threshold') || clean.includes('Coverage below threshold')) {
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
        if (shouldShow(line)) {
            stream.write(`${line}\n`);
        }
    }
};

// Flush remaining buffer
const flushBuffer = (stream: NodeJS.WriteStream): void => {
    if (buffer && shouldShow(buffer)) {
        stream.write(`${buffer}\n`);
    }
};

// Build test arguments
const testArgs = ['--coverage', '--coverage-reporter=lcov', ...(filteredArgs.length > 0 ? filteredArgs : ['src'])];

// Run bun test
async function runTests(): Promise<number> {
    return new Promise((resolve) => {
        const cmd = `bun test ${testArgs.join(' ')}`;
        if (!verbose) {
            console.log(`\x1b[2m${cmd}\x1b[0m\n`);
        } else {
            console.log(cmd);
        }

        const proc = spawn('bun', ['test', ...testArgs], {
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: true,
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
            resolve(1);
        });
    });
}

// Run tests and exit with the same code
runTests().then((code) => {
    process.exit(code);
});
