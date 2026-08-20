import { describe, expect, test } from 'bun:test';

import { type ZodError, zod } from './zod';

describe('ZodError', () => {
    test('constructs from an issues array', () => {
        const err = new zod.ZodError([
            { code: 'too_small', path: ['age'], message: 'age must be >= 0' },
            { code: 'invalid_type', path: ['name'], message: 'name must be a string' },
        ]);

        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('ZodError');
        expect(err.issues).toHaveLength(2);
        expect(err.message).toBe('age must be >= 0; name must be a string');
    });

    test('constructs from a single issue', () => {
        const err = new zod.ZodError([{ code: 'custom', path: [], message: 'boom' }]);
        expect(err.message).toBe('boom');
        expect(err.issues[0]?.path).toStrictEqual([]);
    });

    test('fromError wraps a plain Error into a single-issue ZodError', () => {
        const wrapped = zod.ZodError.fromError(new Error('bad input'));
        expect(wrapped).toBeInstanceOf(zod.ZodError);
        expect(wrapped.issues).toStrictEqual([{ code: 'custom', path: [], message: 'bad input' }]);
    });

    test('fromError is idempotent on an existing ZodError', () => {
        const original = new zod.ZodError([{ code: 'custom', path: ['x'], message: 'already wrapped' }]);
        expect(zod.ZodError.fromError(original)).toBe(original);
    });
});

describe('zod.safeParse', () => {
    test('returns { success: true, data } on valid input', () => {
        const result = zod.safeParse(zod.string().min(3), 'hello');
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toBe('hello');
        }
    });

    test('returns { success: false, error: ZodError } on invalid input', () => {
        const result = zod.safeParse(zod.string().min(3), 'ab');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBeInstanceOf(zod.ZodError);
            expect(result.error.issues.length).toBeGreaterThan(0);
            expect(result.error.issues[0]?.message.includes('at least 3')).toBeTruthy();
        }
    });

    test('works with object schemas', () => {
        const schema = zod.object({ name: zod.string(), age: zod.number().int() });

        const ok = zod.safeParse(schema, { name: 'John', age: 30 });
        expect(ok.success).toBe(true);

        const bad = zod.safeParse(schema, { name: 'John', age: 'thirty' });
        expect(bad.success).toBe(false);
        if (!bad.success) {
            expect(bad.error).toBeInstanceOf(zod.ZodError);
        }
    });
});

