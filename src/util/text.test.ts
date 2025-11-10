import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
    b64urlDecode,
    b64urlEncode,
    capitalize,
    capitalizeAll,
    deserializeParams,
    fromHumanBytes,
    htmlSpecialChars,
    humanBytes,
    locale,
    localePop,
    localePush,
    parseLocaleNumber,
    serializeParams,
    slugify,
} from './text';

describe('text utils', () => {
    test('capitalizes the first letter of a word', () => {
        strictEqual(capitalize('pending'), 'Pending');
    });

    test('returns the same string if already capitalized', () => {
        strictEqual(capitalize('A'), 'A');
    });

    test('returns empty string for empty input', () => {
        strictEqual(capitalize(''), '');
    });

    test('capitalizes the first letter of each word', () => {
        strictEqual(capitalizeAll(''), '');
        strictEqual(capitalizeAll('a b c'), 'A B C');
        strictEqual(capitalizeAll('hello world'), 'Hello World');
        strictEqual(capitalizeAll('Foo Bar baz'), 'Foo Bar Baz');
        strictEqual(capitalizeAll('multiple   spaces'), 'Multiple   Spaces');
    });

    test('slugify', () => {
        strictEqual(slugify(''), '');
        strictEqual(slugify('This is a Title!'), 'this-is-a-title');
        strictEqual(slugify('   Leading whitespace'), 'leading-whitespace');
        strictEqual(slugify('Trailing whitespace   '), 'trailing-whitespace');
        strictEqual(slugify('Multiple   spaces'), 'multiple-spaces');
        strictEqual(slugify('Special &^%$#@! characters'), 'special-characters');
        strictEqual(slugify('Mixed CASE Input and Numbers 12345'), 'mixed-case-input-and-numbers-12345');
    });

    test('escapes special HTML characters', () => {
        strictEqual(htmlSpecialChars('<div>'), '&#38;#38;#60;div&#38;#38;#62;');
        strictEqual(htmlSpecialChars('&"\'<>'), '&#38;#38;#38;&#38;#38;#34;&#38;#38;#39;&#38;#38;#60;&#38;#38;#62;');
        strictEqual(htmlSpecialChars('plain'), 'plain');
        strictEqual(htmlSpecialChars(''), '');
    });

    test('b64urlEncode, b64urlDecode', () => {
        strictEqual(b64urlEncode('Hello, World!'), 'SGVsbG8sIFdvcmxkIQ');
        strictEqual(b64urlDecode('SGVsbG8sIFdvcmxkIQ'), 'Hello, World!');
        strictEqual(b64urlEncode('//kk!&&12@||_\\~~~\\_'), 'Ly9rayEmJjEyQHx8X1x-fn5cXw');
        strictEqual(b64urlDecode('Ly9rayEmJjEyQHx8X1x-fn5cXw'), '//kk!&&12@||_\\~~~\\_');
    });

    test('serializes various params', () => {
        strictEqual(serializeParams({ q: 'js tricks', page: 2 }), 'q=js%20tricks&page=2');
        strictEqual(serializeParams({ active: true, count: 5 }), 'active=true&count=5');
        strictEqual(serializeParams({ name: 'a&b=c', x: '1+2' }), 'name=a%26b%3Dc&x=1%2B2');
        strictEqual(serializeParams({}), '');
    });

    test('parses various params', () => {
        deepStrictEqual(deserializeParams('q=js%20tricks&page=2'), { q: 'js tricks', page: 2 });
        deepStrictEqual(deserializeParams('active=true&count=5'), { active: true, count: 5 });
        deepStrictEqual(deserializeParams('name=a%26b%3Dc&x=1%2B2'), { name: 'a&b=c', x: '1+2' });
        deepStrictEqual(deserializeParams(''), {});
        deepStrictEqual(deserializeParams('foo='), { foo: '' });
    });

    test('round-trip serialize/deserialize', () => {
        const cases: Array<Record<string, string | number | boolean>> = [
            { q: 'js tricks', page: 2 },
            { active: true, count: 5 },
            { name: 'a&b=c', x: '1+2' },
            {},
            { foo: '' },
        ];
        for (const c of cases) {
            const ser = serializeParams(c);
            const deser = deserializeParams(ser);
            const expected = Object.fromEntries(
                Object.entries(c)
                    .sort()
                    .map(([k, v]) => [k, v]),
            );
            deepStrictEqual(deser, expected);
        }
    });
});

