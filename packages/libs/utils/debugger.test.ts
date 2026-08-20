/**
 * Tests for debugger utility
 */

import { describe, expect, test } from 'bun:test';
import { isDebugging } from './debugger';

describe('isDebugging', () => {
    test('returns a boolean value', () => {
        const result = isDebugging(true);
        expect(typeof result).toBe('boolean');
    });

    test('returns consistent value on multiple calls', () => {
        const result1 = isDebugging(true);
        const result2 = isDebugging(true);
        const result3 = isDebugging();

        expect(result1).toBe(result2);
        expect(result2).toBe(result3);
    });

    test('handles browser environment check', () => {
        // Test that the function handles the browser check properly
        // In Node.js environment, process should be defined
        expect(typeof process !== 'undefined').toBeTruthy();
        expect(typeof process.debugPort !== 'undefined').toBeTruthy();

        // Call isDebugging to ensure code coverage
        const result = isDebugging(true);
        expect(typeof result).toBe('boolean');
    });

    test('returns inspector data', () => {
        const save = process.debugPort;
        try {
            isDebugging(true);
            Object(process).debugPort = 1111;
            const result2 = isDebugging(true);
            expect(typeof result2).toBe('boolean');
        } finally {
            process.debugPort = save;
        }
    });
});
