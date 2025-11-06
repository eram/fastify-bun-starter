import { equal, notEqual, ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ErrorEx, errno, getErrorName, isNative } from './error';

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
        ok(new ExampleError() instanceof Error);
        ok(new ExampleError() instanceof ExampleError);
    });

    test('subclasses are instances of Error when thrown', () => {
        try {
            throw new ExampleError();
        } catch (e) {
            ok(e instanceof Error);
        }
    });

    test('subclasses name property is the name of the class', () => {
        equal(new ExampleError().name, 'ExampleError');
        equal(ExampleError.name, 'ExampleError');
    });

    test('includes a stack trace', () => {
        ok(new ExampleError().stack);
    });

    test('initializing ErrorEx with native error', () => {
        const typeError = new TypeError('Type mismatch');
        const customErr = new ErrorEx(typeError);

        equal(customErr.message, 'Type mismatch');
        ok(customErr instanceof ErrorEx);
        ok(!(customErr instanceof TypeError));
        equal(customErr.name, 'ErrorEx');
    });

    test('initializing ErrorEx with RangeError preserves properties', () => {
        const rangeErr = new RangeError('Value out of range');
        Object.defineProperty(rangeErr, 'code', { value: 'ERANGE', enumerable: true });

        const customErr = new ErrorEx(rangeErr);
        equal(customErr.message, 'Value out of range');
        equal(customErr.code, 'ERANGE');
    });

    test('sub-subclasses are instances of Error when thrown', () => {
        ok(new SubExampleError() instanceof Error);
        try {
            throw new SubExampleError();
        } catch (e) {
            ok(e instanceof Error);
        }
        const error = new SubExampleError();
        ok(error instanceof SubExampleError);
    });

    test('sub-subclasses are instances of themselves when thrown', () => {
        equal(new SubExampleError().name, 'SubExampleError');
        try {
            throw new SubExampleError();
        } catch (e) {
            ok(e instanceof Error);
        }
        ok(new SubExampleError() instanceof ExampleError);
        try {
            throw new SubExampleError();
        } catch (e) {
            ok(e instanceof Error);
        }
        equal(SubExampleError.name, 'SubExampleError');
        const error = new SubExampleError();
        ok(error.isExample);
    });

    test('sub-subclasses toString and JSON.stringify', () => {
        const err1 = new ExampleError();
        equal(err1.toString(), 'ExampleError: This is an example');
        equal(err1.name, 'ExampleError');
        equal(err1.message, 'This is an example');
        ok(err1.stack?.includes('ExampleError'));

        const err2 = new SubExampleError();
        equal(err2.toString(), 'SubExampleError: This is an example');
        equal(err2.name, 'SubExampleError');
        equal(err2.message, 'This is an example');
        ok(err2.stack?.includes('SubExampleError'));
    });

    test('copy ctor', () => {
        class TestError extends ErrorEx {}
        const err = new Error('test');
        const testError = new TestError(err);
        equal(testError.name, 'TestError');
        equal(testError.toString(), 'TestError: test');
        notEqual(testError.stack, err.stack);
    });

    test('construct SubExampleError from ExampleError', () => {
        const example = new ExampleError();
        const sub = new SubExampleError(example);
        ok(sub instanceof SubExampleError);
        ok(sub instanceof ExampleError);
        ok(sub instanceof ErrorEx);
        equal(sub.message, example.message);
        notEqual(sub.stack, example.stack);
        equal(sub.name, 'SubExampleError');
    });

    // Test: ErrorEx constructed from another ErrorEx
    test('ErrorEx constructed from another ErrorEx', () => {
        const err1 = new ErrorEx('msg1', 42, 'EFOO');
        equal(err1.errno, 42);

        const err2 = new ErrorEx(err1);
        ok(err2 instanceof ErrorEx);
        equal(err2.message, 'msg1');
        equal(err2.errno, 42);
        equal(err2.code, 'EFOO');
        notEqual(err2.stack, err1.stack);
        equal(err2.name, 'ErrorEx');
    });

    // Test: ErrorEx with explicit errno and code
    test('ErrorEx with explicit errno and code', () => {
        const err = new ErrorEx('msg2', 99, 'EBAR');
        equal(err.errno, 99);
        equal(err.code, 'EBAR');
        const json = JSON.stringify(err);
        ok(json.includes('"errno":99'));
        ok(json.includes('"code":"EBAR"'));
    });

    // Test: ErrorEx constructed with undefined and null
    test('ErrorEx constructed with undefined', () => {
        const err = new ErrorEx(undefined);
        equal(err.message, 'Unknown error');
        equal(err.name, 'ErrorEx');
    });

    test('ErrorEx constructed with null', () => {
        const err = new ErrorEx(null);
        equal(err.message, 'Unknown error');
        equal(err.name, 'ErrorEx');
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
        ok(err instanceof ErrorEx);
        // stack is either "readonly" or undefined, but no crash
    });

    // 100% coverage: test with explicit errno/code overriding error's values
    test("ErrorEx explicit errno/code override error's values", () => {
        const err = new Error('foo');
        Object(err).errno = 123;
        Object(err).code = 'EFOO';
        const ce = new ErrorEx(err, 456, 'EBAR');
        equal(ce.errno, 456);
        equal(ce.code, 'EBAR');
    });

    // 100% coverage: test with error with no message
    test('ErrorEx constructed from error with no message', () => {
        const err = new Error();
        const ce = new ErrorEx(err);
        equal(ce.message, '');
    });

    // 100% coverage: test with string error and errno/code
    test('ErrorEx constructed from string with errno/code', () => {
        const ce = new ErrorEx('foo', 1, 'EFOO');
        equal(ce.message, 'foo');
        equal(ce.errno, 1);
        equal(ce.code, 'EFOO');
    });

    test('ErrorEx JSON.stringify omits undefined', () => {
        const ce = new ErrorEx('foo');
        const json = JSON.stringify(ce);
        ok(!json.includes('errno'));
        ok(!json.includes('code'));
    });

    test('constructor fallback for number/boolean/object with no message', () => {
        const errNum = new ErrorEx(123);
        strictEqual(errNum.message, 'Unknown error');
        const errBool = new ErrorEx(false);
        strictEqual(errBool.message, 'Unknown error');
        const errObj = new ErrorEx({ foo: 'bar' });
        strictEqual(errObj.message, 'Unknown error');
    });

    test('test the catch block in the ErrorEx constructor', () => {
        // Test with object that triggers the catch block
        const originalSetPrototypeOf = Object.setPrototypeOf;
        try {
            Object.setPrototypeOf = (() => {
                throw new Error('Mocked error');
            }) as typeof Object.setPrototypeOf;

            const err = new ErrorEx('test');
            ok(err instanceof ErrorEx);
        } finally {
            Object.setPrototypeOf = originalSetPrototypeOf;
        }
    });

    test('errno and code undefined should not be set', () => {
        const err = new ErrorEx('foo');
        ok(!err.errno);
        ok(!err.code);
    });
});

describe('errno', () => {
    test('ENOENT', () => {
        equal(getErrorName(errno.ENOENT), 'ENOENT');
    });

    test('returns errno constant name', () => {
        // Use a common errno value that should exist in most systems
        const enoent = Object.entries(errno).find(([key]) => key === 'ENOENT')?.[1];
        if (enoent) {
            strictEqual(getErrorName(enoent), 'ENOENT');
        }
    });

    test('returns string for unknown errno', () => {
        strictEqual(getErrorName(999999), '999999');
    });
});

describe('isNative', () => {
    test('identifies native error constructors', () => {
        ok(!isNative(Error));
        ok(!isNative(ErrorEx));

        ok(isNative(TypeError));
        ok(isNative(SyntaxError));
    });

    test('identifies native error instances', () => {
        ok(!isNative(new Error()));
        ok(!isNative(new ErrorEx('TEST')));
        ok(isNative(new URIError()));
    });

    test('handles edge cases', () => {
        ok(!isNative({}));
        ok(!isNative(null));
        ok(!isNative(undefined));
    });
});
