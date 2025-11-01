import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { number, string } from '../lib/validator/validator';
import { type Dict, Immutable, isDeepEqual, isEmpty, replacerFn, reviverFn, type Union } from './immutable';

// ============================================================================
// Type Tests
// ============================================================================

describe('type tests', () => {
    test('union keys', () => {
        interface Box {
            color: string;
            height: number;
            width: number;
        }

        interface Polygon {
            color: string;
            height: number;
            width: number;
            sides: number;
        }

        // type
        type Both = Union<Box | Polygon>;

        function setProp<T extends keyof Both>(me: Both, prop: T, value: Both[T]) {
            me[prop] = value;
        }
        const both: Both = { color: 'black', height: 12, width: 12, sides: 4 };
        setProp(both, 'sides', 3);
        strictEqual(both.sides, 3);
        both.sides = 6;
        strictEqual(both.sides, 6);
    });
});

// ============================================================================
// BigInt JSON Support Tests
// ============================================================================

describe('bigint JSON support', () => {
    test('reviverFn handles bigint strings', () => {
        const json = '{"value": "123n"}';
        const parsed = JSON.parse(json, reviverFn);
        strictEqual(typeof parsed.value, 'bigint');
        strictEqual(parsed.value, 123n);
    });

    test('reviverFn filters __ properties', () => {
        const json = '{"__test": "filtered", "__another": 123, "normal": 1}';
        const parsed = JSON.parse(json, reviverFn);
        // Properties starting with __ are filtered (become undefined)
        ok(!('__test' in parsed));
        ok(!('__another' in parsed));
        strictEqual(parsed.normal, 1);
    });

    test('replacerFn encodes bigint', () => {
        const obj = { value: 42n };
        const json = JSON.stringify(obj, replacerFn);
        ok(json.includes('"42n"'));
    });

    test('bigint roundtrip', () => {
        const obj = { a: 1n, b: 2 };
        const json = JSON.stringify(obj, replacerFn);
        const parsed = JSON.parse(json, reviverFn);
        strictEqual(typeof parsed.a, 'bigint');
        strictEqual(parsed.a, 1n);
        strictEqual(parsed.b, 2);
    });

    test('replacerFn with negative bigint', () => {
        const obj = { hello: -20n };
        const str = JSON.stringify(obj, replacerFn, 1);
        strictEqual(str, '{\n "hello": "-20n"\n}');
        const parsed = JSON.parse(str, reviverFn);
        strictEqual(typeof parsed?.hello, 'bigint');
        strictEqual(parsed?.hello, -20n);
    });
});

// ============================================================================
// Immutable Class Tests
// ============================================================================

