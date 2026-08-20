/**
 * Functional Validator Implementations — Zod-compatible fluent interface
 *
 * Exports factory functions for building validators: string(), number(), object(), array(), etc.
 * Every validator implements codegen(), and the root object() schema's .validate() self-replaces
 * with a `new Function(...)`-backed fast path on its first call.
 *
 * @example
 * const schema = object({ name: string().min(3), age: number().gte(0) });
 * schema.validate({ name: 'Alice', age: 25 }); // First call compiles and replaces itself
 */

import { fromJsonSchema, toJsonSchema } from './schema';
import * as v from './validator';

/**
 * Differences vs. real Zod v4 (zod.dev), as of this writing:
 *
 * Coercion — biggest behavioral divergence:
 *   - Zod v4: `z.number()`/`z.bigint()`/`z.date()` are strict; coercion is opt-in via
 *     `z.coerce.number()` etc. There is no `z.coerce` namespace here — `number()`,
 *     `bigint()`, and `date()` in this lib coerce unconditionally (e.g. `number().parse("5")`
 *     succeeds here but throws in real Zod).
 *
 * Error handling:
 *   - Zod v4: `ZodError` carries a structured `.issues[]` array (path, code, message per
 *     failure) and `z.prettifyError()`/custom error maps for formatting.
 *   - Here: the underlying `ZodyError` thrown by validators is a single-message error with
 *     no path/code metadata (this lib doesn't track a field path while validating). The
 *     `ZodError` class below is a compatibility shim: it wraps that single message into a
 *     one-item `.issues[]` array with a best-effort `code`, since there's no real per-field
 *     path info to report — genuine multi-issue accumulation is not implemented.
 *   - `.safeParse()` on a validator instance returns a `[data, error]` tuple, not Zod's
 *     `{ success, data, error }` object — `zod.safeParse()` below wraps it to match Zod's
 *     shape (including converting the error to `ZodError`), but only when called through
 *     the `zod` namespace, not via `.safeParse()` directly.
 *
 * Missing top-level factories (present in Zod v4, absent here):
 *   - `z.coerce.*`, `z.symbol()`, `z.tuple()`, `z.discriminatedUnion()`, `z.intersection()`,
 *     `z.instanceof()`, `z.custom()`, `z.function()`, `z.templateLiteral()`, `z.file()`,
 *     `z.json()`, `z.never()`, `z.any()`, `z.exactOptional()`, `z.stringbool()`,
 *     `z.uuidv4/v6/v7()`, `z.guid()`, `z.e164()`, `z.mac()`, `z.creditCard()`,
 *     `z.int32/uint32/float32/float64/int64/uint64()`, `z.codec()/decode()/encode()`,
 *     `z.registry()`/`.meta()`/`z.globalRegistry`, `z.locales`, `z.partialRecord()`,
 *     `z.looseRecord()`, `z.xor()`.
 *   - `z.iso.*` is a namespace in Zod v4 (`z.iso.date()`); here `isoDate`/`isoTime`/
 *     `isoDatetime`/`isoDuration` are flat top-level exports instead.
 *
 * Missing chainable methods (present on Zod v4 schemas, absent on this lib's validators):
 *   - `.refine()`, `.superRefine()`, `.check()`, `.transform()`, `.pipe()`, `.preprocess()`,
 *     `.catch()`, `.prefault()`, `.brand()`, `.readonly()`, `.unwrap()`.
 *   - Object schemas: `.safeExtend()`, `.pick()`, `.omit()`, `.partial()`, `.exactPartial()`,
 *     `.required()`, `.catchall()`, `.shape` accessor.
 *     (`.extend()`, `.merge()`, `.strict()`, `.passthrough()`/`.strip()`, `.keyof()` DO exist here.)
 *   - No async variants at all: `.parseAsync()`, `.safeParseAsync()` are absent (this lib
 *     is synchronous-only).
 *
 * Present here but not a Zod v4 concept:
 *   - The root object() schema's `.validate()` self-replacing with a codegen'd
 *     `new Function(...)`-backed fast path on first call — a performance mechanism
 *     unique to this lib, not part of Zod's API. Governed by `enableCodeGen()`.
 *
 * No "Zod Mini" equivalent — this lib has a single API surface, not a tree-shakable
 * functional variant.
 */

