import { describe, expect, test } from 'bun:test';

import {
    array,
    bigint,
    boolean,
    date,
    email,
    isoDate,
    isoDatetime,
    isoDuration,
    isoTime,
    literal,
    map,
    nan,
    nullable,
    nullish,
    nullVal,
    number,
    object,
    optional,
    parse,
    set,
    strictObject,
    string,
    undefinedVal,
    union,
    url,
    uuid,
    voidVal,
    zod,
} from './index';

describe('Validator', () => {
    // Primitive validations
    test('should validate and coerce boolean values', () => {
        const b = boolean();
        expect(b.parse(true)).toBe(true);
        expect(b.parse(false)).toBe(false);
        expect(b.parse('false')).toBe(true); // non-empty strings are truthy
        expect(b.parse('')).toBe(false);
        expect(b.parse(1)).toBe(true);
        expect(b.parse(0)).toBe(false);
        expect(b.parse(null)).toBe(false);
        expect(b.parse({})).toBe(true); // objects are truthy
        expect(b.parse(Number.NaN)).toBe(false);
    });

    test('should validate and coerce string values', () => {
        const s = string();
        expect(s.parse('hello')).toBe('hello');
        expect(s.parse(123)).toBe('123');
        expect(s.parse(0)).toBe('0');
        expect(s.parse(true)).toBe('true');
        expect(s.parse(BigInt(123))).toBe('123');
        expect(s.parse(null)).toBe('null');
        expect(s.parse([1, 2, 3])).toBe('1,2,3');
        expect(s.parse({ foo: 'bar' })).toBe('[object Object]');
    });

    test('should validate and coerce number values', () => {
        const n = number();
        expect(n.parse(42)).toBe(42);
        expect(n.parse('123')).toBe(123);
        expect(n.parse('')).toBe(0);
        expect(n.parse(true)).toBe(1);
        expect(n.parse(BigInt(123))).toBe(123);
        expect(n.parse(null)).toBe(0);
        expect(n.parse(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);

        expect(() => n.parse('not a number')).toThrow();
        expect(() => n.parse(Number.NaN)).toThrow();
        expect(() => n.parse(undefined)).toThrow();
        expect(() => n.parse({})).toThrow();
    });

    test('should validate and coerce bigint values', () => {
        const bi = bigint();
        expect(bi.parse(BigInt(123))).toBe(123n);
        expect(bi.parse('12345678901234567890')).toBe(12345678901234567890n);
        expect(bi.parse(42)).toBe(42n);
        expect(bi.parse(true)).toBe(1n);
        expect(bi.parse('')).toBe(0n);

        expect(() => bi.parse(3.14)).toThrow(); // Non-integer
        expect(() => bi.parse('not a number')).toThrow();
        expect(() => bi.parse(undefined)).toThrow();
        expect(() => bi.parse(null)).toThrow();
        expect(() => bi.parse(Number.POSITIVE_INFINITY)).toThrow();
    });

    test('should validate and coerce date values', () => {
        const d = date();
        const now = new Date();
        expect(d.parse(now) instanceof Date).toBeTruthy();

        const isoDate = d.parse('2023-01-01T00:00:00.000Z');
        expect(isoDate instanceof Date).toBeTruthy();
        expect(isoDate?.toISOString()).toBe('2023-01-01T00:00:00.000Z');

        expect(d.parse(0)?.getTime()).toBe(0); // epoch
        expect(d.parse(true)?.getTime()).toBe(1);
        expect(d.parse(null)?.getTime()).toBe(0);

        expect(() => d.parse('not a date')).toThrow();
        expect(() => d.parse(undefined)).toThrow();
        expect(() => d.parse(Number.NaN)).toThrow();
        expect(() => d.parse(90071992547409920)).toThrow(); // Too large
    });

    test('should handle optional primitives', () => {
        expect(boolean().optional().parse(true)).toBe(true);
        expect(boolean().optional().parse(undefined)).toBe(undefined);

        expect(string().optional().parse('hello')).toBe('hello');
        expect(string().optional().parse(null)).toBe(undefined);

        expect(number().optional().parse(42)).toBe(42);
        expect(number().optional().parse('')).toBe(undefined);

        expect(bigint().optional().parse(123n)).toBe(123n);
        expect(bigint().optional().parse(undefined)).toBe(undefined);

        expect(date().optional().parse(new Date()) instanceof Date).toBeTruthy();
        expect(date().optional().parse(null)).toBe(undefined);
    });

    test('should clear validators using clear() method', () => {
        const s = string().min(5).max(10);
        expect(s.parse('hello')).toBe('hello');
        expect(() => s.parse('hi')).toThrow(); // Too short

        // Clear all validators
        s.clear();
        // Now it accepts anything (no validators)
        expect(s.parse('hi')).toBe('hi'); // Previously would fail
        expect(s.parse('a very long string that exceeds 10')).toBe('a very long string that exceeds 10');

        const n = number().min(0).max(100);
        expect(n.parse(50)).toBe(50);
        expect(() => n.parse(-5)).toThrow(); // Below minimum

        n.clear();
        expect(n.parse(-5)).toBe(-5); // Now accepts anything
    });

    test('should validate undefined and null values', () => {
        const undef = undefinedVal();
        expect(undef.parse(undefined)).toBe(undefined);
        expect(() => undef.parse(null)).toThrow(/Expected literal undefined, got null/);
        expect(() => undef.parse(0)).toThrow(/Expected literal undefined, got 0/);

        const nul = nullVal();
        expect(nul.parse(null)).toBe(null);
        expect(() => nul.parse(undefined)).toThrow(/Expected literal null, got undefined/);
        expect(() => nul.parse(false)).toThrow(/Expected literal null, got false/);
    });

    // String validations
    test('should validate using custom regex patterns', () => {
        const s = string().regex(/^[A-Z][a-z]+$/); // Capitalized word
        expect(s.parse('Hello')).toBe('Hello');
        expect(() => s.parse('hello')).toThrow();
        expect(() => s.parse('HELLO')).toThrow();

        const phone = string().regex(/^\d{3}-\d{3}-\d{4}$/);
        expect(phone.parse('123-456-7890')).toBe('123-456-7890');
        expect(() => phone.parse('1234567890')).toThrow();
    });

    test('should work with multiple regex validators and custom error messages', () => {
        const s = string()
            .regex(/^[A-Z]/) // Must start with capital
            .regex(/[a-z]$/) // Must end with lowercase
            .min(3);
        expect(s.parse('Hello')).toBe('Hello');
        expect(() => s.parse('hello')).toThrow();

        const productCode = string().regex(
            /^PROD-\d{4}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: test
            '"${val}" is not a valid product code (format: PROD-####)',
        );
        expect(productCode.parse('PROD-1234')).toBe('PROD-1234');
        try {
            productCode.parse('INVALID');
            throw new Error('Should have thrown');
        } catch (err) {
            expect((err as Error).message).toBe('"INVALID" is not a valid product code (format: PROD-####)');
        }
    });

    test('should validate string length, startsWith, endsWith, includes', () => {
        expect(string().length(5).parse('hello')).toBe('hello');
        expect(() => string().length(5).parse('hi')).toThrow(/2 === 5/);

        expect(string().startsWith('hello').parse('hello world')).toBe('hello world');
        expect(() => string().startsWith('hello').parse('hi there')).toThrow(/"hi there" must start with "hello"/);

        expect(string().endsWith('world').parse('hello world')).toBe('hello world');
        expect(() => string().endsWith('world').parse('hello there')).toThrow(/"hello there" must end with "world"/);

        expect(string().includes('test').parse('this is a test')).toBe('this is a test');
        expect(() => string().includes('test').parse('no match')).toThrow(/"no match" must include "test"/);
    });

    test('should validate and transform string case', () => {
        expect(string().uppercase().parse('HELLO')).toBe('HELLO');
        expect(() => string().uppercase().parse('Hello')).toThrow(/"Hello" must be uppercase/);

        expect(string().lowercase().parse('hello')).toBe('hello');
        expect(() => string().lowercase().parse('Hello')).toThrow(/"Hello" must be lowercase/);

        // Transforms
        expect(string().trim().parse('  hello  ')).toBe('hello');
        expect(string().toLowerCase().parse('HELLO')).toBe('hello');
        expect(string().toUpperCase().parse('hello')).toBe('HELLO');

        const toUpper = string().toUpperCase();
        expect(toUpper.parse('hello')).toBe('HELLO');
        expect(toUpper.parse('Hello World')).toBe('HELLO WORLD');

        const norm = string().normalize();
        expect(norm.parse('café')).toBe('café');
    });

    test('should chain string validation and transform methods', () => {
        const validator = string().min(3).trim().toLowerCase();
        expect(validator.parse('  HELLO  ')).toBe('hello');
        expect(validator.parse('  HI  ')).toBe('hi');
        expect(() => validator.parse('ab')).toThrow();
    });

    test('should validate string formats (URL, email, UUID, network)', () => {
        expect(string().uuid().parse('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(() => string().uuid().parse('not-a-uuid')).toThrow();

        expect(string().url().parse('https://example.com')).toBe('https://example.com');
        expect(() => string().url().parse('example.com')).toThrow();

        expect(string().httpUrl().parse('https://example.com')).toBe('https://example.com');
        expect(() => string().httpUrl().parse('ftp://files.example.com')).toThrow();

        expect(string().hostname().parse('subdomain.example.com')).toBe('subdomain.example.com');
        expect(() => string().hostname().parse('localhost')).toThrow();

        expect(string().ipv4().parse('192.168.1.1')).toBe('192.168.1.1');
        expect(() => string().ipv4().parse('256.1.1.1')).toThrow();

        expect(string().ipv6().parse('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::8a2e:370:7334');
        expect(() => string().ipv6().parse('192.168.1.1')).toThrow();

        expect(string().cidrv4().parse('192.168.1.0/24')).toBe('192.168.1.0/24');
        expect(() => string().cidrv4().parse('192.168.1.0/33')).toThrow();

        expect(string().cidrv6().parse('2001:db8::/32')).toBe('2001:db8::/32');
        expect(() => string().cidrv6().parse('2001:db8::/129')).toThrow();
    });

    test('should validate encoding formats (base64, base64url, hex)', () => {
        expect(string().base64().parse('SGVsbG8gV29ybGQ=')).toBe('SGVsbG8gV29ybGQ=');
        expect(() => string().base64().parse('invalid@base64')).toThrow(/is not valid/);

        expect(string().base64url().parse('SGVsbG8gV29ybGQ')).toBe('SGVsbG8gV29ybGQ');
        expect(() => string().base64url().parse('has=padding')).toThrow(/is not valid/);

        expect(string().hex().parse('deadbeef')).toBe('deadbeef');
        expect(() => string().hex().parse('notahex')).toThrow();
    });

    test('should validate ID formats (JWT, nanoid, CUID, CUID2, ULID, emoji)', () => {
        const testJwt =
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        expect(string().jwt().parse(testJwt)).toBe(testJwt);
        expect(() => string().jwt().parse('only.two')).toThrow();

        expect(string().nanoid().parse('V1StGXR8_Z5jdHi6B-myT')).toBe('V1StGXR8_Z5jdHi6B-myT');
        expect(() => string().nanoid().parse('tooshort')).toThrow();

        expect(string().cuid().parse('cjld2cjxh0000qzrmn831i7rn')).toBe('cjld2cjxh0000qzrmn831i7rn');
        expect(() => string().cuid().parse('notacuid')).toThrow(/"notacuid" is not a valid CUID/);

        expect(string().cuid2().parse('tz4a98xxat96iws9zmbrgj3a')).toBe('tz4a98xxat96iws9zmbrgj3a');
        expect(() => string().cuid2().parse('1startswithnumber')).toThrow();

        expect(string().ulid().parse('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
        expect(() => string().ulid().parse('01ARZ3NDEKTSV4RRFFQ69G5FA')).toThrow();

        expect(string().emoji().parse('😀')).toBe('😀');
        expect(() => string().emoji().parse('😀😀')).toThrow();
    });

    test('should validate hash formats (MD5, SHA1, SHA256, SHA384, SHA512)', () => {
        expect(string().hash('md5').parse('5d41402abc4b2a76b9719d911017c592')).toBe('5d41402abc4b2a76b9719d911017c592');
        expect(() => string().hash('md5').parse('tooshort')).toThrow();

        const sha256Val = string().hash('sha256');
        expect(sha256Val.parse('2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae')).toBe(
            '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
        );

        expect(
            string()
                .hash('sha512')
                .parse(
                    'ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db27ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff',
                ),
        ).toBe(
            'ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db27ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff',
        );
    });

    // Number validations
    test('should validate finite floats and work with other validators', () => {
        const n = number().float();
        expect(n.parse(3.14)).toBe(3.14);
        expect(n.parse(42)).toBe(42);

        expect(() => n.parse(Number.POSITIVE_INFINITY)).toThrow();
        expect(() => n.parse(Number.NaN)).toThrow();

        const constrained = number().float().min(0).max(100);
        expect(constrained.parse(50.5)).toBe(50.5);
        expect(() => constrained.parse(-1.5)).toThrow();
    });

    test('should validate number range, gt, gte, lt, lte', () => {
        const range = number().range(10, 20);
        expect(range.parse(15)).toBe(15);
        expect(() => range.parse(9)).toThrow();

        expect(number().gt(10).parse(11)).toBe(11);
        expect(() => number().gt(10).parse(10)).toThrow(/10 equal or larger than expected \(10\)/);

        expect(number().gte(10).parse(10)).toBe(10);
        expect(() => number().gte(10).parse(9)).toThrow(/9 >= 10/);

        expect(number().lt(10).parse(9)).toBe(9);
        expect(() => number().lt(10).parse(10)).toThrow(/10 equal or smaller than expected \(10\)/);

        expect(number().lte(10).parse(10)).toBe(10);
        expect(() => number().lte(10).parse(11)).toThrow(/11 smaller than expected \(10\)/);
    });

    test('should validate positive, negative, nonnegative, nonpositive numbers', () => {
        expect(number().positive().parse(1)).toBe(1);
        expect(() => number().positive().parse(0)).toThrow(/0 equal or larger than expected \(0\)/);

        expect(number().negative().parse(-1)).toBe(-1);
        expect(() => number().negative().parse(0)).toThrow(/0 equal or smaller than expected \(0\)/);

        expect(number().nonnegative().parse(0)).toBe(0);
        expect(() => number().nonnegative().parse(-1)).toThrow(/-1 >= 0/);

        expect(number().nonpositive().parse(0)).toBe(0);
        expect(() => number().nonpositive().parse(1)).toThrow(/1 smaller than expected \(0\)/);
    });

    test('should validate multipleOf, step, finite, and safe for numbers', () => {
        const mult5 = number().multipleOf(5);
        expect(mult5.parse(10)).toBe(10);
        expect(() => mult5.parse(7)).toThrow(/7 undevided by 5/);

        expect(number().step(3).parse(0)).toBe(0);
        expect(() => number().step(3).parse(5)).toThrow(/5 undevided by 3/);

        const fin = number().finite();
        expect(fin.parse(42)).toBe(42);
        expect(() => fin.parse(Number.POSITIVE_INFINITY)).toThrow(/is not finite/);

        const safe = number().safe();
        expect(safe.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
        expect(() => safe.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow(/is not a safe integer/);
    });

    // BigInt validations
    test('should validate gt, gte, lt, lte comparisons with bigints', () => {
        const gt10 = bigint().gt(10n);
        expect(gt10.parse(11n)).toBe(11n);
        expect(() => gt10.parse(10n)).toThrow(/10 equal or smaller than expected \(10\)/);

        expect(bigint().gte(10n).parse(10n)).toBe(10n);
        expect(() => bigint().gte(10n).parse(9n)).toThrow(/9 smaller than expected \(10\)/);

        expect(bigint().lt(10n).parse(9n)).toBe(9n);
        expect(() => bigint().lt(10n).parse(10n)).toThrow(/10 equal or larger than expected \(10\)/);

        expect(bigint().lte(10n).parse(10n)).toBe(10n);
        expect(() => bigint().lte(10n).parse(11n)).toThrow(/11 larger than expected \(10\)/);
    });

    test('should validate positive, negative, nonnegative, nonpositive for bigints', () => {
        expect(bigint().positive().parse(1n)).toBe(1n);
        expect(() => bigint().positive().parse(0n)).toThrow(/0 equal or smaller than expected \(0\)/);

        expect(bigint().negative().parse(-1n)).toBe(-1n);
        expect(() => bigint().negative().parse(0n)).toThrow(/0 equal or larger than expected \(0\)/);

        expect(bigint().nonnegative().parse(0n)).toBe(0n);
        expect(() => bigint().nonnegative().parse(-1n)).toThrow(/-1 smaller than expected \(0\)/);

        expect(bigint().nonpositive().parse(0n)).toBe(0n);
        expect(() => bigint().nonpositive().parse(1n)).toThrow(/1 larger than expected \(0\)/);
    });

    test('should validate multipleOf and step for bigints', () => {
        const mult5 = bigint().multipleOf(5n);
        expect(mult5.parse(10n)).toBe(10n);
        expect(() => mult5.parse(7n)).toThrow(/7 undevided by 5/);

        expect(bigint().step(3n).parse(0n)).toBe(0n);
        expect(() => bigint().step(3n).parse(5n)).toThrow(/5 undevided by 3/);
    });

    // Date and ISO format validations
    test('should validate ISO date format', () => {
        expect(string().isoDate().parse('2023-01-01')).toBe('2023-01-01');
        expect(() => string().isoDate().parse('2023-1-1')).toThrow();
        expect(() => string().isoDate().parse('not-a-date')).toThrow();

        expect(isoDate().parse('2023-12-31')).toBe('2023-12-31');
    });

    test('should validate ISO time format', () => {
        expect(string().isoTime().parse('12:30:45')).toBe('12:30:45');
        expect(string().isoTime().parse('12:30:45.123')).toBe('12:30:45.123');
        expect(() => string().isoTime().parse('12:30')).toThrow(); // Missing seconds
        expect(() => string().isoTime().parse('1:30:45')).toThrow(); // Single digit hour
        expect(() => string().isoTime().parse('not-time')).toThrow();

        expect(isoTime().parse('09:15:30')).toBe('09:15:30');
    });

    test('should validate ISO datetime format', () => {
        expect(string().isoDatetime().parse('2023-01-01T12:30:45Z')).toBe('2023-01-01T12:30:45Z');
        expect(string().isoDatetime().parse('2023-01-01T12:30:45+05:30')).toBe('2023-01-01T12:30:45+05:30');
        expect(() => string().isoDatetime().parse('2023-01-01 12:30:45')).toThrow();
        expect(() => string().isoDatetime().parse('not-datetime')).toThrow();

        expect(isoDatetime().parse('2023-12-31T23:59:59Z')).toBe('2023-12-31T23:59:59Z');
    });

    test('should validate ISO duration format', () => {
        expect(string().isoDuration().parse('P1Y2M3DT4H5M6S')).toBe('P1Y2M3DT4H5M6S');
        expect(string().isoDuration().parse('PT1H')).toBe('PT1H');
        expect(string().isoDuration().parse('P1D')).toBe('P1D');
        expect(string().isoDuration().parse('P1W')).toBe('P1W'); // Week format
        expect(string().isoDuration().parse('P3W')).toBe('P3W'); // 3 weeks
        expect(() => string().isoDuration().parse('1 day')).toThrow();
        expect(() => string().isoDuration().parse('P')).toThrow(); // Empty duration

        expect(isoDuration().parse('P3Y6M4DT12H30M5S')).toBe('P3Y6M4DT12H30M5S');
    });

    test('should work as convenience functions', () => {
        expect(isoDate().parse('2024-01-15')).toBe('2024-01-15');
        expect(isoTime().parse('12:30:45')).toBe('12:30:45');
        expect(isoDatetime().parse('2024-01-15T12:30:45Z')).toBe('2024-01-15T12:30:45Z');
        expect(isoDuration().parse('P1Y')).toBe('P1Y');
    });
    test('should validate NaN and literal values (string, number, boolean, null, undefined)', () => {
        // NaN
        expect(Number.isNaN(nan().parse(Number.NaN))).toBeTruthy();
        expect(Number.isNaN(nan().parse(0 / 0))).toBeTruthy();
        expect(() => nan().parse(0)).toThrow(/Expected NaN/);
        expect(() => nan().parse('NaN')).toThrow(/Expected NaN/);

        // String literal
        expect(literal('hello').parse('hello')).toBe('hello');
        expect(() => literal('hello').parse('world')).toThrow(/Expected literal "hello"/);

        // Number literal
        expect(literal(42).parse(42)).toBe(42);
        expect(() => literal(42).parse(43)).toThrow(/Expected literal 42/);
        expect(() => literal(42).parse('42')).toThrow(/Expected literal 42/);

        // Boolean literal
        expect(literal(true).parse(true)).toBe(true);
        expect(() => literal(true).parse(false)).toThrow(/Expected literal true/);

        // Null literal
        expect(literal(null).parse(null)).toBe(null);
        expect(() => literal(null).parse(undefined)).toThrow(/Expected literal null/);

        // Undefined literal
        expect(literal(undefined).parse(undefined)).toBe(undefined);
        expect(() => literal(undefined).parse(null)).toThrow(/Expected literal/);

        // void (same as undefined literal)
        expect(voidVal().parse(undefined)).toBe(undefined);
        expect(() => voidVal().parse(null)).toThrow(/Expected literal undefined, got null/);
    });

    test('should work with nullable and nullish wrappers', () => {
        // nullable - accepts null or wrapped type
        const nullableString = nullable(string());
        expect(nullableString.parse(null)).toBe(null);
        expect(nullableString.parse('hello')).toBe('hello');
        expect(nullableString.parse('undefined')).toBe('undefined'); // string coercion

        // nullable with validation
        const nullableEmail = nullable(string().email());
        expect(nullableEmail.parse(null)).toBe(null);
        expect(nullableEmail.parse('test@example.com')).toBe('test@example.com');
        expect(() => nullableEmail.parse('bad')).toThrow(/is not a valid email address/);

        // nullish - accepts null, undefined, or wrapped type
        const nullishString = nullish(string());
        expect(nullishString.parse(null)).toBe(null);
        expect(nullishString.parse(undefined)).toBe(undefined);
        expect(nullishString.parse('hello')).toBe('hello');
        expect(nullishString.parse(123)).toBe('123'); // coerced

        // nullish with validation
        const nullishEmail = nullish(string().email());
        expect(nullishEmail.parse(null)).toBe(null);
        expect(nullishEmail.parse(undefined)).toBe(undefined);
        expect(nullishEmail.parse('test@example.com')).toBe('test@example.com');
        expect(() => nullishEmail.parse('bad')).toThrow(/is not a valid email address/);
    });

    test('should provide default for undefined/null with primitives and complex types', () => {
        // Primitives
        expect(string().default('default-value').parse(undefined)).toBe('default-value');
        expect(string().default('default-value').parse(null)).toBe('default-value');
        expect(string().default('default-value').parse('custom')).toBe('custom');

        expect(number().default(42).parse(undefined)).toBe(42);
        expect(number().default(42).parse(null)).toBe(42);
        expect(number().default(42).parse(100)).toBe(100);

        expect(boolean().default(true).parse(undefined)).toBe(true);
        expect(boolean().default(true).parse(null)).toBe(true);
        expect(boolean().default(true).parse(false)).toBe(false);

        // Objects
        expect(object().default({ foo: 'bar' }).parse(undefined)).toEqual({ foo: 'bar' });
        expect(object().default({ foo: 'bar' }).parse({ custom: 'value' })).toEqual({ custom: 'value' });

        // Arrays
        expect(array().default([1, 2, 3]).parse(undefined)).toEqual([1, 2, 3]);
        expect(array().default([1, 2, 3]).parse([4, 5])).toEqual([4, 5]);
    });

    test('should work with validation methods', () => {
        const withDefault = number().default(10).positive();
        expect(withDefault.parse(undefined)).toBe(10);
        expect(withDefault.parse(null)).toBe(10);
        expect(() => withDefault.parse(-1)).toThrow(/-1 equal or larger than expected \(0\)/);
        expect(withDefault.parse(20)).toBe(20);
    });

    // isValid Function
    test('should validate and transform valid objects', () => {
        const obj = object({
            name: string().min(2).max(100),
            age: number().int().min(0).max(100),
            email: string().email(),
        });

        const result = parse(obj, {
            name: 'John Doe',
            age: 30,
            email: 'john@example.com',
        });
        expect(result).not.toBe(undefined);
        expect(result?.name).toBe('John Doe');
        expect(result?.age).toBe(30);
        expect(result?.email).toBe('john@example.com');

        // Non-object input throws (validators don't return undefined)
        expect(() => parse(obj, undefined)).toThrow();
        expect(() => parse(obj, 42)).toThrow();
    });

    test('should throw for invalid objects', () => {
        expect(() => parse(object({ name: string().min(2) }), { name: 'J' })).toThrow();
        expect(() => parse(object({ age: number().int().min(0) }), { age: -1 })).toThrow();
        expect(() => parse(object({ age: number().int() }), { age: 25.5 })).toThrow();
        expect(() => parse(object({ email: string().email() }), { email: 'invalid' })).toThrow();
        expect(() => parse(object({ name: string(), age: number() }), { name: 'John' })).toThrow(); // missing required
    });

    test('should handle optional and required fields', () => {
        const obj2 = object({
            name: string(),
            nickname: string().optional(),
            age: number().optional(),
        });

        const result = parse(obj2, { name: 'John' });
        expect(result).not.toBe(undefined);
        expect(result?.name).toBe('John');
        expect(result?.nickname).toBe(undefined);
        expect(result?.age).toBe(undefined);

        // Empty string is valid
        expect(parse(object({ name: string() }), { name: '' })).toEqual({ name: '' });

        // Extra properties ignored
        const result2 = parse(obj2, { name: 'John', extra: 'ignored' });
        expect(Object(result2).extra).toBe(undefined);
    });

    test('should coerce types and validate formats', () => {
        // Number coercion
        const result1 = parse(object({ age: number(), score: number() }), { age: '25', score: '100.5' });
        expect(result1?.age).toBe(25);
        expect(() => parse(object({ age: number() }), { age: 'invalid' })).toThrow();

        // Boolean coercion
        const result2 = parse(object({ name: string(), active: boolean() }), { name: 'John', active: 'true' });
        expect(result2?.active).toBe(true);
    });

    // Obj Arr Map Set Validator
    test('should validate plain objects with and without schema', () => {
        const o = object();
        const result = o.parse({ foo: 'bar' });
        expect(result).not.toBe(undefined);
        expect(result).toEqual({ foo: 'bar' });

        expect(() => o.parse('string')).toThrow();
        expect(() => o.parse([])).toThrow();

        // With schema
        const o2 = object({ name: string(), age: number().int().min(0) });
        expect(o2.parse({ name: 'John', age: 25 })).toEqual({ name: 'John', age: 25 });
        expect(() => o2.parse({ age: 25 })).toThrow(); // missing name
        expect(() => o2.parse({ name: 'John', age: -1 })).toThrow(); // age < 0
    });

    test('should handle required and optional', () => {
        expect(typeof object().parse({})).not.toBe('symbol');
        expect(() => object().parse(undefined)).toThrow();

        const optional = object().optional();
        expect(typeof optional.parse({})).not.toBe('symbol');
        expect(optional.parse(undefined)).toBe(undefined);
    });

    test('should validate arrays with and without item validator', () => {
        const a = array();
        expect(a.parse([1, 2, 3])).toEqual([1, 2, 3]);

        expect(() => a.parse('string')).toThrow(/Expected array, got string/);
        expect(() => a.parse({})).toThrow(/Expected array, got object/);

        // With item validator
        const a2 = array(number().int().min(0));
        expect(a2.parse([1, 2, 3])).toEqual([1, 2, 3]);
        expect(a2.parse(['1', '2', '3'])).toEqual([1, 2, 3]); // coercion
        expect(() => a2.parse([1, -1, 3])).toThrow(); // -1 is < 0
    });

    test('should validate length constraints', () => {
        const minArr = array().minLength(2);
        expect(typeof minArr.parse([1, 2])).not.toBe('symbol');
        expect(() => minArr.parse([1])).toThrow();

        const maxArr = array().maxLength(3);
        expect(typeof maxArr.parse([1, 2, 3])).not.toBe('symbol');
        expect(() => maxArr.parse([1, 2, 3, 4])).toThrow(/4 <= 3/);
    });

    test('should handle required and optional for arrays', () => {
        expect(typeof array().parse([])).not.toBe('symbol');
        expect(() => array().parse(undefined)).toThrow();

        const optional = array().optional();
        expect(typeof optional.parse([])).not.toBe('symbol');
        expect(optional.parse(undefined)).toBe(undefined);
    });
    test('should convert arrays to Set', () => {
        const s = set();
        const result = s.parse([1, 2, 3, 2]);
        expect(result instanceof Set).toBeTruthy();
        expect(result.size).toBe(3);

        expect(() => s.parse('string')).toThrow();

        const withValidator = set(number().int().min(0));
        expect(withValidator.parse([1, 2, 3]) instanceof Set).toBeTruthy();
        expect(() => withValidator.parse([1, -1])).toThrow();

        expect(set().optional().parse(undefined)).toBe(undefined);
    });

    test('should convert objects to Map', () => {
        const m = map();
        const result = m.parse({ a: 1, b: 2 });
        expect(result instanceof Map).toBeTruthy();
        expect(result.get('a')).toBe(1);

        expect(() => m.parse([])).toThrow();

        const withValidator = map(number().int().min(0));
        expect(withValidator.parse({ a: 1, b: 2 }) instanceof Map).toBeTruthy();
        expect(() => withValidator.parse({ a: 1, b: -1 })).toThrow();

        expect(map().optional().parse(undefined)).toBe(undefined);
    });

    test('should validate non-empty arrays, exact length, and chaining', () => {
        // Non-empty
        expect(array().nonempty().parse([1])).toEqual([1]);
        expect(() => array().nonempty().parse([])).toThrow(/Array must not be empty/);

        // Exact length
        expect(array().length(3).parse([1, 2, 3])).toEqual([1, 2, 3]);
        expect(() => array().length(3).parse([1, 2])).toThrow(/2 === 3/);

        // Chaining with item validators
        const arr = array(number()).nonempty().minLength(2).maxLength(5);
        expect(arr.parse([1, 2])).toEqual([1, 2]);
        expect(arr.parse([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5]);
        expect(() => arr.parse([])).toThrow(/Array must not be empty/);
        expect(() => arr.parse([1])).toThrow(/1 >= 2/);
        expect(() => arr.parse([1, 2, 3, 4, 5, 6])).toThrow(/6 <= 5/);
    });

    test('should validate complex nested structures', () => {
        const obj3 = object({
            name: string(),
            age: number().int().min(0),
            address: object({
                street: string(),
                city: string(),
                zip: string().min(5).max(10),
            }),
            hobbies: array(string()).optional(),
        });

        const result = parse(obj3, {
            name: 'John',
            age: 30,
            address: { street: '123 Main St', city: 'NYC', zip: '10001' },
            hobbies: ['reading', 'coding'],
        });

        expect(result).not.toBe(undefined);
        expect(result?.address).toEqual({ street: '123 Main St', city: 'NYC', zip: '10001' });
        expect(result?.hobbies).toEqual(['reading', 'coding']);
    });

    test('should validate array of objects and deeply nested structures', () => {
        const obj4 = object({
            users: array(object({ name: string(), age: number().int().min(0) })),
        });

        const result = parse(obj4, {
            users: [
                { name: 'Alice', age: 25 },
                { name: 'Bob', age: 30 },
            ],
        });
        expect(result).not.toBe(undefined);
        expect(result?.users[0]?.name).toBe('Alice');

        // Missing required field throws
        expect(() => parse(obj4, { users: [{ age: 30 }] })).toThrow();

        // Deep nesting with coercion
        const deepObj = object({
            scores: array(number().int().min(0).max(100)),
        });
        const deepResult = parse(deepObj, { scores: ['85', '92', 100, '78'] });
        expect(deepResult?.scores).toEqual([85, 92, 100, 78]);
    });

    test('should handle empty arrays and multiple nesting levels', () => {
        const schema = object({
            tags: array(string()),
            numbers: array(number()).optional(),
        });

        const result = parse(schema, { tags: [] });
        expect(result?.tags).toEqual([]);
        expect(result?.numbers).toBe(undefined);
    });

    test('should accept unknown keys by default (loose), reject with strictObject', () => {
        // Default loose behavior
        const schema = object({ name: string(), age: number() });
        const result = schema.parse({ name: 'John', age: 30, extra: 'allowed' });
        expect(result?.name).toBe('John');
        expect(result?.age).toBe(30);

        // strictObject rejects unknown keys
        const strict = strictObject({ name: string(), age: number() });
        expect(() => strict.parse({ name: 'John', age: 30, extra: 'not allowed' })).toThrow(/Unknown keys in strict mode: extra/);
        expect(() => strictObject({ name: string() }).parse({ name: 'John', age: 30, email: 'x' })).toThrow(
            /Unknown keys in strict mode: age, email/,
        );

        // strictObject accepts valid objects
        const validResult = strict.parse({ name: 'John', age: 30 });
        expect(validResult?.name).toBe('John');

        // optional explicitly allows unknown keys (legacy behavior with Schema)
        const opt = optional({ name: string() });
        const optionalResult = opt.parse({ name: 'John', age: 30, anything: 'goes' });
        expect(optionalResult?.name).toBe('John');
    });

    test('should support Zod-compatible optional() for any validator', () => {
        // optional with string
        const optStr = optional(string());
        expect(optStr.parse('hello')).toBe('hello');
        expect(optStr.parse(undefined)).toBe(undefined);

        // optional with number
        const optNum = optional(number());
        expect(optNum.parse(42)).toBe(42);
        expect(optNum.parse(undefined)).toBe(undefined);

        // optional with object
        const optObj = optional(object({ id: number() }));
        expect(optObj.parse({ id: 1 })).toStrictEqual({ id: 1 });
        expect(optObj.parse(undefined)).toBe(undefined);

        // optional with array
        const optArr = optional(array(string()));
        expect(optArr.parse(['a', 'b'])).toStrictEqual(['a', 'b']);
        expect(optArr.parse(undefined)).toBe(undefined);
    });

    // Advanced features
    test('should allow custom validators and transformers via push()', () => {
        const n = number();
        n.push((val: number) => {
            if (val % 2 !== 0) throw new Error('Validation failed');
            return val;
        });
        expect(n.parse(10)).toBe(10);
        expect(() => n.parse(11)).toThrow();

        const s = string();
        s.push((val: string) => val.toUpperCase());
        expect(s.parse('hello')).toBe('HELLO');
    });

    test('should allow multiple custom validators', () => {
        const n = number();
        n.push((val: number) => {
            if (val <= 0) throw new Error('Validation failed');
            return val;
        });
        n.push((val: number) => {
            if (val >= 100) throw new Error('Validation failed');
            return val;
        });

        expect(n.parse(50)).toBe(50);
        expect(() => n.parse(-5)).toThrow();
        expect(() => n.parse(150)).toThrow();

        // In parse context - wrap with object() to create Schema
        const schema = object({ score: n });
        expect(parse(schema, { score: 25 })?.score).toBe(25);
        expect(() => parse(schema, { score: 150 })).toThrow();
    });

    test('should store and update descriptions on validators', () => {
        // Basic description
        expect(string().describe('A string field').defs().description).toBe('A string field');
        expect(number().describe('A number field').defs().description).toBe('A number field');

        // Works with chaining
        const n = number().min(5).describe('At least 5').max(10);
        expect(n.defs().description).toBe('At least 5');
        expect(n.parse(7)).toBe(7);

        // Returns undefined when no description
        expect(string().defs().description).toBe(undefined);
    });

    test('should validate union with coercion and literal types', () => {
        // Basic union with coercion (first-match wins)
        const u = union([number(), string()]);
        expect(u.parse('42')).toBe(42); // matches number first
        expect(u.parse('hello')).toBe('hello'); // fails number, matches string
        expect(u.parse(123)).toBe(123);

        // Use literals to avoid coercion issues
        const u2 = union([literal(true), literal(false), number()]);
        expect(u2.parse(true)).toBe(true);
        expect(u2.parse(false)).toBe(false);
        expect(u2.parse(42)).toBe(42);

        // Literal-only union
        const colors = union([literal('red'), literal('green'), literal('blue')]);
        expect(colors.parse('red')).toBe('red');
        expect(() => colors.parse('yellow')).toThrow(/Value does not match any union member/);
    });

    test('should validate union with constraints and throw when no members match', () => {
        // Union with validation constraints
        const u = union([number().min(0).max(100), string().email()]);
        expect(u.parse(50)).toBe(50);
        expect(u.parse('test@example.com')).toBe('test@example.com');
        expect(() => u.parse(150)).toThrow(/Value does not match any union member/);
        expect(() => u.parse('not-an-email')).toThrow(/Value does not match any union member/);

        // No match throws error
        const u2 = union([number().min(100), string().email()]);
        expect(() => u2.parse(42)).toThrow(/Value does not match any union member/);
    });

    test('should validate discriminated unions and complex nested unions', () => {
        // Discriminated union (objects with different shapes)
        const u = union([object({ type: literal('user'), name: string() }), object({ type: literal('admin'), role: string() })]);
        expect(u.parse({ type: 'user', name: 'John' })).toEqual({ type: 'user', name: 'John' });
        expect(u.parse({ type: 'admin', role: 'superadmin' })).toEqual({ type: 'admin', role: 'superadmin' });
        expect(() => u.parse({ type: 'guest' })).toThrow(/Value does not match any union member/);

        // Complex nested union
        const result = union([
            object({ type: literal('success'), data: string() }),
            object({ type: literal('error'), message: string(), code: number() }),
        ]);
        expect(result.parse({ type: 'success', data: 'result' })).toEqual({ type: 'success', data: 'result' });
        expect(result.parse({ type: 'error', message: 'failed', code: 404 })).toEqual({
            type: 'error',
            message: 'failed',
            code: 404,
        });

        // Union of arrays
        expect(union([array(number()), array(string())]).parse([1, 2, 3])).toEqual([1, 2, 3]);
    });

    test('should work with optional, nullable, and in parse context', () => {
        // Optional union
        const u = union([number(), string()]).optional();
        expect(u.parse(undefined)).toBe(undefined);
        expect(u.parse(42)).toBe(42);
        expect(u.parse('hello')).toBe('hello');

        // Nullable union
        const u2 = nullable(union([literal(true), literal(false), number()]));
        expect(u2.parse(null)).toBe(null);
        expect(u2.parse(42)).toBe(42);

        // In parse context - wrap with object() to create Schema
        const schema = object({ id: number(), value: union([number(), string(), boolean()]) });
        const result = parse(schema, { id: 1, value: 42 });
        expect(result?.id).toBe(1);
        expect(result?.value).toBe(42);
    });

    test('should require at least 2 validators', () => {
        // @ts-expect-error - testing runtime error
        expect(() => union([number()])).toThrow(/Union requires at least 2 validators/);
        // @ts-expect-error - testing runtime error
        expect(() => union([])).toThrow(/Union requires at least 2 validators/);
    });

    test('should extract keys as union of literals', () => {
        // Basic keyof
        const schema = object({ name: string(), age: number(), email: string() });
        const keySchema = schema.keyof();
        expect(keySchema.parse('name')).toBe('name');
        expect(keySchema.parse('age')).toBe('age');
        expect(keySchema.parse('email')).toBe('email');
        expect(() => keySchema.parse('unknown')).toThrow(/Value does not match any union member/);

        // Works with object()
        const zSchema = object({ id: number(), title: string() });
        const zKeySchema = zSchema.keyof();
        expect(zKeySchema.parse('id')).toBe('id');
        expect(() => zKeySchema.parse('invalid')).toThrow(/Value does not match any union member/);

        // Throws for object with no schema
        expect(() => object().keyof()).toThrow(/Cannot get keyof from object with no schema/);
    });

    // Zod-like API (z export)
    test('should provide all primitive validators and complex types', () => {
        // Primitives
        expect(string().parse('hello')).toBe('hello');
        expect(number().parse(42)).toBe(42);

        // Array
        expect(array(number()).parse([1, 2, 3])).toEqual([1, 2, 3]);

        // Format validators
        expect(email().parse('test@example.com')).toBe('test@example.com');
        expect(url().parse('https://example.com')).toBe('https://example.com');
        expect(uuid().parse('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');

        // Nullable and nullish
        expect(nullable(string()).parse(null)).toBe(null);
        expect(nullish(number()).parse(undefined)).toBe(undefined);

        // Describe
        expect(object({ name: string() }).describe('User schema').defs().description).toBe('User schema');

        // strictObject and optional
        expect(typeof strictObject).toBe('function');
        expect(typeof optional).toBe('function');
    });

    test('should work with object() and union()', () => {
        const schema = object({
            id: number(),
            name: string().min(3),
            status: union([literal('active'), literal('inactive')]),
        });

        const result = schema.parse({ id: 1, name: 'John', status: 'active' });
        expect(result).toEqual({ id: 1, name: 'John', status: 'active' });
    });

    // Object property constraints
    test('should validate minProperties, maxProperties, and both combined', () => {
        // minProperties
        const minSchema = object({}).minProperties(2);
        expect(() => minSchema.parse({})).toThrow(/Object must have at least 2 properties, got 0/);
        expect(() => minSchema.parse({ a: 1 })).toThrow(/Object must have at least 2 properties, got 1/);
        expect(minSchema.parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });

        // maxProperties
        const maxSchema = object({}).maxProperties(2);
        expect(maxSchema.parse({})).toEqual({});
        expect(maxSchema.parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
        expect(() => maxSchema.parse({ a: 1, b: 2, c: 3 })).toThrow(/Object must have at most 2 properties, got 3/);

        // Both combined
        const rangeSchema = object({}).minProperties(1).maxProperties(3);
        expect(() => rangeSchema.parse({})).toThrow(/Object must have at least 1/);
        expect(rangeSchema.parse({ a: 1 })).toEqual({ a: 1 });
        expect(rangeSchema.parse({ a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2, c: 3 });
        expect(() => rangeSchema.parse({ a: 1, b: 2, c: 3, d: 4 })).toThrow(/Object must have at most 3/);

        // Works with object()
        const zSchema = object({}).minProperties(1).maxProperties(2);
        expect(() => zSchema.parse({})).toThrow(/Object must have at least 1/);
        expect(zSchema.parse({ x: 'test' })).toEqual({ x: 'test' });
        expect(() => zSchema.parse({ x: 'test', y: 'data', z: 'extra' })).toThrow(/Object must have at most 2/);
    });

    test('should support .strict(), .passthrough(), and .strip() methods (Zod-compatible API)', () => {
        const schema = object({ name: string() });
        const input = { name: 'John', age: 30 };

        // Default behavior strips unknown keys
        expect(schema.parse(input)).toEqual({ name: 'John' });

        // .passthrough() allows unknown keys
        expect(schema.passthrough().parse(input)).toEqual({ name: 'John', age: 30 });

        // .strict() throws on unknown keys
        expect(() => schema.strict().parse(input)).toThrow(/Unknown keys in strict mode: age/);

        // .strip() explicitly removes unknown keys (same as default)
        expect(schema.strip().parse(input)).toEqual({ name: 'John' });

        // Methods are chainable
        expect(schema.passthrough().strip().parse(input)).toEqual({ name: 'John' });
    });

    // Schema metadata (_def property)
    test('should expose type metadata for all validator types', () => {
        // Primitives
        expect(string().defs().type).toBe('string');
        expect(number().defs().type).toBe('number');
        expect(boolean().defs().type).toBe('boolean');

        // Complex types
        expect(array(string()).defs().type).toBe('array');
        expect(object({ name: string() }).defs().type).toBe('object');
        expect(union([number(), string()]).defs().type).toBeTruthy(); // Union has type
    });

    test('should store description, literal values, and nullable schemas', () => {
        // Description
        expect(string().describe('A string field').defs().description).toBe('A string field');

        // Literal value
        expect(literal('active').defs().value).toBe('active');

        // Nullable anyOf
        expect(nullable(array(number())).defs().anyOf).toBeTruthy();
    });

    test('should expose object schema properties and constraints', () => {
        // Object properties
        const schema = object({ name: string(), age: number() });
        expect(schema.defs().type).toBe('object');
        expect(schema.defs().properties).toBeTruthy();
        expect(Object.keys(schema.defs().properties!).length).toBe(2);
        expect('name' in schema.defs().properties!).toBeTruthy();
        expect('age' in schema.defs().properties!).toBeTruthy();

        // Strict object disallows additional properties
        expect(strictObject({ name: string() }).defs().additionalProperties).toBe(false);
    });

    test('should expose array items and union anyOf metadata', () => {
        // Array items
        const arr = array(string());
        expect(arr.defs().type).toBe('array');
        expect(arr.defs().items).toBeTruthy();
        expect(arr.defs().items!.type).toBe('string');

        // Union anyOf
        expect(union([number(), string(), boolean()]).defs().type).toBeTruthy();
    });

    test('safeParse should return Zod-compatible result format', () => {
        const schema = string().min(3);

        // Success case
        const result1 = schema.safeParse('hello');
        expect(result1.success).toBe(true);
        if (result1.success) {
            expect(result1.data).toBe('hello');
        }

        // Error case
        const result2 = schema.safeParse('ab');
        expect(result2.success).toBe(false);
        if (!result2.success) {
            expect(result2.error instanceof Error).toBeTruthy();
            expect(result2.error.message.includes('at least 3')).toBeTruthy();
        }

        // Test with object schema
        const objSchema = object({ name: string(), age: number().int() });
        const result3 = objSchema.safeParse({ name: 'John', age: 30 });
        expect(result3.success).toBe(true);
        if (result3.success) {
            expect(result3.data.name).toBe('John');
            expect(result3.data.age).toBe(30);
        }

        // Test with invalid object
        const result4 = objSchema.safeParse({ name: 'Jane', age: 'invalid' });
        expect(result4.success).toBe(false);
        if (!result4.success) {
            expect(result4.error instanceof Error).toBeTruthy();
        }
    });

    test('safeParse should return Zod-compatible result format', () => {
        const schema = string().min(3);

        // Success case
        const result1 = zod.safeParse(schema, 'hello');
        expect(result1.success).toBe(true);
        if (result1.success) {
            expect(result1.data).toBe('hello');
        }

        // Error case
        const result2 = zod.safeParse(schema, 'ab');
        expect(result2.success).toBe(false);
        if (!result2.success) {
            expect(result2.error instanceof Error).toBeTruthy();
            expect(result2.error.message.includes('at least 3')).toBeTruthy();
        }

        // Test with object schema - must wrap with object()
        const objSchema = object({ name: string(), age: number().int() });
        const result3 = zod.safeParse(objSchema, { name: 'John', age: 30 });
        expect(result3.success).toBe(true);
        if (result3.success) {
            expect(result3.data.name).toBe('John');
            expect(result3.data.age).toBe(30);
        }

        // Test with invalid object
        const result4 = zod.safeParse(objSchema, { name: 'Jane', age: 'invalid' });
        expect(result4.success).toBe(false);
        if (!result4.success) {
            expect(result4.error instanceof Error).toBeTruthy();
        }
    });
});

test('should extend object schemas', () => {
    const baseSchema = object({ name: string(), age: number() });
    const extendedSchema = baseSchema.extend({ email: string().email() });

    const result = extendedSchema.parse({ name: 'John', age: 30, email: 'john@example.com' });
    expect(result.name).toBe('John');
    expect(result.age).toBe(30);
    expect(result.email).toBe('john@example.com');

    expect(() => extendedSchema.parse({ name: 'John', age: 30, email: 'invalid' })).toThrow(/email/);
});

test('should extend object with strict mode preserved', () => {
    const baseSchema = object({ name: string() }).strict();
    const extended = baseSchema.extend({ age: number() });

    const result = extended.parse({ name: 'John', age: 30 });
    expect(result.name).toBe('John');
    expect(result.age).toBe(30);

    expect(() => extended.parse({ name: 'John', age: 30, extra: 'value' })).toThrow();
});

test('should extend object with passthrough mode preserved', () => {
    const baseSchema = object({ name: string() }).passthrough();
    const extended = baseSchema.extend({ age: number() });

    const result = extended.parse({ name: 'John', age: 30, extra: 'value' }) as { name: string; age: number; extra: string };
    expect(result.name).toBe('John');
    expect(result.age).toBe(30);
    expect(result.extra).toBe('value');
});

test('should get defs from NaN validator', () => {
    const nanValidator = nan();
    const defs = nanValidator.defs();
    expect(defs.description?.includes('NaN')).toBeTruthy();
    expect(defs.not !== undefined).toBeTruthy();
});

test('should set and retrieve examples from validators', () => {
    // Test built-in examples from standard validators
    const emailValidator = string().email();
    const emailDefs = emailValidator.defs();
    expect(emailDefs.examples).toStrictEqual(['user@example.com']);
    expect(emailDefs.format).toBe('email');

    const urlValidator = string().url();
    const urlDefs = urlValidator.defs();
    expect(urlDefs.examples).toStrictEqual(['https://example.com']);
    expect(urlDefs.format).toBe('uri');

    // Test custom examples override
    const customValidator = string().email().examples('admin@test.com', 'support@test.com');
    const customDefs = customValidator.defs();
    expect(customDefs.examples).toStrictEqual(['admin@test.com', 'support@test.com']);

    // Test examples on plain string
    const plainValidator = string().examples('foo', 'bar', 'baz');
    const plainDefs = plainValidator.defs();
    expect(plainDefs.examples).toStrictEqual(['foo', 'bar', 'baz']);

    // Test chaining with other methods
    const chainedValidator = string().min(3).examples('hello', 'world').max(10);
    const chainedDefs = chainedValidator.defs();
    expect(chainedDefs.examples).toStrictEqual(['hello', 'world']);
    expect(chainedDefs.minLength).toBe(3);
    expect(chainedDefs.maxLength).toBe(10);
});