describe('Immutable tests', () => {
    test('Immutable is frozen', () => {
        const p2 = Immutable.parse('[]');
        ok(Object.isFrozen(p2));
        try {
            Object(p2).a = 1;
        } catch (e) {
            ok(e instanceof TypeError);
        }
    });

    test('Immutable.parse basic', () => {
        const obj = Immutable.parse('{"x": 10, "y": 20}');
        ok(Object.isFrozen(obj));
        strictEqual(obj?.x, 10);
        strictEqual(obj?.y, 20);
    });

    test('Immutable.parse with SharedArrayBuffer', () => {
        const obj = { x: 5, y: 'world' };
        const json = JSON.stringify(obj);
        const encoded = new TextEncoder().encode(json);
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);

        const parsed = Immutable.parse<typeof obj>(buf);
        strictEqual(parsed.x, 5);
        strictEqual(parsed.y, 'world');
        ok(Object.isFrozen(parsed));
    });

    test('Immutable.parse with ArrayBuffer', () => {
        const obj = { a: 1, b: 'test' };
        const json = JSON.stringify(obj);
        const encoded = new TextEncoder().encode(json);
        const buf = encoded.buffer;

        const parsed = Immutable.parse<typeof obj>(buf);
        strictEqual(parsed.a, 1);
        strictEqual(parsed.b, 'test');
        ok(Object.isFrozen(parsed));
    });

    test('Immutable.parse with invalid JSON throws', () => {
        throws(() => {
            Immutable.parse('{not valid json');
        });
    });

    test('Immutable handles bigint parse/stringify roundtrip', () => {
        const obj = { a: 1n, b: 2 };
        const str = JSON.stringify(obj, replacerFn);
        const parsed = Immutable.parse(str);
        strictEqual(typeof parsed?.a, 'bigint');
        strictEqual(parsed?.a, 1n);
        strictEqual(parsed?.b, 2);
        ok(Object.isFrozen(parsed));
    });

    test('Immutable.parse with custom reviver', () => {
        const str = JSON.stringify({ a: 1, b: 2 });
        const parsed = Immutable.parse(str, (_k, v) => (typeof v === 'number' ? v * 10 : v));
        strictEqual(parsed?.a, 10);
        strictEqual(parsed?.b, 20);
        ok(Object.isFrozen(parsed));
    });

    test('Immutable.parse with __proto__ in JSON does not pollute prototype', () => {
        const parsed = Immutable.parse('{"__proto__":{"evil":true}}');
        strictEqual(parsed?.constructor.name, 'Immutable');
        ok(!Object.hasOwn(parsed, 'evil'));
        ok(!parsed?.evil);
        ok(Object.isFrozen(parsed));
    });

    test('Immutable mutating methods are undefined', () => {
        const obj = Immutable.parse('{"x": 1}');
        strictEqual(obj?.set, undefined);
        strictEqual(obj?.deleteProperty, undefined);
        strictEqual(obj?.push, undefined);
        strictEqual(obj?.pop, undefined);
    });

    test('Immutable.safeParse returns success tuple on valid JSON', () => {
        const [data, err] = Immutable.safeParse<{ x: number; y: number }>('{"x": 10, "y": 20}');
        strictEqual(err, undefined);
        ok(data !== undefined);
        strictEqual(data.x, 10);
        strictEqual(data.y, 20);
        ok(Object.isFrozen(data));
    });

    test('Immutable.safeParse returns error tuple on invalid JSON', () => {
        const [data, err] = Immutable.safeParse('{not valid json');
        strictEqual(data, undefined);
        ok(err instanceof Error);
        ok(err.message.length > 0);
    });

    test('Immutable.safeParse handles bigint with default reviverFn', () => {
        const json = '{"value": "123n", "normal": 456}';
        const [data, err] = Immutable.safeParse<{ value: bigint; normal: number }>(json);
        strictEqual(err, undefined);
        ok(data !== undefined);
        strictEqual(typeof data.value, 'bigint');
        strictEqual(data.value, 123n);
        strictEqual(data.normal, 456);
        ok(Object.isFrozen(data));
    });

    test('Immutable.safeParse with custom reviver', () => {
        const json = '{"a": 1, "b": 2}';
        const [data, err] = Immutable.safeParse(json, (_k, v) => (typeof v === 'number' ? v * 10 : v));
        strictEqual(err, undefined);
        ok(data !== undefined);
        strictEqual(data.a, 10);
        strictEqual(data.b, 20);
        ok(Object.isFrozen(data));
    });

    test('Immutable.safeParse with SharedArrayBuffer', () => {
        const obj = { x: 100, y: 'safe' };
        const json = JSON.stringify(obj);
        const encoded = new TextEncoder().encode(json);
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);

        const [data, err] = Immutable.safeParse<typeof obj>(buf);
        strictEqual(err, undefined);
        ok(data !== undefined);
        strictEqual(data.x, 100);
        strictEqual(data.y, 'safe');
        ok(Object.isFrozen(data));
    });

    test('Immutable.safeParse with ArrayBuffer', () => {
        const obj = { a: 42, b: 'buffer' };
        const json = JSON.stringify(obj);
        const encoded = new TextEncoder().encode(json);
        const buf = encoded.buffer;

        const [data, err] = Immutable.safeParse<typeof obj>(buf);
        strictEqual(err, undefined);
        ok(data !== undefined);
        strictEqual(data.a, 42);
        strictEqual(data.b, 'buffer');
        ok(Object.isFrozen(data));
    });

    test('Immutable.parseValidate validates JSON against schema', () => {
        const schema = {
            name: string().min(3),
            age: number().int().positive(),
            email: string().email(),
        };

        const json = '{"name": "John", "age": 30, "email": "john@example.com"}';
        // Type is automatically inferred from schema!
        const data = Immutable.parseValidate(schema, json);

        ok(data !== undefined);
        strictEqual(data.name, 'John');
        strictEqual(data.age, 30);
        strictEqual(data.email, 'john@example.com');
        ok(Object.isFrozen(data));
    });

    test('Immutable.parseValidate throws on validation error', () => {
        const schema = {
            name: string().min(5), // Minimum 5 characters
            age: number().int().positive(),
        };

        const json = '{"name": "Bob", "age": 30}'; // "Bob" is only 3 characters

        throws(() => {
            Immutable.parseValidate(schema, json);
        });
    });

    test('Immutable.parseValidate throws on invalid JSON', () => {
        const schema = {
            name: string(),
        };

        throws(() => {
            Immutable.parseValidate(schema, '{not valid json');
        });
    });

    test('Immutable.safeParseValidate returns success tuple on valid data', () => {
        const schema = {
            name: string().min(3),
            age: number().int().positive(),
        };

        const json = '{"name": "Alice", "age": 25}';
        // Type is automatically inferred from schema!
        const [data, err] = Immutable.safeParseValidate(schema, json);

        strictEqual(err, undefined);
        ok(data !== undefined);
        strictEqual(data.name, 'Alice');
        strictEqual(data.age, 25);
        ok(Object.isFrozen(data));
    });

    test('Immutable.safeParseValidate returns error tuple on validation failure', () => {
        const schema = {
            name: string().min(5),
            age: number().int().positive(),
        };

        const json = '{"name": "Bob", "age": 30}'; // "Bob" is only 3 characters

        const [data, err] = Immutable.safeParseValidate(schema, json);

        strictEqual(data, undefined);
        ok(err instanceof Error);
        ok(err.message.includes('3 >= 5') || err.message.length > 0);
    });

    test('Immutable.parseValidate with SharedArrayBuffer', () => {
        const schema = {
            id: number().int(),
            name: string().min(2),
        };

        const obj = { id: 123, name: 'Test' };
        const json = JSON.stringify(obj);
        const encoded = new TextEncoder().encode(json);
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);

        const data = Immutable.parseValidate(schema, buf);
        strictEqual(data.id, 123);
        strictEqual(data.name, 'Test');
        ok(Object.isFrozen(data));
    });

    test('Immutable.safeParseValidate with SharedArrayBuffer', () => {
        const schema = {
            count: number().int().positive(),
            label: string(),
        };

        const obj = { count: 42, label: 'buffer test' };
        const json = JSON.stringify(obj);
        const encoded = new TextEncoder().encode(json);
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);

        const [data, err] = Immutable.safeParseValidate(schema, buf);
        strictEqual(err, undefined);
        ok(data !== undefined);
        strictEqual(data.count, 42);
        strictEqual(data.label, 'buffer test');
        ok(Object.isFrozen(data));
    });

    test('Immutable.safeParseValidate returns error tuple on invalid JSON', () => {
        const schema = {
            name: string(),
        };

        const [data, err] = Immutable.safeParseValidate(schema, '{not valid json');

        strictEqual(data, undefined);
        ok(err instanceof Error);
    });

    test('Immutable.parseValidate handles type coercion from Validator', () => {
        const schema = {
            name: string(),
            age: number().int(),
        };

        // age is a string in JSON but Validator will coerce it to number
        const json = '{"name": "Charlie", "age": "35"}';
        const data = Immutable.parseValidate(schema, json);

        ok(data !== undefined);
        strictEqual(data.name, 'Charlie');
        strictEqual(typeof data.age, 'number');
        strictEqual(data.age, 35);
        ok(Object.isFrozen(data));
    });

    test('Immutable.parseValidate with custom reviver and validation', () => {
        const schema = {
            name: string(),
            value: number(),
        };

        // Custom reviver multiplies numbers by 10
        const customReviver = (_k: string, v: unknown) => (typeof v === 'number' ? v * 10 : v);

        const json = '{"name": "Test", "value": 5}';
        const data = Immutable.parseValidate(schema, json, customReviver);

        ok(data !== undefined);
        strictEqual(data.name, 'Test');
        strictEqual(data.value, 50); // 5 * 10
        ok(Object.isFrozen(data));
    });

    test('Immutable.freeze converts plain object to frozen Immutable', () => {
        const obj = { x: 10, y: 20 };
        const frozen = Immutable.freeze(obj);

        ok(Object.isFrozen(frozen));
        ok(frozen instanceof Immutable);
        strictEqual(frozen.x, 10);
        strictEqual(frozen.y, 20);
    });

    test('Immutable.freeze prevents modification', () => {
        const obj = { value: 42 };
        const frozen = Immutable.freeze(obj);

        throws(() => {
            (frozen as { value: number }).value = 100;
        });

        strictEqual(frozen.value, 42);
    });

    test('Immutable.freeze works with arrays', () => {
        const arr = [1, 2, 3];
        const frozen = Immutable.freeze(arr);

        ok(Object.isFrozen(frozen));
        ok(Array.isArray(frozen));
        deepStrictEqual(frozen, [1, 2, 3]);
    });

    test('Immutable.freeze works with nested objects', () => {
        const obj = { a: 1, nested: { b: 2 } };
        const frozen = Immutable.freeze(obj);

        ok(Object.isFrozen(frozen));
        strictEqual(frozen.a, 1);
        strictEqual(frozen.nested.b, 2);
    });

    test('Immutable.freeze with class instances preserves prototype', () => {
        class MyClass {
            constructor(public value: number) {}
        }
        const instance = new MyClass(42);
        const frozen = Immutable.freeze(instance);

        ok(Object.isFrozen(frozen));
        ok(frozen instanceof MyClass);
        strictEqual(frozen.value, 42);
    });

    test('Immutable.freeze returns same object reference', () => {
        const obj = { x: 1 };
        const frozen = Immutable.freeze(obj);

        // Same reference (freeze modifies in place)
        strictEqual(frozen, obj);
    });

    test('Immutable.freeze on plain object has undefined mutating methods', () => {
        const obj = { x: 10, y: 20 };
        const frozen = Immutable.freeze(obj);

        // Plain objects get Immutable prototype, so mutating methods are undefined
        strictEqual((frozen as any).push, undefined);
        strictEqual((frozen as any).pop, undefined);
        strictEqual((frozen as any).set, undefined);
        strictEqual((frozen as any).deleteProperty, undefined);
    });

    test('Immutable.freeze on array also sets mutating methods to undefined', () => {
        const arr = [1, 2, 3];
        const frozen = Immutable.freeze(arr);

        // Arrays also get mutating methods set to undefined for consistency
        strictEqual((frozen as any).push, undefined);
        strictEqual((frozen as any).pop, undefined);

        // Array remains frozen
        ok(Object.isFrozen(frozen));
        deepStrictEqual(frozen, [1, 2, 3]);
    });
});

