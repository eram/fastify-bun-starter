#!/usr/bin/env bun
/**
 * Test orchestrator - runs as preload hook in bunfig.toml
 *
 * Responsibilities:
 * - Run lint (optional: --lint or --lint-fix)
 * - Run tsc (optional: --tsc)
 * - Spawn coverage monitor in background
 * - Clean up old coverage data
 *
 * Environment variables:
 * - BUN_TEST_ORCHESTRATED: Set to 'true' to prevent recursion
 * - TEST_MODE: 'verbose' | 'ci' | undefined
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Prevent recursion: exit early if already orchestrated
if (process.env['BUN_TEST_ORCHESTRATED'] === 'true') {
    process.exit(0);
}

// Mark as orchestrated to prevent infinite loops
process.env['BUN_TEST_ORCHESTRATED'] = 'true';

// Detect mode from environment
const isVerbose = process.env['TEST_MODE'] === 'verbose';
const isCi = process.env['TEST_MODE'] === 'ci';
const isWatch = process.argv.includes('--watch');

// Skip orchestration in watch mode (fast iteration)
if (isWatch) {
    process.exit(0);
}

// Determine which steps to run based on mode
const shouldRunTsc = isVerbose;
const shouldRunLint = !isCi;
const shouldRunCoverage = !isCi;
const lintMode = isVerbose ? 'lint' : 'lint:fix'; // verbose = check only, default = auto-fix

const stdio = isVerbose ? 'inherit' : 'ignore';

// Step 1: Run TypeScript compiler (verbose mode only)
if (shouldRunTsc) {
    console.log('\x1b[2mRunning TypeScript compiler...\x1b[0m');
    const tscResult = spawnSync('tsc', [], {
        stdio: isVerbose ? 'inherit' : 'pipe',
        shell: true,
        timeout: 30000,
    });

    if (tscResult.status !== 0) {
        console.error('\x1b[31m✗ TypeScript compilation failed\x1b[0m');
        if (!isVerbose && tscResult.stdout) {
            console.error(tscResult.stdout.toString());
        }
        if (!isVerbose && tscResult.stderr) {
            console.error(tscResult.stderr.toString());
        }
        process.exit(1);
    }
}

// Step 2: Run linter (unless CI mode)
if (shouldRunLint) {
    if (!isVerbose) {
        console.log('\x1b[2mRunning linter...\x1b[0m');
    }

    const lintResult = spawnSync('bun', ['run', lintMode], {
        stdio,
        shell: true,
        timeout: 30000,
    });

    if (lintResult.status !== 0) {
        console.error('\x1b[31m✗ Linting failed\x1b[0m');
        process.exit(1);
    }
}

// Step 3: Clean up old coverage data
if (shouldRunCoverage) {
    const coveragePath = join(process.cwd(), 'coverage');
    if (existsSync(coveragePath)) {
        rmSync(coveragePath, { recursive: true, force: true });
    }
}

// Step 4: Spawn coverage monitor in background (detached process)
if (shouldRunCoverage) {
    const coverageMonitor = spawn('bun', ['script/coverage-report.ts', '--watch'], {
        stdio: 'inherit',
        detached: true,
        shell: true,
        env: {
            ...process.env,
            // Pass mode to coverage reporter if needed
            TEST_MODE: process.env['TEST_MODE'],
        },
    });

    // Detach so it runs independently
    coverageMonitor.unref();
}

// Exit cleanly - tests will now run
process.exit(0);
