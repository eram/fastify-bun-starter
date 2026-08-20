import { describe, expect, test } from 'bun:test';
import Fastify from 'fastify';
import { registerAuth } from './auth';

process.env['JWT_SECRET'] ??= 'ci-test-secret';

describe('registerAuth', () => {
    test('registers the auth hook when JWT_SECRET is a real value', () => {
        const app = Fastify();
        expect(() => registerAuth(app)).not.toThrow();
    });
});