// ============================================================================
// isEmpty Tests
// ============================================================================

describe('isEmpty', () => {
    test('returns true for empty object', () => {
        strictEqual(isEmpty({}), true);
    });
    test('returns false for non-empty object', () => {
        strictEqual(isEmpty({ a: 1 }), false);
    });
    test('returns true for empty array', () => {
        strictEqual(isEmpty([]), true);
    });
    test('returns false for non-empty array', () => {
        strictEqual(isEmpty([1]), false);
    });
    test('returns true for empty Map', () => {
        strictEqual(isEmpty(new Map()), true);
    });
    test('returns false for non-empty Map', () => {
        const m = new Map();
        m.set('a', 1);
        strictEqual(isEmpty(m), false);
    });
    test('returns true for empty Set', () => {
        strictEqual(isEmpty(new Set()), true);
    });
    test('returns false for non-empty Set', () => {
        const s = new Set();
        s.add(1);
        strictEqual(isEmpty(s), false);
    });
    test('returns true for null', () => {
        strictEqual(isEmpty(null), true);
    });
    test('returns true for undefined', () => {
        strictEqual(isEmpty(undefined), true);
    });
    test('returns true for number', () => {
        strictEqual(isEmpty(0), true);
        strictEqual(isEmpty(42), true);
    });
    test('returns true for string', () => {
        strictEqual(isEmpty(''), true);
        strictEqual(isEmpty('abc'), true);
    });
});

