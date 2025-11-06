import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { number, string } from '../lib/validator/validator';
import { type Dict, Immutable, is, isEmpty, replacerFn, reviverFn, type Union } from './immutable';

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

    test('is<> typing', () => {
        ok(is<object>(null));
    });

    test('isEmpty', () => {
        // Objects
        strictEqual(isEmpty({}), true);
        strictEqual(isEmpty({ a: 1 }), false);

        // Arrays
        strictEqual(isEmpty([]), true);
        strictEqual(isEmpty([1]), false);

        // Maps
        strictEqual(isEmpty(new Map()), true);
        const m = new Map();
        m.set('a', 1);
        strictEqual(isEmpty(m), false);

        // Sets
        strictEqual(isEmpty(new Set()), true);
        const s = new Set();
        s.add(1);
        strictEqual(isEmpty(s), false);

        // Primitives
        strictEqual(isEmpty(null), true);
        strictEqual(isEmpty(undefined), true);
        strictEqual(isEmpty(0), true);
        strictEqual(isEmpty(42), true);
        strictEqual(isEmpty(''), true);
        strictEqual(isEmpty('abc'), true);
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
    test('parse() - basic parsing and freezing', () => {
        // Basic JSON parsing
        const obj = Immutable.parse('{"x": 10, "y": 20}');
        ok(Object.isFrozen(obj));
        strictEqual(obj?.x, 10);
        strictEqual(obj?.y, 20);

        // Invalid JSON throws
        throws(() => Immutable.parse('{not valid json'));

        // BigInt roundtrip
        const bigintObj = { a: 1n, b: 2 };
        const parsed = Immutable.parse(JSON.stringify(bigintObj, replacerFn));
        strictEqual(typeof parsed?.a, 'bigint');
        strictEqual(parsed?.a, 1n);
        strictEqual(parsed?.b, 2);

        // Custom reviver
        const customParsed = Immutable.parse('{"a": 1, "b": 2}', (_k, v) => (typeof v === 'number' ? v * 10 : v));
        strictEqual(customParsed?.a, 10);
        strictEqual(customParsed?.b, 20);

        // Prototype pollution protection
        const polluted = Immutable.parse('{"__proto__":{"evil":true}}');
        ok(!Object.hasOwn(polluted, 'evil'));
        ok(!polluted?.evil);

        // Mutating methods are undefined
        strictEqual(obj?.set, undefined);
        strictEqual(obj?.deleteProperty, undefined);
        strictEqual(obj?.push, undefined);
        strictEqual(obj?.pop, undefined);
    });

    test('parse() - ArrayBuffer and SharedArrayBuffer support', () => {
        // SharedArrayBuffer
        const obj1 = { x: 5, y: 'world' };
        const encoded1 = new TextEncoder().encode(JSON.stringify(obj1));
        const buf1 = new SharedArrayBuffer(encoded1.byteLength);
        new Uint8Array(buf1).set(encoded1);
        const parsed1 = Immutable.parse<typeof obj1>(buf1);
        strictEqual(parsed1.x, 5);
        strictEqual(parsed1.y, 'world');
        ok(Object.isFrozen(parsed1));

        // ArrayBuffer
        const obj2 = { a: 1, b: 'test' };
        const encoded2 = new TextEncoder().encode(JSON.stringify(obj2));
        const parsed2 = Immutable.parse<typeof obj2>(encoded2.buffer);
        strictEqual(parsed2.a, 1);
        strictEqual(parsed2.b, 'test');
        ok(Object.isFrozen(parsed2));
    });

    test('safeParse() - success and error handling', () => {
        // Success case
        const [data1, err1] = Immutable.safeParse<{ x: number; y: number }>('{"x": 10, "y": 20}');
        strictEqual(err1, undefined);
        strictEqual(data1?.x, 10);
        strictEqual(data1?.y, 20);
        ok(Object.isFrozen(data1));

        // Error case
        const [data2, err2] = Immutable.safeParse('{not valid json');
        strictEqual(data2, undefined);
        ok(err2 instanceof Error);

        // BigInt handling
        const [data3, err3] = Immutable.safeParse<{ value: bigint; normal: number }>('{"value": "123n", "normal": 456}');
        strictEqual(err3, undefined);
        strictEqual(typeof data3?.value, 'bigint');
        strictEqual(data3?.value, 123n);

        // Custom reviver
        const [data4, err4] = Immutable.safeParse('{"a": 1}', (_k, v) => (typeof v === 'number' ? v * 10 : v));
        strictEqual(err4, undefined);
        strictEqual(data4?.a, 10);

        // SharedArrayBuffer
        const encoded = new TextEncoder().encode('{"x": 100}');
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);
        const [data5, err5] = Immutable.safeParse<{ x: number }>(buf);
        strictEqual(err5, undefined);
        strictEqual(data5?.x, 100);
    });

    test('parseValidate() - schema validation', () => {
        const schema = { name: string().min(3), age: number().int().positive() };

        // Valid data
        const data = Immutable.parseValidate(schema, '{"name": "John", "age": 30}');
        strictEqual(data.name, 'John');
        strictEqual(data.age, 30);
        ok(Object.isFrozen(data));

        // Validation error
        throws(() => Immutable.parseValidate({ name: string().min(5) }, '{"name": "Bob"}'));

        // Invalid JSON
        throws(() => Immutable.parseValidate(schema, '{not valid json'));

        // Type coercion
        const coerced = Immutable.parseValidate(schema, '{"name": "Charlie", "age": "35"}');
        strictEqual(typeof coerced.age, 'number');
        strictEqual(coerced.age, 35);

        // Custom reviver
        const customSchema = { name: string(), value: number() };
        const custom = Immutable.parseValidate(customSchema, '{"name": "Test", "value": 5}', (_k, v) =>
            typeof v === 'number' ? v * 10 : v,
        );
        strictEqual(custom.value, 50);

        // SharedArrayBuffer
        const encoded = new TextEncoder().encode('{"name": "Test", "age": 25}');
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);
        const bufData = Immutable.parseValidate(schema, buf);
        strictEqual(bufData.name, 'Test');
        ok(Object.isFrozen(bufData));
    });

    test('safeParseValidate() - safe schema validation', () => {
        const schema = { name: string().min(3), age: number().int().positive() };

        // Success case
        const [data1, err1] = Immutable.safeParseValidate(schema, '{"name": "Alice", "age": 25}');
        strictEqual(err1, undefined);
        strictEqual(data1?.name, 'Alice');
        strictEqual(data1?.age, 25);
        ok(Object.isFrozen(data1));

        // Validation failure
        const [data2, err2] = Immutable.safeParseValidate({ name: string().min(5) }, '{"name": "Bob"}');
        strictEqual(data2, undefined);
        ok(err2 instanceof Error);

        // Invalid JSON
        const [data3, err3] = Immutable.safeParseValidate(schema, '{not valid json');
        strictEqual(data3, undefined);
        ok(err3 instanceof Error);

        // SharedArrayBuffer
        const encoded = new TextEncoder().encode('{"name": "Test", "age": 30}');
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);
        const [data4, err4] = Immutable.safeParseValidate(schema, buf);
        strictEqual(err4, undefined);
        strictEqual(data4?.name, 'Test');
    });

    test('freeze() - freezing existing objects', () => {
        // Basic object
        const obj = { x: 10, y: 20 };
        const frozen1 = Immutable.freeze(obj);
        ok(Object.isFrozen(frozen1));
        ok(frozen1 instanceof Immutable);
        strictEqual(frozen1.x, 10);
        strictEqual(frozen1, obj); // Same reference

        // Prevents modification
        throws(() => {
            (frozen1 as { x: number }).x = 100;
        });

        // Arrays
        const arr = [1, 2, 3];
        const frozen2 = Immutable.freeze(arr);
        ok(Object.isFrozen(frozen2));
        ok(Array.isArray(frozen2));
        deepStrictEqual(frozen2, [1, 2, 3]);
        strictEqual((frozen2 as any).push, undefined);
        strictEqual((frozen2 as any).pop, undefined);

        // Nested objects
        const nested = { a: 1, nested: { b: 2 } };
        const frozen3 = Immutable.freeze(nested);
        ok(Object.isFrozen(frozen3));
        strictEqual(frozen3.nested.b, 2);

        // Class instances preserve prototype
        class MyClass {
            constructor(public value: number) {}
        }
        const instance = new MyClass(42);
        const frozen4 = Immutable.freeze(instance);
        ok(Object.isFrozen(frozen4));
        ok(frozen4 instanceof MyClass);
        strictEqual(frozen4.value, 42);

        // Mutating methods are undefined
        strictEqual((frozen1 as any).set, undefined);
        strictEqual((frozen1 as any).deleteProperty, undefined);
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

    test('proto pollution', () => {
        const obj: Dict = {};
        const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}', reviverFn);
        Object.assign(obj, malicious);
        ok(!obj.isAdmin);
    });

    test('reviverFn filters __ properties', () => {
        const json = '{"__test": "filtered", "__another": 123, "normal": 1}';
        const parsed = JSON.parse(json, reviverFn);
        // Properties starting with __ are filtered (become undefined)
        ok(!('__test' in parsed));
        ok(!('__another' in parsed));
        strictEqual(parsed.normal, 1);
    });
});
