import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { app } from '../app';

describe('Hello route', () => {
    test('POST /test with default values returns 200', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {},
        });

        strictEqual(response.statusCode, 200);
    });

    test('POST /test with default values returns correct structure', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {},
        });

        const json = response.json();
        strictEqual(json.message, 'Test completed successfully');
        strictEqual(json.data.name, 'World');
        strictEqual(json.data.count, 1);
        strictEqual(json.data.verbose, false);
        strictEqual(json.data.user, undefined);
    });

    test('POST /test with custom name and count', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                name: 'Alice',
                count: 5,
            },
        });

        const json = response.json();
        strictEqual(json.data.name, 'Alice');
        strictEqual(json.data.count, 5);
        strictEqual(json.data.verbose, false);
    });

    test('POST /test with verbose=true includes user object', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                name: 'Bob',
                count: 3,
                verbose: true,
            },
        });

        const json = response.json();
        strictEqual(json.data.verbose, true);
        ok(json.data.user);
        strictEqual(json.data.user.name, 'John Doe');
        strictEqual(json.data.user.age, 30);
        strictEqual(json.data.user.email, 'john@example.com');
    });

    test('POST /test validates name minimum length', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                name: 'AB', // Too short (min 3)
            },
        });

        strictEqual(response.statusCode, 400);
    });

    test('POST /test validates count minimum value', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                count: 0, // Too low (min 1)
            },
        });

        strictEqual(response.statusCode, 400);
    });

    test('POST /test validates count is a number', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                count: 'not-a-number',
            },
        });

        strictEqual(response.statusCode, 400);
    });

    test('POST /test content-type is application/json', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {},
        });

        ok(response.headers['content-type']?.includes('application/json'));
    });

    test('POST /test with all parameters', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/hello',
            payload: {
                name: 'Charlie',
                count: 10,
                verbose: true,
            },
        });

        const json = response.json();
        deepStrictEqual(json.data, {
            name: 'Charlie',
            count: 10,
            verbose: true,
            user: {
                name: 'John Doe',
                age: 30,
                email: 'john@example.com',
            },
        });
    });
});
