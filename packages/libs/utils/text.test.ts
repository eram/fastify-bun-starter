import { describe, expect, test } from 'bun:test';
import {
    b64urlDecode,
    b64urlEncode,
    capitalize,
    capitalizeAll,
    deserializeParams,
    dotify,
    escapeHTML,
    fromHumanBytes,
    humanBytes,
    labelify,
    locale,
    localePop,
    localePush,
    parseLocaleNumber,
    serializeParams,
    slugify,
} from './text';

describe('text utils', () => {
    test('slugify', () => {
        expect(slugify('')).toBe('');
        expect(slugify('This is a Title!')).toBe('this-is-a-title');
        expect(slugify('ThisIsATitle!')).toBe('thisisatitle');
        expect(slugify('   Leading whitespace')).toBe('leading-whitespace');
        expect(slugify('Trailing whitespace   ')).toBe('trailing-whitespace');
        expect(slugify('Multiple   spaces')).toBe('multiple-spaces');
        expect(slugify('Special &^%$#@! characters')).toBe('special-characters');
        expect(slugify('--Mixed CASE Input and Numbers 12345')).toBe('mixed-case-input-and-numbers-12345');

        expect(slugify('Hello World')).toBe('hello-world');
        expect(slugify('Hello', 'World')).toBe('hello-world');
        expect(slugify('##foo', 'bar', 'baz')).toBe('foo-bar-baz');
        expect(slugify('foo_bar', 'baz qux')).toBe('foo-bar-baz-qux');
        expect(slugify('foo--bar', 'baz')).toBe('foo-bar-baz');
        expect(slugify('foo@bar!', 'baz#qux')).toBe('foo-bar-baz-qux');
        expect(slugify('--  spaced  --', 'out')).toBe('spaced-out');
    });

    test('dotify with dotNotation option', () => {
        // Dot notation preserves camelCase and joins with dots
        expect(dotify('serverModal', 'name')).toBe('servermodal.name');
        expect(dotify('ui', 'showServerModal')).toBe('ui.showservermodal');
        expect(dotify('servers', 'items')).toBe('servers.items');
        expect(dotify(' -- serverModal  ', '  name  ')).toBe('servermodal.name');
        expect(dotify('na--me')).toBe('na.me');
    });

    test('generates human-readable labels from field names', () => {
        expect(labelify('name')).toBe('Name');
        expect(labelify('serverUrl')).toBe('Server Url');
        expect(labelify('max_length')).toBe('Max Length');
        expect(labelify('min-value')).toBe('Min Value');
        expect(labelify('--firstName')).toBe('First Name');
        expect(labelify('user_email_address')).toBe('User Email Address');
        expect(labelify('APIKey')).toBe('A P I Key');
    });

    test('capitalizes the first letter of a word', () => {
        expect(capitalize('pending')).toBe('Pending');
        expect(capitalize('A')).toBe('A');
        expect(capitalize('')).toBe('');
        expect(capitalizeAll('')).toBe('');
        expect(capitalizeAll('a b c')).toBe('A B C');
        expect(capitalizeAll('hello world')).toBe('Hello World');
        expect(capitalizeAll('Foo Bar baz')).toBe('Foo Bar Baz');
        expect(capitalizeAll('multiple   spaces')).toBe('Multiple   Spaces');
    });

    test('escapes special HTML characters', () => {
        expect(escapeHTML('<div>')).toBe('&lt;div&gt;');
        expect(escapeHTML('&"\'<>')).toBe('&amp;&quot;&#x27;&lt;&gt;');
        expect(escapeHTML('plain')).toBe('plain');
        expect(escapeHTML('')).toBe('');
    });

    test('b64urlEncode, b64urlDecode', () => {
        expect(b64urlEncode('Hello, World!')).toBe('SGVsbG8sIFdvcmxkIQ');
        expect(b64urlDecode('SGVsbG8sIFdvcmxkIQ')).toBe('Hello, World!');
        expect(b64urlEncode('//kk!&&12@||_\\~~~\\_')).toBe('Ly9rayEmJjEyQHx8X1x-fn5cXw');
        expect(b64urlDecode('Ly9rayEmJjEyQHx8X1x-fn5cXw')).toBe('//kk!&&12@||_\\~~~\\_');
    });

    test('serializes various params', () => {
        expect(serializeParams({ q: 'js tricks', page: 2 })).toBe('q=js%20tricks&page=2');
        expect(serializeParams({ active: true, count: 5 })).toBe('active=true&count=5');
        expect(serializeParams({ name: 'a&b=c', x: '1+2' })).toBe('name=a%26b%3Dc&x=1%2B2');
        expect(serializeParams({})).toBe('');
    });

    test('parses various params', () => {
        expect(deserializeParams('q=js%20tricks&page=2')).toStrictEqual({ q: 'js tricks', page: 2 });
        expect(deserializeParams('active=true&count=5')).toStrictEqual({ active: true, count: 5 });
        expect(deserializeParams('name=a%26b%3Dc&x=1%2B2')).toStrictEqual({ name: 'a&b=c', x: '1+2' });
        expect(deserializeParams('')).toStrictEqual({});
        expect(deserializeParams('foo=')).toStrictEqual({ foo: '' });
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
            expect(deser).toStrictEqual(expected);
        }
    });
});

