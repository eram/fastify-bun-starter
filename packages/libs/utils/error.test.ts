import { describe, expect, test } from 'bun:test';
import { errno, getErrorName } from '@libs/utils/shell';
import { ErrorEx, isNative } from './error';

describe('ErrorEx', () => {
    class ExampleError extends ErrorEx {
        public readonly isExample = true;
        constructor(err?: Error) {
            if (err) {
                super(err);
            } else {
                super('This is an example');
            }
        }
    }

    class SubExampleError extends ExampleError {
        constructor(err?: ExampleError) {
            if (err) {
                super(err);
            } else {
                super();
            }
        }
    }

    test('subclasses are instances of Error', () => {
        expect(new ExampleError() instanceof Error).toBeTruthy();
        expect(new ExampleError() instanceof ExampleError).toBeTruthy();
    });

    test('subclasses are instances of Error when thrown', () => {
        try {
            throw new ExampleError();
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
        }
    });

    test('subclasses name property is the name of the class', () => {
        expect(new ExampleError().name).toBe('ExampleError');
        expect(ExampleError.name).toBe('ExampleError');
    });

    test('includes a stack trace', () => {
        expect(new ExampleError().stack).toBeTruthy();
    });

    test('initializing ErrorEx with native error', () => {
        const typeError = new TypeError('Type mismatch');
        const customErr = new ErrorEx(typeError);

        expect(customErr.message).toBe('Type mismatch');
        expect(customErr instanceof ErrorEx).toBeTruthy();
        expect(!(customErr instanceof TypeError)).toBeTruthy();
        expect(customErr.name).toBe('ErrorEx');
    });

    test('initializing ErrorEx with RangeError preserves properties', () => {
        const rangeErr = new RangeError('Value out of range');
        Object.defineProperty(rangeErr, 'code', { value: 'ERANGE', enumerable: true });

        const customErr = new ErrorEx(rangeErr);
        expect(customErr.message).toBe('Value out of range');
        expect(customErr.code).toBe('ERANGE');
    });

    test('sub-subclasses are instances of Error when thrown', () => {
        expect(new SubExampleError() instanceof Error).toBeTruthy();
        try {
            throw new SubExampleError();
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
        }
        const error = new SubExampleError();
        expect(error instanceof SubExampleError).toBeTruthy();
    });

    test('sub-subclasses are instances of themselves when thrown', () => {
        expect(new SubExampleError().name).toBe('SubExampleError');
        try {
            throw new SubExampleError();
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
        }
        expect(new SubExampleError() instanceof ExampleError).toBeTruthy();
        try {
            throw new SubExampleError();
        } catch (e) {
            expect(e instanceof Error).toBeTruthy();
        }
        expect(SubExampleError.name).toBe('SubExampleError');
        const error = new SubExampleError();
        expect(error.isExample).toBeTruthy();
    });

    test('sub-subclasses toString and JSON.stringify', () => {
        const err1 = new ExampleError();
        expect(err1.toString()).toBe('ExampleError: This is an example');
        expect(err1.name).toBe('ExampleError');
        expect(err1.message).toBe('This is an example');
        expect(err1.stack?.includes('ExampleError')).toBeTruthy();

        const err2 = new SubExampleError();
        expect(err2.toString()).toBe('SubExampleError: This is an example');
        expect(err2.name).toBe('SubExampleError');
        expect(err2.message).toBe('This is an example');
        expect(err2.stack?.includes('SubExampleError')).toBeTruthy();
    });

    test('copy ctor', () => {
        class TestError extends ErrorEx {}
        const err = new Error('test');
        const testError = new TestError(err);
        expect(testError.name).toBe('TestError');
        expect(testError.toString()).toBe('TestError: test');
        expect(testError.stack).not.toBe(err.stack);
    });

    test('construct SubExampleError from ExampleError', () => {
        const example = new ExampleError();
        const sub = new SubExampleError(example);
        expect(sub instanceof SubExampleError).toBeTruthy();
        expect(sub instanceof ExampleError).toBeTruthy();
        expect(sub instanceof ErrorEx).toBeTruthy();
        expect(sub.message).toBe(example.message);
        expect(sub.stack).not.toBe(example.stack);
        expect(sub.name).toBe('SubExampleError');
    });

    // Test: ErrorEx constructed from another ErrorEx
    test('ErrorEx constructed from another ErrorEx', () => {
        const err1 = new ErrorEx('msg1', 42, 'EFOO');
        expect(err1.errno).toBe(42);

        const err2 = new ErrorEx(err1);
        expect(err2 instanceof ErrorEx).toBeTruthy();
        expect(err2.message).toBe('msg1');
        expect(err2.errno).toBe(42);
        expect(err2.code).toBe('EFOO');
        expect(err2.stack).not.toBe(err1.stack);
        expect(err2.name).toBe('ErrorEx');
    });

    // Test: ErrorEx with explicit errno and code
    test('ErrorEx with explicit errno and code', () => {
        const err = new ErrorEx('msg2', 99, 'EBAR');
        expect(err.errno).toBe(99);
        expect(err.code).toBe('EBAR');
        const json = JSON.stringify(err);
        expect(json.includes('"errno":99')).toBeTruthy();
        expect(json.includes('"code":"EBAR"')).toBeTruthy();
    });

    // Test: ErrorEx constructed with undefined and null
    test('ErrorEx constructed with undefined', () => {
        const err = new ErrorEx(undefined);
        expect(err.message).toBe('Unknown error');
        expect(err.name).toBe('ErrorEx');
    });

    test('ErrorEx constructed with null', () => {
        const err = new ErrorEx(null);
        expect(err.message).toBe('Unknown error');
        expect(err.name).toBe('ErrorEx');
    });

    // Test: catch block in constructor (simulate read-only property)
    test('ErrorEx handles read-only property assignment', () => {
        const fakeError = {};
        Object.defineProperty(fakeError, 'stack', {
            value: 'readonly',
            writable: false,
            configurable: false,
            enumerable: true,
        });
        const err = new ErrorEx(fakeError as Error);
        // Should not throw, stack may not be copied
        expect(err instanceof ErrorEx).toBeTruthy();
        // stack is either "readonly" or undefined, but no crash
    });

    // 100% coverage: test with explicit errno/code overriding error's values
    test("ErrorEx explicit errno/code override error's values", () => {
        const err = new Error('foo');
        Object(err).errno = 123;
        Object(err).code = 'EFOO';
        const ce = new ErrorEx(err, 456, 'EBAR');
        expect(ce.errno).toBe(456);
        expect(ce.code).toBe('EBAR');
    });

    // 100% coverage: test with error with no message
    test('ErrorEx constructed from error with no message', () => {
        const err = new Error();
        const ce = new ErrorEx(err);
        expect(ce.message).toBe('');
    });

    // 100% coverage: test with string error and errno/code
    test('ErrorEx constructed from string with errno/code', () => {
        const ce = new ErrorEx('foo', 1, 'EFOO');
        expect(ce.message).toBe('foo');
        expect(ce.errno).toBe(1);
        expect(ce.code).toBe('EFOO');
    });

    test('ErrorEx JSON.stringify omits undefined', () => {
        const ce = new ErrorEx('foo');
        const json = JSON.stringify(ce);
        expect(!json.includes('errno')).toBeTruthy();
        expect(!json.includes('code')).toBeTruthy();
    });

    test('constructor fallback for number/boolean/object with no message', () => {
        const errNum = new ErrorEx(123);
        expect(errNum.message).toBe('Unknown error');
        const errBool = new ErrorEx(false);
        expect(errBool.message).toBe('Unknown error');
        const errObj = new ErrorEx({ foo: 'bar' });
        expect(errObj.message).toBe('Unknown error');
    });

    test('test the catch block in the ErrorEx constructor', () => {
        // Trigger the catch block via a poisoned getter on the source object, so Object.assign()
        // throws while copying properties. Deliberately avoids monkey-patching global functions
        // like Object.setPrototypeOf, which isn't reliably isolated when the full suite runs
        // together (another file's test can observe the mocked global mid-run).
        const bad: Record<string, unknown> = { message: 'boom' };
        Object.defineProperty(bad, 'poison', {
            enumerable: true,
            get() {
                throw new Error('poison accessor');
            },
        });

        const err = new ErrorEx(bad as unknown as Error);
        expect(err instanceof ErrorEx).toBeTruthy();
        expect(err.message).toBe('boom');
    });

    test('errno and code undefined should not be set', () => {
        const err = new ErrorEx('foo');
        expect(!err.errno).toBeTruthy();
        expect(!err.code).toBeTruthy();
    });
});

