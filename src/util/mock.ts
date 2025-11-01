// biome-ignore-all lint/suspicious/noExplicitAny: Generic function types throughout this file need any for flexibility with typed functions

/**
 * Mock utility for Bun tests
 * This wraps Bun's mock to match node:test's MockTracker API as a polyfill.
 * It's injected into the test runner from preload hook in bunfig.toml
 */

import { mock as bunMock } from 'bun:test';

interface MockInfo {
    calls: { [key: string]: (...args: unknown[]) => boolean }[][];
    results: Array<{ type: 'return' | 'throw'; value: unknown }>;
    callCount(): number;
}

/**
 * Mock function compatible with node:test's MockTracker.fn
 */
class MockFn<T extends (...args: any[]) => any> {
    private _mockFn: ReturnType<typeof bunMock>;

    constructor(fn?: T) {
        this._mockFn = bunMock(fn || (() => {}));
    }

    get mock(): MockInfo {
        return {
            calls: this._mockFn.mock.calls,
            results: this._mockFn.mock.results.map((r: { type: string; value: unknown }) => ({
                type: r.type as 'return' | 'throw',
                value: r.value,
            })),
            callCount: () => this._mockFn.mock.calls.length,
        };
    }

    /**
     * Get the mocked function
     */
    get fn(): T {
        return this._mockFn as unknown as T;
    }

    /**
     * Reset mock call history and results
     */
    mockClear(): void {
        this._mockFn.mockClear();
    }

    /**
     * Reset and restore to original implementation
     */
    mockRestore(): void {
        this._mockFn.mockRestore();
    }

    /**
     * Set the implementation for the mock
     */
    mockImplementation(fn: T): void {
        this._mockFn.mockImplementation(fn as () => unknown);
    }

    /**
     * Set a one-time implementation for the mock
     */
    mockImplementationOnce(fn: T): void {
        this._mockFn.mockImplementationOnce(fn as () => unknown);
    }

    /**
     * Set the return value for the mock
     */
    mockReturnValue(value: unknown): void {
        this._mockFn.mockReturnValue(value);
    }

    /**
     * Set a one-time return value for the mock
     */
    mockReturnValueOnce(value: unknown): void {
        this._mockFn.mockReturnValueOnce(value);
    }
}

/**
 * Method mock that tracks the original method for restoration
 */
interface MethodMock<T extends (...args: any[]) => any> {
    mockFn: MockFn<T> & T;
    object: unknown;
    methodName: string | symbol;
    original: T;
}

/**
 * Mock tracker compatible with node:test's MockTracker
 */
export class MockTracker {
    private _mocks: Array<MockFn<(...args: any[]) => any>> = [];
    private _methodMocks: MethodMock<(...args: any[]) => any>[] = [];

    /**
     * Create a mock function
     */
    fn<T extends (...args: any[]) => any>(original?: T): MockFn<T> & T {
        const mockFn = new MockFn<T>(original);
        this._mocks.push(mockFn as MockFn<(...args: any[]) => any>);

        // Create a callable wrapper that delegates to the Bun mock
        const callable = ((...args: Parameters<T>) => mockFn.fn(...args)) as MockFn<T> & T;

        // Copy over the mock methods
        Object.defineProperty(callable, 'mock', {
            get() {
                return mockFn.mock;
            },
        });

        callable.mockClear = () => mockFn.mockClear();
        callable.mockRestore = () => mockFn.mockRestore();
        callable.mockImplementation = (fn: T) => mockFn.mockImplementation(fn);
        callable.mockImplementationOnce = (fn: T) => mockFn.mockImplementationOnce(fn);
        callable.mockReturnValue = (value: unknown) => mockFn.mockReturnValue(value);
        callable.mockReturnValueOnce = (value: unknown) => mockFn.mockReturnValueOnce(value);

        return callable;
    }

    /**
     * Mock a method on an object
     * @param object The object containing the method
     * @param methodName The name of the method to mock
     * @param implementation Optional implementation for the mock
     * @returns A mock function that tracks calls
     */
    method<T extends object, K extends keyof T>(
        object: T,
        methodName: K,
        implementation?: T[K] extends (...args: any[]) => any ? T[K] : never,
    ): T[K] extends (...args: any[]) => any ? MockFn<T[K]> & T[K] : never {
        // Save the original method
        const original = object[methodName];

        if (typeof original !== 'function') {
            throw new TypeError(`Cannot mock non-function property "${String(methodName)}"`);
        }

        // Create a mock function
        const mockFn = this.fn(implementation || (original as T[K] extends (...args: any[]) => any ? T[K] : never));

        // Replace the method on the object
        (object as any)[methodName] = mockFn;

        // Track this method mock for restoration
        this._methodMocks.push({
            mockFn: mockFn as MockFn<(...args: any[]) => any> & ((...args: any[]) => any),
            object,
            methodName: methodName as string | symbol,
            original: original as (...args: any[]) => any,
        });

        return mockFn as T[K] extends (...args: any[]) => any ? MockFn<T[K]> & T[K] : never;
    }

    /**
     * Reset all mocks
     */
    reset(): void {
        // Bun's test runner automatically resets mocks between tests
        // This is here for API compatibility
    }

    /**
     * Restore all mocks to their original implementations
     */
    restoreAll(): void {
        // Restore method mocks first
        for (const methodMock of this._methodMocks) {
            (methodMock.object as any)[methodMock.methodName] = methodMock.original;
        }
        this._methodMocks = [];

        // Then restore function mocks
        for (const mockFn of this._mocks) {
            mockFn.mockRestore();
        }
        this._mocks = [];
    }

    /**
     * Alias for restoreAll() - for node:test API compatibility
     */
    restore(): void {
        this.restoreAll();
    }
}

// Create a global instance
export const mockTracker = new MockTracker();

// Attach mock to globalThis for global access in tests
declare global {
    var mock: MockTracker;
}

// Auto-setup: attach to global when this module is imported
if (!globalThis.mock) {
    globalThis.mock = mockTracker;
}
