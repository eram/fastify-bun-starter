import { describe, expect, test } from 'bun:test';
import { number, object, parseValidate, safeParseValidate, string } from '@libs/zody';
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
        expect(both.sides).toBe(3);
        both.sides = 6;
        expect(both.sides).toBe(6);
    });

    test('is<> typing', () => {
        expect(is<object>(null)).toBeTruthy();
    });

    test('isEmpty', () => {
        // Objects
        expect(isEmpty({})).toBe(true);
        expect(isEmpty({ a: 1 })).toBe(false);

        // Arrays
        expect(isEmpty([])).toBe(true);
        expect(isEmpty([1])).toBe(false);

        // Maps
        expect(isEmpty(new Map())).toBe(true);
        const m = new Map();
        m.set('a', 1);
        expect(isEmpty(m)).toBe(false);

        // Sets
        expect(isEmpty(new Set())).toBe(true);
        const s = new Set();
        s.add(1);
        expect(isEmpty(s)).toBe(false);

        // Primitives
        expect(isEmpty(null)).toBe(true);
        expect(isEmpty(undefined)).toBe(true);
        expect(isEmpty(0)).toBe(true);
        expect(isEmpty(42)).toBe(true);
        expect(isEmpty('')).toBe(true);
        expect(isEmpty('abc')).toBe(true);
    });
});

// ============================================================================
// BigInt JSON Support Tests
// ============================================================================

describe('bigint JSON support', () => {
    test('reviverFn handles bigint strings', () => {
        const json = '{"value": "123n"}';
        const parsed = JSON.parse(json, reviverFn);
        expect(typeof parsed.value).toBe('bigint');
        expect(parsed.value).toBe(123n);
    });

    test('replacerFn encodes bigint', () => {
        const obj = { value: 42n };
        const json = JSON.stringify(obj, replacerFn);
        expect(json.includes('"42n"')).toBeTruthy();
    });

    test('bigint roundtrip', () => {
        const obj = { a: 1n, b: 2 };
        const json = JSON.stringify(obj, replacerFn);
        const parsed = JSON.parse(json, reviverFn);
        expect(typeof parsed.a).toBe('bigint');
        expect(parsed.a).toBe(1n);
        expect(parsed.b).toBe(2);
    });

    test('replacerFn with negative bigint', () => {
        const obj = { hello: -20n };
        const str = JSON.stringify(obj, replacerFn, 1);
        expect(str).toBe('{\n "hello": "-20n"\n}');
        const parsed = JSON.parse(str, reviverFn);
        expect(typeof parsed?.hello).toBe('bigint');
        expect(parsed?.hello).toBe(-20n);
    });
});

// ============================================================================
// Immutable Class Tests
// ============================================================================

