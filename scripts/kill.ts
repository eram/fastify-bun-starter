#!/usr/bin/env bun

/**
 * Cross-platform script to kill processes
 * Usage: bun script/kill.ts [process_name]
 */

import { execSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
// Get process name from args or default to 'bun'
const target = process.argv[2] || 'bun';

// On Windows, ensure .exe extension for taskkill if not present
const processName = isWindows && !target.endsWith('.exe') ? `${target}.exe` : target;

console.log(`Killing process: ${processName}...`);

try {
    const command = isWindows ? `taskkill /F /IM ${processName}` : `pkill -f ${processName}`;

    execSync(command, { stdio: 'inherit' });
} catch (_error) {
    // Ignore errors if no process was found
    console.log(`No process found matching "${processName}" or failed to kill.`);
}
