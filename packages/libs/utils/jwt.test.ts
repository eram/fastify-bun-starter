import { afterAll, beforeAll, describe, test } from 'bun:test';
import { deepEqual, equal, ok, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Algorithm, createToken, JwtPayload, verifyToken } from './jwt';

describe('JWT basics', () => {
    test('create token', () => {
        const token = createToken({ foo: 'bar' }, undefined, 'key');
        equal(typeof token, 'string');
        equal(token.split('.').length, 3);
    });

    test('throw an error when the key is missing', () => {
        throws(() => createToken({ foo: 'bar' }, '1d', {} as Buffer), /No key supplied/);
    });

    test('throw an error when the key is garbage', () => {
        throws(() => createToken({ foo: 'bar' }, '1d', Buffer.alloc(20, 'z')), /unsupported/);
    });

    test('throw an error when the specified algorithm is not supported', () => {
        throws(() => createToken({ foo: 'bar' }, undefined, key, { alg: 'FooBar256' as Algorithm }), /Algorithm not supported/);
    });

    const key = 'key';
    const obj = { foo: 'bar' };
    const token = createToken(obj, '1d', key);

    test('verify', () => {
        const obj2 = verifyToken(token, key);
        const { iat, exp, nbf, ...obj2WithoutClaims } = obj2;
        deepEqual(obj2WithoutClaims, obj);
    });

    test('throw an error when no token is provided', () => {
        throws(() => verifyToken(null as unknown as string, key), /No token supplied/);
    });

    test('throw an error when the token is not correctly formatted', () => {
        throws(() => verifyToken('foo.bar', key), /Token must have 3 segrments/);
    });

    test('throw an error when the specified algorithm is not supported', () => {
        throws(
            // @ts-expect-error Algorithm typing issue
            () => verifyToken(token, key, 'FooBar256', false),
            /Algorithm not supported/,
        );
    });

    test('throw an error when the signature verification fails', () => {
        throws(() => verifyToken(token, 'invalid_key'), /invalid/i);
    });

    test('throw an error when the token is not yet active (optional nbf claim)', () => {
        const nbf = (Date.now() + 1000) / 1000;
        const token = createToken({ foo: 'bar', nbf }, '1d', key);
        throws(() => verifyToken(token, key), /Token not yet active/);
    });

    test('throw an error when the token is expired', () => {
        // we set iat to a past time and expiry to 0
        const iat = Math.floor(Date.now() / 1000) - 100000;
        const token = createToken({ foo: 'bar', iat }, '0', key);
        throws(() => verifyToken(token, key), /Token expired/);
    });

    test('do not throw any error when verification is disabled', () => {
        const obj = { foo: 'bar' };
        const key = 'key';
        const token = createToken(obj, '1s', key);

        throws(() => verifyToken(token, 'invalid_key1'), /invalid/i);

        const result = verifyToken(token, key, undefined, true);
        equal(typeof result, 'object');
        equal(result['foo'], obj['foo']);
    });

    test('decode token wrong algorithm', () => {
        throws(() => createToken(obj, undefined, key, { alg: 'ZZ512' as Algorithm }), /Algorithm not supported/);
        throws(() => verifyToken(token, key, 'ZZ512' as Algorithm), /Algorithm not supported/);
        throws(() => verifyToken(token, key, 'sha384' as Algorithm), /invalid/i);
    });
});

describe('RS256 with PEM/CRT', () => {
    let pem: Buffer;
    let cert: Buffer;

    beforeAll(() => {
        const __dirname__ = dirname(fileURLToPath(import.meta.url));
        pem = readFileSync(join(__dirname__, '__mocks__/base-jwt.pem'));
        cert = readFileSync(join(__dirname__, '__mocks__/base-jwt.crt'));
    });

    test('can add jwt header by options', () => {
        const claims = { foo: 'bar' };
        ok(!!pem && !!cert);

        const token = createToken(claims, undefined, pem, { kid: 'keyidX' });
        const obj2 = verifyToken(token, cert);
        const { iat, exp, nbf, ...obj2WithoutClaims } = obj2;
        deepEqual(obj2WithoutClaims, claims);

        const jwtHeader = token.split('.')[0]!;
        const parsed = JSON.parse(base64urlDecode(jwtHeader));
        deepEqual(parsed, { typ: 'JWT', alg: 'RSA-SHA256', kid: 'keyidX' });
    });

    test('decode token given RS256 algorithm', () => {
        const claims = { foo: 'bar' };
        ok(!!pem && !!cert);

        const token = createToken(claims, '1y', pem, { alg: 'RSA-SHA256' as Algorithm });
        const obj2 = verifyToken(token, cert);
        const { iat, exp, nbf, ...obj2WithoutClaims } = obj2;
        deepEqual(obj2WithoutClaims, claims);
    });

    test('throw an error when the key is invalid', () => {
        const claims = { foo: 'bar' };
        ok(!!pem);

        const token = createToken(claims, '1y', pem, { alg: 'RSA-SHA256' as Algorithm });
        throws(() => verifyToken(token, 'invalid_key'));
    });
});

