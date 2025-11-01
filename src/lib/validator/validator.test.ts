import { deepEqual, deepStrictEqual, notEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    array,
    base64,
    base64url,
    bigint,
    boolean,
    cidrv4,
    cidrv6,
    cuid,
    cuid2,
    date,
    email,
    emoji,
    hash,
    hex,
    hostname,
    httpUrl,
    ipv4,
    ipv6,
    isoDate,
    isoDatetime,
    isoDuration,
    isoTime,
    jwt,
    literal,
    map,
    nan,
    nanoid,
    nullable,
    nullish,
    nullValidator,
    number,
    object,
    optional,
    parseSchema,
    type Schema,
    set,
    strictObject,
    string,
    ulid,
    undefinedValidator,
    union,
    url,
    uuid,
    voidValidator,
    z,
} from './index';

describe('Validator tests', () => {
    // Primitive validations
    it('should validate and coerce boolean values', () => {
        const b = boolean();
        strictEqual(b.parse(true), true);
        strictEqual(b.parse(false), false);
        strictEqual(b.parse('false'), true); // non-empty strings are truthy
        strictEqual(b.parse(''), false);
        strictEqual(b.parse(1), true);
        strictEqual(b.parse(0), false);
        strictEqual(b.parse(null), false);
        strictEqual(b.parse({}), true); // objects are truthy
        strictEqual(b.parse(Number.NaN), false);
    });

    it('should validate and coerce string values', () => {
        const s = string();
        strictEqual(s.parse('hello'), 'hello');
        strictEqual(s.parse(123), '123');
        strictEqual(s.parse(0), '0');
        strictEqual(s.parse(true), 'true');
        strictEqual(s.parse(BigInt(123)), '123');
        strictEqual(s.parse(null), 'null');
        strictEqual(s.parse([1, 2, 3]), '1,2,3');
        strictEqual(s.parse({ foo: 'bar' }), '[object Object]');
    });

    it('should validate and coerce number values', () => {
        const n = number();
        strictEqual(n.parse(42), 42);
        strictEqual(n.parse('123'), 123);
        strictEqual(n.parse(''), 0);
        strictEqual(n.parse(true), 1);
        strictEqual(n.parse(BigInt(123)), 123);
        strictEqual(n.parse(null), 0);
        strictEqual(n.parse(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);

        throws(() => n.parse('not a number'));
        throws(() => n.parse(Number.NaN));
        throws(() => n.parse(undefined));
        throws(() => n.parse({}));
    });

    it('should validate and coerce bigint values', () => {
        const bi = bigint();
        strictEqual(bi.parse(BigInt(123)), 123n);
        strictEqual(bi.parse('12345678901234567890'), 12345678901234567890n);
        strictEqual(bi.parse(42), 42n);
        strictEqual(bi.parse(true), 1n);
        strictEqual(bi.parse(''), 0n);

        throws(() => bi.parse(3.14)); // Non-integer
        throws(() => bi.parse('not a number'));
        throws(() => bi.parse(undefined));
        throws(() => bi.parse(null));
        throws(() => bi.parse(Number.POSITIVE_INFINITY));
    });

    it('should validate and coerce date values', () => {
        const d = date();
        const now = new Date();
        ok(d.parse(now) instanceof Date);

        const isoDate = d.parse('2023-01-01T00:00:00.000Z');
        ok(isoDate instanceof Date);
        strictEqual(isoDate?.toISOString(), '2023-01-01T00:00:00.000Z');

        strictEqual(d.parse(0)?.getTime(), 0); // epoch
        strictEqual(d.parse(true)?.getTime(), 1);
        strictEqual(d.parse(null)?.getTime(), 0);

        throws(() => d.parse('not a date'));
        throws(() => d.parse(undefined));
        throws(() => d.parse(Number.NaN));
        throws(() => d.parse(90071992547409920)); // Too large
    });

    it('should handle optional primitives', () => {
        strictEqual(boolean().optional().parse(true), true);
        strictEqual(boolean().optional().parse(undefined), undefined);

        strictEqual(string().optional().parse('hello'), 'hello');
        strictEqual(string().optional().parse(null), undefined);

        strictEqual(number().optional().parse(42), 42);
        strictEqual(number().optional().parse(''), undefined);

        strictEqual(bigint().optional().parse(123n), 123n);
        strictEqual(bigint().optional().parse(undefined), undefined);

        ok(date().optional().parse(new Date()) instanceof Date);
        strictEqual(date().optional().parse(null), undefined);
    });

    it('should clear validators using clear() method', () => {
        const s = string().min(5).max(10);
        strictEqual(s.parse('hello'), 'hello');
        throws(() => s.parse('hi')); // Too short

        // Clear all validators
        s.clear();
        // Now it accepts anything (no validators)
        strictEqual(s.parse('hi'), 'hi'); // Previously would fail
        strictEqual(s.parse('a very long string that exceeds 10'), 'a very long string that exceeds 10');

        const n = number().min(0).max(100);
        strictEqual(n.parse(50), 50);
        throws(() => n.parse(-5)); // Below minimum

        n.clear();
        strictEqual(n.parse(-5), -5); // Now accepts anything
    });

    it('should validate undefined and null values', () => {
        const undef = undefinedValidator();
        strictEqual(undef.parse(undefined), undefined);
        throws(() => undef.parse(null), /Expected literal undefined, got null/);
        throws(() => undef.parse(0), /Expected literal undefined, got 0/);

        const nul = nullValidator();
        strictEqual(nul.parse(null), null);
        throws(() => nul.parse(undefined), /Expected literal null, got undefined/);
        throws(() => nul.parse(false), /Expected literal null, got false/);
    });

    // String validations
    it('should validate using custom regex patterns', () => {
        const s = string().regex(/^[A-Z][a-z]+$/); // Capitalized word
        strictEqual(s.parse('Hello'), 'Hello');
        throws(() => s.parse('hello'));
        throws(() => s.parse('HELLO'));

        const phone = string().regex(/^\d{3}-\d{3}-\d{4}$/);
        strictEqual(phone.parse('123-456-7890'), '123-456-7890');
        throws(() => phone.parse('1234567890'));
    });

    it('should work with multiple regex validators and custom error messages', () => {
        const s = string()
            .regex(/^[A-Z]/) // Must start with capital
            .regex(/[a-z]$/) // Must end with lowercase
            .min(3);
        strictEqual(s.parse('Hello'), 'Hello');
        throws(() => s.parse('hello'));

        const productCode = string().regex(
            /^PROD-\d{4}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: test
            '"${val}" is not a valid product code (format: PROD-####)',
        );
        strictEqual(productCode.parse('PROD-1234'), 'PROD-1234');
        try {
            productCode.parse('INVALID');
            throw new Error('Should have thrown');
        } catch (err) {
            strictEqual((err as Error).message, '"INVALID" is not a valid product code (format: PROD-####)');
        }
    });

    it('should validate string length, startsWith, endsWith, includes', () => {
        strictEqual(string().length(5).parse('hello'), 'hello');
        throws(() => string().length(5).parse('hi'), /2 === 5/);

        strictEqual(string().startsWith('hello').parse('hello world'), 'hello world');
        throws(() => string().startsWith('hello').parse('hi there'), /"hi there" must start with "hello"/);

        strictEqual(string().endsWith('world').parse('hello world'), 'hello world');
        throws(() => string().endsWith('world').parse('hello there'), /"hello there" must end with "world"/);

        strictEqual(string().includes('test').parse('this is a test'), 'this is a test');
        throws(() => string().includes('test').parse('no match'), /"no match" must include "test"/);
    });

    it('should validate and transform string case', () => {
        strictEqual(string().uppercase().parse('HELLO'), 'HELLO');
        throws(() => string().uppercase().parse('Hello'), /"Hello" must be uppercase/);

        strictEqual(string().lowercase().parse('hello'), 'hello');
        throws(() => string().lowercase().parse('Hello'), /"Hello" must be lowercase/);

        // Transforms
        strictEqual(string().trim().parse('  hello  '), 'hello');
        strictEqual(string().toLowerCase().parse('HELLO'), 'hello');
        strictEqual(string().toUpperCase().parse('hello'), 'HELLO');

        const toUpper = string().toUpperCase();
        strictEqual(toUpper.parse('hello'), 'HELLO');
        strictEqual(toUpper.parse('Hello World'), 'HELLO WORLD');

        const norm = string().normalize();
        strictEqual(norm.parse('café'), 'café');
    });

    it('should chain string validation and transform methods', () => {
        const validator = string().min(3).trim().toLowerCase();
        strictEqual(validator.parse('  HELLO  '), 'hello');
        strictEqual(validator.parse('  HI  '), 'hi');
        throws(() => validator.parse('ab'));
    });

    it('should validate string formats (URL, email, UUID, network)', () => {
        strictEqual(string().uuid().parse('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
        throws(() => string().uuid().parse('not-a-uuid'));

        strictEqual(string().url().parse('https://example.com'), 'https://example.com');
        throws(() => string().url().parse('example.com'));

        strictEqual(string().httpUrl().parse('https://example.com'), 'https://example.com');
        throws(() => string().httpUrl().parse('ftp://files.example.com'));

        strictEqual(string().hostname().parse('subdomain.example.com'), 'subdomain.example.com');
        throws(() => string().hostname().parse('localhost'));

        strictEqual(string().ipv4().parse('192.168.1.1'), '192.168.1.1');
        throws(() => string().ipv4().parse('256.1.1.1'));

        strictEqual(string().ipv6().parse('2001:db8:85a3::8a2e:370:7334'), '2001:db8:85a3::8a2e:370:7334');
        throws(() => string().ipv6().parse('192.168.1.1'));

        strictEqual(string().cidrv4().parse('192.168.1.0/24'), '192.168.1.0/24');
        throws(() => string().cidrv4().parse('192.168.1.0/33'));

        strictEqual(string().cidrv6().parse('2001:db8::/32'), '2001:db8::/32');
        throws(() => string().cidrv6().parse('2001:db8::/129'));
    });

    it('should validate encoding formats (base64, base64url, hex)', () => {
        strictEqual(string().base64().parse('SGVsbG8gV29ybGQ='), 'SGVsbG8gV29ybGQ=');
        throws(() => string().base64().parse('invalid@base64'), /is not valid/);

        strictEqual(string().base64url().parse('SGVsbG8gV29ybGQ'), 'SGVsbG8gV29ybGQ');
        throws(() => string().base64url().parse('has=padding'), /is not valid/);

        strictEqual(string().hex().parse('deadbeef'), 'deadbeef');
        throws(() => string().hex().parse('notahex'));
    });

    it('should validate ID formats (JWT, nanoid, CUID, CUID2, ULID, emoji)', () => {
        const testJwt =
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        strictEqual(string().jwt().parse(testJwt), testJwt);
        throws(() => string().jwt().parse('only.two'));

        strictEqual(string().nanoid().parse('V1StGXR8_Z5jdHi6B-myT'), 'V1StGXR8_Z5jdHi6B-myT');
        throws(() => string().nanoid().parse('tooshort'));

        strictEqual(string().cuid().parse('cjld2cjxh0000qzrmn831i7rn'), 'cjld2cjxh0000qzrmn831i7rn');
        throws(() => string().cuid().parse('notacuid'), /"notacuid" is not a valid CUID/);

        strictEqual(string().cuid2().parse('tz4a98xxat96iws9zmbrgj3a'), 'tz4a98xxat96iws9zmbrgj3a');
        throws(() => string().cuid2().parse('1startswithnumber'));

        strictEqual(string().ulid().parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), '01ARZ3NDEKTSV4RRFFQ69G5FAV');
        throws(() => string().ulid().parse('01ARZ3NDEKTSV4RRFFQ69G5FA'));

        strictEqual(string().emoji().parse('😀'), '😀');
        throws(() => string().emoji().parse('😀😀'));
    });

    it('should validate hash formats (MD5, SHA1, SHA256, SHA384, SHA512)', () => {
        strictEqual(string().hash('md5').parse('5d41402abc4b2a76b9719d911017c592'), '5d41402abc4b2a76b9719d911017c592');
        throws(() => string().hash('md5').parse('tooshort'));

        const sha256Val = string().hash('sha256');
        strictEqual(
            sha256Val.parse('2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae'),
            '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
        );

        strictEqual(
            string()
                .hash('sha512')
                .parse(
                    'ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db27ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff',
                ),
            'ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db27ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff',
        );
    });

    // Number validations
    it('should validate finite floats and work with other validators', () => {
        const n = number().float();
        strictEqual(n.parse(3.14), 3.14);
        strictEqual(n.parse(42), 42);

        throws(() => n.parse(Number.POSITIVE_INFINITY));
        throws(() => n.parse(Number.NaN));

        const constrained = number().float().min(0).max(100);
        strictEqual(constrained.parse(50.5), 50.5);
        throws(() => constrained.parse(-1.5));
    });

    it('should validate number range, gt, gte, lt, lte', () => {
        const range = number().range(10, 20);
        strictEqual(range.parse(15), 15);
        throws(() => range.parse(9));

        strictEqual(number().gt(10).parse(11), 11);
        throws(() => number().gt(10).parse(10), /10 > 10/);

        strictEqual(number().gte(10).parse(10), 10);
        throws(() => number().gte(10).parse(9), /9 >= 10/);

        strictEqual(number().lt(10).parse(9), 9);
        throws(() => number().lt(10).parse(10), /10 < 10/);

        strictEqual(number().lte(10).parse(10), 10);
        throws(() => number().lte(10).parse(11), /11 <= 10/);
    });

    it('should validate positive, negative, nonnegative, nonpositive numbers', () => {
        strictEqual(number().positive().parse(1), 1);
        throws(() => number().positive().parse(0), /0 > 0/);

        strictEqual(number().negative().parse(-1), -1);
        throws(() => number().negative().parse(0), /0 < 0/);

        strictEqual(number().nonnegative().parse(0), 0);
        throws(() => number().nonnegative().parse(-1), /-1 >= 0/);

        strictEqual(number().nonpositive().parse(0), 0);
        throws(() => number().nonpositive().parse(1), /1 <= 0/);
    });

    it('should validate multipleOf, step, finite, and safe for numbers', () => {
        const mult5 = number().multipleOf(5);
        strictEqual(mult5.parse(10), 10);
        throws(() => mult5.parse(3), /3 % 5 !== 0/);

        strictEqual(number().step(3).parse(0), 0);
        throws(() => number().step(3).parse(5), /5 % 3 !== 0/);

        const fin = number().finite();
        strictEqual(fin.parse(42), 42);
        throws(() => fin.parse(Number.POSITIVE_INFINITY), /is not finite/);

        const safe = number().safe();
        strictEqual(safe.parse(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
        throws(() => safe.parse(Number.MAX_SAFE_INTEGER + 1), /is not a safe integer/);
    });

    // BigInt validations
    it('should validate gt, gte, lt, lte comparisons with bigints', () => {
        const gt10 = bigint().gt(10n);
        strictEqual(gt10.parse(11n), 11n);
        throws(() => gt10.parse(10n), /10 > 10/);

        strictEqual(bigint().gte(10n).parse(10n), 10n);
        throws(() => bigint().gte(10n).parse(9n), /9 >= 10/);

        strictEqual(bigint().lt(10n).parse(9n), 9n);
        throws(() => bigint().lt(10n).parse(10n), /10 < 10/);

        strictEqual(bigint().lte(10n).parse(10n), 10n);
        throws(() => bigint().lte(10n).parse(11n), /11 <= 10/);
    });

    it('should validate positive, negative, nonnegative, nonpositive for bigints', () => {
        strictEqual(bigint().positive().parse(1n), 1n);
        throws(() => bigint().positive().parse(0n), /0 > 0/);

        strictEqual(bigint().negative().parse(-1n), -1n);
        throws(() => bigint().negative().parse(0n), /0 < 0/);

        strictEqual(bigint().nonnegative().parse(0n), 0n);
        throws(() => bigint().nonnegative().parse(-1n), /-1 >= 0/);

        strictEqual(bigint().nonpositive().parse(0n), 0n);
        throws(() => bigint().nonpositive().parse(1n), /1 <= 0/);
    });

    it('should validate multipleOf and step for bigints', () => {
        const mult5 = bigint().multipleOf(5n);
        strictEqual(mult5.parse(10n), 10n);
        throws(() => mult5.parse(3n), /3 % 5 !== 0/);

        strictEqual(bigint().step(3n).parse(0n), 0n);
        throws(() => bigint().step(3n).parse(5n), /5 % 3 !== 0/);
    });

    // Date and ISO format validations
    it('should validate ISO date format', () => {
        strictEqual(string().isoDate().parse('2023-01-01'), '2023-01-01');
        throws(() => string().isoDate().parse('2023-1-1'));
        throws(() => string().isoDate().parse('not-a-date'));

        strictEqual(isoDate().parse('2023-12-31'), '2023-12-31');
    });

    it('should validate ISO time format', () => {
        strictEqual(string().isoTime().parse('12:30:45'), '12:30:45');
        strictEqual(string().isoTime().parse('12:30:45.123'), '12:30:45.123');
        throws(() => string().isoTime().parse('12:30')); // Missing seconds
        throws(() => string().isoTime().parse('1:30:45')); // Single digit hour
        throws(() => string().isoTime().parse('not-time'));

        strictEqual(isoTime().parse('09:15:30'), '09:15:30');
    });

    it('should validate ISO datetime format', () => {
        strictEqual(string().isoDatetime().parse('2023-01-01T12:30:45Z'), '2023-01-01T12:30:45Z');
        strictEqual(string().isoDatetime().parse('2023-01-01T12:30:45+05:30'), '2023-01-01T12:30:45+05:30');
        throws(() => string().isoDatetime().parse('2023-01-01 12:30:45'));
        throws(() => string().isoDatetime().parse('not-datetime'));

        strictEqual(isoDatetime().parse('2023-12-31T23:59:59Z'), '2023-12-31T23:59:59Z');
    });

    it('should validate ISO duration format', () => {
        strictEqual(string().isoDuration().parse('P1Y2M3DT4H5M6S'), 'P1Y2M3DT4H5M6S');
        strictEqual(string().isoDuration().parse('PT1H'), 'PT1H');
        strictEqual(string().isoDuration().parse('P1D'), 'P1D');
        strictEqual(string().isoDuration().parse('P1W'), 'P1W'); // Week format
        strictEqual(string().isoDuration().parse('P3W'), 'P3W'); // 3 weeks
        throws(() => string().isoDuration().parse('1 day'));
        throws(() => string().isoDuration().parse('P')); // Empty duration

        strictEqual(isoDuration().parse('P3Y6M4DT12H30M5S'), 'P3Y6M4DT12H30M5S');
    });
    it('should validate gt, gte, lt, lte comparisons with bigints', () => {
        // gt - greater than
        const gt10 = bigint().gt(10n);
        strictEqual(gt10.parse(11n), 11n);
        strictEqual(gt10.parse(100n), 100n);
        throws(() => gt10.parse(10n), /10 > 10/);
        throws(() => gt10.parse(9n), /9 > 10/);

        // gte - greater than or equal
        const gte10 = bigint().gte(10n);
        strictEqual(gte10.parse(10n), 10n);
        strictEqual(gte10.parse(11n), 11n);
        throws(() => gte10.parse(9n), /9 >= 10/);

        // lt - less than
        const lt10 = bigint().lt(10n);
        strictEqual(lt10.parse(9n), 9n);
        strictEqual(lt10.parse(0n), 0n);
        throws(() => lt10.parse(10n), /10 < 10/);
        throws(() => lt10.parse(11n), /11 < 10/);

        // lte - less than or equal
        const lte10 = bigint().lte(10n);
        strictEqual(lte10.parse(10n), 10n);
        strictEqual(lte10.parse(9n), 9n);
        throws(() => lte10.parse(11n), /11 <= 10/);
    });

    it('should validate positive, negative, nonnegative, nonpositive for bigints', () => {
        // positive - greater than 0n
        const pos = bigint().positive();
        strictEqual(pos.parse(1n), 1n);
        strictEqual(pos.parse(100n), 100n);
        throws(() => pos.parse(0n), /0 > 0/);
        throws(() => pos.parse(-1n), /-1 > 0/);

        // negative - less than 0n
        const neg = bigint().negative();
        strictEqual(neg.parse(-1n), -1n);
        strictEqual(neg.parse(-100n), -100n);
        throws(() => neg.parse(0n), /0 < 0/);
        throws(() => neg.parse(1n), /1 < 0/);

        // nonnegative - greater than or equal to 0n
        const nonneg = bigint().nonnegative();
        strictEqual(nonneg.parse(0n), 0n);
        strictEqual(nonneg.parse(1n), 1n);
        throws(() => nonneg.parse(-1n), /-1 >= 0/);

        // nonpositive - less than or equal to 0n
        const nonpos = bigint().nonpositive();
        strictEqual(nonpos.parse(0n), 0n);
        strictEqual(nonpos.parse(-1n), -1n);
        throws(() => nonpos.parse(1n), /1 <= 0/);
    });

    it('should validate multipleOf and step for bigints', () => {
        // multipleOf
        const mult5 = bigint().multipleOf(5n);
        strictEqual(mult5.parse(0n), 0n);
        strictEqual(mult5.parse(5n), 5n);
        strictEqual(mult5.parse(10n), 10n);
        strictEqual(mult5.parse(-5n), -5n);
        throws(() => mult5.parse(3n), /3 % 5 !== 0/);
        throws(() => mult5.parse(7n), /7 % 5 !== 0/);

        // step - alias for multipleOf
        const step3 = bigint().step(3n);
        strictEqual(step3.parse(0n), 0n);
        strictEqual(step3.parse(3n), 3n);
        strictEqual(step3.parse(6n), 6n);
        throws(() => step3.parse(5n), /5 % 3 !== 0/);
    });

    it('should coerce values to bigint', () => {
        const bi = bigint();
        strictEqual(bi.parse(42), 42n);
        strictEqual(bi.parse('123'), 123n);
        strictEqual(bi.parse(true), 1n);
        strictEqual(bi.parse(false), 0n);
        strictEqual(bi.parse(42n), 42n);
    });

    it('should validate length, startsWith, endsWith, includes', () => {
        strictEqual(string().length(5).parse('hello'), 'hello');
        throws(() => string().length(5).parse('hi'), /2 === 5/);

        strictEqual(string().startsWith('hello').parse('hello world'), 'hello world');
        throws(() => string().startsWith('hello').parse('hi there'), /"hi there" must start with "hello"/);

        strictEqual(string().endsWith('world').parse('hello world'), 'hello world');
        throws(() => string().endsWith('world').parse('hello there'), /"hello there" must end with "world"/);

        strictEqual(string().includes('test').parse('this is a test'), 'this is a test');
        throws(() => string().includes('test').parse('no match'), /"no match" must include "test"/);
    });

    it('should validate and transform case', () => {
        strictEqual(string().uppercase().parse('HELLO'), 'HELLO');
        throws(() => string().uppercase().parse('Hello'), /"Hello" must be uppercase/);

        strictEqual(string().lowercase().parse('hello'), 'hello');
        throws(() => string().lowercase().parse('Hello'), /"Hello" must be lowercase/);

        // Transforms
        strictEqual(string().trim().parse('  hello  '), 'hello');
        strictEqual(string().toLowerCase().parse('HELLO'), 'hello');
        strictEqual(string().toUpperCase().parse('hello'), 'HELLO');

        // toUpperCase - converts to uppercase
        const toUpper = string().toUpperCase();
        strictEqual(toUpper.parse('hello'), 'HELLO');
        strictEqual(toUpper.parse('Hello World'), 'HELLO WORLD');
        strictEqual(toUpper.parse('HELLO'), 'HELLO');

        // normalize - Unicode normalization
        const norm = string().normalize();
        strictEqual(norm.parse('café'), 'café'); // NFC normalization
        const nfc = string().normalize('NFC');
        strictEqual(nfc.parse('café'), 'café');
    });

    it('should chain validation and transform methods', () => {
        // Transform then validate - trim happens after toLowerCase
        const validator = string().min(3).trim().toLowerCase();
        strictEqual(validator.parse('  HELLO  '), 'hello');

        // Validation happens BEFORE transform, so '  HI  ' is 6 chars and passes min(3)
        strictEqual(validator.parse('  HI  '), 'hi');

        // This will fail min(3) because 'ab' is only 2 chars (no spaces)
        throws(() => validator.parse('ab'));
    });
    it('should validate range, gt, gte, lt, lte', () => {
        const range = number().range(10, 20);
        strictEqual(range.parse(15), 15);
        throws(() => range.parse(9));

        const composed = number().int().range(0, 5);
        strictEqual(composed.parse(0), 0);
        throws(() => composed.parse(2.5));

        strictEqual(number().gt(10).parse(11), 11);
        throws(() => number().gt(10).parse(10), /10 > 10/);

        strictEqual(number().gte(10).parse(10), 10);
        throws(() => number().gte(10).parse(9), /9 >= 10/);

        strictEqual(number().lt(10).parse(9), 9);
        throws(() => number().lt(10).parse(10), /10 < 10/);

        strictEqual(number().lte(10).parse(10), 10);
        throws(() => number().lte(10).parse(11), /11 <= 10/);
    });

    it('should validate positive, negative, nonnegative, nonpositive', () => {
        strictEqual(number().positive().parse(1), 1);
        throws(() => number().positive().parse(0), /0 > 0/);

        strictEqual(number().negative().parse(-1), -1);
        throws(() => number().negative().parse(0), /0 < 0/);

        strictEqual(number().nonnegative().parse(0), 0);
        throws(() => number().nonnegative().parse(-1), /-1 >= 0/);

        strictEqual(number().nonpositive().parse(0), 0);
        throws(() => number().nonpositive().parse(1), /1 <= 0/);
    });

    it('should validate multipleOf, step, finite, and safe', () => {
        const mult5 = number().multipleOf(5);
        strictEqual(mult5.parse(10), 10);
        throws(() => mult5.parse(3), /3 % 5 !== 0/);

        strictEqual(number().step(3).parse(0), 0);
        throws(() => number().step(3).parse(5), /5 % 3 !== 0/);

        const fin = number().finite();
        strictEqual(fin.parse(42), 42);
        throws(() => fin.parse(Number.POSITIVE_INFINITY), /is not finite/);

        const safe = number().safe();
        strictEqual(safe.parse(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
        throws(() => safe.parse(Number.MAX_SAFE_INTEGER + 1), /is not a safe integer/);
    });
    it('should validate URL, email, UUID, and network formats', () => {
        // UUID
        strictEqual(string().uuid().parse('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
        throws(() => string().uuid().parse('not-a-uuid'));

        // URL (any protocol)
        strictEqual(string().url().parse('https://example.com'), 'https://example.com');
        strictEqual(string().url().parse('ftp://files.example.com'), 'ftp://files.example.com');
        throws(() => string().url().parse('example.com')); // missing protocol

        // HTTP URL (http/https only)
        strictEqual(string().httpUrl().parse('https://example.com'), 'https://example.com');
        throws(() => string().httpUrl().parse('ftp://files.example.com'));

        // Hostname
        strictEqual(string().hostname().parse('subdomain.example.com'), 'subdomain.example.com');
        throws(() => string().hostname().parse('localhost')); // no TLD

        // IPv4 and IPv6
        strictEqual(string().ipv4().parse('192.168.1.1'), '192.168.1.1');
        throws(() => string().ipv4().parse('256.1.1.1')); // out of range
        strictEqual(string().ipv6().parse('2001:db8:85a3::8a2e:370:7334'), '2001:db8:85a3::8a2e:370:7334');
        throws(() => string().ipv6().parse('192.168.1.1')); // IPv4

        // CIDR
        strictEqual(string().cidrv4().parse('192.168.1.0/24'), '192.168.1.0/24');
        throws(() => string().cidrv4().parse('192.168.1.0/33')); // invalid mask
        strictEqual(string().cidrv6().parse('2001:db8::/32'), '2001:db8::/32');
        throws(() => string().cidrv6().parse('2001:db8::/129')); // invalid mask
    });

    it('should validate encoding formats (base64, base64url, hex)', () => {
        // base64
        strictEqual(string().base64().parse('SGVsbG8gV29ybGQ='), 'SGVsbG8gV29ybGQ=');
        throws(() => string().base64().parse('invalid@base64'), /is not valid/);

        // base64url
        strictEqual(string().base64url().parse('SGVsbG8gV29ybGQ'), 'SGVsbG8gV29ybGQ');
        throws(() => string().base64url().parse('has=padding'), /is not valid/);

        // hex
        strictEqual(string().hex().parse('deadbeef'), 'deadbeef');
        throws(() => string().hex().parse('notahex'));
    });

    it('should validate ID formats (JWT, nanoid, CUID, CUID2, ULID) and emoji', () => {
        // JWT
        const testJwt =
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        strictEqual(string().jwt().parse(testJwt), testJwt);
        throws(() => string().jwt().parse('only.two'));

        // nanoid (21 chars)
        strictEqual(string().nanoid().parse('V1StGXR8_Z5jdHi6B-myT'), 'V1StGXR8_Z5jdHi6B-myT');
        throws(() => string().nanoid().parse('tooshort'));

        // CUID
        strictEqual(string().cuid().parse('cjld2cjxh0000qzrmn831i7rn'), 'cjld2cjxh0000qzrmn831i7rn');
        throws(() => string().cuid().parse('notacuid'), /"notacuid" is not a valid CUID/);

        // CUID2
        strictEqual(string().cuid2().parse('tz4a98xxat96iws9zmbrgj3a'), 'tz4a98xxat96iws9zmbrgj3a');
        throws(() => string().cuid2().parse('1startswithnumber')); // must start with letter

        // ULID (26 chars)
        strictEqual(string().ulid().parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), '01ARZ3NDEKTSV4RRFFQ69G5FAV');
        throws(() => string().ulid().parse('01ARZ3NDEKTSV4RRFFQ69G5FA')); // 25 chars

        // Emoji
        strictEqual(string().emoji().parse('😀'), '😀');
        throws(() => string().emoji().parse('😀😀')); // multiple emojis
    });

    it('should validate hash formats (MD5, SHA1, SHA256, SHA384, SHA512)', () => {
        // MD5 (32 hex chars)
        strictEqual(string().hash('md5').parse('5d41402abc4b2a76b9719d911017c592'), '5d41402abc4b2a76b9719d911017c592');
        throws(() => string().hash('md5').parse('tooshort'));

        // SHA256 (64 hex chars)
        const sha256Val = string().hash('sha256');
        strictEqual(
            sha256Val.parse('2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae'),
            '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
        );
        throws(() => sha256Val.parse('notahexstring1234567890123456789012345678901234567890123456789012'));

        // SHA512 (128 hex chars)
        strictEqual(
            string()
                .hash('sha512')
                .parse(
                    'ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db27ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff',
                ),
            'ee26b0dd4af7e749aa1a8ee3c10ae9923f618980772e473f8819a5d4940e0db27ac185f8a0e1d5f84f88bc887fd67b143732c304cc5fa9ad8e6f57f50028a8ff',
        );
    });

    it('should work with exported format validators', () => {
        // Test that exported validators work directly
        strictEqual(uuid().parse('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
        strictEqual(email().parse('test@example.com'), 'test@example.com');
        strictEqual(url().parse('https://example.com'), 'https://example.com');
        strictEqual(httpUrl().parse('https://example.com'), 'https://example.com');
        strictEqual(hostname().parse('example.com'), 'example.com');
        strictEqual(base64().parse('SGVsbG8='), 'SGVsbG8=');
        strictEqual(base64url().parse('SGVsbG8'), 'SGVsbG8');
        strictEqual(hex().parse('deadbeef'), 'deadbeef');
        strictEqual(ipv4().parse('192.168.1.1'), '192.168.1.1');
        strictEqual(ipv6().parse('::1'), '::1');
        strictEqual(cidrv4().parse('192.168.1.0/24'), '192.168.1.0/24');
        strictEqual(cidrv6().parse('2001:db8::/32'), '2001:db8::/32');
        strictEqual(hash('md5').parse('5d41402abc4b2a76b9719d911017c592'), '5d41402abc4b2a76b9719d911017c592');
        strictEqual(nanoid().parse('V1StGXR8_Z5jdHi6B-myT'), 'V1StGXR8_Z5jdHi6B-myT');
        strictEqual(cuid().parse('cjld2cjxh0000qzrmn831i7rn'), 'cjld2cjxh0000qzrmn831i7rn');
        strictEqual(cuid2().parse('tz4a98xxat96iws9zmbrgj3a'), 'tz4a98xxat96iws9zmbrgj3a');
        strictEqual(ulid().parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), '01ARZ3NDEKTSV4RRFFQ69G5FAV');
        strictEqual(emoji().parse('😀'), '😀');
        strictEqual(jwt().parse('eyJhbGci.eyJzdWI.SflKxw'), 'eyJhbGci.eyJzdWI.SflKxw');
    });

    it('should validate ISO date format', () => {
        const validator = isoDate();

        // Valid dates
        strictEqual(validator.parse('2024-01-15'), '2024-01-15');
        strictEqual(validator.parse('2000-12-31'), '2000-12-31');
        strictEqual(validator.parse('1999-01-01'), '1999-01-01');

        // Invalid dates
        throws(() => validator.parse('2024-1-15'), /is not a valid ISO 8601 date/);
        throws(() => validator.parse('24-01-15'), /is not a valid ISO 8601 date/);
        throws(() => validator.parse('2024/01/15'), /is not a valid ISO 8601 date/);
        throws(() => validator.parse('not a date'), /is not a valid ISO 8601 date/);
    });

    it('should validate ISO time format', () => {
        const validator = isoTime();

        // Valid times
        strictEqual(validator.parse('12:30:45'), '12:30:45');
        strictEqual(validator.parse('00:00:00'), '00:00:00');
        strictEqual(validator.parse('23:59:59'), '23:59:59');
        strictEqual(validator.parse('12:30:45.123'), '12:30:45.123');
        strictEqual(validator.parse('12:30:45.1'), '12:30:45.1');

        // Invalid times
        throws(() => validator.parse('12:30'), /is not a valid ISO 8601 time/);
        throws(() => validator.parse('1:30:45'), /is not a valid ISO 8601 time/);
        throws(() => validator.parse('12:30:45.1234'), /is not a valid ISO 8601 time/);
        throws(() => validator.parse('not a time'), /is not a valid ISO 8601 time/);
    });

    it('should validate ISO datetime format', () => {
        const validator = isoDatetime();

        // Valid datetimes
        strictEqual(validator.parse('2024-01-15T12:30:45Z'), '2024-01-15T12:30:45Z');
        strictEqual(validator.parse('2024-01-15T12:30:45.123Z'), '2024-01-15T12:30:45.123Z');
        strictEqual(validator.parse('2024-01-15T12:30:45+05:30'), '2024-01-15T12:30:45+05:30');
        strictEqual(validator.parse('2024-01-15T12:30:45-08:00'), '2024-01-15T12:30:45-08:00');
        strictEqual(validator.parse('2024-01-15T12:30:45'), '2024-01-15T12:30:45');

        // Invalid datetimes
        throws(() => validator.parse('2024-01-15 12:30:45'), /is not a valid ISO 8601 datetime/);
        throws(() => validator.parse('2024-01-15'), /is not a valid ISO 8601 datetime/);
        throws(() => validator.parse('not a datetime'), /is not a valid ISO 8601 datetime/);
    });
    it('should validate ISO duration format', () => {
        const validator = isoDuration();

        // Valid durations
        strictEqual(validator.parse('P1Y2M3DT4H5M6S'), 'P1Y2M3DT4H5M6S');
        strictEqual(validator.parse('P1Y'), 'P1Y');
        strictEqual(validator.parse('PT1H'), 'PT1H');
        strictEqual(validator.parse('P1DT12H'), 'P1DT12H');
        strictEqual(validator.parse('PT0.5S'), 'PT0.5S');
        strictEqual(validator.parse('P0D'), 'P0D');

        // Invalid durations
        throws(() => validator.parse('1Y2M3D'), /is not a valid ISO 8601 duration/);
        throws(() => validator.parse('P'), /is not a valid ISO 8601 duration/);
        throws(() => validator.parse('not a duration'), /is not a valid ISO 8601 duration/);
    });
    it('should work as convenience functions', () => {
        strictEqual(isoDate().parse('2024-01-15'), '2024-01-15');
        strictEqual(isoTime().parse('12:30:45'), '12:30:45');
        strictEqual(isoDatetime().parse('2024-01-15T12:30:45Z'), '2024-01-15T12:30:45Z');
        strictEqual(isoDuration().parse('P1Y'), 'P1Y');
    });
    it('should validate NaN and literal values (string, number, boolean, null, undefined)', () => {
        // NaN
        ok(Number.isNaN(nan().parse(Number.NaN)));
        ok(Number.isNaN(nan().parse(0 / 0)));
        throws(() => nan().parse(0), /Expected NaN/);
        throws(() => nan().parse('NaN'), /Expected NaN/);

        // String literal
        strictEqual(literal('hello').parse('hello'), 'hello');
        throws(() => literal('hello').parse('world'), /Expected literal "hello"/);

        // Number literal
        strictEqual(literal(42).parse(42), 42);
        throws(() => literal(42).parse(43), /Expected literal 42/);
        throws(() => literal(42).parse('42'), /Expected literal 42/);

        // Boolean literal
        strictEqual(literal(true).parse(true), true);
        throws(() => literal(true).parse(false), /Expected literal true/);

        // Null literal
        strictEqual(literal(null).parse(null), null);
        throws(() => literal(null).parse(undefined), /Expected literal null/);

        // Undefined literal
        strictEqual(literal(undefined).parse(undefined), undefined);
        throws(() => literal(undefined).parse(null), /Expected literal/);

        // void (same as undefined literal)
        strictEqual(voidValidator().parse(undefined), undefined);
        throws(() => voidValidator().parse(null), /Expected literal undefined, got null/);
    });

    it('should work with nullable and nullish wrappers', () => {
        // nullable - accepts null or wrapped type
        const nullableString = nullable(string());
        strictEqual(nullableString.parse(null), null);
        strictEqual(nullableString.parse('hello'), 'hello');
        strictEqual(nullableString.parse('undefined'), 'undefined'); // string coercion

        // nullable with validation
        const nullableEmail = nullable(string().email());
        strictEqual(nullableEmail.parse(null), null);
        strictEqual(nullableEmail.parse('test@example.com'), 'test@example.com');
        throws(() => nullableEmail.parse('bad'), /is not a valid email address/);

        // nullish - accepts null, undefined, or wrapped type
        const nullishString = nullish(string());
        strictEqual(nullishString.parse(null), null);
        strictEqual(nullishString.parse(undefined), undefined);
        strictEqual(nullishString.parse('hello'), 'hello');
        strictEqual(nullishString.parse(123), '123'); // coerced

        // nullish with validation
        const nullishEmail = nullish(string().email());
        strictEqual(nullishEmail.parse(null), null);
        strictEqual(nullishEmail.parse(undefined), undefined);
        strictEqual(nullishEmail.parse('test@example.com'), 'test@example.com');
        throws(() => nullishEmail.parse('bad'), /is not a valid email address/);
    });

    it('should provide default for undefined/null with primitives and complex types', () => {
        // Primitives
        strictEqual(string().default('default-value').parse(undefined), 'default-value');
        strictEqual(string().default('default-value').parse(null), 'default-value');
        strictEqual(string().default('default-value').parse('custom'), 'custom');

        strictEqual(number().default(42).parse(undefined), 42);
        strictEqual(number().default(42).parse(null), 42);
        strictEqual(number().default(42).parse(100), 100);

        strictEqual(boolean().default(true).parse(undefined), true);
        strictEqual(boolean().default(true).parse(null), true);
        strictEqual(boolean().default(true).parse(false), false);

        // Objects
        deepEqual(object().default({ foo: 'bar' }).parse(undefined), { foo: 'bar' });
        deepEqual(object().default({ foo: 'bar' }).parse({ custom: 'value' }), { custom: 'value' });

        // Arrays
        deepEqual(array().default([1, 2, 3]).parse(undefined), [1, 2, 3]);
        deepEqual(array().default([1, 2, 3]).parse([4, 5]), [4, 5]);
    });

    it('should work with validation methods', () => {
        const withDefault = number().default(10).positive();
        strictEqual(withDefault.parse(undefined), 10);
        strictEqual(withDefault.parse(null), 10);
        throws(() => withDefault.parse(-1), /-1 > 0/);
        strictEqual(withDefault.parse(20), 20);
    });

    // isValid Function
    it('should validate and transform valid objects', () => {
        const validator: Schema = {
            name: string().min(2).max(100),
            age: number().int().min(0).max(100),
            email: string().email(),
        };

        const result = parseSchema<{ name: string; age: number; email: string }>(validator, {
            name: 'John Doe',
            age: 30,
            email: 'john@example.com',
        });
        notEqual(result, undefined);
        strictEqual(result?.name, 'John Doe');
        strictEqual(result?.age, 30);
        strictEqual(result?.email, 'john@example.com');

        // Non-object input returns undefined
        strictEqual(parseSchema(validator, undefined), undefined);
        strictEqual(parseSchema(validator, 42), undefined);
    });

    it('should throw for invalid objects', () => {
        throws(() => parseSchema({ name: string().min(2) }, { name: 'J' }));
        throws(() => parseSchema({ age: number().int().min(0) }, { age: -1 }));
        throws(() => parseSchema({ age: number().int() }, { age: 25.5 }));
        throws(() => parseSchema({ email: string().email() }, { email: 'invalid' }));
        throws(() => parseSchema({ name: string(), age: number() }, { name: 'John' })); // missing required
    });

    it('should handle optional and required fields', () => {
        const validator = {
            name: string(),
            nickname: string().optional(),
            age: number().optional(),
        };

        const result = parseSchema<{ name: string; nickname?: string; age?: number }>(validator, { name: 'John' });
        notEqual(result, undefined);
        strictEqual(result?.name, 'John');
        strictEqual(result?.nickname, undefined);
        strictEqual(result?.age, undefined);

        // Empty string is valid
        deepEqual(parseSchema({ name: string() }, { name: '' }), { name: '' });

        // Extra properties ignored
        const result2 = parseSchema(validator, { name: 'John', extra: 'ignored' });
        strictEqual((result2 as Record<string, unknown>).extra, undefined);
    });

    it('should coerce types and validate formats', () => {
        // Number coercion
        const result1 = parseSchema<{ age: number; score: number }>(
            { age: number(), score: number() },
            { age: '25', score: '100.5' },
        );
        strictEqual(result1?.age, 25);
        throws(() => parseSchema({ age: number() }, { age: 'invalid' }));

        // Boolean coercion
        const result2 = parseSchema<{ name: string; active: boolean }>(
            { name: string(), active: boolean() },
            { name: 'John', active: 'true' },
        );
        strictEqual(result2?.active, true);
    });

    // Obj Arr Map Set Validator
    it('should validate plain objects with and without schema', () => {
        const o = object();
        const result = o.parse({ foo: 'bar' });
        notEqual(result, undefined);
        deepEqual(result, { foo: 'bar' });

        throws(() => o.parse('string'));
        throws(() => o.parse([]));

        // With schema
        const o2 = object({ name: string(), age: number().int().min(0) });
        deepEqual(o2.parse({ name: 'John', age: 25 }), { name: 'John', age: 25 });
        throws(() => o2.parse({ age: 25 })); // missing name
        throws(() => o2.parse({ name: 'John', age: -1 })); // age < 0
    });

    it('should handle required and optional', () => {
        notEqual(typeof object().parse({}), 'symbol');
        throws(() => object().parse(undefined));

        const optional = object().optional();
        notEqual(typeof optional.parse({}), 'symbol');
        strictEqual(optional.parse(undefined), undefined);
    });

    it('should validate arrays with and without item validator', () => {
        const a = array();
        deepEqual(a.parse([1, 2, 3]), [1, 2, 3]);

        throws(() => a.parse('string'), /Expected array, got string/);
        throws(() => a.parse({}), /Expected array, got object/);

        // With item validator
        const a2 = array(number().int().min(0));
        deepEqual(a2.parse([1, 2, 3]), [1, 2, 3]);
        deepEqual(a2.parse(['1', '2', '3']), [1, 2, 3]); // coercion
        throws(() => a2.parse([1, -1, 3])); // -1 is < 0
    });

    it('should validate length constraints', () => {
        const minArr = array().minLength(2);
        notEqual(typeof minArr.parse([1, 2]), 'symbol');
        throws(() => minArr.parse([1]));

        const maxArr = array().maxLength(3);
        notEqual(typeof maxArr.parse([1, 2, 3]), 'symbol');
        throws(() => maxArr.parse([1, 2, 3, 4]), /4 <= 3/);
    });

    it('should handle required and optional', () => {
        notEqual(typeof array().parse([]), 'symbol');
        throws(() => array().parse(undefined));

        const optional = array().optional();
        notEqual(typeof optional.parse([]), 'symbol');
        strictEqual(optional.parse(undefined), undefined);
    });
    it('should convert arrays to Set', () => {
        const s = set();
        const result = s.parse([1, 2, 3, 2]);
        ok(result instanceof Set);
        strictEqual(result.size, 3);

        throws(() => s.parse('string'));

        const withValidator = set(number().int().min(0));
        ok(withValidator.parse([1, 2, 3]) instanceof Set);
        throws(() => withValidator.parse([1, -1]));

        strictEqual(set().optional().parse(undefined), undefined);
    });

    it('should convert objects to Map', () => {
        const m = map();
        const result = m.parse({ a: 1, b: 2 });
        ok(result instanceof Map);
        strictEqual(result.get('a'), 1);

        throws(() => m.parse([]));

        const withValidator = map(number().int().min(0));
        ok(withValidator.parse({ a: 1, b: 2 }) instanceof Map);
        throws(() => withValidator.parse({ a: 1, b: -1 }));

        strictEqual(map().optional().parse(undefined), undefined);
    });

    it('should validate non-empty arrays, exact length, and chaining', () => {
        // Non-empty
        deepEqual(array().nonempty().parse([1]), [1]);
        throws(() => array().nonempty().parse([]), /Array must not be empty/);

        // Exact length
        deepEqual(array().length(3).parse([1, 2, 3]), [1, 2, 3]);
        throws(() => array().length(3).parse([1, 2]), /2 === 3/);

        // Chaining with item validators
        const arr = array(number()).nonempty().minLength(2).maxLength(5);
        deepEqual(arr.parse([1, 2]), [1, 2]);
        deepEqual(arr.parse([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
        throws(() => arr.parse([]), /Array must not be empty/);
        throws(() => arr.parse([1]), /1 >= 2/);
        throws(() => arr.parse([1, 2, 3, 4, 5, 6]), /6 <= 5/);
    });

    it('should validate complex nested structures', () => {
        const validator: Schema = {
            name: string(),
            age: number().int().min(0),
            address: object({
                street: string(),
                city: string(),
                zip: string().min(5).max(10),
            }),
            hobbies: array(string()).optional(),
        };

        const result = parseSchema<{
            name: string;
            age: number;
            address: { street: string; city: string; zip: string };
            hobbies?: string[];
        }>(validator, {
            name: 'John',
            age: 30,
            address: { street: '123 Main St', city: 'NYC', zip: '10001' },
            hobbies: ['reading', 'coding'],
        });

        notEqual(result, undefined);
        deepEqual(result?.address, { street: '123 Main St', city: 'NYC', zip: '10001' });
        deepEqual(result?.hobbies, ['reading', 'coding']);
    });

    it('should validate array of objects and deeply nested structures', () => {
        const validator: Schema = {
            users: array(object({ name: string(), age: number().int().min(0) })),
        };

        const result = parseSchema<{ users: Array<{ name: string; age: number }> }>(validator, {
            users: [
                { name: 'Alice', age: 25 },
                { name: 'Bob', age: 30 },
            ],
        });
        notEqual(result, undefined);
        strictEqual(result?.users[0].name, 'Alice');

        // Missing required field throws
        throws(() => parseSchema(validator, { users: [{ age: 30 }] }));

        // Deep nesting with coercion
        const deepValidator: Schema = {
            scores: array(number().int().min(0).max(100)),
        };
        const deepResult = parseSchema<{ scores: number[] }>(deepValidator, { scores: ['85', '92', 100, '78'] });
        deepEqual(deepResult?.scores, [85, 92, 100, 78]);
    });

    it('should handle empty arrays and multiple nesting levels', () => {
        const validator: Schema = {
            tags: array(string()),
            numbers: array(number()).optional(),
        };

        const result = parseSchema<{ tags: string[]; numbers?: number[] }>(validator, { tags: [] });
        deepEqual(result?.tags, []);
        strictEqual(result?.numbers, undefined);
    });

    it('should accept unknown keys by default (loose), reject with strictObject', () => {
        // Default loose behavior
        const schema = object({ name: string(), age: number() });
        const result = schema.parse({ name: 'John', age: 30, extra: 'allowed' });
        strictEqual(result?.name, 'John');
        strictEqual(result?.age, 30);

        // strictObject rejects unknown keys
        const strict = strictObject({ name: string(), age: number() });
        throws(() => strict.parse({ name: 'John', age: 30, extra: 'not allowed' }), /Unknown keys in strict mode: extra/);
        throws(
            () => strictObject({ name: string() }).parse({ name: 'John', age: 30, email: 'x' }),
            /Unknown keys in strict mode: age, email/,
        );

        // strictObject accepts valid objects
        const validResult = strict.parse({ name: 'John', age: 30 });
        strictEqual(validResult?.name, 'John');

        // optional explicitly allows unknown keys (legacy behavior with Schema)
        const opt = optional({ name: string() });
        const optionalResult = opt.parse({ name: 'John', age: 30, anything: 'goes' });
        strictEqual(optionalResult?.name, 'John');
    });

    it('should support Zod-compatible optional() for any validator', () => {
        // optional with string
        const optStr = optional(string());
        strictEqual(optStr.parse('hello'), 'hello');
        strictEqual(optStr.parse(undefined), undefined);

        // optional with number
        const optNum = optional(number());
        strictEqual(optNum.parse(42), 42);
        strictEqual(optNum.parse(undefined), undefined);

        // optional with object
        const optObj = optional(object({ id: number() }));
        deepStrictEqual(optObj.parse({ id: 1 }), { id: 1 });
        strictEqual(optObj.parse(undefined), undefined);

        // optional with array
        const optArr = optional(array(string()));
        deepStrictEqual(optArr.parse(['a', 'b']), ['a', 'b']);
        strictEqual(optArr.parse(undefined), undefined);
    });

    // Advanced features
    it('should allow custom validators and transformers via push()', () => {
        const n = number();
        n.push((val: number) => {
            if (val % 2 !== 0) throw new Error('Validation failed');
            return val;
        });
        strictEqual(n.parse(10), 10);
        throws(() => n.parse(11));

        const s = string();
        s.push((val: string) => val.toUpperCase());
        strictEqual(s.parse('hello'), 'HELLO');
    });

    it('should allow multiple custom validators', () => {
        const n = number();
        n.push((val: number) => {
            if (val <= 0) throw new Error('Validation failed');
            return val;
        });
        n.push((val: number) => {
            if (val >= 100) throw new Error('Validation failed');
            return val;
        });

        strictEqual(n.parse(50), 50);
        throws(() => n.parse(-5));
        throws(() => n.parse(150));

        // In parse context
        const validator: Schema = { score: n };
        strictEqual(parseSchema<{ score: number }>(validator, { score: 25 })?.score, 25);
        throws(() => parseSchema<{ score: number }>(validator, { score: 150 }));
    });

    it('should store and update descriptions on validators', () => {
        // Basic description
        strictEqual(string().describe('A string field').defs().description, 'A string field');
        strictEqual(number().describe('A number field').defs().description, 'A number field');

        // Works with chaining
        const n = number().min(5).describe('At least 5').max(10);
        strictEqual(n.defs().description, 'At least 5');
        strictEqual(n.parse(7), 7);

        // Returns undefined when no description
        strictEqual(string().defs().description, undefined);
    });

    it('should validate union with coercion and literal types', () => {
        // Basic union with coercion (first-match wins)
        const u = union([number(), string()]);
        strictEqual(u.parse('42'), 42); // matches number first
        strictEqual(u.parse('hello'), 'hello'); // fails number, matches string
        strictEqual(u.parse(123), 123);

        // Use literals to avoid coercion issues
        const u2 = union([literal(true), literal(false), number()]);
        strictEqual(u2.parse(true), true);
        strictEqual(u2.parse(false), false);
        strictEqual(u2.parse(42), 42);

        // Literal-only union
        const colors = union([literal('red'), literal('green'), literal('blue')]);
        strictEqual(colors.parse('red'), 'red');
        throws(() => colors.parse('yellow'), /Value does not match any union member/);
    });

    it('should validate union with constraints and throw when no members match', () => {
        // Union with validation constraints
        const u = union([number().min(0).max(100), string().email()]);
        strictEqual(u.parse(50), 50);
        strictEqual(u.parse('test@example.com'), 'test@example.com');
        throws(() => u.parse(150), /Value does not match any union member/);
        throws(() => u.parse('not-an-email'), /Value does not match any union member/);

        // No match throws error
        const u2 = union([number().min(100), string().email()]);
        throws(() => u2.parse(42), /Value does not match any union member/);
    });

    it('should validate discriminated unions and complex nested unions', () => {
        // Discriminated union (objects with different shapes)
        const u = union([object({ type: literal('user'), name: string() }), object({ type: literal('admin'), role: string() })]);
        deepEqual(u.parse({ type: 'user', name: 'John' }), { type: 'user', name: 'John' });
        deepEqual(u.parse({ type: 'admin', role: 'superadmin' }), { type: 'admin', role: 'superadmin' });
        throws(() => u.parse({ type: 'guest' }), /Value does not match any union member/);

        // Complex nested union
        const result = union([
            object({ type: literal('success'), data: string() }),
            object({ type: literal('error'), message: string(), code: number() }),
        ]);
        deepEqual(result.parse({ type: 'success', data: 'result' }), { type: 'success', data: 'result' });
        deepEqual(result.parse({ type: 'error', message: 'failed', code: 404 }), {
            type: 'error',
            message: 'failed',
            code: 404,
        });

        // Union of arrays
        deepEqual(union([array(number()), array(string())]).parse([1, 2, 3]), [1, 2, 3]);
    });

    it('should work with optional, nullable, and in parse context', () => {
        // Optional union
        const u = union([number(), string()]).optional();
        strictEqual(u.parse(undefined), undefined);
        strictEqual(u.parse(42), 42);
        strictEqual(u.parse('hello'), 'hello');

        // Nullable union
        const u2 = nullable(union([literal(true), literal(false), number()]));
        strictEqual(u2.parse(null), null);
        strictEqual(u2.parse(42), 42);

        // In parse context
        const validator: Schema = { id: number(), value: union([number(), string(), boolean()]) };
        const result = parseSchema<{ id: number; value: number | string | boolean }>(validator, { id: 1, value: 42 });
        strictEqual(result?.id, 1);
        strictEqual(result?.value, 42);
    });

    it('should require at least 2 validators', () => {
        // @ts-expect-error - testing runtime error
        throws(() => union([number()]), /Union requires at least 2 validators/);
        // @ts-expect-error - testing runtime error
        throws(() => union([]), /Union requires at least 2 validators/);
    });

    it('should extract keys as union of literals', () => {
        // Basic keyof
        const schema = object({ name: string(), age: number(), email: string() });
        const keySchema = schema.keyof();
        strictEqual(keySchema.parse('name'), 'name');
        strictEqual(keySchema.parse('age'), 'age');
        strictEqual(keySchema.parse('email'), 'email');
        throws(() => keySchema.parse('unknown'), /Value does not match any union member/);

        // Works with z.object()
        const zSchema = z.object({ id: z.number(), title: z.string() });
        const zKeySchema = zSchema.keyof();
        strictEqual(zKeySchema.parse('id'), 'id');
        throws(() => zKeySchema.parse('invalid'), /Value does not match any union member/);

        // Throws for object with no schema
        throws(() => object().keyof(), /Cannot get keyof from object with no schema/);
    });

    // Zod-like API (z export)
    it('should provide all primitive validators and complex types', () => {
        // Primitives
        strictEqual(z.string().parse('hello'), 'hello');
        strictEqual(z.number().parse(42), 42);

        // Array
        deepEqual(z.array(z.number()).parse([1, 2, 3]), [1, 2, 3]);

        // Format validators
        strictEqual(z.email().parse('test@example.com'), 'test@example.com');
        strictEqual(z.url().parse('https://example.com'), 'https://example.com');
        strictEqual(z.uuid().parse('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');

        // Nullable and nullish
        strictEqual(z.nullable(z.string()).parse(null), null);
        strictEqual(z.nullish(z.number()).parse(undefined), undefined);

        // Describe
        strictEqual(z.object({ name: z.string() }).describe('User schema').defs().description, 'User schema');

        // strictObject and optional
        strictEqual(typeof z.strictObject, 'function');
        strictEqual(typeof z.optional, 'function');
    });

    it('should work with z.object() and z.union()', () => {
        const schema = z.object({
            id: z.number(),
            name: z.string().min(3),
            status: z.union([z.literal('active'), z.literal('inactive')]),
        });

        const result = schema.parse({ id: 1, name: 'John', status: 'active' });
        deepEqual(result, { id: 1, name: 'John', status: 'active' });
    });

    // Object property constraints
    it('should validate minProperties, maxProperties, and both combined', () => {
        // minProperties
        const minSchema = object({}).minProperties(2);
        throws(() => minSchema.parse({}), /Object must have at least 2 properties, got 0/);
        throws(() => minSchema.parse({ a: 1 }), /Object must have at least 2 properties, got 1/);
        deepEqual(minSchema.parse({ a: 1, b: 2 }), { a: 1, b: 2 });

        // maxProperties
        const maxSchema = object({}).maxProperties(2);
        deepEqual(maxSchema.parse({}), {});
        deepEqual(maxSchema.parse({ a: 1, b: 2 }), { a: 1, b: 2 });
        throws(() => maxSchema.parse({ a: 1, b: 2, c: 3 }), /Object must have at most 2 properties, got 3/);

        // Both combined
        const rangeSchema = object({}).minProperties(1).maxProperties(3);
        throws(() => rangeSchema.parse({}), /Object must have at least 1/);
        deepEqual(rangeSchema.parse({ a: 1 }), { a: 1 });
        deepEqual(rangeSchema.parse({ a: 1, b: 2, c: 3 }), { a: 1, b: 2, c: 3 });
        throws(() => rangeSchema.parse({ a: 1, b: 2, c: 3, d: 4 }), /Object must have at most 3/);

        // Works with z.object()
        const zSchema = z.object({}).minProperties(1).maxProperties(2);
        throws(() => zSchema.parse({}), /Object must have at least 1/);
        deepEqual(zSchema.parse({ x: 'test' }), { x: 'test' });
        throws(() => zSchema.parse({ x: 'test', y: 'data', z: 'extra' }), /Object must have at most 2/);
    });

    it('should support .strict(), .passthrough(), and .strip() methods (Zod-compatible API)', () => {
        const schema = object({ name: string() });
        const input = { name: 'John', age: 30 };

        // Default behavior strips unknown keys
        deepEqual(schema.parse(input), { name: 'John' });

        // .passthrough() allows unknown keys
        deepEqual(schema.passthrough().parse(input), { name: 'John', age: 30 });

        // .strict() throws on unknown keys
        throws(() => schema.strict().parse(input), /Unknown keys in strict mode: age/);

        // .strip() explicitly removes unknown keys (same as default)
        deepEqual(schema.strip().parse(input), { name: 'John' });

        // Methods are chainable
        deepEqual(schema.passthrough().strip().parse(input), { name: 'John' });
    });

    // Schema metadata (_def property)
    it('should expose type metadata for all validator types', () => {
        // Primitives
        strictEqual(string().defs().type, 'string');
        strictEqual(number().defs().type, 'number');
        strictEqual(boolean().defs().type, 'boolean');

        // Complex types
        strictEqual(array(string()).defs().type, 'array');
        strictEqual(object({ name: string() }).defs().type, 'object');
        ok(union([number(), string()]).defs().type); // Union has type
    });

    it('should store description, literal values, and nullable schemas', () => {
        // Description
        strictEqual(string().describe('A string field').defs().description, 'A string field');

        // Literal value
        strictEqual(literal('active').defs().value, 'active');

        // Nullable anyOf
        ok(nullable(array(number())).defs().anyOf);
    });

    it('should expose object schema properties and constraints', () => {
        // Object properties
        const schema = object({ name: string(), age: number() });
        strictEqual(schema.defs().type, 'object');
        ok(schema.defs().properties);
        strictEqual(Object.keys(schema.defs().properties!).length, 2);
        ok('name' in schema.defs().properties!);
        ok('age' in schema.defs().properties!);

        // Strict object disallows additional properties
        strictEqual(strictObject({ name: string() }).defs().additionalProperties, false);
    });

    it('should expose array items and union anyOf metadata', () => {
        // Array items
        const arr = array(string());
        strictEqual(arr.defs().type, 'array');
        ok(arr.defs().items);
        strictEqual(arr.defs().items!.type, 'string');

        // Union anyOf
        ok(union([number(), string(), boolean()]).defs().type);
    });
});