//
// Zod-compatible error type
//
// This lib doesn't track a field path while validating, so every issue reports an empty
// `path` and a best-effort `code` — genuine multi-issue accumulation isn't implemented,
// this only wraps the single message an underlying ZodyError/ValidatorError carries.
export type ZodIssueCode = 'custom' | 'invalid_type' | 'too_small' | 'too_big' | 'invalid_format';

export interface ZodIssue {
    readonly code: ZodIssueCode;
    readonly path: readonly PropertyKey[];
    readonly message: string;
}

export class ZodError extends Error {
    readonly issues: ZodIssue[];

    constructor(issues: ZodIssue[]) {
        super(issues.map((issue) => issue.message).join('; '));
        this.name = 'ZodError';
        this.issues = issues;
    }

    static fromError(error: Error): ZodError {
        if (error instanceof ZodError) return error;
        return new ZodError([{ code: 'custom', path: [], message: error.message }]);
    }
}

//
// Zod-compatible namespace export
//

export namespace zod {
    export type ZodType<T = unknown> = v.TypeV<T>;
    // biome-ignore lint/suspicious/noExplicitAny: Zod compatibility - generic object type
    export type ZodObject = v.ObjV<any>;
    export type ZodString = v.StrV;
    // biome-ignore lint/style/useNamingConvention: Zod compatibility - infer must be lowercase
    export type infer<T> = v.Infer<T>;

    // SafeParse result types
    export type ZodSafeParseSuccess<T> = { success: true; data: T; error?: never };
    export type ZodSafeParseError = { success: false; data?: never; error: ZodError };
    export type ZodSafeParseResult<T> = ZodSafeParseSuccess<T> | ZodSafeParseError;
}

function zodSafeParse<T>(validator: v.Validator<T>, value: unknown): zod.ZodSafeParseResult<T> {
    try {
        const data = validator.parse(value);
        return { success: true, data };
    } catch (error) {
        return { success: false, error: ZodError.fromError(error as Error) };
    }
}

export const zod = {
    // Primitives
    string: v.string,
    number: v.number,
    boolean: v.boolean,
    bigint: v.bigint,
    date: v.date,

    // nulls
    nan: v.nan,
    null: v.nullVal,
    undefined: v.undefinedVal,
    void: v.voidVal,
    nanoid: v.nanoid,

    // Arrays & Objects
    array: v.array,
    object: v.object,
    strictObject: v.strictObject,
    looseObject: v.looseObject,
    set: v.set,
    map: v.map,
    record: v.record,

    // Utility types
    literal: v.literal,
    enum: v.enumeration,
    nullable: v.nullable,
    nullish: v.nullish,
    optional: v.optional,
    union: v.union,
    unknown: v.unknown,

    // String format validators
    email: v.email,
    url: v.url,
    httpUrl: v.httpUrl,
    uuid: v.uuid,
    hostname: v.hostname,
    emoji: v.emoji,
    base64: v.base64,
    base64url: v.base64url,
    hex: v.hex,
    jwt: v.jwt,
    cuid: v.cuid,
    cuid2: v.cuid2,
    ulid: v.ulid,
    ipv4: v.ipv4,
    ipv6: v.ipv6,
    cidrv4: v.cidrv4,
    cidrv6: v.cidrv6,
    hash: v.hash,
    isoDate: v.isoDate,
    isoTime: v.isoTime,
    isoDatetime: v.isoDatetime,
    isoDuration: v.isoDuration,
    // Number helpers
    int: v.int,

    // Utilities
    parseSchema: v.parse,
    safeParse: zodSafeParse, // Zod-compatible return type
    ZodError,

    // JSON Schema conversion (for zod compatibility)
    zodToJsonSchema: toJsonSchema,
    jsonSchemaToZod: fromJsonSchema,
};
