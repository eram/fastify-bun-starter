import { deepEqual, ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { number, object, string } from './index';
import { schemaCompiler, serializerCompiler } from './provider';

// Test helper type: narrow the compiler return type for tests
type ValidationResult = { value?: unknown; error?: Error };

function createTestCompiler<T>(schema: T, httpPart: string) {
    return schemaCompiler({ schema, httpPart } as any) as (data: unknown) => ValidationResult;
}

describe('Validator Provider', () => {
    // JsonSchemaValidatorCompiler tests
    test('should compile and validate with ValueValidator', () => {
        const validator = string().min(3).max(10);
        const compiler = createTestCompiler(validator, 'body');

        // Valid input
        const result1 = compiler('hello');
        strictEqual(result1.error, undefined);
        strictEqual(result1.value, 'hello');

        // Invalid input - too short
        const result2 = compiler('hi');
        ok(result2.error instanceof Error);
    });

    test('should compile and validate with Schema object', () => {
        const schema = {
            name: string().min(2),
            age: number().int().min(0),
        };
        const compiler = createTestCompiler(schema, 'body');

        // Valid input
        const result1 = compiler({ name: 'John', age: 30 });
        strictEqual(result1.error, undefined);
        deepEqual(result1.value, { name: 'John', age: 30 });

        // Invalid input - missing required field
        const result2 = compiler({ name: 'John' });
        ok(result2.error instanceof Error);
        ok(result2.error?.message.includes('age'));

        // Invalid input - age not integer
        const result3 = compiler({ name: 'John', age: 30.5 });
        ok(result3.error instanceof Error);
    });

    test('should handle nested object schemas', () => {
        const schema = {
            user: object({
                name: string(),
                email: string().email(),
            }),
        };
        const compiler = createTestCompiler(schema, 'body');

        // Valid input
        const result1 = compiler({ user: { name: 'John', email: 'john@example.com' } });
        strictEqual(result1.error, undefined);
        deepEqual(result1.value, { user: { name: 'John', email: 'john@example.com' } });

        // Invalid input - invalid email
        const result2 = compiler({ user: { name: 'John', email: 'not-an-email' } });
        ok(result2.error instanceof Error);
    });

    test('should work with different httpPart values', () => {
        const schema = { id: string() };

        // body
        const bodyCompiler = createTestCompiler(schema, 'body');
        const bodyResult = bodyCompiler({ id: '123' });
        strictEqual(bodyResult.error, undefined);

        // querystring
        const queryCompiler = createTestCompiler(schema, 'querystring');
        const queryResult = queryCompiler({ id: '456' });
        strictEqual(queryResult.error, undefined);

        // params
        const paramsCompiler = createTestCompiler(schema, 'params');
        const paramsResult = paramsCompiler({ id: '789' });
        strictEqual(paramsResult.error, undefined);
    });

    test('should return error for invalid data', () => {
        const validator = number().min(10);
        const compiler = createTestCompiler(validator, 'body');

        const result = compiler(5);
        ok(result.error instanceof Error);
        strictEqual(result.value, undefined);
    });

    test('should handle empty objects', () => {
        const schema = {};
        const compiler = createTestCompiler(schema, 'body');

        const result = compiler({});
        strictEqual(result.error, undefined);
        deepEqual(result.value, {});
    });

    // validatorSerializerCompiler tests
    test('should serialize data to JSON string', () => {
        const schema = { name: string() };
        const serializer = serializerCompiler({ schema });

        const result = serializer({ name: 'John', age: 30 });
        strictEqual(result, '{"name":"John","age":30}');
    });

    test('should serialize primitive values', () => {
        const schema = string();
        const serializer = serializerCompiler({ schema });

        strictEqual(serializer('hello'), '"hello"');
        strictEqual(serializer(123), '123');
        strictEqual(serializer(true), 'true');
        strictEqual(serializer(null), 'null');
    });

    test('should serialize arrays', () => {
        const schema = { items: string() };
        const serializer = serializerCompiler({ schema });

        const result = serializer(['a', 'b', 'c']);
        strictEqual(result, '["a","b","c"]');
    });

    test('should serialize nested objects', () => {
        const schema = {
            user: object({
                name: string(),
                age: number(),
            }),
        };
        const serializer = serializerCompiler({ schema });

        const result = serializer({ user: { name: 'John', age: 30 } });
        strictEqual(result, '{"user":{"name":"John","age":30}}');
    });

    test('should handle undefined and null', () => {
        const schema = string();
        const serializer = serializerCompiler({ schema });

        strictEqual(serializer(undefined), undefined);
        strictEqual(serializer(null), 'null');
    });
});
