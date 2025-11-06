/**
 * Validator - Type-safe runtime validation and coercion library
 *
 * A high-performance validation library for TypeScript that provides runtime type checking,
 * coercion, and schema validation with a fluent API.
 *
 * Features:
 * - Intentionally similar API to Zod v4
 * - Faster than Zod v4 for most cases: see bench_validators for performance comparison.
 * - Type coercion (automatic conversion where sensible).
 * - Chainable validation methods.
 * - Optional and default value support.
 * - Nested object and array validation.
 * - Built-in validators for common formats (email, URL, UUID, etc.)
 * - Literal type validation.
 * - Nullable and nullish wrappers.
 * - High performance with singleton instances and optimized paths.
 *
 * @example usage
 * ```typescript
 * // Chaining validators
 * const urlValidator = string().url().httpUrl();
 * const idValidator = string().uuid();
 * const priceValidator = number().positive().multipleOf(0.01);
 *
 * // Optional and default values
 * const statusValidator = string().default("pending");
 * const tagsValidator = array(string()).optional();
 *
 * // Object schemas
 * const userSchema = {
 *   name: string().min(3),
 *   age: number().int().optional(),
 *   email: string().email()
 * };
 *
 * // Parse and validate
 * const user = parse(userSchema, {
 *   name: "John",
 *   email: "john@example.com"
 * });
 *
 * // Nested schemas
 * const addressSchema = {
 *   street: string(),
 *   city: string(),
 *   zip: string().regex(/^\d{5}$/, 'Invalid ZIP code')
 * };
 *
 * const personSchema = {
 *   name: string(),
 *   address: object(addressSchema)
 * };
 * ```
 */

import { ErrorEx } from '../../util';

// JSON Schema primitive types - defined locally to avoid circular dependency
export type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

// ValidatorDef contains only JSON Schema properties actually used
// in this file. Additional props found in schema.ts
export interface ValidatorDef {
    // Validator-specific metadata
    description?: string;
    value?: unknown; // For literal values (maps to const in JSON Schema)
    default?: unknown; // Default value for optional fields

    // We track constraints as validators build up
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number;
    exclusiveMaximum?: number;
    multipleOf?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
    minProperties?: number;
    maxProperties?: number;

    // JSON Schema structure properties (used by validators)
    type?: PrimitiveType | PrimitiveType[];
    properties?: Record<string, ValidatorDef>;
    items?: ValidatorDef;
    required?: string[];
    enum?: unknown[];
    const?: unknown;
    anyOf?: ValidatorDef[];
    not?: ValidatorDef;
    format?: string;
    uniqueItems?: boolean;
    additionalProperties?: boolean | ValidatorDef;
}

export interface Validator<T = unknown> {
    parse(value: unknown): T;
    push(check: (arg: T) => T): number;
    clear(): void;
    isOptional?: boolean; // Flag to indicate if validator is optional
    describe(description: string): this;
    defs(props?: boolean): ValidatorDef; // Get Json schema definition
    optional(): Validator<T | undefined>; // Make validator accept undefined
}

// Validator error class
class ValidatorError extends ErrorEx {}
const verror = (str: string) => new ValidatorError(str);

// Abstract base class for all validators
export abstract class TypeV<T> implements Validator<T> {
    protected _checks: Array<(val: T) => T> = [];
    public isOptional = false; // Track if optional() was called (runtime flag for parse optimization)
    protected _inner?: Validator; // Optional inner validator for composite types
    protected _defs: Partial<ValidatorDef> = {}; // Track constraint metadata for schema generation

    defs(): ValidatorDef {
        return { ...this._defs };
    }

    parse(value: unknown): T {
        // Fast path for validators with no additional constraints
        if (this._checks.length === 0) {
            return value as T;
        }

        // Fast path for single validator
        if (this._checks.length === 1) {
            const result = this._checks[0](value as T);
            return result;
        }

        // Multiple validators - apply in sequence
        let processed: T = value as T;
        for (let i = 0; i < this._checks.length; i++) {
            processed = this._checks[i](processed);
            // Short-circuit if optional validator returns undefined
            // (this prevents further coercion of undefined values)
            if (this.isOptional && processed === undefined && i === 0) {
                return processed;
            }
        }
        return processed;
    }

    push(check: (val: T) => T): number {
        return this._checks.push(check);
    }

    clear() {
        this._checks.length = 0;
    }

    optional(): TypeV<T | undefined> {
        this.isOptional = true;
        this._checks.splice(0, 0, (val: unknown) => {
            if (val === undefined || val === null || val === '') {
                return undefined as T;
            }
            return val as T;
        });
        return this as TypeV<T | undefined>;
    }

    default(val: T): this {
        this.isOptional = true;
        this._defs.default = val;
        this._checks.splice(0, 0, (v: unknown) => {
            if (v === undefined || v === null) {
                return val;
            }
            return v as T;
        });
        return this;
    }

    describe(description: string): this {
        this._defs.description = description;
        return this;
    }

    safeParse(value: unknown): [T | undefined, Error | undefined] {
        try {
            return [this.parse(value) as T, undefined];
        } catch (error) {
            return [undefined, error as Error];
        }
    }
}

//
// --- Number Validator ---
//

