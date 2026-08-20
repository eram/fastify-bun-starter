/**
 * Core Validation Library — Functional validator implementations
 *
 * Provides the functional validator API (string(), number(), object(), array(), etc.)
 * plus the shared types, error classes, and format patterns used by both this module
 * and the decorator system (zody.ts, which builds its schemas from these same nodes).
 * First call compiles a fast path and replaces schema.validate with it.
 *
 * @example
 * const schema = object({ name: string().min(3), age: number().gte(0) });
 * schema.validate({ name: 'Alice', age: 25 });
 *
 */

import { ErrorEx } from '@libs/utils/error';
import {
    arrayOfCheck,
    buildToFunction,
    type CodegenCtx,
    comparison,
    isArrayCheck,
    isCodeGenEnabled,
    isFiniteCheck,
    isIntegerCheck,
    isPlainObjectCheck,
    lengthCheck,
    numberCoercible,
    type ObjectShapeField,
    objectShapeCheck,
    regexTest,
} from './codegen';

//
// --- Shared Types ---
//

// JSON Schema primitive types
type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

// Validator metadata for JSON schema conversion
export interface ValidatorDef {
    description?: string;
    value?: unknown;
    default?: unknown;
    examples?: string[];
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

// Format Validation Patterns
const PATTERNS = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    url: /^(https?|ftp):\/\/.+/i,
    httpUrl: /^https?:\/\/.+/i,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    hostname: /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/,
    ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
    ipv6: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/,
    jwt: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    base64: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    hex: /^[0-9a-fA-F]*$/,
} as const;

// SafeParse result types (Zod-compatible)
type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseError = { success: false; error: Error };
export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseError;

// Validator interface
export interface Validator<T = unknown> {
    parse(value: unknown): T;
    push(check: (arg: T) => T, gen: (ctx: CodegenCtx, expr: string) => string): number;
    clear(): void;
    isOptional?: boolean;
    describe(description: string): this;
    examples(...examples: string[]): this;
    defs(props?: boolean): ValidatorDef;
    optional(): Validator<T | undefined>;
    default(val: T): this;
    safeParse(value: unknown): SafeParseResult<T>;
    // Boolean validity check. Non-root nodes just wrap parse(); the schema root
    // (ObjV) self-replaces this with a codegen'd fast path on first call.
    validate(value: unknown): boolean;
    // Emits a boolean JS expression testing `expr`, composed bottom-up by parent nodes.
    codegen(ctx: CodegenCtx, expr: string): string;
    // Freezes this validator (and any nested validators it owns) immutable — called
    // once, recursively, by the schema root when it compiles a fast validate() path.
    freeze(): void;
}

//
// --- Error Classes ---
//

export class ValidatorError extends ErrorEx {}
export const verror = (str: string) => new ValidatorError(str);

//
// --- Base Validator Class ---
//

type CheckEntry<T> = { check: (val: T) => T; gen: (ctx: CodegenCtx, expr: string) => string };

export abstract class TypeV<T> implements Validator<T> {
    protected _entries: Array<CheckEntry<T>> = [];
    public isOptional = false; // Track if optional() was called (runtime flag for parse optimization)
    protected _inner?: Validator; // Optional inner validator for composite types
    protected _defs: Partial<ValidatorDef> = {}; // Track constraint metadata for schema generation

    // Object.isFrozen(this) doubles as the "may this be mutated?" flag, so there's
    // nothing to keep in sync — a mutation path that forgets to call
    // _assertMutable() still fails, since _entries/_defs are frozen too.
    protected _assertMutable(): void {
        if (Object.isFrozen(this)) {
            throw verror('Cannot modify a validator schema after validate() has compiled it');
        }
    }

    /** Freezes this validator (and any nested validators it owns) immutable. Called once, by the schema root, on first validate(). */
    freeze(): void {
        // _defs is deliberately left unfrozen: it's JSON-Schema/description metadata,
        // not consumed by parse()/codegen(), and several constraint methods (e.g.
        // minProperties) write to it before calling push() — freezing it would make
        // those throw a raw native error instead of _assertMutable()'s message.
        Object.freeze(this._entries);
        Object.freeze(this);
    }

    defs(_props?: boolean): ValidatorDef {
        return { ...this._defs };
    }

    parse(value: unknown): T {
        // Fast path for validators with no additional constraints
        if (this._entries.length === 0) {
            return value as T;
        }

        // Fast path for single validator
        if (this._entries.length === 1) {
            return this._entries[0]!.check(value as T);
        }

        // Multiple validators - apply in sequence
        let processed: T = value as T;
        for (let i = 0; i < this._entries.length; i++) {
            processed = this._entries[i]!.check(processed);
            // Short-circuit if optional validator returns undefined
            // (this prevents further coercion of undefined values)
            if (this.isOptional && processed === undefined && i === 0) {
                return processed;
            }
        }
        return processed;
    }

    push(check: (val: T) => T, gen: (ctx: CodegenCtx, expr: string) => string): number {
        this._assertMutable();
        return this._entries.push({ check, gen });
    }

