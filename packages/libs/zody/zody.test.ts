import { afterEach, expect, test } from 'bun:test';
import { enableCodeGen } from './codegen';
import { array, number, string } from './validator';
import { type ZodyCtor, z } from './zody';

// TypeScript's class-decorator return-type mutation doesn't propagate to the
// decorated class's static type through `@decorator class {}` declaration syntax,
// so the added ZodyCtor statics (validate/parse/toZod/etc.) need a cast at usage.
function zc<T extends abstract new (...args: unknown[]) => unknown>(ctor: T): T & ZodyCtor<InstanceType<T>> {
    return ctor as unknown as T & ZodyCtor<InstanceType<T>>;
}

afterEach(() => {
    enableCodeGen(true);
});

@z.Schema({ inferDefault: true })
class User {
    @z.int.min(1) id!: number;
    @z.string.minLength(3) name = 'john';
    @z.string.email.optional email?: string;
    @z.bigint visits!: bigint;
}

test('validate and parse basic class', () => {
    expect(zc(User).validate({ id: 1, name: 'john', visits: 4n })).toBe(true);
    expect(zc(User).validate({ id: 0, name: 'jo', visits: 4n })).toBe(false);
    const parsed = zc(User).parse({ id: 1, name: 'john', visits: 4n });
    expect(parsed.name).toBe('john');
});

test('toZod returns real zod-like schema', () => {
    const schema = zc(User).toZod();
    const res = schema.safeParse({ id: 2, name: 'john', visits: 3n });
    expect(res.success).toBe(true);
});

test('conflicting roots throw', () => {
    expect(() => {
        @z.Schema()
        class Bad {
            @z.string.int bad!: string;
        }
        zc(Bad).toZod();
    }).toThrow();
});

// Codegen / self-replacing validate() tests
test('validate() agrees with safeParse across primitives, arrays, objects, unions', () => {
    const stringValidator = string().min(2).max(5).optional();
    const testCases = ['', 'a', 'ab', 'abc', 'abcde', 'abcdef', undefined, null];
    for (const input of testCases) {
        expect(stringValidator.validate(input)).toBe(stringValidator.safeParse(input).success);
    }

    const arraySchema = array(number().int());
    expect(arraySchema.validate([1, 2, 3])).toBe(true);
    expect(arraySchema.validate([1, 2.5, 3])).toBe(false);
    expect(arraySchema.validate([1, 'two', 3])).toBe(false);
    expect(arraySchema.validate('not an array')).toBe(false);
});

test('decorated class validate() agrees with interpreted safeParse on multiple fields', () => {
    @z.Schema()
    class Profile {
        @z.number.int.gte(1) age!: number;
        @z.string.minLength(1) name!: string;
        @z.string.email.optional email?: string;
    }

    const schema = zc(Profile).toZod();

    // Valid case
    expect(schema.validate({ age: 25, name: 'Alice', email: 'a@example.com' })).toBe(true);

    // Missing optional field is valid
    expect(schema.validate({ age: 25, name: 'Alice' })).toBe(true);

    // Invalid age
    expect(schema.validate({ age: 0, name: 'Alice' })).toBe(false);

    // Missing required name
    expect(schema.validate({ age: 25 })).toBe(false);

    // Invalid email format
    expect(schema.validate({ age: 25, name: 'Alice', email: 'not-an-email' })).toBe(false);
});

test('Class.validate() forwards to the cached schema root', () => {
    const validInput = { id: 1, name: 'john', visits: 4n };
    const invalidInput = { id: 0, name: 'jo', visits: 4n };

    expect(zc(User).validate(validInput)).toBe(true);
    expect(zc(User).validate(invalidInput)).toBe(false);
});

test('Class.validate() self-replaces the cached schema instance once, and later calls stay correct', () => {
    @z.Schema()
    class Widget {
        @z.string.minLength(1) name!: string;
    }

    const schema = zc(Widget).toZod();
    const before = schema.validate;

    expect(zc(Widget).validate({ name: 'ok' })).toBe(true);

    const after = schema.validate;
    expect(before).not.toBe(after);

    expect(zc(Widget).validate({ name: '' })).toBe(false);
    expect(zc(Widget).validate({ name: 'ok' })).toBe(true);
});

test('enableCodeGen(false) keeps decorated class validate() interpreted', () => {
    enableCodeGen(false);

    @z.Schema()
    class Widget {
        @z.string.minLength(1) name!: string;
    }

    const schema = zc(Widget).toZod();
    const before = schema.validate;

    expect(zc(Widget).validate({ name: 'ok' })).toBe(true);
    expect(zc(Widget).validate({ name: '' })).toBe(false);
    expect(schema.validate).toBe(before);
});

