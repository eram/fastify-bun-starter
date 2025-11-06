/**
 * Tests for debugger utility
 */

import { strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isDebuggerAttached } from './debugger';

describe('isDebuggerAttached', () => {
    test('returns a boolean value', () => {
        const result = isDebuggerAttached();
        strictEqual(typeof result, 'boolean', 'Should return a boolean');
    });

    test('returns consistent value on multiple calls', () => {
        const result1 = isDebuggerAttached();
        const result2 = isDebuggerAttached();
        const result3 = isDebuggerAttached();

        strictEqual(result1, result2, 'Should return same value on second call');
        strictEqual(result2, result3, 'Should return same value on third call');
    });

    test('caches the result (performance test)', () => {
        // First call might do actual detection
        const start1 = Date.now();
        isDebuggerAttached();
        const _duration1 = Date.now() - start1;

        // Subsequent calls should use cached value (much faster)
        const start2 = Date.now();
        for (let i = 0; i < 1000; i++) {
            isDebuggerAttached();
        }
        const duration2 = Date.now() - start2;

        // 1000 cached calls should be faster than the potential first detection
        strictEqual(duration2 < 100, true, 'Cached calls should be very fast (< 100ms for 1000 calls)');
    });
});