// ============================================================================
// isDeepEqual Tests
// ============================================================================

describe('isDeepEqual', () => {
    test('isDeepEqual positive', () => {
        // objects
        strictEqual(isDeepEqual({ x: 1, y: { z: 2 } }, { x: 1, y: { z: 2 } }), true);
        // arrays
        strictEqual(isDeepEqual([1, 2, [3, 4]], [1, 2, [3, 4]]), true);
        // primitives
        strictEqual(isDeepEqual(42, 42), true);
        strictEqual(isDeepEqual('abc', 'abc'), true);
        // Immutable instances
        strictEqual(isDeepEqual({ foo: 'bar', baz: [1, 2] }, { foo: 'bar', baz: [1, 2] }), true);
    });

    test('isDeepEqual negative', () => {
        // objects
        strictEqual(isDeepEqual({ x: 1, y: { z: 2 } }, { x: 1, y: { z: 3 } }), false);
        // arrays
        strictEqual(isDeepEqual([1, 2, [3, 4]], [1, 2, [3, 5]]), false);
        // primitives
        strictEqual(isDeepEqual(42, 43), false);
        strictEqual(isDeepEqual('abc', 'def'), false);
        // Immutable instances
        strictEqual(isDeepEqual({ foo: 'bar', baz: [1, 2] }, { foo: 'bar', baz: [1, 3] }), false);
    });
});