    clear() {
        this._assertMutable();
        this._entries.length = 0;
    }

    optional(): TypeV<T | undefined> {
        this._assertMutable();
        this.isOptional = true;
        this._entries.splice(0, 0, {
            check: (val: unknown) => {
                if (val === undefined || val === null || val === '') {
                    return undefined as T;
                }
                return val as T;
            },
            gen: (_ctx, expr) => `(${expr} === undefined || ${expr} === null || ${expr} === '' || true)`,
        });
        return this as TypeV<T | undefined>;
    }

    default(val: T): this {
        this._assertMutable();
        this.isOptional = true;
        this._defs.default = val;
        this._entries.splice(0, 0, {
            check: (v: unknown) => {
                if (v === undefined || v === null) {
                    return val;
                }
                return v as T;
            },
            gen: () => 'true',
        });
        return this;
    }

    describe(description: string): this {
        this._defs.description = description;
        return this;
    }

    description = this.describe;

    examples(...examples: string[]): this {
        this._defs.examples = examples;
        return this;
    }

    safeParse(value: unknown): SafeParseResult<T> {
        try {
            return { success: true, data: this.parse(value) as T };
        } catch (error) {
            return { success: false, error: error as Error };
        }
    }

    // Plain boolean validity check — wraps parse(). Only the schema root (ObjV)
    // overrides this to self-replace with a codegen'd fast path.
    validate(input: unknown): boolean {
        try {
            this.parse(input);
            return true;
        } catch {
            return false;
        }
    }

    // Default codegen: AND together every pushed entry's fragment, in push order —
    // mirrors what parse() does with `_entries`. Container types (ObjV/ArrV/UnionV/
    // NullableV/NullishV) override this to inline their structural checks and
    // recurse into children's own codegen instead.
    codegen(ctx: CodegenCtx, expr: string): string {
        if (this._entries.length === 0) return 'true';
        return `(${this._entries.map((entry) => `(${entry.gen(ctx, expr)})`).join(' && ')})`;
    }
}

//
// --- Number Validator ---
//

class NumV extends TypeV<number> {
    constructor() {
        super();
        this.push(
            (val: unknown) => {
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
            },
            (_ctx, expr) => numberCoercible(expr),
        );
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'number' };
    }

    int(): this {
        this.push(
            (val: number) => {
                if (!Number.isInteger(val)) {
                    throw verror(`${val} is not integer`);
                }
                return val;
            },
            (_ctx, expr) => isIntegerCheck(expr),
        );
        return this;
    }

    float(): this {
        this.push(
            (val: number) => {
                if (!Number.isFinite(val)) {
                    throw verror(`${val} is not finite`);
                }
                return val;
            },
            (_ctx, expr) => isFiniteCheck(expr),
        );
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
        this.push(
            (val: number) => {
                if (val < min) {
                    throw verror(`${val} >= ${min}`);
                }
                return val;
            },
            (ctx, expr) => comparison(ctx, expr, 'gte', min),
        );
        return this;
    }

    lte(max: number): this {
        this._defs.maximum = max;
        this.push(
            (val: number) => {
                if (val > max) {
                    throw verror(`${val} smaller than expected (${max})`);
                }
                return val;
            },
            (ctx, expr) => comparison(ctx, expr, 'lte', max),
        );
        return this;
    }

    gt(value: number): this {
        this._defs.exclusiveMinimum = value;
        this.push(
            (val: number) => {
                if (val <= value) {
                    throw verror(`${val} equal or larger than expected (${value})`);
                }
                return val;
            },
            (ctx, expr) => comparison(ctx, expr, 'gt', value),
        );
        return this;
    }

    lt(value: number): this {
        this._defs.exclusiveMaximum = value;
        this.push(
            (val: number) => {
                if (val >= value) {
                    throw verror(`${val} equal or smaller than expected (${value})`);
                }
                return val;
            },
            (ctx, expr) => comparison(ctx, expr, 'lt', value),
        );
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
        this.push(
            (val: number) => {
                if (val % divisor !== 0) {
                    throw verror(`${val} undevided by ${divisor}`);
                }
                return val;
            },
            (ctx, expr) => `(Number(${expr}) % ${ctx.addConst(divisor)} === 0)`,
        );
        return this;
    }

    step(divisor: number): this {
        return this.multipleOf(divisor);
    }

    range(min: number, max: number): this {
        return this.min(min).max(max);
    }

    finite(): this {
        this.push(
            (val: number) => {
                if (!Number.isFinite(val)) {
                    throw verror(`${val} is not finite`);
                }
                return val;
            },
            (_ctx, expr) => isFiniteCheck(expr),
        );
        return this;
    }

    safe(): this {
        this.push(
            (val: number) => {
                if (!Number.isSafeInteger(val)) {
                    throw verror(`${val} is not a safe integer`);
                }
                return val;
            },
            (_ctx, expr) => `Number.isSafeInteger(Number(${expr}))`,
        );
        return this;
    }
}

//
// --- String Validator ---
//

