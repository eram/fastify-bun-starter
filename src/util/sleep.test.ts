import { ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { debounce, sleep } from './sleep';

describe('sleep', () => {
    test('should delay execution', async () => {
        const start = Date.now();
        await sleep(100);
        const elapsed = Date.now() - start;
        ok(elapsed >= 100, `Expected at least 100ms, got ${elapsed}ms`);
        ok(elapsed < 150, `Expected less than 150ms, got ${elapsed}ms`);
    });
});

describe('debounce', () => {
    test('should delay function execution', async () => {
        let callCount = 0;
        const fn = () => {
            callCount++;
        };

        const debounced = debounce(fn, 100);

        // Call multiple times rapidly
        debounced();
        debounced();
        debounced();

        // Function should not have been called yet
        strictEqual(callCount, 0);

        // Wait for debounce delay
        await sleep(150);

        // Function should have been called once
        strictEqual(callCount, 1);
    });

    test('should pass arguments to debounced function', async () => {
        let receivedArg: string | undefined;
        const fn = (arg: string) => {
            receivedArg = arg;
        };

        const debounced = debounce(fn, 50);
        debounced('test-value');

        await sleep(100);

        strictEqual(receivedArg, 'test-value');
    });

    test('should use default delay of 300ms when not specified', async () => {
        let callCount = 0;
        const fn = () => {
            callCount++;
        };

        const debounced = debounce(fn); // No delay specified

        debounced();

        // Should not have been called after 200ms
        await sleep(200);
        strictEqual(callCount, 0);

        // Should have been called after 350ms (300 + buffer)
        await sleep(200);
        strictEqual(callCount, 1);
    });

    test('should cancel previous timeout when called again', async () => {
        let callCount = 0;
        const fn = () => {
            callCount++;
        };

        const debounced = debounce(fn, 100);

        debounced();
        await sleep(50); // Wait 50ms
        debounced(); // This should cancel the first call
        await sleep(50); // Wait another 50ms (total 100ms from first call)

        // First call should have been cancelled
        strictEqual(callCount, 0);

        await sleep(100); // Wait for second call to complete

        // Only the second call should have executed
        strictEqual(callCount, 1);
    });

    test('should handle multiple sequential calls', async () => {
        const calls: number[] = [];
        const fn = (value: number) => {
            calls.push(value);
        };

        const debounced = debounce(fn, 50);

        debounced(1);
        await sleep(100);

        debounced(2);
        await sleep(100);

        debounced(3);
        await sleep(100);

        // Should have three calls with correct values
        strictEqual(calls.length, 3);
        strictEqual(calls[0], 1);
        strictEqual(calls[1], 2);
        strictEqual(calls[2], 3);
    });
});
