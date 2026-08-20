/**
 * Fastify Type Provider for Validator
 * Provides type-safe request/response validation using our custom validator
 */

import { replacerFn } from '@libs/utils/immutable';
import type { Validator } from '@libs/zody';
import { object } from '@libs/zody';
import type { FastifySchemaCompiler, FastifySerializerCompiler, FastifyTypeProvider } from 'fastify';

// Validator-like type (works with both validator instances and zody class statics)
type ValidatorLike<T = unknown> = {
    parse(input: unknown): T;
    safeParse(input: unknown): { success: boolean; data?: T; error?: Error };
};

/**
 * Zody/Validator type provider for Fastify
 * Maps validator/zody schemas to TypeScript types
 */
export interface Provider extends FastifyTypeProvider {
    validator: this['schema'] extends { parse(input: unknown): infer T } ? T : unknown;
    serializer: this['schema'] extends { parse(input: unknown): infer T } ? T : unknown;
}

/**
 * Check if a value is a Validator or Zody class constructor
 * Works with both functional validators (plain objects with .parse method)
 * and zody class constructors (functions with static .parse method)
 */
function isValidator(schema: unknown): schema is ValidatorLike {
    // Functional validator: plain object with parse method
    if (typeof schema === 'object' && schema !== null && 'parse' in schema && typeof schema.parse === 'function') {
        return true;
    }
    // Zody class constructor: function with static parse method
    if (typeof schema === 'function' && 'parse' in schema && typeof schema.parse === 'function') {
        return true;
    }
    return false;
}

/**
 * Validator schema compiler for Fastify
 * Compiles validator schemas into validation functions
 *
 * Accepts either:
 * - A Validator instance (e.g., string(), number(), object({ ... }))
 * - A plain object with Validator properties (e.g., { name: string(), age: number() })
 *
 * Plain objects are automatically wrapped with object() before validation.
 */
export const schemaCompiler: FastifySchemaCompiler<Validator | Record<string, Validator>> = ({ schema, httpPart: _httpPart }) => {
    return (data: unknown) => {
        try {
            // If it's already a Validator, use it directly
            if (isValidator(schema)) {
                const result: unknown = schema.parse(data);
                return { value: result };
            }

            // Otherwise, it's a plain object with validators - wrap it
            const validator = object(schema as Record<string, Validator<unknown>>);
            const result: unknown = validator.parse(data);
            return { value: result };
        } catch (error) {
            return { error: error as Error };
        }
    };
};

/**
 * Serializer compiler for Fastify responses
 * Uses Bun's fast JSON.stringify with custom replacer for BigInt support
 */
export const serializerCompiler: FastifySerializerCompiler<Validator | Record<string, Validator>> = () => {
    return (data: unknown): string => JSON.stringify(data, replacerFn, 0);
};
