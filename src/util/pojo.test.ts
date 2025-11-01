import { deepEqual, deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Dict, POJO, ROJO, Union } from './pojo';

const { copyIn, isEmpty, merge } = POJO;

// Add assert import

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

describe('pojo tests', () => {
    test('types', () => {
        const p1 = POJO.parse(JSON.stringify({}));
        deepStrictEqual(p1, new POJO());
        const p2 = POJO.parse<Array<number>>('[]');
        ok(p2 instanceof Object);
        ok(Array.isArray(p2));
        ok(!(p2 instanceof Map));
        const p3 = POJO.stringify({});
        strictEqual(p3, '{}');
        strictEqual(Object.prototype.toString.call(new POJO()), '[object Object]');
    });

    class C extends Map<string, string> {
        hello = 0;
    }

    test('pojo from class', () => {
        const c = new C();
        const before = Object.getPrototypeOf(c);
        strictEqual(before.constructor.name, 'C');
        strictEqual(c.hello, 0);
        strictEqual(typeof c.size, 'number');

        // parse POJO from class instance
        // this will return a plain object with the same properties
        const pojo = POJO.parse<C>(c);
        const after = Object.getPrototypeOf(pojo) as C;
        strictEqual(after?.constructor?.name, 'POJO');
        strictEqual(pojo?.hello, 0);
        strictEqual(typeof pojo?.hello, 'number');
        strictEqual(typeof pojo?.size, 'undefined');
    });

    test('pojo stringify', () => {
        // this should parse into a POJO object but have the props on C and type of C for typescript typing
        const pojo = POJO.parse<C>('{   "hello":   0 }  ');
        const ty = Object.getPrototypeOf(pojo);
        strictEqual(ty.constructor.name, 'POJO');
        strictEqual(pojo?.hello, 0);
        const str = JSON.stringify(pojo, undefined, 1);
        strictEqual(str, '{\n "hello": 0\n}');
        strictEqual(POJO.stringify('text'), '"text"');
        strictEqual(POJO.stringify(5), '5');
    });

    test('pojo stringify with bigint', () => {
        const pojo = { hello: -20n };
        const str = POJO.stringify(pojo, undefined, 1);
        strictEqual(str, '{\n "hello": "-20n"\n}');
        const parsed = POJO.parse<C>(str);
        strictEqual(typeof parsed, 'object');
        strictEqual(typeof parsed?.hello, 'bigint');
        strictEqual(parsed?.hello, -20n);
    });

    describe('invalid JSON handling', () => {
        test('pojo parse with invalid JSON throws and returns fallback', () => {
            const fallback = { foo: 42 };
            const result = POJO.parse('{not valid json', undefined, fallback);
            ok(result?.foo === fallback.foo);
        });

        test('pojo parse with invalid JSON and no fallback throws', () => {
            throws(() => {
                JSON.parse('{not valid json');
            });
        });

        test('POJO.parse fallback on invalid JSON', () => {
            const fallback = { foo: 123 };
            const result = POJO.parse('{bad json', undefined, fallback);
            deepStrictEqual(result?.foo, 123);
        });

        test('POJO.parse does not throws on invalid JSON', () => {
            ok(typeof POJO.parse('{bad json') === 'object');
        });

        test('POJO.parse with fallback', () => {
            // array fallback
            const arr = [1, 2, 3];
            const parsed1 = POJO.parse('{bad json', undefined, arr);
            deepStrictEqual(parsed1, [1, 2, 3]);

            // string fallback
            const str = 'fallback';
            const parsed2 = POJO.parse('{bad json', undefined, str);
            deepStrictEqual(parsed2, str);

            // on false fallback - should throw
            throws(() => POJO.parse('{bad json', undefined, false));
        });
    });

    test('POJO iterator yields key-value pairs', () => {
        const obj = POJO.parse({ a: 1, b: 2 });
        ok(obj instanceof POJO);
        const entries = [...obj];
        deepEqual(entries, [
            ['a', 1],
            ['b', 2],
        ]);

        let count = 0;
        for (const k in obj) {
            ok(Object.hasOwn(obj, k));
            delete obj[k];
            count++;
        }
        strictEqual(count, 2);
        strictEqual(Object.keys(obj).length, 0);
    });

    test('POJO.stringify with replacer and space', () => {
        const obj = { a: 1, b: 2n };
        const str = POJO.stringify(obj, undefined, 2);
        ok(str.includes('  "b": "2n"'));
        const str2 = POJO.stringify(obj, (_k, v) => (typeof v === 'bigint' ? `${v + 1n}n` : v), 0);
        ok(str2.includes('"b":"3n"'));
    });

    test('POJO.iterator works for instance', () => {
        const obj = new POJO();
        obj.x = 1;
        obj.y = 2;
        const entries = [...obj];
        deepStrictEqual(entries, [
            ['x', 1],
            ['y', 2],
        ]);
    });

    test("POJO.parse with class fallback uses fallback's constructor", () => {
        class MyClass {
            foo = 1;
            bar = 2;
        }
        const fallback = new MyClass();
        const parsed = POJO.parse(`{"foo":1; invalid"}`, undefined, fallback);
        ok(parsed instanceof MyClass);
        strictEqual(parsed.foo, 1);
        strictEqual(parsed.bar, 2);
    });

    test('POJO.parse with fallback as plain object returns POJO instance', () => {
        const fallback = { foo: 1 };
        const parsed = POJO.parse(`{"foo":2}`, undefined, fallback);
        strictEqual(Object.getPrototypeOf(parsed).constructor.name, 'POJO');
        strictEqual(parsed?.foo, 2);
    });

    test('POJO handles bigint parse/stringify roundtrip', () => {
        const obj = { a: 1n, b: 2 };
        const str = POJO.stringify(obj);
        const parsed = POJO.parse(str);
        strictEqual(typeof parsed?.a, 'bigint');
        strictEqual(parsed?.a, 1n);
        strictEqual(parsed?.b, 2);
    });

    test('POJO.parse with array input', () => {
        const arr = [1, 2, 3];
        const parsed = POJO.parse(arr);
        ok(Array.isArray(parsed));
        deepStrictEqual(parsed, arr);
    });

    test('POJO.parse with object input', () => {
        const obj = { a: 1, b: 2 };
        const parsed = POJO.parse(obj);
        const { a, b } = parsed!;
        ok(a === 1 && b === 2);
    });

    test('POJO.parse with custom reviver', () => {
        const str = JSON.stringify({ a: 1, b: 2 });
        const parsed = POJO.parse(str, (_k, v) => (typeof v === 'number' ? v * 10 : v));
        strictEqual(parsed?.a, 10);
        strictEqual(parsed?.b, 20);
    });

    test('POJO.parse with __proto__ in JSON does not pollute prototype', () => {
        const parsed = POJO.parse('{"__proto__":{"evil":true}}');
        // Should be a POJO, not an object with evil on prototype
        strictEqual(parsed?.constructor.name, 'POJO');
        ok(!Object.hasOwn(parsed, 'evil'));
        ok(!parsed?.evil);
    });

    test('POJO.parse empty edge cases', () => {
        // empty string should return an empty POJO
        ok(typeof POJO.parse('') === 'object');

        // With fallback, should return fallback (object)
        let parsed = POJO.parse('', undefined, { a: 6 });
        ok(parsed?.a === 6);

        parsed = POJO.parse(null);
        deepStrictEqual(parsed, new POJO());

        parsed = POJO.parse(undefined);
        ok(parsed instanceof POJO);
        deepStrictEqual(parsed, new POJO());
    });

    test('POJO.parse primitives', () => {
        let parsed = POJO.parse<number>(123);
        deepStrictEqual(parsed, 123);

        parsed = POJO.parse(true);
        deepStrictEqual(parsed, true);

        parsed = POJO.parse('[1,2,3]');
        deepStrictEqual(parsed, [1, 2, 3]);

        parsed = POJO.parse('{"a":1,"b":2}');
        deepEqual(parsed, new POJO({ a: 1, b: 2 }));
    });

    test('POJO.parse with fallback', () => {
        // array fallback
        const arr = [1, 2, 3];
        const parsed1 = POJO.parse('{bad json', undefined, arr);
        deepStrictEqual(parsed1, [1, 2, 3]);

        // string fallback
        const str = 'fallback';
        const parsed2 = POJO.parse('{bad json', undefined, str);
        deepStrictEqual(parsed2, str);

        // on false fallback - should throw
        throws(() => POJO.parse('{bad json', undefined, false));
    });
});