class NumV extends TypeV<number> {
    constructor() {
        super();
        this.push((val: unknown) => {
            // Fast path: Value is already a number
            if (typeof val === 'number') {
                if (Number.isNaN(val)) {
                    throw verror('Expected number, got NaN');
                }
                return val;
            }
            // Coerce to number
            const num = Number(val);
            if (Number.isNaN(num)) {
                throw verror(`Expected number, got ${typeof val}`);
            }
            return num;
        });
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'number' };
    }

    int(): this {
        this.push((val: number) => {
            if (!Number.isInteger(val)) {
                throw verror(`${val} is not integer`);
            }
            return val;
        });
        return this;
    }

    float(): this {
        this.push((val: number) => {
            if (!Number.isFinite(val)) {
                throw verror(`${val} is not finite`);
            }
            return val;
        });
        return this;
    }

    min(min: number): this {
        return this.gte(min);
    }

    max(max: number): this {
        return this.lte(max);
    }

    gte(min: number): this {
        this._defs.minimum = min;
        this.push((val: number) => {
            if (val < min) {
                throw verror(`${val} >= ${min}`);
            }
            return val;
        });
        return this;
    }

    lte(max: number): this {
        this._defs.maximum = max;
        this.push((val: number) => {
            if (val > max) {
                throw verror(`${val} <= ${max}`);
            }
            return val;
        });
        return this;
    }

    gt(value: number): this {
        this._defs.exclusiveMinimum = value;
        this.push((val: number) => {
            if (val <= value) {
                throw verror(`${val} > ${value}`);
            }
            return val;
        });
        return this;
    }

    lt(value: number): this {
        this._defs.exclusiveMaximum = value;
        this.push((val: number) => {
            if (val >= value) {
                throw verror(`${val} < ${value}`);
            }
            return val;
        });
        return this;
    }

    positive(): this {
        return this.gt(0);
    }

    negative(): this {
        return this.lt(0);
    }

    nonnegative(): this {
        return this.gte(0);
    }

    nonpositive(): this {
        return this.lte(0);
    }

    multipleOf(divisor: number): this {
        this._defs.multipleOf = divisor;
        this.push((val: number) => {
            if (val % divisor !== 0) {
                throw verror(`${val} % ${divisor} !== 0`);
            }
            return val;
        });
        return this;
    }

    step(divisor: number): this {
        return this.multipleOf(divisor);
    }

    range(min: number, max: number): this {
        return this.min(min).max(max);
    }

    finite(): this {
        this.push((val: number) => {
            if (!Number.isFinite(val)) {
                throw verror(`${val} is not finite`);
            }
            return val;
        });
        return this;
    }

    safe(): this {
        this.push((val: number) => {
            if (!Number.isSafeInteger(val)) {
                throw verror(`${val} is not a safe integer`);
            }
            return val;
        });
        return this;
    }
}

//
// --- String Validator ---
//

