/**
 * Tests for debugger utility
 */

import { strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isDebugging } from './debugger';

describe('isDebuggerAttached', () => {
    test('returns a boolean value', () => {
        const result = isDebugging();
        strictEqual(typeof result, 'boolean', 'Should return a boolean');
    });

    test('returns consistent value on multiple calls', () => {
        const result1 = isDebugging();
        const result2 = isDebugging();
        const result3 = isDebugging();

        strictEqual(result1, result2, 'Should return same value on second call');
        strictEqual(result2, result3, 'Should return same value on third call');
    });
});