describe('errno', () => {
    test('ENOENT', () => {
        expect(getErrorName(errno.ENOENT)).toBe('ENOENT');
    });

    test('returns errno constant name', () => {
        // Use a common errno value that should exist in most systems
        const enoent = Object.entries(errno).find(([key]) => key === 'ENOENT')?.[1];
        if (enoent) {
            expect(getErrorName(enoent)).toBe('ENOENT');
        }
    });

    test('returns string for unknown errno', () => {
        expect(getErrorName(999999)).toBe('999999');
    });
});

describe('isNative', () => {
    test('identifies native error constructors', () => {
        expect(!isNative(Error)).toBeTruthy();
        expect(!isNative(ErrorEx)).toBeTruthy();

        expect(isNative(TypeError)).toBeTruthy();
        expect(isNative(SyntaxError)).toBeTruthy();
    });

    test('identifies native error instances', () => {
        expect(!isNative(new Error())).toBeTruthy();
        expect(!isNative(new ErrorEx('TEST'))).toBeTruthy();
        expect(isNative(new URIError())).toBeTruthy();
    });

    test('handles edge cases', () => {
        expect(!isNative({})).toBeTruthy();
        expect(!isNative(null)).toBeTruthy();
        expect(!isNative(undefined)).toBeTruthy();
    });
});
