import { equal, ok, rejects } from 'node:assert/strict';
import readline from 'node:readline';
import { describe, test } from 'node:test';
import { blue, bold, color, errno, getErrorName, green, grey, prompt, red, system, yellow } from './shell';

describe('shell testing', () => {
    test('system positive', async () => {
        const code = await system('bun -e "console.log(process.pid)"', { throwOnError: true });
        equal(code, 0);
    });

    test('system negative', async () => {
        const code = await system('test1234');
        // Accept both Windows (1) and Linux (127) exit codes for command not found
        ok(code === 1 || code === 127, `Expected exit code 1 (Windows) or 127 (Linux), got ${code}`);
    });

    test('fail throws', async () => {
        rejects(system('test1234', { throwOnError: true }), /Failed with exit code/);
    });

    test('filter', async () => {
        // Test filtering of output
        let callCount = 0;
        const fn = (line: string, stream: { write: (data: string) => void }) => {
            callCount++;
            stream.write(line);
        };
        const code = await system('bun -e "console.log(process.pid)"', { throwOnError: true, lineTransform: fn });
        equal(code, 0);
        equal(callCount, 1);
    });

    test('spinner func', async () => {
        let spinnerCount = 0;
        let spinnerCallCount = 0;
        const spinner = () => {
            spinnerCallCount++;
            return '+-+|'.charAt(spinnerCount++ % 4);
        };
        const code = await system('bun -e "await new Promise(resolve => setTimeout(resolve, 500))"', { spinner });
        equal(code, 0);
        ok(spinnerCallCount > 1);
    });

    test('timeout', async () => {
        const code = await system('bun -e "await new Promise(resolve => setTimeout(resolve, 1000))"', { timeout: 500 });
        equal(code, errno.ETIMEDOUT);
    });

    test('prompt positive', async () => {
        const originalCreateInterface = readline.createInterface;
        readline.createInterface = (() => ({
            question: (_q: string, cb: (v: string) => void) => cb('test'),
            close: () => undefined,
            on: () => undefined,
        })) as unknown as typeof readline.createInterface;

        const yn = await prompt('?', 'y');
        equal(yn, 'test');

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
        equal(yn, 'y');

        readline.createInterface = originalCreateInterface;
    });

    test('system handles child process error event', async () => {
        // This test covers the error handler (lines 112-113 in shell.ts)
        await rejects(system('this-command-does-not-exist-anywhere-12345', { throwOnError: true }), /Failed with exit code/);
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

        await rejects(promptPromise);

        readline.createInterface = originalCreateInterface;
    });

    test('color shorthand functions', () => {
        // Test basic color functions
        ok(red`test`.includes('test'));
        ok(yellow`test`.includes('test'));
        ok(grey`test`.includes('test'));
        ok(green`test`.includes('test'));
        ok(blue`test`.includes('test'));
        ok(bold`test`.includes('test'));

        // Test interpolation
        const name = 'World';
        ok(red`Hello ${name}`.includes('Hello World'));
        ok(color('green', Object.assign(['Test'], { raw: ['Test'] })).includes('Test'));
    });

    test('getErrorName returns errno name', () => {
        const name = getErrorName(errno.ENOENT);
        equal(name, 'ENOENT');
    });

    test('getErrorName returns number for unknown errno', () => {
        const name = getErrorName(999999);
        equal(name, '999999');
    });
});
