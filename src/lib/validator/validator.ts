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

// Validator error class
class ValidatorError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidatorError';
    }
}

const verror = (str: string) => new ValidatorError(str);

// JSON Schema primitive types - defined locally to avoid circular dependency
export type PrimitiveType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

// ValidatorDef contains only properties validators actually use
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

export interface ValueValidator<T = unknown> {
    parse(value: unknown): T | undefined;
    push(validator: (arg: T) => T): number;
    clear(): void;
    isOptional?: boolean; // Flag to indicate if validator is optional
    describe(description: string): this;
    defs(additionalProperties?: boolean): ValidatorDef; // Get Json schema definition
    optional(): this; // Make validator accept undefined
}

// Abstract base class for all validators
export abstract class TypeVal<T> implements ValueValidator<T> {
    protected _validators: Array<(val: T) => T> = [];
    public isOptional = false; // Track if optional() was called (runtime flag for parse optimization)
    protected _innerValidator?: ValueValidator; // Optional inner validator for composite types
    protected _defs: Partial<ValidatorDef> = {}; // Track constraint metadata for schema generation

    defs(): ValidatorDef {
        return { ...this._defs };
    }

    get innerValidator(): ValueValidator | undefined {
        return this._innerValidator;
    }

    parse(value: unknown): T | undefined {
        // Fast path for validators with no additional constraints
        if (this._validators.length === 0) {
            return value as T;
        }

        // Fast path for single validator
        if (this._validators.length === 1) {
            const result = this._validators[0](value as T);
            return result;
        }

        // Multiple validators - apply in sequence
        let processedValue: T | undefined = value as T;
        for (const validator of this._validators) {
            processedValue = validator(processedValue as T);
            if (processedValue === undefined) {
                return undefined;
            }
        }
        return processedValue;
    }

    push(validator: (val: T) => T): number {
        return this._validators.push(validator);
    }

    clear() {
        this._validators.length = 0;
    }

    optional(): this {
        this.isOptional = true;
        this._validators.splice(0, 0, (val: unknown) => {
            if (val === undefined || val === null || val === '') {
                return undefined as T;
            }
            return val as T;
        });
        return this;
    }

