import { ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { app } from '../app';

describe('Number formatting API', () => {
    test('POST /hello formats positive number with en-US locale', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 123456789,
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 200);
        const json = response.json();
        strictEqual(json.formatted, '123,456,789');
    });

    test('POST /hello formats negative number with en-US locale', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: -987654321,
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 200);
        const json = response.json();
        strictEqual(json.formatted, '-987,654,321');
    });

    test('POST /hello formats number with de-DE locale', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 123456,
                locale: 'de-DE',
            },
        });

        strictEqual(response.statusCode, 200);
        const json = response.json();
        strictEqual(json.formatted, '123.456');
    });

    test('POST /hello formats number with fr-FR locale', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 123456,
                locale: 'fr-FR',
            },
        });

        strictEqual(response.statusCode, 200);
        const json = response.json();
        ok(json.formatted.includes('123'));
    });

    test('POST /hello validates number has max 15 digits', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 1234567890123456, // 16 digits
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 400);
    });

    test('POST /hello accepts 15 digit number', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 123456789012345, // 15 digits
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 200);
    });

    test('POST /hello validates locale format is IETF BCP 47', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 12345,
                locale: 'invalid_locale',
            },
        });

        strictEqual(response.statusCode, 400);
    });

    test('POST /hello returns 400 for unsupported locale with list of available locales', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 12345,
                locale: 'xx-XX',
            },
        });

        strictEqual(response.statusCode, 400);
        const json = response.json();
        ok(json.message);
        ok(json.availableLocales);
        ok(Array.isArray(json.availableLocales));
        ok(json.availableLocales.length > 0);
    });

    test('POST /hello requires number field', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 400);
    });

    test('POST /hello requires locale field', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 12345,
            },
        });

        strictEqual(response.statusCode, 400);
    });

    test('POST /hello content-type is application/json', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 12345,
                locale: 'en-US',
            },
        });

        ok(response.headers['content-type']?.includes('application/json'));
    });

    test('POST /hello formats single digit number', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 5,
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 200);
        const json = response.json();
        strictEqual(json.formatted, '5');
    });

    test('POST /hello formats zero', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                number: 0,
                locale: 'en-US',
            },
        });

        strictEqual(response.statusCode, 200);
        const json = response.json();
        strictEqual(json.formatted, '0');
    });
});
