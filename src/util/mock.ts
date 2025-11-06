// biome-ignore-all lint/suspicious/noExplicitAny: Generic function types throughout this file need any for flexibility with typed functions

/**
 * Mock utility for Bun tests.
 * This is done to match the mock functionality of Bun with node:test (aka polyfill)
 * It's injected into the test runner from preload hook in bunfig.toml
 * Runs during preload (see bunfig.toml) to augment the built-in mock
 *
 * MockTracker methods:
 * - reset(): Restores all mocks + Disassociates (clears arrays)
 * - restoreAll(): Restores all mocks + Keeps association (arrays intact)
 *
 * Individual mock context methods:
 * - mockContext.restore(): Restores single mock (on function/method contexts)
 */

import { mock as bunMock } from 'bun:test';
import * as nodeTest from 'node:test';

/** Mock tracker compatible with node:test's MockTracker */
class Tracker {
    private _fns: Array<ReturnType<typeof bunMock>> = [];
    private _methods: Array<{ obj: any; name: string | symbol; orig: any; mock: ReturnType<typeof bunMock> }> = [];

    fn<T extends (...args: any[]) => any>(orig?: T): nodeTest.Mock<T> {
        const fn = bunMock(orig || (() => {}));

        // Add callCount() method for node:test compatibility
        // @ts-expect-error - Bun mock structure differs slightly from node:test
        fn.mock.callCount ??= () => fn.mock.calls.length;

        // Add restore() method on individual mock context (node:test API)
        // For standalone functions, restore resets to original implementation (noop for new mocks)
        // @ts-expect-error - Bun mock structure differs slightly from node:test
        fn.mock.restore ??= () => {
            // For bare functions, there's nothing to restore (no object to update)
            // Node.js just resets implementation to original, which is already in place
        };

        // Add results property for node:test compatibility (Bun already has this)
        // Note: Bun mocks already track results, so this is just for documentation

        this._fns.push(fn);
        // Return as any because Bun's mock includes additional methods not in node:test types
        // (mockClear, mockImplementation, mockReturnValue, etc.)
        return fn as any;
    }

    method<T extends object, K extends keyof T, Impl extends (...args: any[]) => any = any>(
        obj: T,
        name: K,
        impl?: Impl,
    ): T[K] extends (...args: any[]) => any ? nodeTest.Mock<Impl> : never {
        const orig = obj[name];

        if (typeof orig !== 'function') {
            throw new TypeError(`Cannot mock non-function property "${String(name)}"`);
        }

        const fn = this.fn(impl || (orig as any));
        Object(obj)[name] = fn;
        this._methods.push({ obj, name: name as string | symbol, orig, mock: fn });

        // Override restore() for mocked methods to restore the original on the object
        // Note: restore() does NOT clear call history (use resetCalls() for that)
        fn.mock.restore = () => {
            obj[name] = orig;
        };

        return fn as any;
    }

    reset() {
        // Restores all mocks AND disassociates from tracker (node:test API)
        // This is called automatically after each test completes
        for (const m of this._methods) {
            m.obj[m.name] = m.orig;
        }
        // Clear arrays - disassociate mocks from tracker
        this._methods = [];
        this._fns = [];
    }

    restoreAll() {
        // Restores all mocks but keeps them associated with tracker (node:test API)
        // Unlike reset(), does NOT clear the tracking arrays
        for (const m of this._methods) {
            m.obj[m.name] = m.orig;
        }
    }
}

// Create global instance (not exported - only used internally to extend node:test mock)
const tracker = new Tracker();

if (nodeTest.mock && typeof nodeTest.mock === 'function') {
    Object.assign(nodeTest.mock, {
        method: tracker.method.bind(tracker),
        fn: tracker.fn.bind(tracker),
        reset: tracker.reset.bind(tracker),
        restoreAll: tracker.restoreAll.bind(tracker),
    });
}

// Type augmentation for our extensions to node:test mock
declare module 'node:test' {
    export interface MockTracker {
        method<T extends object, K extends keyof T, Impl extends (...args: any[]) => any = any>(
            object: T,
            methodName: K,
            implementation?: Impl,
        ): T[K] extends (...args: any[]) => any ? Mock<Impl> : never;
        fn<T extends (...args: any[]) => any>(original?: T): Mock<T>;
        reset(): void;
        restoreAll(): void;
    }
}