describe('locale-aware text utils', () => {
    test('locale template tag with numbers and dates in English/US', () => {
        const result = locale`number is ${1000000} and date is ${new Date('2024-01-15T12:00:00Z')}.`;
        // Should format with en-US locale (default)
        expect(result.includes('1,000,000') || result.includes('1 000 000')).toBeTruthy(); // Different systems may format differently
        expect(result.includes('number is')).toBeTruthy();
        expect(result.includes('and date is')).toBeTruthy();
    });

    test('locale template tag with string values', () => {
        const result = locale`text is ${'hello'} and number is ${42}.`;
        expect(result.includes('text is hello')).toBeTruthy();
        expect(result.includes('and number is')).toBeTruthy();
    });

    test('locale template tag with mixed value types', () => {
        const result = locale`Today ${new Date('2024-01-15T12:00:00Z')}, we have ${5000} items and the name is ${'test'}.`;
        // Just verify all parts are present
        expect(result.includes('test')).toBeTruthy();
        expect(result.includes('Today')).toBeTruthy();
        expect(result.includes('we have')).toBeTruthy();
        expect(result.includes('items and the name is')).toBeTruthy();
    });

    test('localePush and localePop with German locale', () => {
        const date = new Date('2024-01-15T12:00:00Z');
        const num = 1234567.89;

        // Push German locale
        localePush('de-DE');
        const germanResult = locale`Date: ${date}, Number: ${num}`;

        // German formatting: period for thousands, comma for decimal, DD.MM.YYYY format
        expect(germanResult.includes('15.1.2024') || germanResult.includes('15.01.2024')).toBeTruthy();
        expect(germanResult.includes('1.234.567,89')).toBeTruthy();

        // Pop back to default
        localePop();
    });

    test('localePush with currency formatting', () => {
        const price = 1234.56;

        // Push with currency options
        localePush('de-DE', { style: 'currency', currency: 'EUR' });
        const result = locale`Price: ${price}`;

        // German currency: 1.234,56 € (with euro symbol)
        expect(result.includes('1.234,56') && result.includes('€')).toBeTruthy();

        localePop();
    });

    test('localePush with date formatting options', () => {
        const date = new Date('2024-07-15T12:00:00Z');

        // Push with long date format
        localePush('en-US', { dateStyle: 'long' });
        const result = locale`Date: ${date}`;

        // Long format includes month name
        expect(result.includes('July')).toBeTruthy();

        localePop();
    });

    test('localePush/localePop stack behavior', () => {
        const num = 1000;

        // Push first locale
        localePush('de-DE');
        const german = locale`${num}`;
        expect(german.includes('1.000')).toBeTruthy();

        // Push second locale (nested)
        localePush('fr-FR');
        const french = locale`${num}`;
        expect(french.includes('1 000') || french.includes('1 000')).toBeTruthy();
        localePop();

        // Pop back to German
        const germanAgain = locale`${num}`;
        expect(germanAgain.includes('1.000')).toBeTruthy();

        // arabic
        localePush('ar-EG');
        const arabic = locale`Number: ${1234567.89}`;
        expect(arabic.includes('١٬٢٣٤٬٥٦٧٫٨٩')).toBeTruthy();
        localePop();

        // Pop back to default
        localePop();
    });

    test('localePop on empty stack does not throw', () => {
        // Should not throw even if stack is empty
        localePop();
        localePop();
        const result = locale`test ${123}`;
        expect(result.includes('test')).toBeTruthy();
    });

    test('locale works without localePush (system default)', () => {
        // Make sure locale still works without any push/pop
        const result = locale`Number: ${1000}, String: ${'test'}`;
        expect(result.includes('Number:')).toBeTruthy();
        expect(result.includes('test')).toBeTruthy();
    });

    test('parses localized numbers', () => {
        const english = '-1,234,567.89'; // en-US
        expect(parseLocaleNumber(english)).toBe(-1234567.89);

        const german = '1.234.567,890'; // de-DE
        expect(parseLocaleNumber(german, 'de-DE')).toBe(1234567.89);

        const arabic = '١٬٢٣٤٬٥٦٧٫٨٩-'; // ar-EG
        expect(parseLocaleNumber(arabic, 'ar-EG')).toBe(-1234567.89);

        // fr has a space as thousands that is charcode 48 or 8239
        const french = `1 234${String.fromCharCode(8239)}567,89`; // fr-FR
        expect(parseLocaleNumber(french, 'fr-FR')).toBe(1234567.89);

        const persian = '۱٬۲۳۴٬۵۶۷٫۸۹'; // fa-IR
        expect(parseLocaleNumber(persian, 'fa-IR')).toBe(1234567.89);
    });

    test('Negative: parse localized numbers', () => {
        const nan = '١٬٢٣٤٬٥٦٧٫٨٩'; // in en-US this is invalid
        expect(parseLocaleNumber(nan)).toBe(NaN);

        const nan2 = '1-234,,567.890';
        expect(parseLocaleNumber(nan2, 'de-DE')).toBe(NaN);
    });
});