describe('Immutable tests', () => {
    test('parse() - basic parsing and freezing', () => {
        // Basic JSON parsing
        const obj = Immutable.parse('{"x": 10, "y": 20}');
        expect(Object.isFrozen(obj)).toBeTruthy();
        expect(obj?.['x']).toBe(10);
        expect(obj?.['y']).toBe(20);

        // Invalid JSON throws
        expect(() => Immutable.parse('{not valid json')).toThrow();

        // BigInt roundtrip
        const bigintObj = { a: 1n, b: 2 };
        const parsed = Immutable.parse(JSON.stringify(bigintObj, replacerFn));
        expect(typeof parsed?.['a']).toBe('bigint');
        expect(parsed?.['a']).toBe(1n);
        expect(parsed?.['b']).toBe(2);

        // Custom reviver
        const customParsed = Immutable.parse('{"a": 1, "b": 2}', (_k: string, v: unknown) =>
            typeof v === 'number' ? v * 10 : v,
        );
        expect(customParsed?.['a']).toBe(10);
        expect(customParsed?.['b']).toBe(20);

        // Prototype pollution protection
        const polluted = Immutable.parse('{"__proto__":{"evil":true}}');
        expect(!Object.hasOwn(polluted, 'evil')).toBeTruthy();
        expect(!polluted?.['evil']).toBeTruthy();

        // Mutating methods are undefined
        expect(obj?.['set']).toBe(undefined);
        expect(obj?.['deleteProperty']).toBe(undefined);
        expect(obj?.['push']).toBe(undefined);
        expect(obj?.['pop']).toBe(undefined);
    });

    test('parse() - ArrayBuffer and SharedArrayBuffer support', () => {
        // SharedArrayBuffer
        const obj1 = { x: 5, y: 'world' };
        const encoded1 = new TextEncoder().encode(JSON.stringify(obj1));
        const buf1 = new SharedArrayBuffer(encoded1.byteLength);
        new Uint8Array(buf1).set(encoded1);
        const parsed1 = Immutable.parse<typeof obj1>(buf1);
        expect(parsed1.x).toBe(5);
        expect(parsed1.y).toBe('world');
        expect(Object.isFrozen(parsed1)).toBeTruthy();

        // ArrayBuffer
        const obj2 = { a: 1, b: 'test' };
        const encoded2 = new TextEncoder().encode(JSON.stringify(obj2));
        const parsed2 = Immutable.parse<typeof obj2>(encoded2.buffer);
        expect(parsed2.a).toBe(1);
        expect(parsed2.b).toBe('test');
        expect(Object.isFrozen(parsed2)).toBeTruthy();
    });

    test('safeParse() - success and error handling', () => {
        // Success case
        const [data1, err1] = Immutable.safeParse<{ x: number; y: number }>('{"x": 10, "y": 20}');
        expect(err1).toBe(undefined);
        expect(data1?.x).toBe(10);
        expect(data1?.y).toBe(20);
        expect(Object.isFrozen(data1)).toBeTruthy();

        // Error case
        const [data2, err2] = Immutable.safeParse('{not valid json');
        expect(data2).toBe(undefined);
        expect(err2 instanceof Error).toBeTruthy();

        // BigInt handling
        const [data3, err3] = Immutable.safeParse<{ value: bigint; normal: number }>('{"value": "123n", "normal": 456}');
        expect(err3).toBe(undefined);
        expect(typeof data3?.value).toBe('bigint');
        expect(data3?.value).toBe(123n);

        // Custom reviver
        const [data4, err4] = Immutable.safeParse('{"a": 1}', (_k: string, v: unknown) => (typeof v === 'number' ? v * 10 : v));
        expect(err4).toBe(undefined);
        expect(data4?.['a']).toBe(10);

        // SharedArrayBuffer
        const encoded = new TextEncoder().encode('{"x": 100}');
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);
        const [data5, err5] = Immutable.safeParse<{ x: number }>(buf);
        expect(err5).toBe(undefined);
        expect(data5?.x).toBe(100);
    });

    test('parseValidate() - schema validation', () => {
        const schema = object({ name: string().min(3), age: number().int().positive() });

        // Valid data
        const data = parseValidate(schema, '{"name": "John", "age": 30}');
        expect(data.name).toBe('John');
        expect(data.age).toBe(30);
        expect(Object.isFrozen(data)).toBeTruthy();

        // Validation error
        expect(() => parseValidate(object({ name: string().min(5) }), '{"name": "Bob"}')).toThrow();

        // Invalid JSON
        expect(() => parseValidate(schema, '{not valid json')).toThrow();

        // Type coercion
        const coerced = parseValidate(schema, '{"name": "Charlie", "age": "35"}');
        expect(typeof coerced.age).toBe('number');
        expect(coerced.age).toBe(35);

        // Custom reviver
        const customSchema = object({ name: string(), value: number() });
        const custom = parseValidate(customSchema, '{"name": "Test", "value": 5}', (_k: string, v: unknown) =>
            typeof v === 'number' ? v * 10 : v,
        );
        expect(custom.value).toBe(50);

        // SharedArrayBuffer
        const encoded = new TextEncoder().encode('{"name": "Test", "age": 25}');
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);
        const bufData = parseValidate(schema, buf);
        expect(bufData.name).toBe('Test');
        expect(Object.isFrozen(bufData)).toBeTruthy();
    });

    test('safeParseValidate() - safe schema validation', () => {
        const schema = object({ name: string().min(3), age: number().int().positive() });

        // Success case
        const [data1, err1] = safeParseValidate(schema, '{"name": "Alice", "age": 25}');
        expect(err1).toBe(undefined);
        expect(data1?.name).toBe('Alice');
        expect(data1?.age).toBe(25);
        expect(Object.isFrozen(data1)).toBeTruthy();

        // Validation failure
        const [data2, err2] = safeParseValidate(object({ name: string().min(5) }), '{"name": "Bob"}');
        expect(data2).toBe(undefined);
        expect(err2 instanceof Error).toBeTruthy();

        // Invalid JSON
        const [data3, err3] = safeParseValidate(schema, '{not valid json');
        expect(data3).toBe(undefined);
        expect(err3 instanceof Error).toBeTruthy();

        // SharedArrayBuffer
        const encoded = new TextEncoder().encode('{"name": "Test", "age": 30}');
        const buf = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(buf).set(encoded);
        const [data4, err4] = safeParseValidate(schema, buf);
        expect(err4).toBe(undefined);
        expect(data4?.name).toBe('Test');
    });

    test('freeze() - freezing existing objects', () => {
        // Basic object
        const obj = { x: 10, y: 20 };
        const frozen1 = Immutable.freeze(obj);
        expect(Object.isFrozen(frozen1)).toBeTruthy();
        expect(frozen1 instanceof Immutable).toBeTruthy();
        expect(frozen1.x).toBe(10);
        expect(frozen1).toBe(obj); // Same reference

        // Prevents modification
        expect(() => {
            (frozen1 as { x: number }).x = 100;
        }).toThrow();

        // Arrays
        const arr = [1, 2, 3];
        const frozen2 = Immutable.freeze(arr);
        expect(Object.isFrozen(frozen2)).toBeTruthy();
        expect(Array.isArray(frozen2)).toBeTruthy();
        expect(frozen2).toStrictEqual([1, 2, 3]);
        expect(Object(frozen2).push).toBe(undefined);
        expect(Object(frozen2).pop).toBe(undefined);

        // Nested objects
        const nested = { a: 1, nested: { b: 2 } };
        const frozen3 = Immutable.freeze(nested);
        expect(Object.isFrozen(frozen3)).toBeTruthy();
        expect(frozen3.nested.b).toBe(2);

        // Class instances preserve prototype
        class MyClass {
            value: number;
            constructor(value: number) {
                this.value = value;
            }
        }
        const instance = new MyClass(42);
        const frozen4 = Immutable.freeze(instance);
        expect(Object.isFrozen(frozen4)).toBeTruthy();
        expect(frozen4 instanceof MyClass).toBeTruthy();
        expect(frozen4.value).toBe(42);

        // Mutating methods are undefined
        expect(Object(frozen1).set).toBe(undefined);
        expect(Object(frozen1).deleteProperty).toBe(undefined);
    });
});