test('autocompile option warms the schema root validate() on class decoration', async () => {
    const cache = Symbol.for('zody.cache');

    @z.Schema({ autocompile: true })
    class AutocompileUser {
        @z.int.min(1) id!: number;
        @z.string name!: string;
    }

    // autocompile happens in setImmediate, so we need to wait a tick
    await new Promise((resolve) => setImmediate(resolve));

    // After autocompile, cache should be populated
    const hasCache = (AutocompileUser as unknown as { [key: symbol]: unknown })[cache] !== undefined;
    expect(hasCache).toBe(true);

    // Verify the (now self-replaced) validator works
    expect(zc(AutocompileUser).validate({ id: 1, name: 'test' })).toBe(true);
    expect(zc(AutocompileUser).validate({ id: 0, name: 'test' })).toBe(false);
});

// Union tests
@z.Schema({ autocompile: true })
class Ticket {
    @z.union([z.string, z.number]) code!: string | number;
}

test('union field accepts every declared option, not just the first', () => {
    // regression test: previously only the first union option (string) was ever checked
    expect(zc(Ticket).toZod().safeParse({ code: 'abc' }).success).toBe(true);
    expect(zc(Ticket).toZod().safeParse({ code: 42 }).success).toBe(true);
});

test('union field with a coercing string option matches almost anything (string() never throws)', () => {
    // Unlike zody's old built-in string validator (strict, no coercion), the shared
    // validator.ts StrV that z.string now delegates to coerces via String(val), which
    // never throws — so a string|number union has no input that fails both arms.
    expect(zc(Ticket).toZod().safeParse({ code: {} }).success).toBe(true);
    expect(zc(Ticket).toZod().safeParse({ code: null }).success).toBe(true);
});

test('union requires at least 2 options', () => {
    expect(() => {
        @z.Schema()
        class BadUnion {
            @z.union([z.string]) code!: string;
        }
        zc(BadUnion).toZod();
    }).toThrow();
});

test('validate() agrees with interpreted safeParse on every union option', () => {
    const schema = zc(Ticket).toZod();
    const inputs = [{ code: 'abc' }, { code: 42 }, { code: {} }, { code: null }];

    for (const input of inputs) {
        expect(schema.validate(input)).toBe(schema.safeParse(input).success);
    }
});

test('Class.validate() validates all union options, not just the first', async () => {
    await new Promise((resolve) => setImmediate(resolve));

    expect(zc(Ticket).validate({ code: 'abc' })).toBe(true);
    expect(zc(Ticket).validate({ code: 42 })).toBe(true);
    // {} coerces via String() (the string arm never throws), so it matches too.
    expect(zc(Ticket).validate({ code: {} })).toBe(true);
});

// --- defs() / buildPropertySchema() ---

@z.Schema()
class Contact {
    @z.string.email email!: string;
    @z.string.url site!: string;
    @z.string.uuid uid!: string;
    @z.string.hostname host!: string;
    @z.string.ipv4 ip4!: string;
    @z.string.ipv6 ip6!: string;
    @z.string.jwt token!: string;
    @z.string.base64 blob!: string;
    @z.string.hex color!: string;
    @z.string.regex(/^[a-z]+$/) code!: string;
    @z.string.minLength(2)
    @z.string.maxLength(10)
    name!: string;
    @z.string.length(5) fixed!: string;
    @z.number.gte(0)
    @z.number.lte(100)
    score!: number;
    @z.number.gt(0)
    @z.number.lt(10)
    small!: number;
    @z.number.min(1)
    @z.number.max(9)
    ranged!: number;
    @z.int count!: number;
    @z.number.float ratio!: number;
    @z.string.describe('a helpful description') described!: string;
    @z.string.optional maybe?: string;
    @z.string.nullable orNull!: string | null;
    @z.array(z.string) tags!: string[];
}

test('defs() maps format ops to JSON-Schema format/pattern keywords', () => {
    const defs = zc(Contact).defs();
    const props = defs['properties'] as Record<string, Record<string, unknown>>;

    expect(props['email']).toEqual({ type: 'string', format: 'email' });
    expect(props['site']).toEqual({ type: 'string', format: 'uri' });
    expect(props['uid']).toEqual({ type: 'string', format: 'uuid' });
    expect(props['host']).toEqual({ type: 'string', format: 'hostname' });
    expect(props['ip4']).toEqual({ type: 'string', format: 'ipv4' });
    expect(props['ip6']).toEqual({ type: 'string', format: 'ipv6' });
    expect(props['token']).toEqual({ type: 'string', pattern: '^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*$' });
    expect(props['blob']).toEqual({
        type: 'string',
        pattern: '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$',
    });
    expect(props['color']).toEqual({ type: 'string', pattern: '^[0-9a-fA-F]*$' });
    expect(props['code']).toEqual({ type: 'string', pattern: '^[a-z]+$' });
});

