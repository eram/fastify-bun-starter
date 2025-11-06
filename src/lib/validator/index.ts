/**
 * * @module validator
 *
 * This module provides integration between Fastify and a custom JSON validator.
 * It includes type providers, schema compilers, and type inference utilities.
 * The lib replaces the usage of several common utility npm packages that carry with them
 * unwanted dependencies and bloat:
 * 1. zod - heavy dependency for schema validation
 * 2. typebox - heavy dependency for schema validation
 * 3. @fastify/type-provider-typebox - heavy dependency for schema validation
 * 4. zod-to-json-schema - heavy dependency for schema conversion
 * 5. json-schema-to-zod -https://www.npmjs.com/package/json-schema-to-zod
 *
 */
export * from './provider';
export * from './schema';
export * from './validator';

import type { Infer } from './provider';
import { fromJsonSchema, toJsonSchema } from './schema';
// Re-export core validator functions and types for direct access
import {
    array,
    base64,
    base64url,
    bigint,
    boolean,
    cidrv4,
    cidrv6,
    cuid,
    cuid2,
    date,
    email,
    emoji,
    enumeration,
    hash,
    hex,
    hostname,
    httpUrl,
    int,
    ipv4,
    ipv6,
    isoDate,
    isoDatetime,
    isoDuration,
    isoTime,
    jwt,
    literal,
    looseObject,
    map,
    nan,
    nanoid,
    nullable,
    nullish,
    nullVal,
    number,
    type ObjV,
    object,
    optional,
    parseSchema,
    record,
    type StrV,
    safeParse,
    set,
    strictObject,
    string,
    type TypeV,
    ulid,
    undefinedVal,
    union,
    unknown,
    url,
    uuid,
    voidVal,
} from './validator';

// Zod-like API export for backwards compatibility
export const z = {
    // Primitive types
    string,
    number,
    boolean,
    bigint,
    date,
    undefined: undefinedVal,
    null: nullVal,
    nan,
    void: voidVal,

    // Complex types
    array,
    object,
    strictObject,
    looseObject,
    set,
    map,
    record,

    // Utility types
    literal,
    enum: enumeration,
    nullable,
    nullish,
    optional,
    union,
    unknown,

    // String format validators
    email,
    url,
    httpUrl,
    uuid,
    hostname,
    emoji,
    base64,
    base64url,
    hex,
    jwt,
    nanoid,
    cuid,
    cuid2,
    ulid,
    ipv4,
    ipv6,
    cidrv4,
    cidrv6,
    hash,
    isoDate,
    isoTime,
    isoDatetime,
    isoDuration,
    // Number helpers
    int,

    // Utilities
    parseSchema,
    safeParse, // NB!! different return type than zod's

    // JSON Schema conversion (for zod compatibility)
    zodToJsonSchema: toJsonSchema,
    jsonSchemaToZod: fromJsonSchema,
};

export namespace z {
    export type ZodType<T = unknown> = TypeV<T>;
    export type ZodObject = ObjV;
    export type ZodString = StrV;
    // biome-ignore lint/style/useNamingConvention: Zod compatibility
    export type infer<T> = Infer<T>;
}