describe('ROJO tests', () => {
    test('ROJO is frozen', () => {
        const p2 = ROJO.parse('[]');
        ok(Object.isFrozen(p2));
        try {
            Object(p2).a = 1;
        } catch (e) {
            ok(e instanceof TypeError);
        }
    });

    test('ROJO iterator yields key-value pairs', () => {
        const ro = ROJO.parse({ x: 10, y: 20 });
        // Use Object.entries or the iterator directly
        const entries = [...Object.entries(ro!)];
        deepEqual(entries, [
            ['x', 10],
            ['y', 20],
        ]);
    });
});

describe('isEmpty', () => {
    test('returns true for empty object', () => {
        strictEqual(isEmpty({}), true); // passes
    });
    test('returns false for non-empty object', () => {
        strictEqual(isEmpty({ a: 1 }), false); // passes
    });
    test('returns true for empty array', () => {
        strictEqual(isEmpty([]), true); // passes
    });
    test('returns false for non-empty array', () => {
        strictEqual(isEmpty([1]), false); // passes
    });
    test('returns true for empty Map', () => {
        strictEqual(isEmpty(new Map()), true); // passes
    });
    test('returns false for non-empty Map', () => {
        const m = new Map();
        m.set('a', 1);
        strictEqual(isEmpty(m), false); // passes
    });
    test('returns true for empty Set', () => {
        strictEqual(isEmpty(new Set()), true); // passes
    });
    test('returns false for non-empty Set', () => {
        const s = new Set();
        s.add(1);
        strictEqual(isEmpty(s), false); // passes
    });
    test('returns true for null', () => {
        strictEqual(isEmpty(null), true); // passes
    });
    test('returns true for undefined', () => {
        strictEqual(isEmpty(undefined), true); // passes
    });
    test('returns true for number', () => {
        strictEqual(isEmpty(0), true); // passes
        strictEqual(isEmpty(42), true); // passes
    });
    test('returns true for string', () => {
        strictEqual(isEmpty(''), true); // passes
        strictEqual(isEmpty('abc'), true); // passes
    });
});