export class StrV extends TypeV<string> {
    constructor() {
        super();
        this.push((val: unknown) => {
            // Fast path: Value is already a string
            if (typeof val === 'string') {
                return val;
            }
            // Coerce to string using native String() conversion
            return String(val);
        });
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'string' };
    }

    // Validation methods
    min(min: number): this {
        this._defs.minLength = min;
        this.push((val: string) => {
            if (val.length < min) {
                throw verror(`${val.length} >= ${min}`);
            }
            return val;
        });
        return this;
    }

    max(max: number): this {
        this._defs.maxLength = max;
        this.push((val: string) => {
            if (val.length > max) {
                throw verror(`${val.length} <= ${max}`);
            }
            return val;
        });
        return this;
    }

    regex(pattern: RegExp, msg?: string): this {
        this._defs.pattern = pattern.source;
        this.push((val: string) => {
            if (!pattern.test(val)) {
                val = val.length > 20 ? `${val.slice(0, 17)}...` : val;
                let str = pattern.toString();
                str = str.length > 20 ? `${str.slice(0, 17)}...` : str;
                msg ??= `"${val}" does not match ${str}`;
                // Support template string interpolation in error message
                const message = msg.replace(/\$\{val\}/g, val);
                throw verror(message);
            }
            return val;
        });
        return this;
    }

    email(): this {
        return this.regex(
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid email address',
        );
    }

    length(len: number): this {
        this.push((val: string) => {
            if (val.length !== len) {
                throw verror(`${val.length} === ${len}`);
            }
            return val;
        });
        return this;
    }

    startsWith(prefix: string): this {
        this.push((val: string) => {
            if (!val.startsWith(prefix)) {
                throw verror(`"${val}" must start with "${prefix}"`);
            }
            return val;
        });
        return this;
    }

    endsWith(suffix: string): this {
        this.push((val: string) => {
            if (!val.endsWith(suffix)) {
                throw verror(`"${val}" must end with "${suffix}"`);
            }
            return val;
        });
        return this;
    }

    includes(substring: string): this {
        this.push((val: string) => {
            if (!val.includes(substring)) {
                throw verror(`"${val}" must include "${substring}"`);
            }
            return val;
        });
        return this;
    }

    uppercase(): this {
        this.push((val: string) => {
            if (val !== val.toUpperCase()) {
                throw verror(`"${val}" must be uppercase`);
            }
            return val;
        });
        return this;
    }

    lowercase(): this {
        this.push((val: string) => {
            if (val !== val.toLowerCase()) {
                throw verror(`"${val}" must be lowercase`);
            }
            return val;
        });
        return this;
    }

    // Transform methods
    trim(): this {
        this.push((val: string) => val.trim());
        return this;
    }

    toLowerCase(): this {
        this.push((val: string) => val.toLowerCase());
        return this;
    }

    toUpperCase(): this {
        this.push((val: string) => val.toUpperCase());
        return this;
    }

    normalize(form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' = 'NFC'): this {
        this.push((val: string) => val.normalize(form));
        return this;
    }

    // String format validators
    uuid(): this {
        return this.regex(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid UUID',
        );
    }

    url(): this {
        this.push((val: string) => {
            try {
                new URL(val);
                return val;
            } catch {
                throw verror(`"${val}" is not a valid URL`);
            }
        });
        return this;
    }

    httpUrl(): this {
        this.push((val: string) => {
            try {
                const url = new URL(val);
                if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                    throw verror(`"${val}" must use http or https protocol`);
                }
                return val;
            } catch {
                throw verror(`"${val}" is not a valid HTTP(S) URL`);
            }
        });
        return this;
    }

    hostname(): this {
        return this.regex(
            /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid hostname',
        );
    }

    emoji(): this {
        // Matches single emoji characters (including complex ones with modifiers and ZWJ sequences)
        return this.regex(
            /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(\u200D(\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid emoji',
        );
    }

    base64(): this {
        return this.regex(
            /^[A-Za-z0-9+/]*={0,2}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not valid base64',
        );
    }

    base64url(): this {
        return this.regex(
            /^[A-Za-z0-9_-]*$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not valid base64url',
        );
    }

    hex(): this {
        return this.regex(
            /^[0-9a-fA-F]+$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not valid hexadecimal',
        );
    }

    jwt(): this {
        return this.regex(
            /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid JWT token',
        );
    }

    nanoid(): this {
        // Nanoid default is 21 characters using A-Za-z0-9_-
        return this.regex(
            /^[A-Za-z0-9_-]{21}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid Nanoid',
        );
    }

    cuid(): this {
        // CUID format: c + timestamp (base 36) + counter (base 36) + fingerprint + random (base 36)
        // Example: cjld2cjxh0000qzrmn831i7rn
        return this.regex(
            /^c[a-z0-9]{24}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid CUID',
        );
    }

    cuid2(): this {
        // CUID2 format: variable length, lowercase alphanumeric
        // Typically 24-32 characters
        return this.regex(
            /^[a-z][a-z0-9]{23,31}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid CUID2',
        );
    }

    ulid(): this {
        // ULID format: 26 characters using Crockford's base32 (0-9A-HJKMNP-TV-Z)
        return this.regex(
            /^[0-9A-HJKMNP-TV-Z]{26}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ULID',
        );
    }

    ipv4(): this {
        return this.regex(
            /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid IPv4 address',
        );
    }

    ipv6(): this {
        // IPv6 validation (supports compressed format)
        return this.regex(
            /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid IPv6 address',
        );
    }

    cidrv4(): this {
        return this.regex(
            /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}\/(3[0-2]|[12]?\d)$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid CIDR v4 notation',
        );
    }

    cidrv6(): this {
        // IPv6 CIDR notation
        return this.regex(
            /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8])$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid CIDR v6 notation',
        );
    }

    hash(algorithm: 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512'): this {
        const lengths: Record<string, number> = {
            md5: 32,
            sha1: 40,
            sha256: 64,
            sha384: 96,
            sha512: 128,
        };
        const expected = lengths[algorithm];
        this.push((val: string) => {
            if (!/^[0-9a-fA-F]+$/.test(val)) {
                throw verror(`"${val}" is not a valid hex string`);
            }
            if (val.length !== expected) {
                throw verror(`${algorithm} hash must be ${expected} characters, got ${val.length}`);
            }
            return val;
        });
        return this;
    }

    // ISO 8601 date format: YYYY-MM-DD
    isoDate(): this {
        return this.regex(
            /^\d{4}-\d{2}-\d{2}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 date (YYYY-MM-DD)',
        );
    }

    // ISO 8601 time format: HH:MM:SS or HH:MM:SS.sss
    isoTime(): this {
        return this.regex(
            /^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 time (HH:MM:SS)',
        );
    }

    // ISO 8601 datetime format: YYYY-MM-DDTHH:MM:SS.sssZ or with timezone offset
    isoDatetime(): this {
        return this.regex(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 datetime',
        );
    }

    // ISO 8601 duration format: P[n]Y[n]M[n]DT[n]H[n]M[n]S or P[n]W
    // Week format (P[n]W) cannot be combined with other date components
    // Must have at least one component (Y, M, D, W, H, M, or S)
    isoDuration(): this {
        return this.regex(
            /^P(?:\d+W|(?=\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?|(?:\d+Y)?(?:\d+M)?(?:\d+D)?T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 duration',
        );
    }
}

//
// --- Boolean Validator ---
//

class BoolV extends TypeV<boolean> {
    constructor() {
        super();
        // Add type coercion as the first validator
        // Uses JavaScript's native Boolean() coercion (same as Zod)
        this.push((val: unknown) => {
            return Boolean(val);
        });
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'boolean' };
    }
}