// ============================================================================
// reviverFn and replacerFn Tests
// ============================================================================

describe('reviverFn and replacerFn', () => {
    test('replacerFn encodes BigInt as string with "n" suffix', () => {
        const obj = { x: 5, y: 42n, z: 'hello' };
        const json = JSON.stringify(obj, replacerFn);
        ok(json.includes('"y":"42n"'), 'BigInt should be encoded as "42n"');
        ok(json.includes('"x":5'), 'Number should remain as number');
        ok(json.includes('"z":"hello"'), 'String should remain as string');
    });

    test('reviverFn decodes string with "n" suffix to BigInt', () => {
        const json = '{"x": 5, "y": "42n", "z": "hello"}';
        const obj = JSON.parse(json, reviverFn) as { x: number; y: bigint; z: string };
        strictEqual(obj.x, 5, 'Number should remain as number');
        strictEqual(typeof obj.y, 'bigint', 'String "42n" should be decoded to BigInt');
        strictEqual(obj.y, 42n, 'BigInt value should be 42n');
        strictEqual(obj.z, 'hello', 'Regular string should remain unchanged');
    });

    test('reviverFn filters out properties starting with "__"', () => {
        const json = '{"x": 5, "__proto__": {"polluted": true}, "__constructor__": {"evil": true}, "y": 10}';
        const obj = JSON.parse(json, reviverFn) as { x: number; y: number };
        strictEqual(obj.x, 5);
        strictEqual(obj.y, 10);
        strictEqual(Object.hasOwn(obj, '__proto__'), false, '__proto__ should be filtered out');
        strictEqual(Object.hasOwn(obj, '__constructor__'), false, '__constructor__ should be filtered out');
    });

    test('reviverFn and replacerFn roundtrip with BigInt', () => {
        const original = { a: 1, b: 'hello', c: 42n, d: -123n };
        const json = JSON.stringify(original, replacerFn);
        const parsed = JSON.parse(json, reviverFn) as typeof original;
        strictEqual(parsed.a, 1);
        strictEqual(parsed.b, 'hello');
        strictEqual(typeof parsed.c, 'bigint');
        strictEqual(parsed.c, 42n);
        strictEqual(typeof parsed.d, 'bigint');
        strictEqual(parsed.d, -123n);
    });

    test('reviverFn handles edge cases for BigInt-like strings', () => {
        const json = '{"valid": "123n", "negative": "-456n", "positive": "+789n", "notBigInt": "123", "notBigIntN": "hellon"}';
        const obj = JSON.parse(json, reviverFn) as {
            valid: bigint;
            negative: bigint;
            positive: bigint;
            notBigInt: string;
            notBigIntN: string;
        };
        strictEqual(typeof obj.valid, 'bigint', '"123n" should be BigInt');
        strictEqual(obj.valid, 123n);
        strictEqual(typeof obj.negative, 'bigint', '"-456n" should be BigInt');
        strictEqual(obj.negative, -456n);
        strictEqual(typeof obj.positive, 'bigint', '"+789n" should be BigInt');
        strictEqual(obj.positive, 789n);
        strictEqual(typeof obj.notBigInt, 'string', '"123" without "n" should remain string');
        strictEqual(obj.notBigInt, '123');
        strictEqual(typeof obj.notBigIntN, 'string', '"hellon" is not a valid BigInt');
        strictEqual(obj.notBigIntN, 'hellon');
    });
});

// ============================================================================
// Proto Pollution Test
// ============================================================================

describe('proto pollution', () => {
    test('proto pollution', () => {
        const obj: Dict = {};
        const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}', reviverFn);
        Object.assign(obj, malicious);
        ok(!obj.isAdmin);
    });
});
