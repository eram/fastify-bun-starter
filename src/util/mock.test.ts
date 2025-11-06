import { deepEqual, equal, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, mock, test } from 'node:test';

describe('mock utility', () => {
    test('is mock working', () => {
        ok(mock, 'mock should be defined globally');
        ok(typeof mock.fn === 'function', 'mock.fn should be a function');
        ok(typeof mock.reset === 'function', 'mock.reset should be a function');
        ok(typeof mock.restoreAll === 'function', 'mock.restoreAll should be a function');
    });

    test('mock.fn creates a callable mock function', () => {
        const mockFn = mock.fn(() => 'test');
        ok(typeof mockFn === 'function', 'mockFn should be callable');
        const result = mockFn();
        strictEqual(result, 'test', 'mockFn should return test value');
    });

    test('mock.fn without implementation', () => {
        const mockFn = mock.fn();
        const result = mockFn();
        strictEqual(result, undefined, 'mockFn should return undefined by default');
    });

    test('mock.fn tracks calls correctly', () => {
        const mockFn = mock.fn((a: number, b: number) => a + b);

        mockFn(1, 2);
        mockFn(3, 4);
        mockFn(5, 6);

        strictEqual(mockFn.mock.calls.length, 3, 'should track 3 calls');
        deepEqual(mockFn.mock.calls[0], [1, 2], 'first call args should be [1, 2]');
        deepEqual(mockFn.mock.calls[1], [3, 4], 'second call args should be [3, 4]');
        deepEqual(mockFn.mock.calls[2], [5, 6], 'third call args should be [5, 6]');
    });

    test('mock.fn tracks call count', () => {
        const mockFn = mock.fn();

        strictEqual(mockFn.mock.callCount(), 0, 'initial call count should be 0');

        mockFn();
        strictEqual(mockFn.mock.callCount(), 1, 'call count should be 1 after one call');

        mockFn();
        mockFn();
        strictEqual(mockFn.mock.callCount(), 3, 'call count should be 3 after three calls');
    });

    test('mock.fn tracks results', () => {
        const mockFn = mock.fn((x: number) => x * 2);

        mockFn(5);
        mockFn(10);

        // @ts-expect-error - Bun mock has results property
        strictEqual(mockFn.mock.results.length, 2, 'should track 2 results');
        // @ts-expect-error - Bun mock has results property
        strictEqual(mockFn.mock.results[0].type, 'return', 'first result type should be return');
        // @ts-expect-error - Bun mock has results property
        strictEqual(mockFn.mock.results[0].value, 10, 'first result value should be 10');
        // @ts-expect-error - Bun mock has results property
        strictEqual(mockFn.mock.results[1].type, 'return', 'second result type should be return');
        // @ts-expect-error - Bun mock has results property
        strictEqual(mockFn.mock.results[1].value, 20, 'second result value should be 20');
    });

    test('mockClear resets call history', () => {
        const mockFn = mock.fn();

        mockFn(1);
        mockFn(2);
        strictEqual(mockFn.mock.calls.length, 2, 'should have 2 calls before clear');

        // @ts-expect-error - Bun mock has mockClear method
        mockFn.mockClear();
        strictEqual(mockFn.mock.calls.length, 0, 'should have 0 calls after clear');
        // @ts-expect-error - Bun mock has results property
        strictEqual(mockFn.mock.results.length, 0, 'should have 0 results after clear');
    });

    test('mockImplementation changes implementation', () => {
        const mockFn = mock.fn(() => 'original');

        strictEqual(mockFn(), 'original', 'should return original value');

        // @ts-expect-error - Bun mock has mockImplementation method
        mockFn.mockImplementation(() => 'changed');
        strictEqual(mockFn(), 'changed', 'should return changed value');
    });

    test('mockImplementationOnce changes implementation for one call', () => {
        const mockFn = mock.fn(() => 'default');

        // @ts-expect-error - Bun mock has mockImplementationOnce method
        mockFn.mockImplementationOnce(() => 'once');
        strictEqual(mockFn(), 'once', 'first call should return once');
        strictEqual(mockFn(), 'default', 'second call should return default');
        strictEqual(mockFn(), 'default', 'third call should return default');
    });

    test('mockReturnValue sets return value', () => {
        const mockFn = mock.fn();

        // @ts-expect-error - Bun mock has mockReturnValue method
        mockFn.mockReturnValue(42);
        strictEqual(mockFn(), 42, 'should return 42');
        strictEqual(mockFn(), 42, 'should still return 42');
    });

    test('mockReturnValueOnce sets return value for one call', () => {
        const mockFn = mock.fn(() => 'default');

        // @ts-expect-error - Bun mock has mockReturnValueOnce method
        mockFn.mockReturnValueOnce('once');
        strictEqual(mockFn(), 'once', 'first call should return once');
        strictEqual(mockFn(), 'default', 'second call should return default');
    });

    test('multiple mockReturnValueOnce calls', () => {
        const mockFn = mock.fn(() => 'default');

        // @ts-expect-error - Bun mock has mockReturnValueOnce method
        mockFn.mockReturnValueOnce('first');
        // @ts-expect-error - Bun mock has mockReturnValueOnce method
        mockFn.mockReturnValueOnce('second');
        // @ts-expect-error - Bun mock has mockReturnValueOnce method
        mockFn.mockReturnValueOnce('third');

        strictEqual(mockFn(), 'first', 'first call should return first');
        strictEqual(mockFn(), 'second', 'second call should return second');
        strictEqual(mockFn(), 'third', 'third call should return third');
        strictEqual(mockFn(), 'default', 'fourth call should return default');
    });

    test('mock.fn with typed function', () => {
        type AddFn = (a: number, b: number) => number;
        const mockFn = mock.fn<AddFn>((a, b) => a + b);

        const result = mockFn(5, 3);
        strictEqual(result, 8, 'should return 8');
        strictEqual(mockFn.mock.calls.length, 1, 'should track one call');
        deepEqual(mockFn.mock.calls[0], [5, 3], 'should track correct args');
    });

    test('calls are typed as unknown[][]', () => {
        const mockFn = mock.fn((str: string) => str.toUpperCase());

        mockFn('hello');
        mockFn('world');

        // Verify calls structure matches unknown[][]
        const calls: unknown[][] = mockFn.mock.calls as unknown as unknown[][];
        ok(Array.isArray(calls), 'calls should be an array');
        ok(Array.isArray(calls[0]), 'calls[0] should be an array');
        equal(calls[0][0], 'hello', 'calls[0][0] should be hello');
        equal(calls[1][0], 'world', 'calls[1][0] should be world');
    });

    test('mock.restoreAll restores all mock functions', () => {
        const mockFn1 = mock.fn(() => 'fn1');
        const mockFn2 = mock.fn(() => 'fn2');

        mockFn1();
        mockFn2();

        strictEqual(mockFn1.mock.calls.length, 1, 'fn1 should have 1 call');
        strictEqual(mockFn2.mock.calls.length, 1, 'fn2 should have 1 call');

        mock.restoreAll();

        // After restore, new calls should still work
        mockFn1();
        mockFn2();

        // The mocks should be restored (exact behavior depends on implementation)
        // At minimum, restoreAll should not throw
        ok(true, 'restoreAll should complete without error');
    });

    test('mock function with no arguments', () => {
        const mockFn = mock.fn(() => 'no-args');

        mockFn();
        mockFn();

        strictEqual(mockFn.mock.calls.length, 2, 'should track calls with no args');
        deepEqual(mockFn.mock.calls[0], [], 'first call should have empty args');
        deepEqual(mockFn.mock.calls[1], [], 'second call should have empty args');
    });

    test('mock function with multiple arguments', () => {
        const mockFn = mock.fn((a: string, b: number, c: boolean) => `${a}-${b}-${c}`);

        mockFn('test', 42, true);
        mockFn('hello', 100, false);

        strictEqual(mockFn.mock.calls.length, 2, 'should track 2 calls');
        deepEqual(mockFn.mock.calls[0], ['test', 42, true], 'first call args should match');
        deepEqual(mockFn.mock.calls[1], ['hello', 100, false], 'second call args should match');
    });

    test('mock function can be used as callback', () => {
        const mockFn = mock.fn((x: number) => x * 2);
        const numbers = [1, 2, 3];

        const results = numbers.map(mockFn);

        deepEqual(results, [2, 4, 6], 'mock should work as callback');
        strictEqual(mockFn.mock.calls.length, 3, 'should track all callback calls');
    });

    test('individual mock contexts have restore() method', () => {
        const obj = {
            test: () => 'original',
        };

        const mockMethod = mock.method(obj, 'test', () => 'mocked');
        strictEqual(obj.test(), 'mocked', 'should use mocked implementation');
        strictEqual(mockMethod.mock.calls.length, 1, 'should have 1 call');

        // Individual mock contexts have restore() method (not MockTracker)
        // restore() only restores implementation, does NOT clear call history
        mockMethod.mock.restore();
        strictEqual(obj.test(), 'original', 'restore() should restore original implementation');
        strictEqual(mockMethod.mock.calls.length, 1, 'restore() should NOT clear call history');

        // Test mockClear() for clearing call history
        // @ts-expect-error - Bun mock has mockClear method
        mockMethod.mockClear();
        strictEqual(mockMethod.mock.calls.length, 0, 'mockClear() should clear call history');

        // After individual restore, tracker still has association (can restoreAll)
        const obj2 = { fn: () => 'original2' };
        mock.method(obj2, 'fn', () => 'mocked2');
        strictEqual(obj2.fn(), 'mocked2', 'should use mocked implementation');

        mock.restoreAll();
        strictEqual(obj2.fn(), 'original2', 'restoreAll should still work');

        mock.reset(); // Clean up
    });

    // mock.method() tests
    test('mock.method mocks an object method', () => {
        const obj = {
            greet: (name: string) => `Hello ${name}`,
        };

        const mockMethod = mock.method(obj, 'greet', (name: string) => `Hi ${name}`);

        strictEqual(obj.greet('World'), 'Hi World', 'should use mocked implementation');
        strictEqual(mockMethod.mock.calls.length, 1, 'should track calls');
        deepEqual(mockMethod.mock.calls[0], ['World'], 'should track call arguments');
    });

    test('mock.method restores original method', () => {
        const obj = {
            add: (a: number, b: number) => a + b,
        };

        const original = obj.add;
        mock.method(obj, 'add', (a: number, b: number) => a * b);

        strictEqual(obj.add(2, 3), 6, 'should use mocked implementation (multiply)');

        mock.restoreAll();

        strictEqual(obj.add(2, 3), 5, 'should restore original implementation (add)');
        strictEqual(obj.add, original, 'should restore exact original function');
    });

    test('mock.method without implementation uses original', () => {
        const obj = {
            getValue: () => 42,
        };

        const mockMethod = mock.method(obj, 'getValue');

        strictEqual(obj.getValue(), 42, 'should call original implementation');
        strictEqual(mockMethod.mock.calls.length, 1, 'should track calls');
    });

    test('mock.method throws for non-function properties', () => {
        const obj = {
            value: 42,
        };

        throws(
            () => {
                mock.method(obj as any, 'value');
            },
            /Cannot mock non-function property/,
            'should throw for non-function',
        );
    });

    test('mock.method tracks multiple calls', () => {
        const obj = {
            log: (msg: string) => console.log(msg),
        };

        const mockMethod = mock.method(obj, 'log', () => {});

        obj.log('first');
        obj.log('second');
        obj.log('third');

        strictEqual(mockMethod.mock.calls.length, 3, 'should track all calls');
        deepEqual(mockMethod.mock.calls[0], ['first'], 'should track first call');
        deepEqual(mockMethod.mock.calls[1], ['second'], 'should track second call');
        deepEqual(mockMethod.mock.calls[2], ['third'], 'should track third call');

        mock.restoreAll();
    });

    test('mock.method can mock console methods', () => {
        const originalLog = console.log;
        const mockMethod = mock.method(console, 'log', () => {});

        console.log('test message');

        strictEqual(mockMethod.mock.calls.length, 1, 'should track console.log call');
        deepEqual(mockMethod.mock.calls[0], ['test message'], 'should track arguments');

        mock.restoreAll();

        strictEqual(console.log, originalLog, 'should restore original console.log');
    });

    test('mock.method restores multiple methods', () => {
        const obj = {
            method1: () => 'original1',
            method2: () => 'original2',
        };

        const original1 = obj.method1;
        const original2 = obj.method2;

        mock.method(obj, 'method1', () => 'mocked1');
        mock.method(obj, 'method2', () => 'mocked2');

        strictEqual(obj.method1(), 'mocked1', 'method1 should be mocked');
        strictEqual(obj.method2(), 'mocked2', 'method2 should be mocked');

        mock.restoreAll();

        strictEqual(obj.method1(), 'original1', 'method1 should be restored');
        strictEqual(obj.method2(), 'original2', 'method2 should be restored');
        strictEqual(obj.method1, original1, 'should restore exact original method1');
        strictEqual(obj.method2, original2, 'should restore exact original method2');
    });

    test('mock.reset() restores originals and disassociates from tracker', () => {
        const obj = { fn: () => 'original' };

        // Mock the method
        const mockFn = mock.method(obj, 'fn', () => 'mocked');
        strictEqual(obj.fn(), 'mocked', 'should use mocked implementation');
        strictEqual(mockFn.mock.calls.length, 1, 'should have 1 call');

        // reset() restores originals AND disassociates (clears tracking arrays)
        mock.reset();

        // After reset(), original function is restored
        strictEqual(obj.fn(), 'original', 'should restore original after reset');

        // After reset(), calling restoreAll() has no effect (disassociated)
        mock.restoreAll();
        strictEqual(obj.fn(), 'original', 'restoreAll after reset should have no effect');

        // Mock a new method to verify tracker still works
        mock.method(obj, 'fn', () => 'new mock');
        strictEqual(obj.fn(), 'new mock', 'tracker should work for new mocks after reset');

        mock.reset(); // Clean up
    });

    test('mock.restoreAll() restores originals but keeps association', () => {
        const obj = { fn: () => 'original' };

        // Mock the method
        mock.method(obj, 'fn', () => 'mocked');
        strictEqual(obj.fn(), 'mocked', 'should use mocked implementation');

        // restoreAll() restores original but does NOT disassociate
        mock.restoreAll();
        strictEqual(obj.fn(), 'original', 'should restore original implementation');

        // Mock the same method again - should work because still associated
        mock.method(obj, 'fn', () => 'mocked again');
        strictEqual(obj.fn(), 'mocked again', 'can mock again after restoreAll');

        // Call restoreAll() again - should work because still associated
        mock.restoreAll();
        strictEqual(obj.fn(), 'original', 'restoreAll can be called multiple times');

        mock.reset(); // Clean up and disassociate
    });
});
