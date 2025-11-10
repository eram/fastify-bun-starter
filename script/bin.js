#!/usr/bin/env node
/**
 * Universal CLI entry point - detects runtime and executes appropriately
 * Supports both Node.js (via tsx) and Bun runtimes
 * Note: npx and bunx override the shebang with their respective runtimes
 */

// Detect if running under Bun
const isBun = typeof Bun !== 'undefined';

if (isBun) {
    // Running under Bun - directly import and execute TypeScript
    await import('../src/cli/index.ts');
} else {
    // Running under Node.js - use tsx to execute TypeScript
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const cliPath = path.resolve(__dirname, '../src/cli/index.ts');

    // Spawn tsx process with same arguments
    const child = spawn('npx', ['--yes', 'tsx', cliPath, ...process.argv.slice(2)], {
        stdio: 'inherit',
        shell: true,
    });

    child.on('exit', (code) => {
        process.exit(code || 0);
    });

    child.on('error', (err) => {
        console.error('Failed to execute CLI:', err);
        process.exit(1);
    });
}
