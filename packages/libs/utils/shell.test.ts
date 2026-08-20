import { describe, expect, test } from 'bun:test';
import readline from 'node:readline';
import { blue, bold, color, errno, getErrorName, green, grey, prompt, red, system, yellow } from './shell';

describe('shell testing', () => {
    test('system positive', async () => {
        const code = await system('bun -e "console.log(process.pid)"', { throwOnError: true });
        expect(code).toBe(0);
    });

    test('system negative', async () => {
        const code = await system('test1234');
        // Accept both Windows (1) and Linux (127) exit codes for command not found
        expect(code === 1 || code === 127).toBeTruthy();
    });

    test('fail throws', async () => {
        expect(system('test1234', { throwOnError: true })).rejects.toThrow(/Failed with exit code/);
    });

    test('filter', async () => {
        // Test filtering of output
        let callCount = 0;
        const fn = (line: string, stream: { write: (data: string) => void }) => {
            callCount++;
            stream.write(line);
        };
        const code = await system('bun -e "console.log(process.pid)"', { throwOnError: true, lineTransform: fn });
        expect(code).toBe(0);
        expect(callCount).toBe(1);
    });

    test('spinner func', async () => {
        let spinnerCount = 0;
        let spinnerCallCount = 0;
        const spinner = () => {
            spinnerCallCount++;
            return '+-+|'.charAt(spinnerCount++ % 4);
        };
        const code = await system('bun -e "await new Promise(resolve => setTimeout(resolve, 500))"', { spinner });
        expect(code).toBe(0);
        expect(spinnerCallCount > 1).toBeTruthy();
    });

    test('timeout', async () => {
        const code = await system('bun -e "await new Promise(resolve => setTimeout(resolve, 1000))"', { timeout: 500 });
        expect(code).toBe(errno.ETIMEDOUT);
    });

    test('prompt positive', async () => {
        const originalCreateInterface = readline.createInterface;
        readline.createInterface = (() => ({
            question: (_q: string, cb: (v: string) => void) => cb('test'),
            close: () => undefined,
            on: () => undefined,
        })) as unknown as typeof readline.createInterface;

        const yn = await prompt('?', 'y');
        expect(yn).toBe('test');

        readline.createInterface = originalCreateInterface;
    });

    test('prompt with def value', async () => {
        const originalCreateInterface = readline.createInterface;
        readline.createInterface = (() => ({
            question: (_q: string, cb: (v: string) => void) => cb(''),
            close: () => undefined,
            on: () => undefined,
        })) as unknown as typeof readline.createInterface;

        const yn = await prompt('?', 'y');
        expect(yn).toBe('y');

        readline.createInterface = originalCreateInterface;
    });

    test('system handles child process error event', async () => {
        // This test covers the error handler (lines 112-113 in shell.ts)
        // Use timeout to prevent hanging on Windows when command doesn't exist
        await expect(system('this-command-does-not-exist-anywhere-12345', { throwOnError: true, timeout: 300 })).rejects.toThrow(
            /Failed with exit code/,
        );
    });

    test('prompt handles SIGINT rejection', async () => {
        const originalCreateInterface = readline.createInterface;
        let sigintHandler: (() => void) | undefined;

        readline.createInterface = (() => ({
            question: (_q: string, _cb: (v: string) => void) => {
                // Don't call callback, just wait for SIGINT
            },
            close: () => undefined,
            on: (event: string, handler: () => void) => {
                if (event === 'SIGINT') {
                    sigintHandler = handler;
                }
            },
        })) as unknown as typeof readline.createInterface;

        const promptPromise = prompt('?', 'y');

        // Trigger SIGINT
        setTimeout(() => {
            if (sigintHandler) {
                sigintHandler();
            }
        }, 50);

        await expect(promptPromise).rejects.toThrow();

        readline.createInterface = originalCreateInterface;
    });

    test('color shorthand functions', () => {
        // Test basic color functions
        expect(red`test`.includes('test')).toBeTruthy();
        expect(yellow`test`.includes('test')).toBeTruthy();
        expect(grey`test`.includes('test')).toBeTruthy();
        expect(green`test`.includes('test')).toBeTruthy();
        expect(blue`test`.includes('test')).toBeTruthy();
        expect(bold`test`.includes('test')).toBeTruthy();

        // Test interpolation
        const name = 'World';
        expect(red`Hello ${name}`.includes('Hello World')).toBeTruthy();
        expect(color('green', Object.assign(['Test'], { raw: ['Test'] })).includes('Test')).toBeTruthy();
    });

    test('getErrorName returns errno name', () => {
        const name = getErrorName(errno.ENOENT);
        expect(name).toBe('ENOENT');
    });

    test('getErrorName returns number for unknown errno', () => {
        const name = getErrorName(999999);
        expect(name).toBe('999999');
    });
});