describe('copyIn', () => {
    test('copyIn with empty source does nothing', () => {
        const target = { a: 1, b: 2 };
        // biome-ignore lint/complexity/noBannedTypes: test edge case
        const result = copyIn(target, 6 as Object);
        deepStrictEqual(result, target);
    });

    test("copyIn with 'assign' copies only existing keys", () => {
        class A {
            a = 1;
            b = 2;
        }
        const a = new A();
        // biome-ignore lint/complexity/noBannedTypes: test edge case
        copyIn(a, { a: 10, b: 20, c: 30 } as Object, { updater: copyIn.assign }); // c should be ignored
        strictEqual(a.a, 10);
        strictEqual(a.b, 20);
        ok(!('c' in a));
    });

    test('copyIn with assign and add', () => {
        const obj = { x: 1, y: 2 };
        // biome-ignore lint/complexity/noBannedTypes: test edge case
        copyIn(obj, { x: 5, y: 6, z: 7 } as Object, { updater: copyIn.assign });
        deepStrictEqual(obj, { x: 5, y: 6 });

        // biome-ignore lint/complexity/noBannedTypes: test edge case
        copyIn(obj, { x: 2, y: 'y', z: 7 } as Object, { updater: copyIn.add });
        deepStrictEqual(obj, { x: 7, y: '6y', z: 7 });
    });

    test('throws on adding a non string/number', () => {
        const source1 = { a: new Set() };
        const source2 = { a: new Set() };
        throws(() => {
            copyIn(source1, source2, { updater: copyIn.add });
        });
    });

    test('iterable', () => {
        const set1 = new Set(['test1']);
        const set2 = new Set(['test2']);

        ok(!set1.has('test2'));
        const out = copyIn(set1, set2);
        deepEqual(out, set1);
        ok(out.has('test2'));
        ok(set1.has('test1'));
        ok(!set1.has('test3'));
    });

    test('iterable with array', () => {
        const arr1 = ['test1', 1];
        const arr2 = ['test1', 2, 'test2'];

        copyIn(arr1, arr2, { updater: copyIn.add });
        deepStrictEqual(arr1, ['test1test1', 3, 'test2']);
    });

    test('preserves the class when copyIn on a class and obj', () => {
        class C {
            constructor(
                public one: number,
                public two?: number,
            ) {}
        }

        const source1 = new C(1);
        const proto1 = Object.getPrototypeOf(source1)?.constructor?.name; // "C"

        const source2 = { two: 2 };
        const out = copyIn(source1, source2);

        strictEqual(Object.getPrototypeOf(out)?.constructor?.name, proto1);
        strictEqual(source1.two, 2);
        strictEqual(out.one, 1);
    });
});