//
// --- BigInt Validator ---
//

class BigIntV extends TypeV<bigint> {
    constructor() {
        super();
        // Add type coercion as the first validator
        this.push((val: unknown) => {
            if (typeof val === 'bigint') return val;
            return BigInt(val as string | number | boolean | bigint);
        });
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'integer' };
    }

    gt(threshold: bigint): this {
        this._defs.exclusiveMinimum = Number(threshold);
        this.push((val: bigint) => {
            if (val <= threshold) {
                throw verror(`${val} > ${threshold}`);
            }
            return val;
        });
        return this;
    }

    gte(threshold: bigint): this {
        this._defs.minimum = Number(threshold);
        this.push((val: bigint) => {
            if (val < threshold) {
                throw verror(`${val} >= ${threshold}`);
            }
            return val;
        });
        return this;
    }

    lt(threshold: bigint): this {
        this._defs.exclusiveMaximum = Number(threshold);
        this.push((val: bigint) => {
            if (val >= threshold) {
                throw verror(`${val} < ${threshold}`);
            }
            return val;
        });
        return this;
    }

    lte(threshold: bigint): this {
        this._defs.maximum = Number(threshold);
        this.push((val: bigint) => {
            if (val > threshold) {
                throw verror(`${val} <= ${threshold}`);
            }
            return val;
        });
        return this;
    }

    min(min: bigint): this {
        return this.gte(min);
    }

    max(max: bigint): this {
        return this.lte(max);
    }

    positive(): this {
        return this.gt(0n);
    }

    negative(): this {
        return this.lt(0n);
    }

    nonnegative(): this {
        return this.gte(0n);
    }

    nonpositive(): this {
        return this.lte(0n);
    }

    multipleOf(divisor: bigint): this {
        this._defs.multipleOf = Number(divisor);
        this.push((val: bigint) => {
            if (val % divisor !== 0n) {
                throw verror(`${val} % ${divisor} !== 0`);
            }
            return val;
        });
        return this;
    }

    step(divisor: bigint): this {
        return this.multipleOf(divisor);
    }
}

//
// --- Date Validator ---
// Date can be ISO string or timestamp number.
//

class DateV extends TypeV<Date> {
    constructor() {
        super();
        this.push((val: unknown) => {
            // Direct Date instance
            if (val instanceof Date) {
                return val;
            }

            // String to Date
            if (typeof val === 'string') {
                if (val === '') {
                    throw new ValidatorError('Date string cannot be empty');
                }
                const d = new Date(val);
                if (!Number.isNaN(d.getTime())) {
                    return d;
                }
                throw verror(`"${val}" is not a valid date`);
            }

            // Number to Date (timestamp)
            if (typeof val === 'number') {
                if (!Number.isFinite(val) || val > 8640000000000000) {
                    throw verror(`${val} is not a valid timestamp`);
                }
                const d = new Date(val);
                if (!Number.isNaN(d.getTime())) {
                    return d;
                }
                throw verror(`${val} is not a valid timestamp`);
            }

            // Boolean to Date (true→1ms, false→0ms)
            if (typeof val === 'boolean') {
                return new Date(val ? 1 : 0);
            }

            // null to Date (epoch)
            if (val === null) {
                return new Date(0);
            }

            throw verror(`Expected date, got ${typeof val}`);
        });
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'string', format: 'date-time' };
    }
}

//
// --- Literal Validator ---
//

class LiteralV<T extends string | number | boolean | null | undefined> extends TypeV<T> {
    private _literal: T;

    constructor(literal: T) {
        super();
        this._literal = literal;

        // Add literal validation logic to checks
        this.push((val: unknown) => {
            if (val !== this._literal) {
                const format = (v: unknown) =>
                    v === null ? 'null' : v === undefined ? 'undefined' : typeof v === 'string' ? `"${v}"` : String(v);
                throw verror(`Expected literal ${format(this._literal)}, got ${format(val)}`);
            }
            return this._literal;
        });
    }

    override defs(): ValidatorDef {
        const value = this._literal;
        const type = typeof value;
        let rc: ValidatorDef = { ...super.defs(), value };

        do {
            if (type === 'string') {
                rc.type = 'string';
                rc.const = value;
                break;
            }
            if (type === 'number') {
                rc.type = 'number';
                rc.const = value;
                break;
            }
            if (type === 'boolean') {
                rc.type = 'boolean';
                rc.const = value;
                break;
            }
            if (type === 'bigint') {
                rc = { ...super.defs(), type: 'integer', const: Number(value), value };
                rc.type = 'integer';
                rc.const = Number(value);
                break;
            }
            if (value === null) {
                rc.type = 'null';
                break;
            }
            if (value === undefined) {
                break;
            }
            rc.const = value;
        } while (0);
        return rc;
    }
}

//
// --- Null/Unknown/Undefined Validators ---
//
class UnknownV extends TypeV<unknown> {
    constructor() {
        super();
        this.push((val: unknown) => val);
    }
}

