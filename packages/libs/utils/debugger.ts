/**
 * Checks if the Node.js process is running under a connected debugger.
 * This is useful to determine if we should log more detailed information or disable timeouts.
 * Browser-safe: returns false in browser environments.
 * @returns {boolean} True if the process is running under a debugger.
 */
let _attached: boolean | undefined;
export function isDebugging(force = false) {
    try {
        if (!force && _attached !== undefined) {
            return _attached;
        }

        // Browser environment - no debugging detection
        if (typeof process === 'undefined' || process.debugPort === 0) {
            return (_attached = false);
        }

        // Node.js environment - check if debugger is attached
        // Dynamic import to avoid bundler issues
        const inspector = require('node:inspector');
        return (_attached =
            typeof process.debugPort === 'number' && process.debugPort !== 0 && typeof inspector.url() === 'string');
    } catch (_e) {
        return (_attached = false);
    }
}