describe('locale-aware text utils', () => {
    test('locale template tag with numbers and dates in English/US', () => {
        const result = locale`number is ${1000000} and date is ${new Date('2024-01-15T12:00:00Z')}.`;
        // Should format with en-US locale (default)
        ok(result.includes('1,000,000') || result.includes('1 000 000')); // Different systems may format differently
        ok(result.includes('number is'));
        ok(result.includes('and date is'));
    });

    test('locale template tag with string values', () => {
        const result = locale`text is ${'hello'} and number is ${42}.`;
        ok(result.includes('text is hello'));
        ok(result.includes('and number is'));
    });

    test('locale template tag with mixed value types', () => {
        const result = locale`Today ${new Date('2024-01-15T12:00:00Z')}, we have ${5000} items and the name is ${'test'}.`;
        // Just verify all parts are present
        ok(result.includes('test'));
        ok(result.includes('Today'));
        ok(result.includes('we have'));
        ok(result.includes('items and the name is'));
    });

    test('localePush and localePop with German locale', () => {
        const date = new Date('2024-01-15T12:00:00Z');
        const num = 1234567.89;

        // Push German locale
        localePush('de-DE');
        const germanResult = locale`Date: ${date}, Number: ${num}`;

        // German formatting: period for thousands, comma for decimal, DD.MM.YYYY format
        ok(germanResult.includes('15.1.2024') || germanResult.includes('15.01.2024'));
        ok(germanResult.includes('1.234.567,89'));

        // Pop back to default
        localePop();
    });

    test('localePush with currency formatting', () => {
        const price = 1234.56;

        // Push with currency options
        localePush('de-DE', { style: 'currency', currency: 'EUR' });
        const result = locale`Price: ${price}`;

        // German currency: 1.234,56 € (with euro symbol)
        ok(result.includes('1.234,56') && result.includes('€'));

        localePop();
    });

    test('localePush with date formatting options', () => {
        const date = new Date('2024-07-15T12:00:00Z');

        // Push with long date format
        localePush('en-US', { dateStyle: 'long' });
        const result = locale`Date: ${date}`;

        // Long format includes month name
        ok(result.includes('July'));

        localePop();
    });

    test('localePush/localePop stack behavior', () => {
        const num = 1000;

        // Push first locale
        localePush('de-DE');
        const german = locale`${num}`;
        ok(german.includes('1.000'));

        // Push second locale (nested)
        localePush('fr-FR');
        const french = locale`${num}`;
        ok(french.includes('1 000') || french.includes('1\u202f000'));
        localePop();

        // Pop back to German
        const germanAgain = locale`${num}`;
        ok(germanAgain.includes('1.000'));

        // arabic
        localePush('ar-EG');
        const arabic = locale`Number: ${1234567.89}`;
        ok(arabic.includes('١٬٢٣٤٬٥٦٧٫٨٩'));
        localePop();

        // Pop back to default
        localePop();
    });

    test('localePop on empty stack does not throw', () => {
        // Should not throw even if stack is empty
        localePop();
        localePop();
        const result = locale`test ${123}`;
        ok(result.includes('test'));
    });

    test('locale works without localePush (system default)', () => {
        // Make sure locale still works without any push/pop
        const result = locale`Number: ${1000}, String: ${'test'}`;
        ok(result.includes('Number:'));
        ok(result.includes('test'));
    });

    test('parses localized numbers', () => {
        const english = '-1,234,567.89'; // en-US
        strictEqual(parseLocaleNumber(english), -1234567.89);

        const german = '1.234.567,890'; // de-DE
        strictEqual(parseLocaleNumber(german, 'de-DE'), 1234567.89);

        const arabic = '١٬٢٣٤٬٥٦٧٫٨٩-'; // ar-EG
        strictEqual(parseLocaleNumber(arabic, 'ar-EG'), -1234567.89);

        // fr has a space as thousands that is charcode 48 or 8239
        const french = `1 234${String.fromCharCode(8239)}567,89`; // fr-FR
        strictEqual(parseLocaleNumber(french, 'fr-FR'), 1234567.89);

        const persian = '۱٬۲۳۴٬۵۶۷٫۸۹'; // fa-IR
        strictEqual(parseLocaleNumber(persian, 'fa-IR'), 1234567.89);
    });

    test('Negative: parse localized numbers', () => {
        const nan = '١٬٢٣٤٬٥٦٧٫٨٩'; // in en-US this is invalid
        strictEqual(parseLocaleNumber(nan), NaN);

        const nan2 = '1-234,,567.890';
        strictEqual(parseLocaleNumber(nan2, 'de-DE'), NaN);
    });
});