class UndefinedV extends LiteralV<undefined> {
    constructor() {
        super(undefined);
    }
}

class VoidV extends LiteralV<undefined> {
    constructor() {
        super(undefined);
    }
}

class NullV extends LiteralV<null> {
    constructor() {
        super(null);
    }
}

class NanV extends TypeV<number> {
    constructor() {
        super();
        // NaN is special because NaN !== NaN, so we need custom logic
        this.push((val: unknown) => {
            if (!Number.isNaN(val)) {
                throw verror(`Expected NaN, got ${val}`);
            }
            return val as number;
        });
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), not: {}, description: 'Value must be NaN (not representable in JSON Schema)' };
    }
}

//
// --- Nullable Wrapper ---
//

class NullableV<T> extends TypeV<T | null> {
    constructor(inner: Validator<T>) {
        super();
        this._inner = inner;

        // Add nullable validation logic to checks
        this.push((value: unknown) => {
            if (value === null) {
                return null;
            }
            return this._inner!.parse(value) as T;
        });
    }

    override defs(props?: boolean): ValidatorDef {
        const baseDef = super.defs();
        const innerDef = this._inner!.defs(props);

        // If inner schema has additional properties (like items for arrays), use anyOf
        const isComposite = innerDef.items || innerDef.properties || innerDef.enum;

        if (isComposite) {
            // Don't include 'type' from baseDef when using anyOf (JSON Schema constraint)
            const result = { ...baseDef, anyOf: [innerDef, { type: 'null' as const }] };
            delete result.type;
            return result;
        }

        // For simple types, add null to type
        if (innerDef.type) {
            const types = Array.isArray(innerDef.type) ? innerDef.type : [innerDef.type];
            if (!types.includes('null')) {
                return {
                    ...baseDef,
                    ...innerDef,
                    type: [...types, 'null'],
                };
            }
        }

        // Fallback: use anyOf without 'type'
        const result = { ...baseDef, anyOf: [innerDef, { type: 'null' as const }] };
        delete result.type;
        return result;
    }
}

//
// --- Nullish Wrapper ---
//

class NullishV<T> extends TypeV<T | null | undefined> {
    constructor(inner: Validator<T>) {
        super();
        this._inner = inner;
        this.isOptional = true;

        // Add nullish validation logic to checks
        this.push((value: unknown) => {
            if (value === null || value === undefined) {
                return value as T | null | undefined;
            }
            return this._inner!.parse(value) as T | null | undefined;
        });
    }

    override defs(props?: boolean): ValidatorDef {
        const baseDef = super.defs();
        const innerDef = this._inner!.defs(props);

        // Nullish is null or undefined - in JSON Schema, we just treat it as nullable
        // If inner schema has additional properties (like items for arrays), use anyOf
        const isComplex = innerDef.items || innerDef.properties || innerDef.enum;

        if (isComplex) {
            // Don't include 'type' from baseDef when using anyOf (JSON Schema constraint)
            const result = { ...baseDef, anyOf: [innerDef, { type: 'null' as const }] };
            delete result.type;
            return result;
        }

        // For simple types, add null to type
        if (innerDef.type) {
            const types = Array.isArray(innerDef.type) ? innerDef.type : [innerDef.type];
            if (!types.includes('null')) {
                return {
                    ...baseDef,
                    ...innerDef,
                    type: [...types, 'null'],
                };
            }
        }

        // Fallback: use anyOf without 'type'
        const result = { ...baseDef, anyOf: [innerDef, { type: 'null' as const }] };
        delete result.type;
        return result;
    }
}

//
// --- Object Validator ---
//

// Helper type to extract keys of optional validators
type OptionalKeys<S extends Schema> = {
    [K in keyof S]: S[K] extends Validator<infer U> ? (undefined extends U ? K : never) : never;
}[keyof S];

// Helper type to extract keys of required validators
type RequiredKeys<S extends Schema> = Exclude<keyof S, OptionalKeys<S>>;

// Force TypeScript to evaluate and simplify the object type
type SimplifyObject<T> = { [K in keyof T]: T[K] };

// Object type with proper optional/required handling
type InferObject<S extends Schema> = SimplifyObject<
    {
        [K in RequiredKeys<S>]: S[K] extends Validator<infer U> ? U : never;
    } & {
        [K in OptionalKeys<S>]?: S[K] extends Validator<infer U> ? U : never;
    }
>;

export class ObjV<S extends Schema = Schema> extends TypeV<InferObject<S>> {
    private _schema: S;
    protected _strict = false;
    protected _loose = false;