export class StrV extends TypeV<string> {
    constructor() {
        super();
        this.push(
            (val: unknown) => {
                // Fast path: Value is already a string
                if (typeof val === 'string') {
                    return val;
                }
                // Coerce to string using native String() conversion
                return String(val);
            },
            () => 'true',
        );
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'string' };
    }

    // Validation methods
    min(min: number): this {
        this._defs.minLength = min;
        this.push(
            (val: string) => {
                if (val.length < min) {
                    throw verror(`Must be at least ${min} characters long`);
                }
                return val;
            },
            (ctx, expr) => lengthCheck(ctx, `String(${expr})`, 'min', min),
        );
        return this;
    }

    max(max: number): this {
        this._defs.maxLength = max;
        this.push(
            (val: string) => {
                if (val.length > max) {
                    throw verror(`Must be at most ${max} characters long`);
                }
                return val;
            },
            (ctx, expr) => lengthCheck(ctx, `String(${expr})`, 'max', max),
        );
        return this;
    }

    regex(pattern: RegExp, msg?: string): this {
        this._defs.pattern = pattern.source;
        this.push(
            (val: string) => {
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
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, pattern),
        );
        return this;
    }

    email(): this {
        this._defs.format = 'email';
        this._defs.examples = ['user@example.com'];
        this.push(
            (val: string) => {
                if (!testFormat(val, 'email')) throw verror(`"${val}" is not a valid email address`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.email),
        );
        return this;
    }

    length(len: number): this {
        this.push(
            (val: string) => {
                if (val.length !== len) {
                    throw verror(`${val.length} === ${len}`);
                }
                return val;
            },
            (ctx, expr) => lengthCheck(ctx, `String(${expr})`, 'eq', len),
        );
        return this;
    }

    startsWith(prefix: string): this {
        this.push(
            (val: string) => {
                if (!val.startsWith(prefix)) {
                    throw verror(`"${val}" must start with "${prefix}"`);
                }
                return val;
            },
            (ctx, expr) => `String(${expr}).startsWith(${ctx.addConst(prefix)})`,
        );
        return this;
    }

    endsWith(suffix: string): this {
        this.push(
            (val: string) => {
                if (!val.endsWith(suffix)) {
                    throw verror(`"${val}" must end with "${suffix}"`);
                }
                return val;
            },
            (ctx, expr) => `String(${expr}).endsWith(${ctx.addConst(suffix)})`,
        );
        return this;
    }

    includes(substring: string): this {
        this.push(
            (val: string) => {
                if (!val.includes(substring)) {
                    throw verror(`"${val}" must include "${substring}"`);
                }
                return val;
            },
            (ctx, expr) => `String(${expr}).includes(${ctx.addConst(substring)})`,
        );
        return this;
    }

    uppercase(): this {
        this.push(
            (val: string) => {
                if (val !== val.toUpperCase()) {
                    throw verror(`"${val}" must be uppercase`);
                }
                return val;
            },
            (_ctx, expr) => `(String(${expr}) === String(${expr}).toUpperCase())`,
        );
        return this;
    }

    lowercase(): this {
        this.push(
            (val: string) => {
                if (val !== val.toLowerCase()) {
                    throw verror(`"${val}" must be lowercase`);
                }
                return val;
            },
            (_ctx, expr) => `(String(${expr}) === String(${expr}).toLowerCase())`,
        );
        return this;
    }

    // Transform methods — mutate the parsed value but never fail validity.
    trim(): this {
        this.push(
            (val: string) => val.trim(),
            () => 'true',
        );
        return this;
    }

    toLowerCase(): this {
        this.push(
            (val: string) => val.toLowerCase(),
            () => 'true',
        );
        return this;
    }

    toUpperCase(): this {
        this.push(
            (val: string) => val.toUpperCase(),
            () => 'true',
        );
        return this;
    }

    normalize(form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' = 'NFC'): this {
        this.push(
            (val: string) => val.normalize(form),
            () => 'true',
        );
        return this;
    }

    // String format validators
    uuid(): this {
        this._defs.format = 'uuid';
        this._defs.examples = ['123e4567-e89b-12d3-a456-426614174000'];
        this.push(
            (val: string) => {
                if (!testFormat(val, 'uuid')) throw verror(`"${val}" is not a valid UUID`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.uuid),
        );
        return this;
    }

    url(): this {
        this._defs.format = 'uri';
        this._defs.examples = ['https://example.com'];
        this.push(
            (val: string) => {
                if (!testFormat(val, 'url')) throw verror(`"${val}" is not a valid URL`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.url),
        );
        return this;
    }

    httpUrl(): this {
        this.push(
            (val: string) => {
                if (!testFormat(val, 'httpUrl')) throw verror(`"${val}" is not a valid HTTP(S) URL`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.httpUrl),
        );
        return this;
    }

    hostname(): this {
        this._defs.format = 'hostname';
        this._defs.examples = ['example.com', 'api.github.com'];
        this.push(
            (val: string) => {
                if (!testFormat(val, 'hostname')) throw verror(`"${val}" is not a valid hostname`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.hostname),
        );
        return this;
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
        this.push(
            (val: string) => {
                if (!testFormat(val, 'base64')) throw verror(`"${val}" is not valid base64`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.base64),
        );
        return this;
    }

    base64url(): this {
        return this.regex(
            /^[A-Za-z0-9_-]*$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not valid base64url',
        );
    }

    hex(): this {
        this.push(
            (val: string) => {
                if (!testFormat(val, 'hex')) throw verror(`"${val}" is not valid hexadecimal`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.hex),
        );
        return this;
    }

    jwt(): this {
        this.push(
            (val: string) => {
                if (!testFormat(val, 'jwt')) throw verror(`"${val}" is not a valid JWT token`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.jwt),
        );
        return this;
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
        this._defs.format = 'ipv4';
        this._defs.examples = ['192.168.1.1', '10.0.0.1'];
        this.push(
            (val: string) => {
                if (!testFormat(val, 'ipv4')) throw verror(`"${val}" is not a valid IPv4 address`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.ipv4),
        );
        return this;
    }

    ipv6(): this {
        this._defs.format = 'ipv6';
        this._defs.examples = ['2001:0db8:85a3::8a2e:0370:7334', '::1'];
        this.push(
            (val: string) => {
                if (!testFormat(val, 'ipv6')) throw verror(`"${val}" is not a valid IPv6 address`);
                return val;
            },
            (ctx, expr) => regexTest(ctx, `String(${expr})`, PATTERNS.ipv6),
        );
        return this;
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
        this.push(
            (val: string) => {
                if (!/^[0-9a-fA-F]+$/.test(val)) {
                    throw verror(`"${val}" is not a valid hex string`);
                }
                if (val.length !== expected) {
                    throw verror(`${algorithm} hash must be ${expected} characters, got ${val.length}`);
                }
                return val;
            },
            (ctx, expr) => {
                const strExpr = `String(${expr})`;
                return `(${regexTest(ctx, strExpr, /^[0-9a-fA-F]+$/)} && ${lengthCheck(ctx, strExpr, 'eq', expected!)})`;
            },
        );
        return this;
    }

    // ISO 8601 date format: YYYY-MM-DD
    isoDate(): this {
        this._defs.format = 'date';
        this._defs.examples = ['2024-01-15', '2025-12-31'];
        return this.regex(
            /^\d{4}-\d{2}-\d{2}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 date (YYYY-MM-DD)',
        );
    }

    // ISO 8601 time format: HH:MM:SS or HH:MM:SS.sss
    isoTime(): this {
        this._defs.format = 'time';
        this._defs.examples = ['14:30:00', '09:15:30.123'];
        return this.regex(
            /^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 time (HH:MM:SS)',
        );
    }

    // ISO 8601 datetime format: YYYY-MM-DDTHH:MM:SS.sssZ or with timezone offset
    isoDatetime(): this {
        this._defs.format = 'date-time';
        this._defs.examples = ['2024-01-15T14:30:00Z', '2024-01-15T14:30:00+05:30'];
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
        this._defs.format = 'duration';
        this._defs.examples = ['P1Y2M3DT4H5M6S', 'PT1H30M', 'P3W'];
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
        this.push(
            (val: unknown) => {
                return Boolean(val);
            },
            () => 'true',
        );
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'boolean' };
    }
}

//
// --- BigInt Validator ---
//

function bigintCoercibleCheck(expr: string): string {
    return `(function () { try { BigInt(${expr}); return true; } catch { return false; } })()`;
}

class BigIntV extends TypeV<bigint> {
    constructor() {
        super();
        // Add type coercion as the first validator
        this.push(
            (val: unknown) => {
                if (typeof val === 'bigint') return val;
                return BigInt(val as string | number | boolean | bigint);
            },
            (_ctx, expr) => bigintCoercibleCheck(expr),
        );
    }

    override defs(): ValidatorDef {
        return { ...super.defs(), type: 'integer' };
    }

    gt(threshold: bigint): this {
        this._defs.exclusiveMinimum = Number(threshold);
        this.push(
            (val: bigint) => {
                if (val <= threshold) {
                    throw verror(`${val} equal or smaller than expected (${threshold})`);
                }
                return val;
            },
            (ctx, expr) => comparison(ctx, expr, 'gt', threshold),
        );
        return this;
    }

    gte(threshold: bigint): this {
        this._defs.minimum = Number(threshold);
        this.push(
            (val: bigint) => {
                if (val < threshold) {
                    throw verror(`${val} smaller than expected (${threshold})`);
                }
                return val;
            },
            (ctx, expr) => comparison(ctx, expr, 'gte', threshold),
        );
        return this;
    }

    lt(threshold: bigint): this {
        this._defs.exclusiveMaximum = Number(threshold);
        this.push(
            (val: bigint) => {
                if (val >= threshold) {
                    throw verror(`${val} equal or larger than expected (${threshold})`);
                }
                return val;
            },
            (ctx, expr) => comparison(ctx, expr, 'lt', threshold),
        );
        return this;
    }

    lte(threshold: bigint): this {
        this._defs.maximum = Number(threshold);
        this.push(
            (val: bigint) => {
                if (val > threshold) {
                    throw verror(`${val} larger than expected (${threshold})`);
                }
                return val;
            },
            (ctx, expr) => comparison(ctx, expr, 'lte', threshold),
        );
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
        this.push(
            (val: bigint) => {
                if (val % divisor !== 0n) {
                    throw verror(`${val} undevided by ${divisor}`);
                }
                return val;
            },
            (ctx, expr) => {
                const divisorRef = ctx.addConst(divisor);
                return `(function () { try { return BigInt(${expr}) % ${divisorRef} === 0n; } catch { return false; } })()`;
            },
        );
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

function dateCoercibleCheck(expr: string): string {
    return `(function () {
        var v = ${expr};
        if (v instanceof Date) return true;
        if (typeof v === 'string') { if (v === '') return false; var d = new Date(v); return !Number.isNaN(d.getTime()); }
        if (typeof v === 'number') { if (!Number.isFinite(v) || v > 8640000000000000) return false; var d2 = new Date(v); return !Number.isNaN(d2.getTime()); }
        if (typeof v === 'boolean') return true;
        if (v === null) return true;
        return false;
    })()`;
}

class DateV extends TypeV<Date> {
    constructor() {
        super();
        this.push(
            (val: unknown) => {
                // Direct Date instance
                if (val instanceof Date) {
                    return val;
                }

                // String to Date
                if (typeof val === 'string') {
                    if (val === '') {
                        throw verror('Date string cannot be empty');
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
            },
            (_ctx, expr) => dateCoercibleCheck(expr),
        );
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
        this.push(
            (val: unknown) => {
                if (val !== this._literal) {
                    const format = (v: unknown) =>
                        v === null ? 'null' : v === undefined ? 'undefined' : typeof v === 'string' ? `"${v}"` : String(v);
                    throw verror(`Expected literal ${format(this._literal)}, got ${format(val)}`);
                }
                return this._literal;
            },
            (ctx, expr) => (this._literal === undefined ? `${expr} === undefined` : `${expr} === ${ctx.addConst(this._literal)}`),
        );
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
        this.push(
            (val: unknown) => val,
            () => 'true',
        );
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
        this.push(
            (val: unknown) => {
                if (!Number.isNaN(val)) {
                    throw verror(`Expected NaN, got ${val}`);
                }
                return val as number;
            },
            (_ctx, expr) => `Number.isNaN(${expr})`,
        );
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
        this.push(
            (value: unknown) => {
                if (value === null) {
                    return null;
                }
                return this._inner!.parse(value) as T;
            },
            () => 'true', // unused: codegen() is overridden below
        );
    }

    override codegen(ctx: CodegenCtx, expr: string): string {
        const innerExpr = this._inner!.codegen(ctx, expr);
        return `(${expr} === null || (${innerExpr}))`;
    }

    override freeze(): void {
        super.freeze();
        this._inner!.freeze();
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
        this.push(
            (value: unknown) => {
                if (value === null || value === undefined) {
                    return value as T | null | undefined;
                }
                return this._inner!.parse(value) as T | null | undefined;
            },
            () => 'true', // unused: codegen() is overridden below
        );
    }

    override codegen(ctx: CodegenCtx, expr: string): string {
        const innerExpr = this._inner!.codegen(ctx, expr);
        return `(${expr} === null || ${expr} === undefined || (${innerExpr}))`;
    }

    override freeze(): void {
        super.freeze();
        this._inner!.freeze();
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
type OptionalKeys<S extends Record<string, Validator>> = {
    [K in keyof S]: S[K] extends Validator<infer U> ? (undefined extends U ? K : never) : never;
}[keyof S];

// Helper type to extract keys of required validators
type RequiredKeys<S extends Record<string, Validator>> = Exclude<keyof S, OptionalKeys<S>>;

// Force TypeScript to evaluate and simplify the object type
type SimplifyObject<T> = { [K in keyof T]: T[K] };

// Object type with proper optional/required handling
type InferObject<S extends Record<string, Validator>> = SimplifyObject<
    {
        [K in RequiredKeys<S>]: S[K] extends Validator<infer U> ? U : never;
    } & {
        [K in OptionalKeys<S>]?: S[K] extends Validator<infer U> ? U : never;
    }
>;

export class ObjV<S extends Record<string, Validator>> extends TypeV<InferObject<S>> {
    private _schema: S;
    protected _strict = false;
    protected _loose = false;

    constructor(schema: S = {} as S) {
        super();
        this._schema = schema as S;
        // Add type coercion and validation in one validator
        type InferredType = InferObject<S>;
        this.push(
            (val: unknown) => {
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
            },
            () => 'true', // unused: codegen() is overridden below
        );
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
        this._assertMutable();
        this._strict = true;
        this._loose = false;
        return this;
    }

    passthrough(): this {
        this._assertMutable();
        this._loose = true;
        this._strict = false;
        return this;
    }

    strip(): this {
        this._assertMutable();
        this._strict = false;
        this._loose = false;
        return this;
    }

    extend<Ext extends Record<string, Validator>>(additionalSchema: Ext): ObjV<S & Ext> {
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
        for (let i = 1; i < this._entries.length; i++) {
            extended._entries.push(this._entries[i] as never);
        }

        extended._defs = { ...this._defs };
        return extended;
    }

    // BC for zod3
    merge = this.extend;

    minProperties(min: number): this {
        this._defs.minProperties = min;
        type InferredType = InferObject<S>;
        this.push(
            (val: InferredType) => {
                const propCount = Object.keys(val as object).length;
                if (propCount < min) {
                    throw verror(`Object must have at least ${min} properties, got ${propCount}`);
                }
                return val;
            },
            (ctx, expr) => this._propertyCountCheck(ctx, expr, 'min', min),
        );
        return this;
    }

    maxProperties(max: number): this {
        this._defs.maxProperties = max;
        type InferredType = InferObject<S>;
        this.push(
            (val: InferredType) => {
                const propCount = Object.keys(val as object).length;
                if (propCount > max) {
                    throw verror(`Object must have at most ${max} properties, got ${propCount}`);
                }
                return val;
            },
            (ctx, expr) => this._propertyCountCheck(ctx, expr, 'max', max),
        );
        return this;
    }

    // Counts only the schema-shape keys present on `expr` with a defined value —
    // matches the parsed *result*'s key count in strip mode (the common case),
    // which is what the interpreted minProperties/maxProperties checks above
    // actually measure (they run against the reconstructed result, not raw input).
    private _propertyCountCheck(ctx: CodegenCtx, expr: string, op: 'min' | 'max', value: number): string {
        const keysConst = ctx.addConst(Object.keys(this._schema));
        const countExpr = `${keysConst}.filter(function (k) { return ${expr}[k] !== undefined; }).length`;
        const valueRef = ctx.addConst(value);
        return `(${countExpr} ${op === 'min' ? '>=' : '<='} ${valueRef})`;
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

    get schema(): Record<string, Validator> {
        return this._schema;
    }

    override codegen(ctx: CodegenCtx, expr: string): string {
        const strict = this._strict;
        const schemaKeys = Object.keys(this._schema);
        const fields: ObjectShapeField[] = schemaKeys.map((key) => {
            const fieldValidator = this._schema[key] as Validator<unknown>;
            return {
                key,
                optional: !!fieldValidator.isOptional,
                codegen: (propExpr: string) => fieldValidator.codegen(ctx, propExpr),
            };
        });
        let result = objectShapeCheck(ctx, expr, fields, strict ? schemaKeys : undefined);
        // Extra checks pushed after the constructor (minProperties/maxProperties) —
        // index 0 is the constructor's own placeholder, deliberately skipped.
        const extra = this._entries.slice(1);
        if (extra.length > 0) {
            result = `(${result} && ${extra.map((entry) => `(${entry.gen(ctx, expr)})`).join(' && ')})`;
        }
        return result;
    }

    // Recurses into every field validator so mutating a nested schema after the
    // root has compiled fails loudly instead of being silently invisible to the
    // already-generated fast path.
    override freeze(): void {
        super.freeze();
        for (const field of Object.values(this._schema)) {
            field.freeze();
        }
    }

    // Schema root: first call materializes a `new Function(...)`-backed validator
    // from codegen() and replaces this instance's own `validate`. Nested validators
    // never do this — only the root object schema does.
    override validate(input: unknown): boolean {
        if (!isCodeGenEnabled()) return super.validate(input);
        const fast = buildToFunction(this);
        // Must defineProperty before freeze(): freezing makes `this` non-extensible,
        // and `validate` isn't an own property yet (it's inherited from the
        // prototype) — adding it after freezing would throw.
        Object.defineProperty(this, 'validate', { value: fast, writable: false, configurable: true });
        this.freeze();
        return fast(input);
    }
}

//
// --- Array Validator ---
//

export class ArrV<T = unknown> extends TypeV<T[]> {
    constructor(item?: Validator<T>) {
        super();
        if (item !== undefined) this._inner = item;
        // Add type coercion as the first validator
        this.push(
            (val: unknown) => {
                if (!Array.isArray(val)) {
                    throw verror(`Expected array, got ${typeof val}`);
                }
                if (this._inner) {
                    return val.map((item) => this._inner!.parse(item)) as T[];
                }
                return val as T[];
            },
            () => 'true', // unused: codegen() is overridden below
        );
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
        this.push(
            (val: T[]) => {
                if (val.length < min) {
                    throw verror(`${val.length} >= ${min}`);
                }
                return val;
            },
            (ctx, expr) => lengthCheck(ctx, expr, 'min', min),
        );
        return this;
    }

    maxLength(max: number): this {
        this._defs.maxItems = max;
        this.push(
            (val: T[]) => {
                if (val.length > max) {
                    throw verror(`${val.length} <= ${max}`);
                }
                return val;
            },
            (ctx, expr) => lengthCheck(ctx, expr, 'max', max),
        );
        return this;
    }

    length(len: number): this {
        this.push(
            (val: T[]) => {
                if (val.length !== len) {
                    throw verror(`${val.length} === ${len}`);
                }
                return val;
            },
            (ctx, expr) => lengthCheck(ctx, expr, 'eq', len),
        );
        return this;
    }

    nonempty(): this {
        this.push(
            (val: T[]) => {
                if (val.length === 0) {
                    throw verror('Array must not be empty');
                }
                return val;
            },
            (ctx, expr) => lengthCheck(ctx, expr, 'min', 1),
        );
        return this;
    }

    override codegen(ctx: CodegenCtx, expr: string): string {
        const inner = this._inner as Validator<unknown> | undefined;
        let result = inner ? arrayOfCheck(ctx, expr, (itemExpr) => inner.codegen(ctx, itemExpr)) : isArrayCheck(expr);
        // Extra checks pushed after the constructor (minLength/maxLength/length/nonempty).
        const extra = this._entries.slice(1);
        if (extra.length > 0) {
            result = `(${result} && ${extra.map((entry) => `(${entry.gen(ctx, expr)})`).join(' && ')})`;
        }
        return result;
    }

    override freeze(): void {
        super.freeze();
        this._inner?.freeze();
    }
}

//
// --- Set Validator ---
//

class SetV<T = unknown> extends TypeV<Set<T>> {
    constructor(item?: Validator<T>) {
        super();
        if (item !== undefined) this._inner = item;
        // Add type coercion as the first validator
        this.push(
            (val: unknown) => {
                if (val instanceof Set) {
                    return val as Set<T>;
                }
                if (Array.isArray(val)) {
                    const set = new Set<T>();
                    for (const item of val) {
                        set.add(this._inner ? (this._inner.parse(item) as T) : (item as T));
                    }
                    return set;
                }
                throw verror(`Expected Set or array, got ${typeof val}`);
            },
            () => 'true', // unused: codegen() is overridden below
        );
    }

    override defs(props = false): ValidatorDef {
        const baseDef = super.defs();
        const schema: Partial<ValidatorDef> = { type: 'array', uniqueItems: true };

        if (this._inner) {
            schema.items = this._inner.defs(props);
        }

        return { ...baseDef, ...schema };
    }

    override codegen(ctx: CodegenCtx, expr: string): string {
        const inner = this._inner as Validator<unknown> | undefined;
        const itemsExpr = `Array.from(${expr})`;
        const containerCheck = `(${expr} instanceof Set || Array.isArray(${expr}))`;
        if (!inner) return containerCheck;
        const itemVar = ctx.freshVar('item');
        const innerExpr = inner.codegen(ctx, itemVar);
        return `(${containerCheck} && ${itemsExpr}.every(function (${itemVar}) { return !!(${innerExpr}); }))`;
    }

    override freeze(): void {
        super.freeze();
        this._inner?.freeze();
    }
}

//
// --- Map Validator ---
//

class MapV<V = unknown> extends TypeV<Map<string, V>> {
    constructor(value?: Validator<V>) {
        super();
        if (value !== undefined) this._inner = value;
        // Add type coercion as the first validator - converts to Map
        this.push(
            (val: unknown) => {
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
            },
            () => 'true', // unused: codegen() is overridden below
        );
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

    override codegen(ctx: CodegenCtx, expr: string): string {
        const inner = this._inner as Validator<unknown> | undefined;
        const mapCheck = `(${expr} instanceof Map)`;
        const objCheck = isPlainObjectCheck(expr);
        if (!inner) return `(${mapCheck} || ${objCheck})`;
        const itemVar = ctx.freshVar('item');
        const innerExpr = inner.codegen(ctx, itemVar);
        const everyCheck = `function (${itemVar}) { return !!(${innerExpr}); }`;
        return `((${mapCheck} && Array.from(${expr}.values()).every(${everyCheck})) || (${objCheck} && Object.values(${expr}).every(${everyCheck})))`;
    }

    override freeze(): void {
        super.freeze();
        this._inner?.freeze();
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
        this.push(
            (value: unknown) => {
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
            },
            () => 'true', // unused: codegen() is overridden below
        );
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
                type: types.length === 1 ? types[0]! : types,
            };
        }

        // Return anyOf for complex unions - don't include 'type' from baseDef (JSON Schema constraint)
        const result = { ...baseDef, anyOf: anyOfSchemas };
        delete result.type;
        return result;
    }

    // Union: "matches at least one option" — boolean OR of each option's
    // expression, e.g. `((a) || (b))`, not AND (which would mean "matches all
    // options at once", intersection semantics this union does not have).
    override codegen(ctx: CodegenCtx, expr: string): string {
        const parts = this._union.map((option) => `(${option.codegen(ctx, expr)})`);
        return `(${parts.join(' || ')})`;
    }

    override freeze(): void {
        super.freeze();
        for (const option of this._union) option.freeze();
    }
}

// --- Enum Validator is a Union of literals --
class EnumV<T> extends UnionV<T> {
    private _values: readonly (string | number | boolean)[];

    constructor(values: readonly (string | number | boolean)[]) {
        super(values.map((v) => literal(v)));
        this._values = values;
    }

    override defs(props = false): ValidatorDef {
        const baseDef = super.defs(props);
        return {
            ...baseDef,
            enum: this._values as unknown[],
        };
    }
}

// Zod-compatible optional: makes any validator accept undefined
// Legacy optional: creates an optional loose object (backward compatibility)
export function optional<T>(validator: Validator<T>): Validator<T | undefined>;
// biome-ignore lint/suspicious/noExplicitAny: schema object type cannot be statically inferred
export function optional(schema?: Record<string, Validator>): ObjV<any>;
export function optional<T>(validatorOrSchema?: Validator<T> | Record<string, Validator>): Validator<T | undefined> {
    // Check if it's a ValueValidator by checking for push method (ValueValidator-specific)
    if (
        validatorOrSchema &&
        typeof validatorOrSchema === 'object' &&
        'push' in validatorOrSchema &&
        typeof validatorOrSchema.push === 'function'
    ) {
        return (validatorOrSchema as Validator<T>).optional();
    }
    // Otherwise, treat as plain object schema - use legacy behavior: create optional loose object
    return new ObjV(validatorOrSchema as Record<string, Validator>).passthrough().optional() as Validator<T | undefined>;
}

//
// --- Exports and Utility Functions ---
//
export const array = <T = unknown>(item?: Validator<T>): ArrV<T> => new ArrV<T>(item);
export const bigint = () => new BigIntV();
export const boolean = () => new BoolV();
export const date = () => new DateV();
export const email = () => new StrV().email();
export const enumeration = <T extends readonly (string | number | boolean)[]>(values: T) => new EnumV<T[number]>(values);
export const int = () => new NumV().int();
export const literal = <T extends string | number | boolean | null | undefined>(value: T) => new LiteralV(value);
export const map = <V = unknown>(value?: Validator<V>): Validator<Map<string, V>> => new MapV<V>(value);
export const nullable = <T>(validator: Validator<T>) => new NullableV(validator);
export const nullish = <T>(validator: Validator<T>) => new NullishV(validator);
export const number = () => new NumV();
export const unknown = () => new UnknownV();
export const set = <T = unknown>(item?: Validator<T>): Validator<Set<T>> => new SetV<T>(item);
export const string = () => new StrV();

// objects
export const looseObject = <S extends Record<string, Validator>>(schema?: S) => new ObjV<S>(schema as S).passthrough();
export const object = <S extends Record<string, Validator>>(schema?: S) => new ObjV<S>(schema as S);
export const record = <V = unknown>(value?: Validator<V>): Validator<Map<string, V>> => new MapV<V>(value);
export const strictObject = <S extends Record<string, Validator>>(schema?: S) => new ObjV<S>(schema as S).strict();

// A fresh instance per call, like every other factory here — a shared singleton
// would let one schema's validate() freeze an instance embedded in an unrelated,
// still-under-construction schema.
export const nan = () => new NanV();
export const nullVal = () => new NullV();
export const undefinedVal = () => new UndefinedV();
export const voidVal = () => new VoidV();

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

function testFormat(str: string, format: keyof typeof PATTERNS | RegExp): boolean {
    if (typeof format === 'string') {
        return PATTERNS[format as keyof typeof PATTERNS]?.test(str) ?? false;
    }
    return format.test(str);
}

// Helper to simplify extracted union types
type ExtractTypes<T extends readonly Validator[]> =
    T[number] extends Validator<infer U> ? (U extends object ? { [K in keyof U]: U[K] } : U) : never;

export const union = <T extends readonly [Validator, Validator, ...Validator[]]>(validators: T) =>
    new UnionV<ExtractTypes<T>>(validators);

/**
 * Parse and validate a value using a validator
 * Simply delegates to the validator's parse method
 */
export function parse<T>(validator: Validator<T>, value: unknown): T {
    return validator.parse(value);
}

/**
 * Safe parse utility: returns [data, undefined] on success or [undefined, error] on failure
 * Note: return type is aligned with safe.ts pattern, not with Zod's SafeParseResult
 */
export function safeParse<T>(validator: Validator<T>, value: unknown): [T | undefined, Error | undefined] {
    try {
        return [validator.parse(value), undefined];
    } catch (err) {
        return [undefined, err instanceof Error ? err : new Error(Object(err).message ?? String(err))];
    }
}

// Helper type to infer schema object types
type InferSchema<S extends Record<string, Validator>> = {
    [K in keyof S]: S[K] extends Validator<infer U> ? U : never;
};

// Helper to recursively unwrap and simplify types
type Simplify<T> =
    T extends Map<infer K, infer V>
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
export type Infer<T> = Simplify<T extends Validator<infer U> ? U : T extends Record<string, Validator> ? InferSchema<T> : never>;