describe('fromHumanBytes', () => {
    test('humanBytes', () => {
        // Binary units (default, bin=true): uses 1024 threshold and KiB/MiB/GiB units
        strictEqual(humanBytes(1024), '1 KiB');
        strictEqual(humanBytes(1024 * 1024), '1 MiB');
        strictEqual(humanBytes(1024 * 1024 * 1024), '1 GiB');
        strictEqual(humanBytes(1024 * 1024 * 1024 * 1024 * 1024), '1 PiB');
        strictEqual(humanBytes(512), '512 B');
        strictEqual(humanBytes(2048), '2 KiB');
        strictEqual(humanBytes(5 * 1024 * 1024), '5 MiB');
        strictEqual(humanBytes(2.5 * 1024 * 1024 * 1024), '2.5 GiB');
        strictEqual(humanBytes(1536), '1.5 KiB');
        strictEqual(humanBytes(1024 * 1024 * 1.2345), '1.23 MiB');

        // Decimal/SI units (bin=false): uses 1000 threshold and KB/MB/GB units
        strictEqual(humanBytes(1000, false), '1 KB');
        strictEqual(humanBytes(1000 * 1000, false), '1 MB');
        strictEqual(humanBytes(1000 * 1000 * 1000, false), '1 GB');
        strictEqual(humanBytes(1000 * 1000 * 1000 * 1000 * 1000, false), '1 PB');
        strictEqual(humanBytes(999, false), '999 B');
        strictEqual(humanBytes(500, false), '500 B');
        strictEqual(humanBytes(2000, false), '2 KB');
        strictEqual(humanBytes(5 * 1000 * 1000, false), '5 MB');
        strictEqual(humanBytes(2.5 * 1000 * 1000 * 1000, false), '2.5 GB');
        strictEqual(humanBytes(1500, false), '1.5 KB');
        strictEqual(humanBytes(1000 * 1000 * 5.6789, false), '5.68 MB');

        // Edge cases: zero, small, negative
        strictEqual(humanBytes(0), '0 B');
        strictEqual(humanBytes(100), '100 B');
        strictEqual(humanBytes(-512), '-512 B');
        strictEqual(humanBytes(-1024), '-1 KiB');
        strictEqual(humanBytes(-1020, false), '-1.02 KB');
    });

    test('fromHumanBytes parses binary units (KiB/MiB/GiB)', () => {
        // Binary units (default, 1024 base)
        strictEqual(fromHumanBytes('1 KiB'), 1024);
        strictEqual(fromHumanBytes('1 MiB'), 1024 * 1024);
        strictEqual(fromHumanBytes('1 GiB'), 1024 * 1024 * 1024);
        strictEqual(fromHumanBytes('1 TiB'), 1024 * 1024 * 1024 * 1024);
        strictEqual(fromHumanBytes('1 PiB'), 1024 * 1024 * 1024 * 1024 * 1024);
        strictEqual(fromHumanBytes('2 KiB'), 2048);
        strictEqual(fromHumanBytes('5 MiB'), 5 * 1024 * 1024);
        strictEqual(fromHumanBytes('2.5 GiB'), 2.5 * 1024 * 1024 * 1024);
        strictEqual(fromHumanBytes('1.5 KiB'), 1536);
        strictEqual(fromHumanBytes('1.23 MiB'), 1024 * 1024 * 1.23);
    });

    test('fromHumanBytes parses decimal units (KB/MB/GB)', () => {
        // Decimal/SI units (1000 base)
        strictEqual(fromHumanBytes('1 KB'), 1000);
        strictEqual(fromHumanBytes('1 MB'), 1000 * 1000);
        strictEqual(fromHumanBytes('1 GB'), 1000 * 1000 * 1000);
        strictEqual(fromHumanBytes('1 TB'), 1000 * 1000 * 1000 * 1000);
        strictEqual(fromHumanBytes('1 PB'), 1000 * 1000 * 1000 * 1000 * 1000);
        strictEqual(fromHumanBytes('2 KB'), 2000);
        strictEqual(fromHumanBytes('5 MB'), 5 * 1000 * 1000);
        strictEqual(fromHumanBytes('2.5 GB'), 2.5 * 1000 * 1000 * 1000);
        strictEqual(fromHumanBytes('1.5 KB'), 1500);
        strictEqual(fromHumanBytes('5.68 MB'), 1000 * 1000 * 5.68);
    });

    test('fromHumanBytes parses bytes with no unit', () => {
        strictEqual(fromHumanBytes('0 B'), 0);
        strictEqual(fromHumanBytes('100 B'), 100);
        strictEqual(fromHumanBytes('512 B'), 512);
        strictEqual(fromHumanBytes('999 B'), 999);
    });

    test('fromHumanBytes parses negative values', () => {
        strictEqual(fromHumanBytes('-512 B'), -512);
        strictEqual(fromHumanBytes('-1 KiB'), -1024);
        strictEqual(fromHumanBytes('-1.02 KB'), -1020);
    });

    test('fromHumanBytes handles whitespace variations', () => {
        strictEqual(fromHumanBytes('1KiB'), 1024);
        strictEqual(fromHumanBytes('1  KiB'), 1024);
        strictEqual(fromHumanBytes('  1 KiB  '), 1024);
        strictEqual(fromHumanBytes('1.5  MB'), 1500000);
    });

    test('fromHumanBytes handles locale-formatted numbers', () => {
        // humanBytes uses locale template tag which may add thousands separators
        strictEqual(fromHumanBytes('1,024 B'), 1024);
        strictEqual(fromHumanBytes('1 024 B'), 1024); // space separator

        localePush('de-DE'); // German locale
        strictEqual(fromHumanBytes('1.234.567,89 B'), 1234567.89); // German format
        localePop();
    });

    test('fromHumanBytes round-trip with humanBytes', () => {
        const values = [
            0,
            100,
            512,
            1024,
            1536,
            2048,
            1024 * 1024,
            2.5 * 1024 * 1024,
            1024 * 1024 * 1024,
            5 * 1024 * 1024 * 1024,
            -512,
            -1024,
            -1024 * 1024,
        ];

        for (const val of values) {
            const humanBin = humanBytes(val, true);
            const parsedBin = fromHumanBytes(humanBin);
            // Binary units should round-trip perfectly since they use powers of 1024
            // Allow small floating-point errors (within 0.1%)
            const binError = Math.abs(parsedBin - val) / Math.max(Math.abs(val), 1);
            ok(binError < 0.001, `Binary: ${val} -> ${humanBin} -> ${parsedBin}`);

            const humanSi = humanBytes(val, false);
            const parsedSi = fromHumanBytes(humanSi);
            // SI units may have rounding errors due to humanBytes rounding to 2 decimal places
            // and the mismatch between binary values and decimal units (e.g., 1024 -> 1.02 KB -> 1020)
            // Allow up to 1% error for SI conversions
            const siError = Math.abs(parsedSi - val) / Math.max(Math.abs(val), 1);
            ok(siError < 0.01, `SI: ${val} -> ${humanSi} -> ${parsedSi} (error: ${siError.toFixed(4)})`);
        }
    });

    test('fromHumanBytes throws on invalid input', () => {
        const invalidInputs = ['', '   ', '-,, b', 'invalid', 'KB', '1 XB', '1.2.3 MB', 'abc MB'];

        for (const input of invalidInputs) {
            strictEqual(Number.isNaN(fromHumanBytes(input)), true, `Should return NaN for: ${input}`);
        }
    });

    test('fromHumanBytes with explicit locale parameter', () => {
        // English locale with comma as thousands separator
        strictEqual(fromHumanBytes('1,234.56 B', 'en-US'), 1234.56);
        strictEqual(fromHumanBytes('1,234 B', 'en-US'), 1234);
        strictEqual(fromHumanBytes('1.5 MB', 'en-US'), 1500000);

        // German locale with dot as thousands separator and comma as decimal
        strictEqual(fromHumanBytes('1.234,56 B', 'de-DE'), 1234.56);
        strictEqual(fromHumanBytes('1.234 B', 'de-DE'), 1234);
        strictEqual(fromHumanBytes('1,5 MB', 'de-DE'), 1500000);

        // French locale (narrow no-break space as thousands separator)
        strictEqual(fromHumanBytes('1\u202f234,56 B', 'fr-FR'), 1234.56);
        strictEqual(fromHumanBytes('1\u202f234 B', 'fr-FR'), 1234);
    });
});