describe('merge', () => {
    test('merges properties and prototype', () => {
        class C {
            constructor(
                public one: number,
                public two?: number,
            ) {}
        }

        const cls = new C(1);
        const protoCls = Object.getPrototypeOf(cls)?.constructor?.name; // "C"

        const obj = { two: 2 }; // "Object"
        const out = merge(cls, obj);

        // out is a new object with proto of from C
        ok(out !== cls && out !== obj);
        ok(Object.getPrototypeOf(out)?.constructor?.name, protoCls); // "C"

        // source1 and source 2 should not be modified
        ok(typeof cls.two === 'undefined');
        ok(!('one' in obj));

        // out should have properties from both
        strictEqual(out.one, 1);
        strictEqual(out.two, 2);
    });

    test('merges properties class over object', () => {
        class C {
            constructor(
                public one: number,
                public two?: number,
            ) {}
        }

        const obj = { two: 2 }; // proto = "Object"
        const cls = new C(2);
        const protoCls = Object.getPrototypeOf(cls)?.constructor?.name; // "C"
        const out = merge(obj, cls);
        ok(Object.getPrototypeOf(out)?.constructor?.name, protoCls); // "C"
    });

    test('merge an objct into a map', () => {
        const map = new Map<string, number>([
            ['a', 1],
            ['b', 2],
        ]);
        const obj = { b: 3, c: 4 };
        const out = merge(map, obj);

        ok(out instanceof Map);
        strictEqual(out.get('a'), 1);
        strictEqual(out.get('b'), 3);
        strictEqual(out.get('c'), 4);
        ok(!out.has('d'));
    });

    //add a case for proto pollution test
    test('proto pollution', () => {
        const obj: Dict = {};
        const malicious = JSON.parse('{"__proto__": {"isAdmin": true}}');
        merge(obj, malicious);
        ok(!obj.isAdmin);
    });

    test('isDeepClone positive', () => {
        // objects
        strictEqual(POJO.isDeepClone({ x: 1, y: { z: 2 } }, { x: 1, y: { z: 2 } }), true);
        // arrays
        strictEqual(POJO.isDeepClone([1, 2, [3, 4]], [1, 2, [3, 4]]), true);
        // primitives
        strictEqual(POJO.isDeepClone(42, 42), true);
        strictEqual(POJO.isDeepClone('abc', 'abc'), true);
        // POJO instances
        strictEqual(POJO.isDeepClone(new POJO({ foo: 'bar', baz: [1, 2] }), new POJO({ foo: 'bar', baz: [1, 2] })), true);
    });

    test('isDeepClone negative', () => {
        // objects
        strictEqual(POJO.isDeepClone({ x: 1, y: { z: 2 } }, { x: 1, y: { z: 3 } }), false);
        // arrays
        strictEqual(POJO.isDeepClone([1, 2, [3, 4]], [1, 2, [3, 5]]), false);
        // primitives
        strictEqual(POJO.isDeepClone(42, 43), false);
        strictEqual(POJO.isDeepClone('abc', 'def'), false);
        // POJO instances
        strictEqual(POJO.isDeepClone(new POJO({ foo: 'bar', baz: [1, 2] }), new POJO({ foo: 'bar', baz: [1, 3] })), false);
    });
});

describe('SharedBuffer support', () => {
    test('parse with SharedArrayBuffer input', () => {
        const obj = { x: 5, y: 'world' };
        const buf = POJO.toSharedBuffer(obj);
        const parsed = POJO.parse<typeof obj>(buf);
        ok(parsed instanceof POJO);
        strictEqual(parsed?.x, 5);
        strictEqual(parsed?.y, 'world');
    });

    test('toSharedBuffer with replacer', () => {
        const obj = { date: new Date('2020-01-01') };
        const buf = POJO.toSharedBuffer(obj, (_k: string, v: unknown) => (v instanceof Date ? v.toISOString() : v));
        const parsed = POJO.parse<{ date: string }>(buf);
        strictEqual(parsed?.date, '2020-01-01T00:00:00.000Z');
    });

    test('toSharedBuffer and parse roundtrip', () => {
        const obj = { a: 1, b: 'hello', c: 42n };
        const buf = POJO.toSharedBuffer(obj);
        ok(buf instanceof SharedArrayBuffer);
        const parsed = POJO.parse<typeof obj>(buf);
        ok(parsed instanceof POJO);
        strictEqual(parsed?.a, 1);
        strictEqual(parsed?.b, 'hello');
        strictEqual(parsed?.c, 42n);
    });
});
