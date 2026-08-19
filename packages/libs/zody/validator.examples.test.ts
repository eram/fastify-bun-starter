/**
 * Tests for examples() method
 */

import { describe, expect, test } from 'bun:test';
import { string } from './validator';

describe('Validator examples() method', () => {
    test('sets examples using examples() method', () => {
        const v = string().examples('foo', 'bar', 'baz');
        const defs = v.defs();

        expect(defs.examples).toStrictEqual(['foo', 'bar', 'baz']);
    });

    test('examples() is chainable', () => {
        const v = string().min(3).examples('hello', 'world').max(10).describe('A greeting');

        const defs = v.defs();

        expect(defs.minLength).toBe(3);
        expect(defs.maxLength).toBe(10);
        expect(defs.description).toBe('A greeting');
        expect(defs.examples).toStrictEqual(['hello', 'world']);
    });

    test('examples() works with email v', () => {
        const v = string().email().examples('admin@example.com', 'user@test.org');
        const defs = v.defs();

        expect(defs.format).toBe('email');
        expect(defs.pattern).toBe('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$');
        expect(defs.examples).toStrictEqual(['admin@example.com', 'user@test.org']);
    });

    test('examples() overrides previous examples', () => {
        const v = string().examples('old1', 'old2').examples('new1', 'new2');

        const defs = v.defs();
        expect(defs.examples).toStrictEqual(['new1', 'new2']);
    });

    test('can use single example', () => {
        const v = string().examples('single-example');
        const defs = v.defs();

        expect(defs.examples).toStrictEqual(['single-example']);
    });

    test('built-in validators have examples set automatically', () => {
        const email = string().email();
        const url = string().url();
        const uuid = string().uuid();

        expect(email.defs().examples?.[0]).toBe('user@example.com');
        expect(url.defs().examples?.[0]).toBe('https://example.com');
        expect(uuid.defs().examples?.[0]).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    test('custom examples override built-in examples', () => {
        const v = string()
            .email() // Sets examples: ['user@example.com']
            .examples('custom@example.org'); // Overrides

        const defs = v.defs();
        expect(defs.examples).toStrictEqual(['custom@example.org']);
    });
});