    constructor(schema: Schema = {}) {
        super();
        this._schema = schema as S;
        // Add type coercion and validation in one validator
        type InferredType = InferObject<S>;
        this.push((val: unknown) => {
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                // If no schema, just return the object as-is
                if (Object.keys(this._schema).length === 0) {
                    return val as InferredType;
                }

                const rec = val as Record<string, unknown>;

                // Strict mode: reject unknown keys
                if (this._strict) {
                    const schemaKeys = Object.keys(this._schema);
                    const inputKeys = Object.keys(rec);
                    const unknownKeys = inputKeys.filter((k) => !schemaKeys.includes(k));
                    if (unknownKeys.length > 0) {
                        throw verror(`Unknown keys in strict mode: ${unknownKeys.join(', ')}`);
                    }
                }

                // Validate nested fields directly here - each validator's parse will throw if validation fails
                const result: Record<string, unknown> = {};
                for (const key of Object.keys(this._schema)) {
                    const fieldValidator = this._schema[key];
                    const fieldValue = rec[key];

                    // Check if field is optional
                    const isOptional =
                        fieldValidator &&
                        typeof fieldValidator === 'object' &&
                        'isOptional' in fieldValidator &&
                        fieldValidator.isOptional;

                    // If field is missing and required, throw error
                    if (fieldValue === undefined && !isOptional) {
                        throw verror(`Missing required field: ${key}`);
                    }

                    // If field is present, validate it (even if undefined but optional)
                    if (fieldValue !== undefined) {
                        // Call the validator's parse method
                        if (fieldValidator && typeof fieldValidator === 'object' && 'parse' in fieldValidator) {
                            result[key] = (fieldValidator as Validator<unknown>).parse(fieldValue);
                        } else {
                            result[key] = fieldValue;
                        }
                    }
                    // If field is undefined and optional, don't include it in result (or set to undefined)
                    // This matches the expected behavior where optional fields can be omitted
                }

                // Passthrough mode: include unknown keys
                if (this._loose) {
                    const schemaKeys = Object.keys(this._schema);
                    for (const key of Object.keys(rec)) {
                        if (!schemaKeys.includes(key)) {
                            result[key] = rec[key];
                        }
                    }
                }

                return result as InferredType;
            }
            throw verror(`Expected object, got ${typeof val}`);
        });
    }

    keyof(): UnionV<string> {
        const keys = Object.keys(this._schema);
        if (keys.length === 0) {
            throw verror('Cannot get keyof from object with no schema');
        }
        const literals = keys.map((k) => new LiteralV(k));
        return new UnionV<string>(literals);
    }

    strict(): this {
        this._strict = true;
        this._loose = false;
        return this;
    }

    passthrough(): this {
        this._loose = true;
        this._strict = false;
        return this;
    }

    strip(): this {
        this._strict = false;
        this._loose = false;
        return this;
    }

    extend(additionalSchema: Schema): ObjV {
        const merged = { ...this._schema, ...additionalSchema };
        const extended = new ObjV(merged);

        // Preserve strict/loose mode from current instance
        if (this._strict) {
            extended.strict();
        } else if (this._loose) {
            extended.passthrough();
        }

        // Preserve validators from original instance (e.g., minProperties, maxProperties, custom refinements)
        // Skip the first validator which is the object type coercion/validation
        for (let i = 1; i < this._checks.length; i++) {
            extended._checks.push(this._checks[i] as never);
        }

        // Preserve metadata (defs)
        extended._defs = { ...this._defs };

        return extended;
    }

    // BC for zod3
    merge = this.extend;

    minProperties(min: number): this {
        this._defs.minProperties = min;
        type InferredType = InferObject<S>;
        this.push((val: InferredType) => {
            const propCount = Object.keys(val as object).length;
            if (propCount < min) {
                throw verror(`Object must have at least ${min} properties, got ${propCount}`);
            }
            return val;
        });
        return this;
    }

    maxProperties(max: number): this {
        this._defs.maxProperties = max;
        type InferredType = InferObject<S>;
        this.push((val: InferredType) => {
            const propCount = Object.keys(val as object).length;
            if (propCount > max) {
                throw verror(`Object must have at most ${max} properties, got ${propCount}`);
            }
            return val;
        });
        return this;
    }

    override defs(props = false): ValidatorDef {
        const baseDef = super.defs();
        const properties: Record<string, ValidatorDef> = {};
        const required: string[] = [];

        const schema = this._schema;
        if (schema) {
            for (const [key, fieldValidator] of Object.entries(schema)) {
                properties[key] = fieldValidator.defs(props);
                // Mark required fields (those without isOptional flag)
                if (!fieldValidator.isOptional) {
                    required.push(key);
                }
            }
        }

        // Set additionalPropsValue based on validator and context
        if (this._strict) {
            props = false;
        }

        return {
            ...baseDef,
            type: 'object',
            properties: properties,
            required: required,
            additionalProperties: props,
        };
    }

    get schema(): Schema {
        return this._schema;
    }
}

//
// --- Array Validator ---
//

class ArrV extends TypeV<Array<unknown>> {
    constructor(item?: Validator) {
        super();
        this._inner = item;
        // Add type coercion as the first validator
        this.push((val: unknown) => {
            if (!Array.isArray(val)) {
                throw verror(`Expected array, got ${typeof val}`);
            }
            if (this._inner) {
                return val.map((item) => this._inner!.parse(item));
            }
            return val;
        });
    }

    override defs(props = false): ValidatorDef {
        const baseDef = super.defs();
        const schema: Partial<ValidatorDef> = { type: 'array' };

        if (this._inner) {
            schema.items = this._inner.defs(props);
        }

        return { ...baseDef, ...schema };
    }

    minLength(min: number): this {
        this._defs.minItems = min;
        this.push((val: Array<unknown>) => {
            if (val.length < min) {
                throw verror(`${val.length} >= ${min}`);
            }
            return val;
        });
        return this;
    }