    default(defaultValue: T): this {
        this.isOptional = true;
        this._defs.default = defaultValue;
        this._validators.splice(0, 0, (val: unknown) => {
            if (val === undefined || val === null) {
                return defaultValue;
            }
            return val as T;
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

class NumVal extends TypeVal<number> {
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
            const numValue = Number(val);
            if (Number.isNaN(numValue)) {
                throw verror(`Expected number, got ${typeof val}`);
            }
            return numValue;
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

    min(minValue: number): this {
        return this.gte(minValue);
    }

    max(maxValue: number): this {
        return this.lte(maxValue);
    }

    gte(minValue: number): this {
        this._defs.minimum = minValue;
        this.push((val: number) => {
            if (val < minValue) {
                throw verror(`${val} >= ${minValue}`);
            }
            return val;
        });
        return this;
    }

    lte(maxValue: number): this {
        this._defs.maximum = maxValue;
        this.push((val: number) => {
            if (val > maxValue) {
                throw verror(`${val} <= ${maxValue}`);
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

export class StrVal extends TypeVal<string> {
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
    min(minLength: number): this {
        this._defs.minLength = minLength;
        this.push((val: string) => {
            if (val.length < minLength) {
                throw verror(`${val.length} >= ${minLength}`);
            }
            return val;
        });
        return this;
    }

    max(maxLength: number): this {
        this._defs.maxLength = maxLength;
        this.push((val: string) => {
            if (val.length > maxLength) {
                throw verror(`${val.length} <= ${maxLength}`);
            }
            return val;
        });
        return this;
    }

    regex(pattern: RegExp, errMsg?: string): this {
        this._defs.pattern = pattern.source;
        this.push((val: string) => {
            if (!pattern.test(val)) {
                val = val.length > 20 ? `${val.slice(0, 17)}...` : val;
                let patternString = pattern.toString();
                patternString = patternString.length > 20 ? `${patternString.slice(0, 17)}...` : patternString;
                errMsg ??= `"${val}" does not match ${patternString}`;
                // Support template string interpolation in error message
                const message = errMsg.replace(/\$\{val\}/g, val);
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
        const expectedLength = lengths[algorithm];
        this.push((val: string) => {
            if (!/^[0-9a-fA-F]+$/.test(val)) {
                throw verror(`"${val}" is not a valid hex string`);
            }
            if (val.length !== expectedLength) {
                throw verror(`${algorithm} hash must be ${expectedLength} characters, got ${val.length}`);
            }
            return val;
        });
        return this;
    }

    // ISO format validators
    isoDate(): this {
        // ISO 8601 date format: YYYY-MM-DD
        return this.regex(
            /^\d{4}-\d{2}-\d{2}$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 date (YYYY-MM-DD)',
        );
    }

    isoTime(): this {
        // ISO 8601 time format: HH:MM:SS or HH:MM:SS.sss
        return this.regex(
            /^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 time (HH:MM:SS)',
        );
    }

    isoDatetime(): this {
        // ISO 8601 datetime format: YYYY-MM-DDTHH:MM:SS.sssZ or with timezone offset
        return this.regex(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: implemented inside regex func
            '"${val}" is not a valid ISO 8601 datetime',
        );
    }

    isoDuration(): this {
        // ISO 8601 duration format: P[n]Y[n]M[n]DT[n]H[n]M[n]S or P[n]W
        // Week format (P[n]W) cannot be combined with other date components
        // Must have at least one component (Y, M, D, W, H, M, or S)
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

class BoolVal extends TypeVal<boolean> {
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

class BigIntVal extends TypeVal<bigint> {
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

    min(threshold: bigint): this {
        return this.gte(threshold);
    }

    max(threshold: bigint): this {
        return this.lte(threshold);
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

class DateVal extends TypeVal<Date> {
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

class LiteralVal<T extends string | number | boolean | null | undefined> extends TypeVal<T> {
    private _literalValue: T;

    constructor(literalValue: T) {
        super();
        this._literalValue = literalValue;
    }

    override defs(): ValidatorDef {
        const value = this._literalValue;
        const type = typeof value;

        if (value === null) {
            return { ...super.defs(), type: 'null', value };
        }
        if (value === undefined) {
            return { ...super.defs(), value };
        }
        if (type === 'string') {
            return { ...super.defs(), type: 'string', const: value, value };
        }
        if (type === 'number') {
            return { ...super.defs(), type: 'number', const: value, value };
        }
        if (type === 'boolean') {
            return { ...super.defs(), type: 'boolean', const: value, value };
        }
        if (type === 'bigint') {
            return { ...super.defs(), type: 'integer', const: Number(value), value };
        }

        return { ...super.defs(), const: value, value };
    }

    override parse(value: unknown): T {
        if (value !== this._literalValue) {
            const expectedStr =
                this._literalValue === null
                    ? 'null'
                    : this._literalValue === undefined
                      ? 'undefined'
                      : typeof this._literalValue === 'string'
                        ? `"${this._literalValue}"`
                        : String(this._literalValue);
            const gotStr =
                value === null
                    ? 'null'
                    : value === undefined
                      ? 'undefined'
                      : typeof value === 'string'
                        ? `"${value}"`
                        : String(value);
            throw verror(`Expected literal ${expectedStr}, got ${gotStr}`);
        }
        return this._literalValue;
    }
}

//
// --- Null/Unknown/Undefined Validators ---
//
class UnknownVal extends TypeVal<unknown> {
    constructor() {
        super();
        this.push((val: unknown) => val);
    }
}

class UndefinedVal extends LiteralVal<undefined> {
    constructor() {
        super(undefined);
    }
}

//
// --- Null Validator ---
//

class NullVal extends LiteralVal<null> {
    constructor() {
        super(null);
    }
}

//
// --- NaN Validator ---
// NaN is special because NaN !== NaN, so we need custom logic
//

class NanVal extends TypeVal<number> {
    override defs(): ValidatorDef {
        return { ...super.defs(), not: {} };
    }

    override parse(value: unknown): number | undefined {
        if (!Number.isNaN(value)) {
            throw verror(`Expected NaN, got ${value}`);
        }
        return value as number;
    }
}

//
// --- Void Validator ---
//

class VoidVal extends LiteralVal<undefined> {
    constructor() {
        super(undefined);
    }
}

//
// --- Nullable Wrapper ---
//

class NullableVal<T> extends TypeVal<T | null> {
    constructor(innerValidator: ValueValidator<T>) {
        super();
        this._innerValidator = innerValidator;
    }

    override defs(additionalProperties?: boolean): ValidatorDef {
        const baseDef = super.defs();
        const innerDef = this._innerValidator!.defs(additionalProperties);

        // If inner schema has additional properties (like items for arrays), use anyOf
        const hasComplexSchema = innerDef.items || innerDef.properties || innerDef.enum;

        if (hasComplexSchema) {
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
                    type: [...types, 'null'] as PrimitiveType[],
                };
            }
        }

        // Fallback: use anyOf without 'type'
        const result = { ...baseDef, anyOf: [innerDef, { type: 'null' as const }] };
        delete result.type;
        return result;
    }

    override parse(value: unknown): T | null | undefined {
        if (value === null) {
            return null;
        }
        return this._innerValidator!.parse(value) as T | null;
    }
}

//
// --- Nullish Wrapper ---
//

class NullishVal<T> extends TypeVal<T | null | undefined> {
    constructor(innerValidator: ValueValidator<T>) {
        super();
        this._innerValidator = innerValidator;
    }

    override defs(additionalProperties?: boolean): ValidatorDef {
        const baseDef = super.defs();
        const innerDef = this._innerValidator!.defs(additionalProperties);

        // Nullish is null or undefined - in JSON Schema, we just treat it as nullable
        // If inner schema has additional properties (like items for arrays), use anyOf
        const hasComplexSchema = innerDef.items || innerDef.properties || innerDef.enum;

        if (hasComplexSchema) {
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
                    type: [...types, 'null'] as PrimitiveType[],
                };
            }
        }

        // Fallback: use anyOf without 'type'
        const result = { ...baseDef, anyOf: [innerDef, { type: 'null' as const }] };
        delete result.type;
        return result;
    }

    override parse(value: unknown): T | null | undefined {
        if (value === null || value === undefined) {
            return value as T | null | undefined;
        }
        return this._innerValidator!.parse(value) as T | null | undefined;
    }
}

//
// --- Object Validator ---
//

export class ObjVal extends TypeVal<Record<string, unknown>> {
    private _schema: Schema;
    protected _strict = false;
    protected _loose = false;

    constructor(schema: Schema = {}) {
        super();
        this._schema = schema;
        // Add type coercion and validation in one validator
        this.push((val: unknown) => {
            if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
                // If no schema, just return the object as-is
                if (Object.keys(this._schema).length === 0) {
                    return val as Record<string, unknown>;
                }

                const objRecord = val as Record<string, unknown>;

                // Strict mode: reject unknown keys
                if (this._strict) {
                    const schemaKeys = Object.keys(this._schema);
                    const inputKeys = Object.keys(objRecord);
                    const unknownKeys = inputKeys.filter((k) => !schemaKeys.includes(k));
                    if (unknownKeys.length > 0) {
                        throw verror(`Unknown keys in strict mode: ${unknownKeys.join(', ')}`);
                    }
                }

                // Validate nested fields directly here - parse will throw if validation fails
                const result = parse(this._schema, val) as Record<string, unknown>;

                // Passthrough mode: include unknown keys
                if (this._loose) {
                    const schemaKeys = Object.keys(this._schema);
                    for (const key of Object.keys(objRecord)) {
                        if (!schemaKeys.includes(key)) {
                            result[key] = objRecord[key];
                        }
                    }
                }

                return result;
            }
            throw verror(`Expected object, got ${typeof val}`);
        });
    }

    keyof(): UnionVal<string> {
        const keys = Object.keys(this._schema);
        if (keys.length === 0) {
            throw verror('Cannot get keyof from object with no schema');
        }
        const literals = keys.map((k) => new LiteralVal(k));
        return new UnionVal<string>(literals);
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

    extend(additionalSchema: Schema): ObjVal {
        const merged = { ...this._schema, ...additionalSchema };
        const extended = new ObjVal(merged);

        // Preserve strict/loose mode from current instance
        if (this._strict) {
            extended.strict();
        } else if (this._loose) {
            extended.passthrough();
        }

        // Preserve validators from original instance (e.g., minProperties, maxProperties, custom refinements)
        // Skip the first validator which is the object type coercion/validation
        for (let i = 1; i < this._validators.length; i++) {
            extended._validators.push(this._validators[i]);
        }

        // Preserve metadata (defs)
        extended._defs = { ...this._defs };

        return extended;
    }

    // BC for zod3
    merge = this.extend;

    minProperties(min: number): this {
        this._defs.minProperties = min;
        this.push((val: Record<string, unknown>) => {
            const propCount = Object.keys(val).length;
            if (propCount < min) {
                throw verror(`Object must have at least ${min} properties, got ${propCount}`);
            }
            return val;
        });
        return this;
    }

    maxProperties(max: number): this {
        this._defs.maxProperties = max;
        this.push((val: Record<string, unknown>) => {
            const propCount = Object.keys(val).length;
            if (propCount > max) {
                throw verror(`Object must have at most ${max} properties, got ${propCount}`);
            }
            return val;
        });
        return this;
    }

    override defs(additionalProperties = false): ValidatorDef {
        const baseDef = super.defs();
        const properties: Record<string, ValidatorDef> = {};
        const requiredFields: string[] = [];

        const objSchema = this._schema;
        if (objSchema) {
            for (const [key, fieldValidator] of Object.entries(objSchema)) {
                properties[key] = fieldValidator.defs(additionalProperties);
                // Mark required fields (those without isOptional flag)
                if (!fieldValidator.isOptional) {
                    requiredFields.push(key);
                }
            }
        }

        // Set additionalPropsValue based on validator and context
        if (this._strict) {
            additionalProperties = false;
        }

        return {
            ...baseDef,
            type: 'object',
            properties,
            required: requiredFields,
            additionalProperties: additionalProperties,
        };
    }

    get schema(): Schema {
        return this._schema;
    }
}

//
// --- Array Validator ---
//

class ArrVal extends TypeVal<Array<unknown>> {
    private _itemValidator?: ValueValidator;

    constructor(itemValidator?: ValueValidator) {
        super();
        this._itemValidator = itemValidator;
        // Add type coercion as the first validator
        this.push((val: unknown) => {
            if (!Array.isArray(val)) {
                throw verror(`Expected array, got ${typeof val}`);
            }
            if (this._itemValidator) {
                return val.map((item) => this._itemValidator!.parse(item));
            }
            return val;
        });
    }

    override defs(additionalProperties = false): ValidatorDef {
        const baseDef = super.defs();
        const schema: Partial<ValidatorDef> = { type: 'array' };

        if (this._itemValidator) {
            schema.items = this._itemValidator.defs(additionalProperties);
        }

        return { ...baseDef, ...schema };
    }

    get itemValidator(): ValueValidator | undefined {
        return this._itemValidator;
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

class SetVal extends TypeVal<Set<unknown>> {
    private _itemValidator?: ValueValidator;

    constructor(itemValidator?: ValueValidator) {
        super();
        this._itemValidator = itemValidator;
        // Add type coercion as the first validator
        this.push((val: unknown) => {
            if (val instanceof Set) {
                return val;
            }
            if (Array.isArray(val)) {
                const set = new Set<unknown>();
                for (const item of val) {
                    const validated = this._itemValidator ? this._itemValidator.parse(item) : item;
                    set.add(validated);
                }
                return set;
            }
            throw verror(`Expected Set or array, got ${typeof val}`);
        });
    }

    override defs(additionalProperties = false): ValidatorDef {
        const baseDef = super.defs();
        const schema: Partial<ValidatorDef> = { type: 'array', uniqueItems: true };

        if (this._itemValidator) {
            schema.items = this._itemValidator.defs(additionalProperties);
        }

        return { ...baseDef, ...schema };
    }

    get itemValidator(): ValueValidator | undefined {
        return this._itemValidator;
    }
}

//
// --- Map Validator ---
//

class MapVal extends TypeVal<Map<string, unknown>> {
    private _valueValidator?: ValueValidator;

    constructor(valueValidator?: ValueValidator) {
        super();
        this._valueValidator = valueValidator;
        // Add type coercion as the first validator
        this.push((val: unknown) => {
            if (val instanceof Map) {
                return val as Map<string, unknown>;
            }
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                const entries = Object.entries(val as Record<string, unknown>);
                const map = new Map<string, unknown>();
                for (const [k, v] of entries) {
                    const validated = this._valueValidator ? this._valueValidator.parse(v) : v;
                    map.set(k, validated);
                }
                return map;
            }
            throw verror(`Expected Map or object, got ${typeof val}`);
        });
    }

    override defs(additionalProperties = false): ValidatorDef {
        const baseDef = super.defs();
        const schema: Partial<ValidatorDef> = { type: 'object' };

        if (this._valueValidator) {
            schema.additionalProperties = this._valueValidator.defs(additionalProperties);
        } else {
            schema.additionalProperties = true;
        }

        return { ...baseDef, ...schema };
    }

    get valueValidator(): ValueValidator | undefined {
        return this._valueValidator;
    }
}

//
// --- Union Validator ---
//

class UnionVal<T> extends TypeVal<T> {
    private _unionValidators: readonly ValueValidator[];

    constructor(validators: readonly ValueValidator[]) {
        super();
        if (!validators || validators.length < 2) {
            throw verror('Union requires at least 2 validators');
        }
        this._unionValidators = validators;
    }

    override defs(additionalProperties = false): ValidatorDef {
        const baseDef = super.defs();
        const validators = this._unionValidators;

        if (!validators || validators.length === 0) {
            return baseDef;
        }

        // Convert each validator to JSON Schema
        const anyOfSchemas: ValidatorDef[] = validators
            .map((v) => v.defs(additionalProperties))
            .filter((s) => Object.keys(s).length > 0);

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
            const types = Array.from(new Set(anyOfSchemas.map((s) => s.type as string))) as PrimitiveType[];
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
    get unionValidators(): readonly ValueValidator[] {
        return this._unionValidators;
    }

    override parse(value: unknown): T | undefined {
        // First, check if there are base validators (like optional()) and apply them
        // This handles optional() and default() at the union level
        if (this._validators.length > 0) {
            let processedValue: unknown = value;
            for (const validator of this._validators) {
                processedValue = validator(processedValue as T);
                if (processedValue === undefined) {
                    return undefined;
                }
            }
            value = processedValue;
        }

        const errors: string[] = [];

        // Try each validator in order (first-match strategy)
        for (const validator of this._unionValidators) {
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
    }
}

// Zod-compatible optional: makes any validator accept undefined
// Legacy optional: creates an optional loose object (backward compatibility)
export function optional<T>(validator: ValueValidator<T>): ValueValidator<T | undefined>;
export function optional(schema?: Schema): ObjVal;
export function optional<T>(validatorOrSchema?: ValueValidator<T> | Schema): ValueValidator<T | undefined> | ObjVal {
    // Check if it's a ValueValidator by checking for push method (ValueValidator-specific)
    if (
        validatorOrSchema &&
        typeof validatorOrSchema === 'object' &&
        'push' in validatorOrSchema &&
        typeof validatorOrSchema.push === 'function'
    ) {
        return (validatorOrSchema as ValueValidator<T>).optional();
    }
    // Otherwise, treat as Schema (plain object) - use legacy behavior: create optional loose object
    return new ObjVal(validatorOrSchema as Schema).passthrough().optional();
}

//
// --- Exports and Utility Functions ---
//

export type Schema = Record<string, ValueValidator>;
export const array = (itemValidator?: ValueValidator) => new ArrVal(itemValidator);
export const bigint = () => new BigIntVal();
export const boolean = () => new BoolVal();
export const date = () => new DateVal();
export const email = () => new StrVal().email();
export const int = () => new NumVal().int();
export const literal = <T extends string | number | boolean | null | undefined>(value: T) => new LiteralVal(value);
export const map = (valueValidator?: ValueValidator) => new MapVal(valueValidator);
export const nullable = <T>(validator: ValueValidator<T>) => new NullableVal(validator);
export const nullish = <T>(validator: ValueValidator<T>) => {
    const val = new NullishVal(validator);
    val.isOptional = true;
    return val;
};
export const number = () => new NumVal();
export const object = (schema?: Schema) => new ObjVal(schema);
export const strictObject = (schema?: Schema) => new ObjVal(schema).strict();
export const looseObject = (schema?: Schema) => new ObjVal(schema).passthrough();
export const record = (valueValidator?: ValueValidator) => new MapVal(valueValidator);
export const unknown = () => new UnknownVal();

export const set = (itemValidator?: ValueValidator) => new SetVal(itemValidator);
export const string = () => new StrVal();
export const union = <T extends readonly [ValueValidator, ValueValidator, ...ValueValidator[]]>(validators: T) =>
    new UnionVal<T[number] extends ValueValidator<infer U> ? U : never>(validators);

// Static singleton instances for stateless validators
const NAN_VALIDATOR = new NanVal();
const NULL_VALIDATOR = new NullVal();
const UNDEFINED_VALIDATOR = new UndefinedVal();
const VOID_VALIDATOR = new VoidVal();
export const nan = () => NAN_VALIDATOR;
export const nullValidator = () => NULL_VALIDATOR;
export const undefinedValidator = () => UNDEFINED_VALIDATOR;
export const voidValidator = () => VOID_VALIDATOR;

// shorthands
export const uuid = () => new StrVal().uuid();
export const url = () => new StrVal().url();
export const httpUrl = () => new StrVal().httpUrl();
export const hostname = () => new StrVal().hostname();
export const emoji = () => new StrVal().emoji();
export const base64 = () => new StrVal().base64();
export const base64url = () => new StrVal().base64url();
export const hex = () => new StrVal().hex();
export const jwt = () => new StrVal().jwt();
export const nanoid = () => new StrVal().nanoid();
export const cuid = () => new StrVal().cuid();
export const cuid2 = () => new StrVal().cuid2();
export const ulid = () => new StrVal().ulid();
export const ipv4 = () => new StrVal().ipv4();
export const ipv6 = () => new StrVal().ipv6();
export const cidrv4 = () => new StrVal().cidrv4();
export const cidrv6 = () => new StrVal().cidrv6();
export const hash = (algorithm: 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512') => new StrVal().hash(algorithm);

export const isoDate = () => new StrVal().isoDate();
export const isoTime = () => new StrVal().isoTime();
export const isoDatetime = () => new StrVal().isoDatetime();
export const isoDuration = () => new StrVal().isoDuration();

export function parseSchema<T extends Record<string, unknown>>(validator: Schema, obj: unknown): T | undefined {
    if (typeof obj !== 'object' || obj === undefined) return undefined;

    const res = {} as T;
    const objRecord = obj as Record<string, unknown>;

    // Fast path for empty schema
    let hasValidators = false;
    let hasOptionalFields = false;
    for (const prop in validator) {
        if (Object.hasOwn(validator, prop)) {
            hasValidators = true;
            if (validator[prop].isOptional) {
                hasOptionalFields = true;
                break;
            }
        }
    }
    if (!hasValidators) {
        return obj as T;
    }

    // Fast path for required-only schemas
    if (!hasOptionalFields) {
        for (const prop in validator) {
            if (!Object.hasOwn(validator, prop)) continue;
            const validatorInstance = validator[prop];
            const inputValue = objRecord[prop];

            if (inputValue === undefined) {
                throw verror(`Required property '${prop}' is missing`);
            }

            const value = validatorInstance.parse(inputValue);
            if (value !== undefined) {
                (res as Record<string, unknown>)[prop] = value;
            }
        }
        return res;
    }

    // Schema has optional fields
    for (const prop in validator) {
        if (!Object.hasOwn(validator, prop)) continue;
        const validatorInstance = validator[prop];
        const inputValue = objRecord[prop];

        if (inputValue === undefined) {
            if (!validatorInstance.isOptional) {
                throw verror(`Required property '${prop}' is missing`);
            }
            // For optional fields, skip validation - don't call valueOf with undefined
            // unless there's a default value defined
            if (validatorInstance.defs()?.default !== undefined) {
                const value = validatorInstance.parse(inputValue);
                if (value !== undefined) {
                    (res as Record<string, unknown>)[prop] = value;
                }
            }
            continue;
        }

        const value = validatorInstance.parse(inputValue);
        if (value !== undefined) {
            (res as Record<string, unknown>)[prop] = value;
        }
    }
    return res;
}

// Safe parse utility: note the return type here is aligned with safe.ts, not with zod's.
export function safeParse<T extends Record<string, unknown>>(
    validator: Schema,
    value: unknown,
): [T | undefined, Error | undefined] {
    try {
        return [parse<T>(validator, value), undefined];
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