test('defs() maps length/numeric/type constraint ops to JSON-Schema keywords', () => {
    const defs = zc(Contact).defs();
    const props = defs['properties'] as Record<string, Record<string, unknown>>;

    expect(props['name']).toEqual({ type: 'string', minLength: 2, maxLength: 10 });
    expect(props['fixed']).toEqual({ type: 'string', minLength: 5, maxLength: 5 });
    expect(props['score']).toEqual({ type: 'number', minimum: 0, maximum: 100 });
    expect(props['small']).toEqual({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 10 });
    expect(props['ranged']).toEqual({ type: 'number', minimum: 1, maximum: 9 });
    expect(props['count']).toEqual({ type: 'integer' });
    expect(props['ratio']).toEqual({ type: 'number' });
    expect(props['described']).toEqual({ type: 'string', description: 'a helpful description' });
});

test('defs() excludes optional/nullable/default fields from required[], and expands nullable to a type array', () => {
    const defs = zc(Contact).defs();
    const props = defs['properties'] as Record<string, Record<string, unknown>>;
    const required = defs['required'] as string[];

    expect(props['maybe']).toEqual({ type: 'string' });
    expect(props['orNull']).toEqual({ type: ['string', 'null'] });
    expect(required).toContain('email');
    expect(required).not.toContain('maybe');
    expect(required).not.toContain('orNull');
});

test('defs() recurses into array item schemas via arrayOf', () => {
    const defs = zc(Contact).defs();
    const props = defs['properties'] as Record<string, Record<string, unknown>>;

    expect(props['tags']).toEqual({ type: 'array', items: { type: 'string' } });
});