describe('zod namespace — factory delegation smoke tests', () => {
    test('primitives', () => {
        expect(zod.string().parse('a')).toBe('a');
        expect(zod.number().parse(5)).toBe(5);
        expect(zod.boolean().parse(true)).toBe(true);
        expect(zod.bigint().parse(5n)).toBe(5n);
        expect(zod.date().parse(new Date('2024-01-01')).getFullYear()).toBe(2024);
    });

    test('nulls and void-like primitives', () => {
        expect(Number.isNaN(zod.nan().parse(Number.NaN))).toBe(true);
        expect(zod.null().parse(null)).toBe(null);
        expect(zod.undefined().parse(undefined)).toBe(undefined);
        expect(zod.void().parse(undefined)).toBe(undefined);
        expect(typeof zod.nanoid().parse('V1StGXR8_Z5jdHi6B-myT')).toBe('string');
    });

    test('arrays and objects', () => {
        expect(zod.array(zod.number()).parse([1, 2, 3])).toStrictEqual([1, 2, 3]);
        expect(zod.object({ a: zod.string() }).parse({ a: 'x' })).toStrictEqual({ a: 'x' });
        expect(() => zod.strictObject({ a: zod.string() }).parse({ a: 'x', b: 1 })).toThrow();
        expect(zod.looseObject({ a: zod.string() }).parse({ a: 'x', b: 1 }) as Record<string, unknown>).toStrictEqual({
            a: 'x',
            b: 1,
        });
        expect(zod.set(zod.number()).parse(new Set([1, 2]))).toStrictEqual(new Set([1, 2]));
        expect(zod.map(zod.number()).parse(new Map([['a', 1]]))).toStrictEqual(new Map([['a', 1]]));
        expect(zod.record(zod.number()).parse(new Map([['a', 1]]))).toStrictEqual(new Map([['a', 1]]));
    });

    test('utility types', () => {
        expect(zod.literal('fixed').parse('fixed')).toBe('fixed');
        expect(zod.enum(['a', 'b']).parse('b')).toBe('b');
        expect(zod.nullable(zod.string()).parse(null)).toBe(null);
        expect(zod.nullish(zod.string()).parse(undefined)).toBe(undefined);
        expect(zod.optional(zod.string()).parse(undefined)).toBe(undefined);
        expect(zod.union([zod.number(), zod.string()]).parse('x')).toBe('x');
        expect(zod.unknown().parse({ anything: true })).toStrictEqual({ anything: true });
    });

    test('string format validators', () => {
        expect(zod.email().parse('user@example.com')).toBe('user@example.com');
        expect(zod.url().parse('https://example.com')).toBe('https://example.com');
        expect(zod.httpUrl().parse('https://example.com')).toBe('https://example.com');
        expect(zod.uuid().parse('123e4567-e89b-12d3-a456-426614174000')).toBe('123e4567-e89b-12d3-a456-426614174000');
        expect(zod.hostname().parse('example.com')).toBe('example.com');
        expect(zod.emoji().parse('😀')).toBe('😀');
        expect(zod.base64().parse('aGVsbG8=')).toBe('aGVsbG8=');
        expect(zod.hex().parse('deadbeef')).toBe('deadbeef');
        expect(zod.ipv4().parse('127.0.0.1')).toBe('127.0.0.1');
        expect(zod.ipv6().parse('::1')).toBe('::1');
        expect(zod.isoDate().parse('2024-01-01')).toBe('2024-01-01');
        expect(zod.isoTime().parse('12:30:00')).toBe('12:30:00');
        expect(zod.isoDatetime().parse('2024-01-01T12:30:00Z')).toBe('2024-01-01T12:30:00Z');
        expect(zod.isoDuration().parse('P1Y2M3D')).toBe('P1Y2M3D');
    });

    test('number helpers', () => {
        expect(zod.int().parse(5)).toBe(5);
        expect(() => zod.int().parse(5.5)).toThrow();
    });

    test('parseSchema utility', () => {
        expect(zod.parseSchema(zod.string(), 'hi')).toBe('hi');
        expect(() => zod.parseSchema(zod.string().min(3), 'hi')).toThrow();
    });
});

describe('zod JSON Schema conversion', () => {
    test('zodToJsonSchema / jsonSchemaToZod round-trip an object schema', () => {
        const schema = zod.object({ name: zod.string().min(1), age: zod.number().int() });

        const jsonSchema = zod.zodToJsonSchema(schema);
        expect(jsonSchema.type).toBe('object');

        const roundTripped = zod.jsonSchemaToZod(jsonSchema);
        expect(roundTripped.parse({ name: 'Ann', age: 5 })).toStrictEqual({ name: 'Ann', age: 5 });
        expect(() => roundTripped.parse({ name: '', age: 5 })).toThrow();
    });
});

describe('zod namespace types (compile-time only)', () => {
    test('type aliases stay assignable to their validator.ts equivalents', () => {
        const strType: zod.ZodType<string> = zod.string();
        const objType: zod.ZodObject = zod.object({});
        const strSchema: zod.ZodString = zod.string();
        type Inferred = zod.infer<typeof strSchema>;
        const value: Inferred = 'ok';

        expect(strType.parse('ok')).toBe('ok');
        expect(objType.parse({})).toStrictEqual({});
        expect(value).toBe('ok');
    });

    test('ZodSafeParseResult narrows on success discriminant', () => {
        const result: zod.ZodSafeParseResult<string> = zod.safeParse(zod.string(), 'ok');
        if (result.success) {
            const data: string = result.data;
            expect(data).toBe('ok');
        } else {
            const err: ZodError = result.error;
            expect(err).toBeInstanceOf(zod.ZodError);
        }
    });
});