    maxLength(max: number): this {
        this._defs.maxItems = max;
        this.push((val: Array<unknown>) => {
            if (val.length > max) {
                throw verror(`${val.length} <= ${max}`);
            }
            return val;
        });
        return this;
    }

    length(len: number): this {
        this.push((val: Array<unknown>) => {
            if (val.length !== len) {
                throw verror(`${val.length} === ${len}`);
            }
            return val;
        });
        return this;
    }

    nonempty(): this {
        this.push((val: Array<unknown>) => {
            if (val.length === 0) {
                throw verror('Array must not be empty');
            }
            return val;
        });
        return this;
    }
}

//
// --- Set Validator ---
//

class SetV extends TypeV<Set<unknown>> {
    constructor(item?: Validator) {
        super();
        this._inner = item;
        // Add type coercion as the first validator
        this.push((val: unknown) => {
            if (val instanceof Set) {
                return val;
            }
            if (Array.isArray(val)) {
                const set = new Set<unknown>();
                for (const item of val) {
                    const validated = this._inner ? this._inner.parse(item) : item;
                    set.add(validated);
                }
                return set;
            }
            throw verror(`Expected Set or array, got ${typeof val}`);
        });
    }

    override defs(props = false): ValidatorDef {
        const baseDef = super.defs();
        const schema: Partial<ValidatorDef> = { type: 'array', uniqueItems: true };

        if (this._inner) {
            schema.items = this._inner.defs(props);
        }

        return { ...baseDef, ...schema };
    }
}

//
// --- Map Validator ---
//

class MapV<V = unknown> extends TypeV<Map<string, V>> {
    constructor(value?: Validator<V>) {
        super();
        this._inner = value;
        // Add type coercion as the first validator - converts to Map
        this.push((val: unknown) => {
            if (val instanceof Map) {
                const result = new Map<string, V>();
                for (const [k, v] of val.entries()) {
                    result.set(k, (this._inner ? this._inner.parse(v) : v) as V);
                }
                return result;
            }
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                const result = new Map<string, V>();
                for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
                    result.set(k, (this._inner ? this._inner.parse(v) : v) as V);
                }
                return result;
            }
            throw verror(`Expected Map or object, got ${typeof val}`);
        });
    }

    override defs(props = false): ValidatorDef {
        const baseDef = super.defs();
        const schema: Partial<ValidatorDef> = { type: 'object' };

        if (this._inner) {
            schema.additionalProperties = this._inner.defs(props);
        } else {
            schema.additionalProperties = true;
        }

        return { ...baseDef, ...schema };
    }
}

//
// --- Union Validator ---
//

class UnionV<T> extends TypeV<T> {
    private _union: readonly Validator[];

    constructor(validators: readonly Validator[]) {
        super();
        if (!validators || validators.length < 2) {
            throw verror('Union requires at least 2 validators');
        }
        this._union = validators;

        // Add union validation logic to the checks array
        this.push((value: unknown) => {
            const errors: string[] = [];

            // Try each validator in order (first-match strategy)
            for (const validator of this._union) {
                try {
                    const result = validator.parse(value);
                    return result as T;
                } catch (err) {
                    // Collect error message
                    errors.push((err as Error).message);
                }
            }

            // All validators failed - throw with aggregate error
            throw verror(`Value does not match any union member:\n${errors.map((e, i) => `  [${i}] ${e}`).join('\n')}`);
        });
    }

    override defs(props = false): ValidatorDef {
        const baseDef = super.defs();
        const validators = this._union;

        if (!validators || validators.length === 0) {
            return baseDef;
        }

        // Convert each validator to JSON Schema
        const anyOfSchemas: ValidatorDef[] = validators.map((v) => v.defs(props)).filter((s) => Object.keys(s).length > 0);

        if (anyOfSchemas.length === 0) {
            return baseDef;
        }

        // Check if all schemas are simple primitives - only consider JSON Schema properties, not ValidatorDef metadata
        const allPrimitives = anyOfSchemas.every((s) => {
            const jsonSchemaKeys = Object.keys(s).filter(
                (k) =>
                    // Exclude ValidatorDef-specific properties (only 'value' now after removing typeName)
                    k !== 'value' && k !== 'description',
            );
            return s.type && typeof s.type === 'string' && jsonSchemaKeys.length === 1 && jsonSchemaKeys[0] === 'type';
        });

        if (allPrimitives) {
            // Extract unique primitive types
            const types = Array.from(new Set(anyOfSchemas.map((s) => s.type as PrimitiveType)));
            return {
                ...baseDef,
                type: types.length === 1 ? types[0] : types,
            };
        }

        // Return anyOf for complex unions - don't include 'type' from baseDef (JSON Schema constraint)
        const result = { ...baseDef, anyOf: anyOfSchemas };
        delete result.type;
        return result;
    }
}

// --- Enum Validator is a Union of literals --
class EnumV<T> extends UnionV<T> {
    constructor(values: readonly (string | number | boolean)[]) {
        super(values.map((v) => literal(v)));
    }
}