describe('fromHumanBytes', () => {
    test('humanBytes', () => {
        // Binary units (default, bin=true): uses 1024 threshold and KiB/MiB/GiB units
        expect(humanBytes(1024)).toBe('1 KiB');
        expect(humanBytes(1024 * 1024)).toBe('1 MiB');
        expect(humanBytes(1024 * 1024 * 1024)).toBe('1 GiB');
        expect(humanBytes(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1 PiB');
        expect(humanBytes(512)).toBe('512 B');
        expect(humanBytes(2048)).toBe('2 KiB');
        expect(humanBytes(5 * 1024 * 1024)).toBe('5 MiB');
        expect(humanBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GiB');
        expect(humanBytes(1536)).toBe('1.5 KiB');
        expect(humanBytes(1024 * 1024 * 1.2345)).toBe('1.23 MiB');

        // Decimal/SI units (bin=false): uses 1000 threshold and KB/MB/GB units
        expect(humanBytes(1000, false)).toBe('1 KB');
        expect(humanBytes(1000 * 1000, false)).toBe('1 MB');
        expect(humanBytes(1000 * 1000 * 1000, false)).toBe('1 GB');
        expect(humanBytes(1000 * 1000 * 1000 * 1000 * 1000, false)).toBe('1 PB');
        expect(humanBytes(999, false)).toBe('999 B');
        expect(humanBytes(500, false)).toBe('500 B');
        expect(humanBytes(2000, false)).toBe('2 KB');
        expect(humanBytes(5 * 1000 * 1000, false)).toBe('5 MB');
        expect(humanBytes(2.5 * 1000 * 1000 * 1000, false)).toBe('2.5 GB');
        expect(humanBytes(1500, false)).toBe('1.5 KB');
        expect(humanBytes(1000 * 1000 * 5.6789, false)).toBe('5.68 MB');

        // Edge cases: zero, small, negative
        expect(humanBytes(0)).toBe('0 B');
        expect(humanBytes(100)).toBe('100 B');
        expect(humanBytes(-512)).toBe('-512 B');
        expect(humanBytes(-1024)).toBe('-1 KiB');
        expect(humanBytes(-1020, false)).toBe('-1.02 KB');
    });

    test('fromHumanBytes parses binary units (KiB/MiB/GiB)', () => {
        // Binary units (default, 1024 base)
        expect(fromHumanBytes('1 KiB')).toBe(1024);
        expect(fromHumanBytes('1 MiB')).toBe(1024 * 1024);
        expect(fromHumanBytes('1 GiB')).toBe(1024 * 1024 * 1024);
        expect(fromHumanBytes('1 TiB')).toBe(1024 * 1024 * 1024 * 1024);
        expect(fromHumanBytes('1 PiB')).toBe(1024 * 1024 * 1024 * 1024 * 1024);
        expect(fromHumanBytes('2 KiB')).toBe(2048);
        expect(fromHumanBytes('5 MiB')).toBe(5 * 1024 * 1024);
        expect(fromHumanBytes('2.5 GiB')).toBe(2.5 * 1024 * 1024 * 1024);
        expect(fromHumanBytes('1.5 KiB')).toBe(1536);
        expect(fromHumanBytes('1.23 MiB')).toBe(1024 * 1024 * 1.23);
    });

    test('fromHumanBytes parses decimal units (KB/MB/GB)', () => {
        // Decimal/SI units (1000 base)
        expect(fromHumanBytes('1 KB')).toBe(1000);
        expect(fromHumanBytes('1 MB')).toBe(1000 * 1000);
        expect(fromHumanBytes('1 GB')).toBe(1000 * 1000 * 1000);
        expect(fromHumanBytes('1 TB')).toBe(1000 * 1000 * 1000 * 1000);
        expect(fromHumanBytes('1 PB')).toBe(1000 * 1000 * 1000 * 1000 * 1000);
        expect(fromHumanBytes('2 KB')).toBe(2000);
        expect(fromHumanBytes('5 MB')).toBe(5 * 1000 * 1000);
        expect(fromHumanBytes('2.5 GB')).toBe(2.5 * 1000 * 1000 * 1000);
        expect(fromHumanBytes('1.5 KB')).toBe(1500);
        expect(fromHumanBytes('5.68 MB')).toBe(1000 * 1000 * 5.68);
    });

    test('fromHumanBytes parses bytes with no unit', () => {
        expect(fromHumanBytes('0 B')).toBe(0);
        expect(fromHumanBytes('100 B')).toBe(100);
        expect(fromHumanBytes('512 B')).toBe(512);
        expect(fromHumanBytes('999 B')).toBe(999);
    });

    test('fromHumanBytes parses negative values', () => {
        expect(fromHumanBytes('-512 B')).toBe(-512);
        expect(fromHumanBytes('-1 KiB')).toBe(-1024);
        expect(fromHumanBytes('-1.02 KB')).toBe(-1020);
    });

    test('fromHumanBytes handles whitespace variations', () => {
        expect(fromHumanBytes('1KiB')).toBe(1024);
        expect(fromHumanBytes('1  KiB')).toBe(1024);
        expect(fromHumanBytes('  1 KiB  ')).toBe(1024);
        expect(fromHumanBytes('1.5  MB')).toBe(1500000);
    });

    test('fromHumanBytes handles locale-formatted numbers', () => {
        // humanBytes uses locale template tag which may add thousands separators
        expect(fromHumanBytes('1,024 B')).toBe(1024);
        expect(fromHumanBytes('1 024 B')).toBe(1024); // space separator

        localePush('de-DE'); // German locale
        expect(fromHumanBytes('1.234.567,89 B')).toBe(1234567.89); // German format
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
            expect(binError < 0.001).toBeTruthy();

            const humanSi = humanBytes(val, false);
            const parsedSi = fromHumanBytes(humanSi);
            // SI units may have rounding errors due to humanBytes rounding to 2 decimal places
            // and the mismatch between binary values and decimal units (e.g., 1024 -> 1.02 KB -> 1020)
            // Allow up to 1% error for SI conversions
            const siError = Math.abs(parsedSi - val) / Math.max(Math.abs(val), 1);
            expect(siError < 0.01).toBeTruthy();
        }
    });

    test('fromHumanBytes throws on invalid input', () => {
        const invalidInputs = ['', '   ', '-,, b', 'invalid', 'KB', '1 XB', '1.2.3 MB', 'abc MB'];

        for (const input of invalidInputs) {
            expect(Number.isNaN(fromHumanBytes(input))).toBe(true);
        }
    });

    test('fromHumanBytes with explicit locale parameter', () => {
        // English locale with comma as thousands separator
        expect(fromHumanBytes('1,234.56 B', 'en-US')).toBe(1234.56);
        expect(fromHumanBytes('1,234 B', 'en-US')).toBe(1234);
        expect(fromHumanBytes('1.5 MB', 'en-US')).toBe(1500000);

        // German locale with dot as thousands separator and comma as decimal
        expect(fromHumanBytes('1.234,56 B', 'de-DE')).toBe(1234.56);
        expect(fromHumanBytes('1.234 B', 'de-DE')).toBe(1234);
        expect(fromHumanBytes('1,5 MB', 'de-DE')).toBe(1500000);

        // French locale (narrow no-break space as thousands separator)
        expect(fromHumanBytes('1 234,56 B', 'fr-FR')).toBe(1234.56);
        expect(fromHumanBytes('1 234 B', 'fr-FR')).toBe(1234);
    });
});
