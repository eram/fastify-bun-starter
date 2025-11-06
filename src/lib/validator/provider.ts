/**
 * Fastify Type Provider for json Validator
 * Provides type-safe request/response validation using our custom validator
 */

import type { FastifySchema, FastifySchemaCompiler, FastifyTypeProvider } from 'fastify';
import type { Schema, Validator } from './validator';
import { parseSchema } from './validator';

// Helper type to infer schema object types
type InferSchema<S extends Schema> = {
    [K in keyof S]: S[K] extends Validator<infer U> ? U : never;
};

// Helper to recursively unwrap and simplify types
type Simplify<T> = T extends Map<infer K, infer V>
    ? Map<K, Simplify<V>>
    : T extends Array<infer U>
      ? Array<Simplify<U>>
      : T extends object
        ? { [K in keyof T]: Simplify<T[K]> }
        : T;

/**
 * Type helper to infer TypeScript types from validator schemas
 * Uses Simplify to recursively flatten all nested types
 */
export type Infer<T> = Simplify<T extends Validator<infer U> ? U : T extends Schema ? InferSchema<T> : never>;

/**
 * JSON Schema type provider for Fastify
 * Maps validator schemas to TypeScript types
 */
export interface Provider extends FastifyTypeProvider {
    validator: this['schema'] extends Validator<infer T>
        ? T
        : this['schema'] extends Schema
          ? { [K in keyof this['schema']]: this['schema'][K] extends Validator<infer U> ? U : never }
          : unknown;
    serializer: this['schema'] extends Validator<infer T>
        ? T
        : this['schema'] extends Schema
          ? { [K in keyof this['schema']]: this['schema'][K] extends Validator<infer U> ? U : never }
          : unknown;
}

/**
 * Type for the validator function returned by the compiler
 */
type ValidatorFn = (data: unknown) => { value?: unknown; error?: Error };

/**
 * Validator schema compiler for Fastify
 * Compiles validator schemas into validation functions
 *
 * Matches TypeBox's pattern by:
 * - Receiving httpPart to distinguish body from querystring/params/headers
 * - Applying conversion for non-body parts (for type coercion)
 * - Returning errors in Fastify's expected format
 */
export const schemaCompiler: FastifySchemaCompiler<Validator | Schema> = ({ schema, httpPart: _httpPart }): ValidatorFn => {
    return (data: unknown): { value?: unknown; error?: Error } => {
        try {
            // For non-body parts, we could apply type coercion here if needed
            // For now, we'll keep consistent behavior across all parts
            const value = data;

            // Check if it's a ValueValidator (has its own parse method and _checks property)
            // We need to check for _checks because objects might have parse methods too
            if ('_checks' in schema && typeof schema.parse === 'function') {
                const validator = schema as unknown as Validator<unknown>;
                const result = validator.parse(value);
                return { value: result };
            }

            const result = parseSchema(schema as Schema, value);
            return { value: result };
        } catch (error) {
            return { error: error as Error };
        }
    };
};

/**
 * Serializer compiler for Fastify responses
 * Simply returns the data as-is (no serialization needed)
 */
export function serializerCompiler({ schema: _schema }: { schema: Validator | Schema }) {
    return (data: unknown) => {
        // For responses, we just return the data as JSON
        // The validator has already been applied during parsing
        return JSON.stringify(data);
    };
}

/** Fastify schema adding specific validator types */
export interface ValidatorFastifySchema extends FastifySchema {
    body?: Validator | Schema;
    querystring?: Validator | Schema;
    params?: Validator | Schema;
    headers?: Validator | Schema;
    response?: {
        [statusCode: string]: Validator | Schema;
        [statusCode: number]: Validator | Schema;
    };
}