// Zod-compatible optional: makes any validator accept undefined
// Legacy optional: creates an optional loose object (backward compatibility)
export function optional<T>(validator: Validator<T>): Validator<T | undefined>;
export function optional(schema?: Schema): ObjV;
export function optional<T>(validatorOrSchema?: Validator<T> | Schema): Validator<T | undefined> {
    // Check if it's a ValueValidator by checking for push method (ValueValidator-specific)
    if (
        validatorOrSchema &&
        typeof validatorOrSchema === 'object' &&
        'push' in validatorOrSchema &&
        typeof validatorOrSchema.push === 'function'
    ) {
        return (validatorOrSchema as Validator<T>).optional();
    }
    // Otherwise, treat as Schema (plain object) - use legacy behavior: create optional loose object
    return new ObjV(validatorOrSchema as Schema).passthrough().optional() as Validator<T | undefined>;
}

//
// --- Exports and Utility Functions ---
//

export type Schema = Record<string, Validator>;
export const array = (item?: Validator) => new ArrV(item);
export const bigint = () => new BigIntV();
export const boolean = () => new BoolV();
export const date = () => new DateV();
export const email = () => new StrV().email();
export const int = () => new NumV().int();
export const literal = <T extends string | number | boolean | null | undefined>(value: T) => new LiteralV(value);
export const map = (value?: Validator) => new MapV(value);
export const nullable = <T>(validator: Validator<T>) => new NullableV(validator);
export const nullish = <T>(validator: Validator<T>) => new NullishV(validator);
export const number = () => new NumV();
export const object = <S extends Schema>(schema?: S) => new ObjV<S>(schema as S);
export const strictObject = <S extends Schema>(schema?: S) => new ObjV<S>(schema as S).strict();
export const looseObject = <S extends Schema>(schema?: S) => new ObjV<S>(schema as S).passthrough();
export const record = <V>(value?: Validator<V>) => new MapV<V>(value);
export const unknown = () => new UnknownV();
export const set = (item?: Validator) => new SetV(item);
export const string = () => new StrV();
export const enumeration = <T extends readonly (string | number | boolean)[]>(values: T) => new EnumV<T[number]>(values);

// Static singleton instances for stateless validators
const NAN_VALIDATOR = new NanV();
const NULL_VALIDATOR = new NullV();
const UNDEFINED_VALIDATOR = new UndefinedV();
const VOID_VALIDATOR = new VoidV();
export const nan = () => NAN_VALIDATOR;
export const nullVal = () => NULL_VALIDATOR;
export const undefinedVal = () => UNDEFINED_VALIDATOR;
export const voidVal = () => VOID_VALIDATOR;

// shorthands
export const uuid = () => new StrV().uuid();
export const url = () => new StrV().url();
export const httpUrl = () => new StrV().httpUrl();
export const hostname = () => new StrV().hostname();
export const emoji = () => new StrV().emoji();
export const base64 = () => new StrV().base64();
export const base64url = () => new StrV().base64url();
export const hex = () => new StrV().hex();
export const jwt = () => new StrV().jwt();
export const nanoid = () => new StrV().nanoid();
export const cuid = () => new StrV().cuid();
export const cuid2 = () => new StrV().cuid2();
export const ulid = () => new StrV().ulid();
export const ipv4 = () => new StrV().ipv4();
export const ipv6 = () => new StrV().ipv6();
export const cidrv4 = () => new StrV().cidrv4();
export const cidrv6 = () => new StrV().cidrv6();
export const hash = (algorithm: 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512') => new StrV().hash(algorithm);

export const isoDate = () => new StrV().isoDate();
export const isoTime = () => new StrV().isoTime();
export const isoDatetime = () => new StrV().isoDatetime();
export const isoDuration = () => new StrV().isoDuration();

// Helper to simplify extracted union types
type ExtractTypes<T extends readonly Validator[]> = T[number] extends Validator<infer U>
    ? U extends object
        ? { [K in keyof U]: U[K] }
        : U
    : never;

export const union = <T extends readonly [Validator, Validator, ...Validator[]]>(validators: T) =>
    new UnionV<ExtractTypes<T>>(validators);

export function parseSchema<T extends Record<string, unknown>>(validator: Schema, obj: unknown): T | undefined {
    // Return undefined for non-object inputs
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
        return undefined;
    }
    return object(validator).parse(obj) as T;
}

// Safe parse utility: note the return type here is aligned with safe.ts, not with zod's.
export function safeParse<T = unknown>(validator: Schema | TypeV<T>, value: unknown): [T | undefined, Error | undefined] {
    try {
        // Check if validator is a TypeV instance (like UnionV, ObjV, etc.)
        if (validator && typeof validator === 'object' && 'parse' in validator && typeof validator.parse === 'function') {
            return [validator.parse(value) as T, undefined];
        }
        // Otherwise, treat as Schema object and delegate to parseSchema
        return [parseSchema(validator as Schema, value) as T, undefined];
    } catch (err) {
        return [undefined, err instanceof Error ? err : new Error(Object(err).message ?? String(err))];
    }
}

/**
 * Alias for backward compatibility - parse does the same as parseSchema
 */
export const parse = parseSchema;

/**
 * Type helper to infer TypeScript types from validator schemas
 * Re-exported from provider for convenience
 */
export type { Infer } from './provider';
