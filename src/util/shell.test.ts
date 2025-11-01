import { equal, ok, rejects } from 'node:assert/strict';
import readline from 'node:readline';
import { describe, test } from 'node:test';
import { errno, prompt, system } from './shell';

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
        const fn = mock.fn((line, stream) => stream.write(line));
        const code = await system('bun -e "console.log(process.pid)"', { throwOnError: true, lineTransform: fn });
        equal(code, 0);
        equal(fn.mock.calls.length, 1);
    });

    test('spinner func', async () => {
        let spinnerCount = 0;
        const spinner = mock.fn(() => '+-+|'.charAt(spinnerCount++ % 4));
        const code = await system('bun -e "await new Promise(resolve => setTimeout(resolve, 500))"', { spinner });
        equal(code, 0);
        ok(spinner.mock.calls.length > 1);
    });

    test('timeout', async () => {
        const code = await system('bun -e "await new Promise(resolve => setTimeout(resolve, 1000))"', { timeout: 500 });
        equal(code, errno.ETIMEDOUT);
    });

    test('prompt positive', async () => {
        mock.method(readline, 'createInterface', () => ({
            question: (_q: string, cb: (v: string) => void) => cb('test'),
            close: () => undefined,
            on: () => undefined,
        }));
        const yn = await prompt('?', 'y');
        equal(yn, 'test');
        // No need to call restore() when using node:test mock.method, it restores automatically after the test.
    });

    test('prompt with def value', async () => {
        mock.method(readline, 'createInterface', () => ({
            question: (_q: string, cb: (v: string) => void) => cb(''),
            close: () => undefined,
            on: () => undefined,
        }));
        const yn = await prompt('?', 'y');
        equal(yn, 'y');
        // No need to call restore() here either.
    });
});