// Helper functions
function base64urlDecode(str: string): string {
    return Buffer.from(base64urlUnescape(str), 'base64').toString();
}

function base64urlUnescape(str: string): string {
    str += new Array(5 - (str.length % 4)).join('=');
    return str.replace(/-/g, '+').replace(/_/g, '/');
}

describe('jwt with SECRET', () => {
    const sub = 'positive@domain.com';
    const prop1: 'test' = 'test';
    let savedSecret: string | undefined;
    let savedOld: string | undefined;
    let savedExpires: string | undefined;

    beforeAll(() => {
        savedSecret = process.env['JWT_SECRET'];
        savedOld = process.env['JWT_SECRET_OLD'];
        savedExpires = process.env['JWT_SECRET_EXPIRES'];
        process.env['JWT_SECRET'] = 'testSecret';
        process.env['JWT_SECRET_OLD'] = 'oldSecret';
    });

    afterAll(() => {
        restoreEnv('JWT_SECRET', savedSecret);
        restoreEnv('JWT_SECRET_OLD', savedOld);
        restoreEnv('JWT_SECRET_EXPIRES', savedExpires);
    });

    test('positive', () => {
        const token = createToken({ sub, prop1 }, '1m');
        equal(typeof token, 'string');
        ok(/^[A-Za-z0-9-_]+?\.[A-Za-z0-9-_]+?\.[A-Za-z0-9-_]+?$/.test(token));
        ok(token.length > 100);

        const claims = verifyToken(token);
        strictEqual(claims.error, undefined);
        strictEqual(claims.sub, sub);
        strictEqual(claims['prop1'], prop1);
    });

    test('old secret', () => {
        const sub = 'old@domain.com';
        const currentSecret = process.env['JWT_SECRET'];
        process.env['JWT_SECRET'] = process.env['JWT_SECRET_OLD'];
        const token = createToken({ sub, prop1 });
        strictEqual(typeof token, 'string');

        process.env['JWT_SECRET'] = 'newSecret';
        const claims = verifyToken(token);
        ok(!claims.error);
        strictEqual(claims.sub, sub);
        strictEqual(claims['prop1'], prop1);

        process.env['JWT_SECRET'] = currentSecret;
    });

    test('negative', () => {
        const token = 'negative@domain.com';
        throws(() => verifyToken(token), /Token must have 3 segrments/);
    });

    test('expired', () => {
        // construct an already-expired token directly instead of mocking the clock
        const iat = Math.floor(Date.now() / 1000) - 100;
        const token = createToken({ sub, iat }, '1s');
        strictEqual(typeof token, 'string');

        throws(() => verifyToken(token), /Token expired/);
    });

    test('JWT_SECRET_EXPIRES string or number', () => {
        process.env['JWT_SECRET_EXPIRES'] = '1d';
        let token = createToken({ sub });
        strictEqual(typeof token, 'string');
        let claims = verifyToken(token);
        ok(!claims.error);
        strictEqual(claims.sub, sub);
        strictEqual(claims.exp, Math.floor(Date.now() / 1000) + 86400);

        process.env['JWT_SECRET_EXPIRES'] = '1000';
        token = createToken({ sub });
        strictEqual(typeof token, 'string');
        claims = verifyToken(token);
        ok(!claims.error);
        strictEqual(claims.sub, sub);
        strictEqual(claims.exp, Math.floor(Date.now() / 1000) + 1000);
    });

    test('isValid', () => {
        const claims = verifyToken(createToken({ sub: 'test@domain.com' }));
        strictEqual(JwtPayload.isValid(claims), true);

        throws(() => verifyToken('invalid.token.1'), /invalid/i);
    });

    test('throw if no JWT_SECRET', () => {
        delete process.env['JWT_SECRET'];
        throws(() => createToken({ sub: 'test@domain.com' }), /JWT_SECRET/);
        throws(() => verifyToken('token'), /JWT_SECRET/);
    });
});

/** process.env values are always strings; assigning `undefined` back stores the literal string "undefined". */
function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}
