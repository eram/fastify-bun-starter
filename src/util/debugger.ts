import inspector from 'node:inspector';

/**
 * Checks if the Node.js process is running under a connected debugger.
 * This is useful to determine if we should log more detailed information or disable timeouts.
 * @returns {boolean} True if the process is running under a debugger.
 */
let _attached: boolean | undefined;
export function isDebuggerAttached() {
    return (
        _attached ??
        (_attached = typeof process.debugPort === 'number' && process.debugPort !== 0 && typeof inspector.url() === 'string')
    );
}
