/**
 * * @module validator
 *
 * This module provides integration between Fastify and a custom JSON validator.
 * It includes type providers, schema compilers, and type inference utilities.
 * The lib replaces the usage of several common utility npm packages that carry with them
 * unwanted dependencies and bloat:
 * 1. zod - https://github.com/colinhacks/zod
 * 2. typebox - https://github.com/sinclairzx81/typebox
 * 3. @fastify/type-provider-typebox - https://www.npmjs.com/package/@fastify/type-provider-typebox
 * 4. zod-to-json-schema - https://www.npmjs.com/package/zod-to-json-schema
 * 5. json-schema-to-zod - https://www.npmjs.com/package/json-schema-to-zod
 *
 */

import { fromJsonSchema, toJsonSchema } from './schema';
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
    type Infer,
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
    parse,
    record,
    type StrV,
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
    type Validator,
    voidVal,
} from './validator';

export * from './schema';
export * from './validator';

//
// Zod-like API export for backwards compatibility
//

export namespace z {
    export type ZodType<T = unknown> = TypeV<T>;
    // biome-ignore lint/suspicious/noExplicitAny: Zod compatibility - generic object type
    export type ZodObject = ObjV<any>;
    export type ZodString = StrV;
    // biome-ignore lint/style/useNamingConvention: Zod compatibility - infer must be lowercase
    export type infer<T> = Infer<T>;

    // SafeParse result types
    export type ZodSafeParseSuccess<T> = { success: true; data: T; error?: never };
    export type ZodSafeParseError = { success: false; data?: never; error: Error };
    export type ZodSafeParseResult<T> = ZodSafeParseSuccess<T> | ZodSafeParseError;
}

/**
 * Zod-compatible safeParse function
 * Returns { success: true, data } or { success: false, error }
 */
function zodSafeParse<T>(validator: Validator<T>, value: unknown): z.ZodSafeParseResult<T> {
    try {
        const data = validator.parse(value);
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error as Error };
    }
}

export const z = {
    // Primitives
    string,
    number,
    boolean,
    bigint,
    date,

    // nulls
    nan,
    null: nullVal,
    undefined: undefinedVal,
    void: voidVal,
    nanoid,

    // Arrays & Objects
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
    parseSchema: parse,
    safeParse: zodSafeParse, // Zod-compatible return type

    // JSON Schema conversion (for zod compatibility)
    zodToJsonSchema: toJsonSchema,
    jsonSchemaToZod: fromJsonSchema,
};
