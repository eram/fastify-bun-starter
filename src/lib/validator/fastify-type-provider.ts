/**
 * Fastify Type Provider for jsonValidator
 *
 * Provides type-safe request/response validation using our custom validator
 */

import type { FastifySchemaCompiler, FastifyTypeProvider } from 'fastify';
import type { Schema, ValueValidator } from './jsonValidator';
import { parse } from './jsonValidator';

/**
 * JSON Schema type provider for Fastify
 * Maps validator schemas to TypeScript types
 */
export interface JsonSchemaTypeProvider extends FastifyTypeProvider {
    validator: this['schema'] extends ValueValidator<infer T>
        ? T
        : this['schema'] extends Schema
          ? { [K in keyof this['schema']]: this['schema'][K] extends ValueValidator<infer U> ? U : never }
          : unknown;
    serializer: this['schema'] extends ValueValidator<infer T>
        ? T
        : this['schema'] extends Schema
          ? { [K in keyof this['schema']]: this['schema'][K] extends ValueValidator<infer U> ? U : never }
          : unknown;
}

/**
 * Validator schema compiler for Fastify
 * Compiles validator schemas into validation functions
 *
 * Matches TypeBox's pattern by:
 * - Receiving httpPart to distinguish body from querystring/params/headers
 * - Applying conversion for non-body parts (for type coercion)
 * - Returning errors in Fastify's expected format
 */
// biome-ignore lint/style/useNamingConvention: Fastify schema compiler convention
export const JsonSchemaValidatorCompiler: FastifySchemaCompiler<ValueValidator | Schema> = ({ schema, httpPart: _httpPart }) => {
    return (data: unknown): unknown => {
        try {
            // For non-body parts, we could apply type coercion here if needed
            // For now, we'll keep consistent behavior across all parts
            const value = data;

            // Check if it's a ValueValidator (has its own valueOf method and _validators property)
            // We need to check for _validators because all objects inherit valueOf from Object.prototype
            if ('_validators' in schema && typeof schema.valueOf === 'function') {
                const result = schema.valueOf(value);
                return { value: result };
            }

            // If it's a Schema (object with validators as properties), use parse
            const result = parse(schema as Schema, value);
            return { value: result };
        } catch (error) {
            // Return error in Fastify's expected format
            return { error: error as Error };
        }
    };
};

/**
 * Serializer compiler for Fastify responses
 * Simply returns the data as-is (no serialization needed)
 */
export function validatorSerializerCompiler({ schema: _schema }: { schema: ValueValidator | Schema }) {
    return (data: unknown) => {
        // For responses, we just return the data as JSON
        // The validator has already been applied during parsing
        return JSON.stringify(data);
    };
}

/**
 * Type helper to infer TypeScript types from validator schemas
 */
export type Infer<T> = T extends ValueValidator<infer U>
    ? U
    : T extends Schema
      ? { [K in keyof T]: T[K] extends ValueValidator<infer U> ? U : never }
      : never;

/**
 * Fastify schema with validator support
 */
export interface ValidatorFastifySchema extends FastifySchema {
    body?: ValueValidator | Schema;
    querystring?: ValueValidator | Schema;
    params?: ValueValidator | Schema;
    headers?: ValueValidator | Schema;
    response?: {
        [statusCode: string]: ValueValidator | Schema;
        [statusCode: number]: ValueValidator | Schema;
    };
}