test('defs() includes $schema by default and omits it when includeSchemaVersion is false', () => {
    const withVersion = zc(Contact).defs();
    const withoutVersion = zc(Contact).defs(false);

    expect(withVersion['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    expect(withoutVersion['$schema']).toBeUndefined();
});

// --- applyOps(): decorator format/transform ops wired through parse()/validate() ---

@z.Schema()
class Formats {
    @z.string.email email!: string;
    @z.string.url site!: string;
    @z.string.uuid uid!: string;
    @z.string.hostname host!: string;
    @z.string.ipv4 ip4!: string;
    @z.string.ipv6 ip6!: string;
    @z.string.jwt token!: string;
    @z.string.base64 blob!: string;
    @z.string.hex color!: string;
}

test('decorator format ops (url/uuid/hostname/ipv4/ipv6/jwt/base64/hex) validate through validate()', () => {
    const valid = {
        email: 'user@example.com',
        site: 'https://example.com',
        uid: '123e4567-e89b-12d3-a456-426614174000',
        host: 'example.com',
        ip4: '127.0.0.1',
        ip6: '::1',
        token: 'aaa.bbb.ccc',
        blob: 'aGVsbG8=',
        color: 'deadbeef',
    };
    expect(zc(Formats).validate(valid)).toBe(true);

    for (const key of Object.keys(valid)) {
        const invalidInput = { ...valid, [key]: '!!! not valid !!!' };
        expect(zc(Formats).validate(invalidInput)).toBe(false);
    }
});

@z.Schema()
class Transformed {
    @z.string.trim padded!: string;
    @z.string.toLowerCase shout!: string;
    @z.string.toUpperCase whisper!: string;
}

test('decorator transform ops (trim/toLowerCase/toUpperCase) mutate the parsed value', () => {
    const parsed = zc(Transformed).parse({ padded: '  hi  ', shout: 'LOUD', whisper: 'quiet' });
    expect(parsed.padded).toBe('hi');
    expect(parsed.shout).toBe('loud');
    expect(parsed.whisper).toBe('QUIET');
});

// The decorator grammar only allows a single trailing call in `@expr`, so a chain
// like `z.array(z.string).minLength(1).maxLength(3)` must be built as a plain
// expression first, then referenced as a bare identifier in decorator position.
const tagsDecorator = z.array(z.string).minLength(1).maxLength(3);
const pairDecorator = z.array(z.number).length(2);

@z.Schema()
class Tagged {
    @tagsDecorator tags!: string[];
    @pairDecorator pair!: number[];
}

test('array field length ops dispatch to ArrV (minLength/maxLength/length), not string min/max', () => {
    expect(zc(Tagged).validate({ tags: ['a'], pair: [1, 2] })).toBe(true);
    expect(zc(Tagged).validate({ tags: [], pair: [1, 2] })).toBe(false); // below minLength
    expect(zc(Tagged).validate({ tags: ['a', 'b', 'c', 'd'], pair: [1, 2] })).toBe(false); // above maxLength
    expect(zc(Tagged).validate({ tags: ['a'], pair: [1] })).toBe(false); // wrong length
});

@z.Schema()
class Unadorned {
    @z.array() items!: unknown[];
}

test('array field with no inner type spec falls back to unknown() items', () => {
    expect(zc(Unadorned).validate({ items: [1, 'two', { three: 3 }] })).toBe(true);
    expect(zc(Unadorned).validate({ items: 'not an array' })).toBe(false);
    const defs = zc(Unadorned).defs();
    const props = defs['properties'] as Record<string, Record<string, unknown>>;
    expect(props['items']).toEqual({ type: 'array', items: {} });
});

// --- toZodNode(): boolean/date root types actually built and validated ---

@z.Schema()
class Flags {
    @z.boolean enabled!: boolean;
    @z.date createdAt!: Date;
}

test('boolean and date decorator fields build real validators through validate()/parse()', () => {
    const input = { enabled: true, createdAt: new Date('2024-01-01') };
    expect(zc(Flags).validate(input)).toBe(true);
    expect(zc(Flags).parse(input).enabled).toBe(true);
    expect(zc(Flags).validate({ enabled: true, createdAt: 'not a date' })).toBe(false);
});

// --- applyOps(): numeric max/lte/gt/lt/float, regex, describe, nullable all wired through an actual compile ---

@z.Schema()
class Bounds {
    @z.number.max(10) capped!: number;
    @z.number.lte(5) atMost!: number;
    @z.number.gt(0) positive!: number;
    @z.number.lt(100) small!: number;
    @z.number.float ratio!: number;
    @z.string.regex(/^[a-z]+$/) code!: string;
    @z.string.describe('a code name') named!: string;
    @z.string.nullable orNull!: string | null;
}

test('max/lte/gt/lt/float/regex/describe/nullable ops are actually wired into the compiled validator', () => {
    const valid = { capped: 10, atMost: 5, positive: 1, small: 99, ratio: 1.5, code: 'abc', named: 'x', orNull: null };
    expect(zc(Bounds).validate(valid)).toBe(true);
    expect(zc(Bounds).validate({ ...valid, capped: 11 })).toBe(false);
    expect(zc(Bounds).validate({ ...valid, atMost: 6 })).toBe(false);
    expect(zc(Bounds).validate({ ...valid, positive: 0 })).toBe(false);
    expect(zc(Bounds).validate({ ...valid, small: 100 })).toBe(false);
    expect(zc(Bounds).validate({ ...valid, code: 'ABC' })).toBe(false);
    expect(zc(Bounds).validate({ ...valid, orNull: 'present' })).toBe(true);
});

// --- static safeParse() ---

test('Class.safeParse() forwards to the cached schema root', () => {
    const ok = zc(User).safeParse({ id: 1, name: 'john', visits: 4n });
    expect(ok.success).toBe(true);

    const bad = zc(User).safeParse({ id: 0, name: 'jo', visits: 4n });
    expect(bad.success).toBe(false);
});

// --- inferFromValue(): type inference purely from a field's default value ---

@z.Schema()
class InferredDefaults {
    // Each field needs its own decorator *instance* — reusing the bare `z` function
    // itself (rather than a lazy-getter-derived one like `z.describe(...)`) across
    // multiple fields would share one `initializerRan` closure flag and silently
    // drop metadata for every field after the first. `.describe()` sidesteps that
    // without adding a root type, so inference is driven purely by the default value.
    @z.describe('a') count = 5;
    @z.describe('b') active = true;
    @z.describe('c') big = 10n;
    @z.describe('d') when = new Date('2024-01-01');
    @z.describe('e') list = [1, 2, 3];
}

test('field type is inferred from its default value when no explicit root decorator is given', () => {
    const defs = zc(InferredDefaults).defs();
    const props = defs['properties'] as Record<string, Record<string, unknown>>;

    expect(props['count']).toEqual({ type: 'number', description: 'a' });
    expect(props['active']).toEqual({ type: 'boolean', description: 'b' });
    expect(props['big']).toEqual({ type: 'integer', description: 'c' });
    expect(props['when']).toEqual({ type: 'string', format: 'date-time', description: 'd' });
    expect(props['list']).toEqual({ type: 'array', items: {}, description: 'e' });
});

test('explicit root decorator conflicting with the inferred default-value type throws', () => {
    expect(() => {
        @z.Schema()
        class Conflict {
            @z.string bad = 5;
        }
        zc(Conflict).defs();
    }).toThrow(/contradicts explicit/);
});

test('a default value that is a plain object (not Date/Array) cannot be inferred and errors clearly', () => {
    expect(() => {
        @z.Schema()
        class Unwritable {
            @z.describe('x') meta = {};
        }
        zc(Unwritable).defs();
    }).toThrow(/cannot infer type/);
});