// ============================================================================
// reviverFn and replacerFn Tests
// ============================================================================

describe('reviverFn and replacerFn', () => {
    test('replacerFn encodes BigInt as string with "n" suffix', () => {
        const obj = { x: 5, y: 42n, z: 'hello' };
        const json = JSON.stringify(obj, replacerFn);
        expect(json.includes('"y":"42n"')).toBeTruthy();
        expect(json.includes('"x":5')).toBeTruthy();
        expect(json.includes('"z":"hello"')).toBeTruthy();
    });

    test('reviverFn decodes string with "n" suffix to BigInt', () => {
        const json = '{"x": 5, "y": "42n", "z": "hello"}';
        const obj = JSON.parse(json, reviverFn) as { x: number; y: bigint; z: string };
        expect(obj.x).toBe(5);
        expect(typeof obj.y).toBe('bigint');
        expect(obj.y).toBe(42n);
        expect(obj.z).toBe('hello');
    });

    test('reviverFn filters out properties starting with "__"', () => {
        const json = '{"x": 5, "__proto__": {"polluted": true}, "__constructor__": {"evil": true}, "y": 10}';
        const obj = JSON.parse(json, reviverFn) as { x: number; y: number };
        expect(obj.x).toBe(5);
        expect(obj.y).toBe(10);
        expect(Object.hasOwn(obj, '__proto__')).toBe(false);
        expect(Object.hasOwn(obj, '__constructor__')).toBe(false);
    });

    test('reviverFn and replacerFn roundtrip with BigInt', () => {
        const original = { a: 1, b: 'hello', c: 42n, d: -123n };
        const json = JSON.stringify(original, replacerFn);
        const parsed = JSON.parse(json, reviverFn) as typeof original;
        expect(parsed.a).toBe(1);
        expect(parsed.b).toBe('hello');
        expect(typeof parsed.c).toBe('bigint');
        expect(parsed.c).toBe(42n);
        expect(typeof parsed.d).toBe('bigint');
        expect(parsed.d).toBe(-123n);
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
        expect(typeof obj.valid).toBe('bigint');
        expect(obj.valid).toBe(123n);
        expect(typeof obj.negative).toBe('bigint');
        expect(obj.negative).toBe(-456n);
        expect(typeof obj.positive).toBe('bigint');
        expect(obj.positive).toBe(789n);
        expect(typeof obj.notBigInt).toBe('string');
        expect(obj.notBigInt).toBe('123');
        expect(typeof obj.notBigIntN).toBe('string');
        expect(obj.notBigIntN).toBe('hellon');
    });

    test('proto pollution', () => {
        const obj: Dict = {};
        const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}', reviverFn);
        Object.assign(obj, malicious);
        expect(!obj['isAdmin']).toBeTruthy();
    });

    test('reviverFn filters __ properties', () => {
        const json = '{"__test": "filtered", "__another": 123, "normal": 1}';
        const parsed = JSON.parse(json, reviverFn);
        // Properties starting with __ are filtered (become undefined)
        expect(!('__test' in parsed)).toBeTruthy();
        expect(!('__another' in parsed)).toBeTruthy();
        expect(parsed.normal).toBe(1);
    });
});
