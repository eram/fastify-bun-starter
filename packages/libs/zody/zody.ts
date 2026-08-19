// Import ErrorEx for ZodyError
import { ErrorEx } from '@libs/utils/error';

// Compiled validator node for fast execution
type CompiledNode<T = unknown> = {
    validate(input: unknown): boolean;
    parse(input: unknown): T;
};

// Local Validator type - zody is self-contained with no external dependencies
type Validator<T = unknown> = {
    parse(input: unknown): T;
    safeParse(input: unknown): { success: boolean; data?: T; error?: Error };
    compile?(): CompiledNode<T>;
    optional(): Validator<T | undefined>;
    nullable(): Validator<T | null>;
    default(value: T): Validator<T>;
    min(value: number | bigint): Validator<T>;
    max(value: number | bigint): Validator<T>;
    gte(value: number | bigint): Validator<T>;
    lte(value: number | bigint): Validator<T>;
    gt(value: number | bigint): Validator<T>;
    lt(value: number | bigint): Validator<T>;
    email(): Validator<T>;
    int(): Validator<T>;
    float(): Validator<T>;
    url(): Validator<T>;
    uuid(): Validator<T>;
    hostname(): Validator<T>;
    ipv4(): Validator<T>;
    ipv6(): Validator<T>;
    jwt(): Validator<T>;
    base64(): Validator<T>;
    hex(): Validator<T>;
    regex(pattern: RegExp | string, message?: string): Validator<T>;
    trim(): Validator<T>;
    toLowerCase(): Validator<T>;
    toUpperCase(): Validator<T>;
    minLength(len: number): Validator<T>;
    maxLength(len: number): Validator<T>;
    length(len: number): Validator<T>;
    describe(text: string): Validator<T>;
    [key: string]: any;
};

type Ctor<T = unknown> = abstract new (...args: unknown[]) => T;
type PrimitiveKind = 'string' | 'number' | 'boolean' | 'bigint' | 'date';
type RootKind = PrimitiveKind | 'array' | 'union' | 'literal' | 'enum' | 'object';

const META_KEY = '__z_meta__';
const CACHE = Symbol.for('zody.cache');
const PHANTOM = Symbol.for('zody.phantom');
const _PENDING_FIELDS_KEY = Symbol.for('zody.pending_fields');

// Global registry for field decorator info, keyed by class constructor
const decorationRegistry = new WeakMap<object, Map<string, Op[]>>();
let lastDecoratedClass: object | null = null;

function setLastDecoratedClass(ctor: object): void {
    lastDecoratedClass = ctor;
}

function registerFieldDecoration(fieldName: string, ops: Op[]): void {
    if (!lastDecoratedClass) {
        return;
    }
    if (!decorationRegistry.has(lastDecoratedClass)) {
        decorationRegistry.set(lastDecoratedClass, new Map());
    }
    const fields = decorationRegistry.get(lastDecoratedClass)!;
    if (!fields.has(fieldName)) {
        fields.set(fieldName, []);
    }
    fields.get(fieldName)!.push(...ops);
}

function getFieldDecorations(ctor: object): Map<string, Op[]> | undefined {
    return decorationRegistry.get(ctor);
}

// ZodyError class for validation failures
class ZodyError extends ErrorEx {
    constructor(message: string) {
        super(message);
        this.name = 'ZodyError';
    }
}

// Regex patterns for format validation (ported from validator.ts)
const PATTERNS = {
    url: /^(https?|ftp):\/\/.+/i,
    httpUrl: /^https?:\/\/.+/i,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    hostname: /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
    ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
    ipv6: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/,
    jwt: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    base64: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    hex: /^[0-9a-fA-F]*$/,
};

function testFormat(str: string, format: keyof typeof PATTERNS | RegExp): boolean {
    if (typeof format === 'string') {
        return PATTERNS[format as keyof typeof PATTERNS]?.test(str) ?? false;
    }
    return format.test(str);
}

// Local validator factory functions - no external dependencies
function createValidator<T>(
    typeName: string,
    parseFn: (input: unknown) => T,
    options: {
        optional?: boolean;
        default?: T;
        min?: number | bigint;
        max?: number | bigint;
        gt?: number | bigint;
        lt?: number | bigint;
        gte?: number | bigint;
        lte?: number | bigint;
        email?: boolean;
        int?: boolean;
        float?: boolean;
        url?: boolean;
        uuid?: boolean;
        hostname?: boolean;
        ipv4?: boolean;
        ipv6?: boolean;
        jwt?: boolean;
        base64?: boolean;
        hex?: boolean;
        regex?: { pattern: RegExp | string; message?: string };
        trim?: boolean;
        toLowerCase?: boolean;
        toUpperCase?: boolean;
        minLength?: number;
        maxLength?: number;
        length?: number;
        describe?: string;
    } = {},
): Validator<T> {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation logic necessarily complex
    const parse = (input: unknown): T => {
        // During class initialization, be lenient with undefined values
        const isInitializing = (globalThis as unknown).__z_initializing__;
        if (isInitializing && input === undefined) return undefined as T;

        if (options.optional && input === undefined) return undefined as T;
        if (options.default !== undefined && input === undefined) return options.default;
        if (input === null && !options.optional) throw new ZodyError(`Expected ${typeName}, received null`);

        let result = parseFn(input);

        // String transforms (apply before length checks)
        if (typeof result === 'string') {
            if (options.trim) result = (result as unknown).trim();
            if (options.toLowerCase) result = (result as unknown).toLowerCase();
            if (options.toUpperCase) result = (result as unknown).toUpperCase();
        }

        // Format validations for strings
        if (typeof result === 'string') {
            if (options.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
                throw new ZodyError(`Expected valid email, received ${result}`);
            }
            if (options.url && !testFormat(result, 'url')) {
                throw new ZodyError(`Expected valid URL, received ${result}`);
            }
            if (options.uuid && !testFormat(result, 'uuid')) {
                throw new ZodyError(`Expected valid UUID, received ${result}`);
            }
            if (options.hostname && !testFormat(result, 'hostname')) {
                throw new ZodyError(`Expected valid hostname, received ${result}`);
            }
            if (options.ipv4 && !testFormat(result, 'ipv4')) {
                throw new ZodyError(`Expected valid IPv4, received ${result}`);
            }
            if (options.ipv6 && !testFormat(result, 'ipv6')) {
                throw new ZodyError(`Expected valid IPv6, received ${result}`);
            }
            if (options.jwt && !testFormat(result, 'jwt')) {
                throw new ZodyError(`Expected valid JWT, received ${result}`);
            }
            if (options.base64 && !testFormat(result, 'base64')) {
                throw new ZodyError(`Expected valid base64, received ${result}`);
            }
            if (options.hex && !testFormat(result, 'hex')) {
                throw new ZodyError(`Expected valid hex, received ${result}`);
            }
            if (options.regex) {
                const pattern =
                    typeof options.regex.pattern === 'string' ? new RegExp(options.regex.pattern) : options.regex.pattern;
                if (!pattern.test(result)) {
                    throw new ZodyError(
                        options.regex.message || `Expected to match pattern ${pattern.source}, received ${result}`,
                    );
                }
            }

            // For strings, min/max can mean minLength/maxLength
            if (options.min !== undefined && result.length < Number(options.min)) {
                throw new ZodyError(`Expected string with min length ${options.min}, received ${result.length}`);
            }
            if (options.max !== undefined && result.length > Number(options.max)) {
                throw new ZodyError(`Expected string with max length ${options.max}, received ${result.length}`);
            }

            // Length validations for strings (minLength/maxLength are more explicit)
            if (options.minLength !== undefined && result.length < options.minLength) {
                throw new ZodyError(`Expected string with min length ${options.minLength}, received ${result.length}`);
            }
            if (options.maxLength !== undefined && result.length > options.maxLength) {
                throw new ZodyError(`Expected string with max length ${options.maxLength}, received ${result.length}`);
            }
            if (options.length !== undefined && result.length !== options.length) {
                throw new ZodyError(`Expected string with length ${options.length}, received ${result.length}`);
            }
        }

        // Numeric constraints
        if (typeof result === 'number' || typeof result === 'bigint') {
            if (options.int && typeof result === 'number' && !Number.isInteger(result)) {
                throw new ZodyError(`Expected integer, received decimal`);
            }
            if (options.float && typeof result === 'number' && Number.isInteger(result)) {
                // Allow floats that happen to be integers
            }
            if (options.min !== undefined && result < (options.min as unknown)) {
                throw new ZodyError(`Expected >= ${options.min}, received ${result}`);
            }
            if (options.max !== undefined && result > (options.max as unknown)) {
                throw new ZodyError(`Expected <= ${options.max}, received ${result}`);
            }
            if (options.gte !== undefined && result < (options.gte as unknown)) {
                throw new ZodyError(`Expected >= ${options.gte}, received ${result}`);
            }
            if (options.lte !== undefined && result > (options.lte as unknown)) {
                throw new ZodyError(`Expected <= ${options.lte}, received ${result}`);
            }
            if (options.gt !== undefined && result <= (options.gt as unknown)) {
                throw new ZodyError(`Expected > ${options.gt}, received ${result}`);
            }
            if (options.lt !== undefined && result >= (options.lt as unknown)) {
                throw new ZodyError(`Expected < ${options.lt}, received ${result}`);
            }
        }

        return result;
    };

    const validator: Validator<T> = (input: unknown) => parse(input);
    validator.parse = parse;
    validator.safeParse = (input: unknown) => {
        try {
            return { success: true, data: parse(input) };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    };

    // Compile into a specialized fast path
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compilation dispatches all type handlers
    validator.compile = (): CompiledNode<T> => {
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation logic necessarily complex
        const compiledParse = (input: unknown): T => {
            const isInitializing = (globalThis as unknown).__z_initializing__;
            if (isInitializing && input === undefined) return undefined as T;

            if (options.optional && input === undefined) return undefined as T;
            if (options.default !== undefined && input === undefined) return options.default;
            if (input === null && !options.optional) throw new ZodyError(`Expected ${typeName}, received null`);

            let result = parseFn(input);

            // String transforms (apply before length checks)
            if (typeof result === 'string') {
                if (options.trim) result = (result as unknown).trim();
                if (options.toLowerCase) result = (result as unknown).toLowerCase();
                if (options.toUpperCase) result = (result as unknown).toUpperCase();
            }

            // Format validations for strings
            if (typeof result === 'string') {
                if (options.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
                    throw new ZodyError(`Expected valid email, received ${result}`);
                }
                if (options.url && !testFormat(result, 'url')) {
                    throw new ZodyError(`Expected valid URL, received ${result}`);
                }
                if (options.uuid && !testFormat(result, 'uuid')) {
                    throw new ZodyError(`Expected valid UUID, received ${result}`);
                }
                if (options.hostname && !testFormat(result, 'hostname')) {
                    throw new ZodyError(`Expected valid hostname, received ${result}`);
                }
                if (options.ipv4 && !testFormat(result, 'ipv4')) {
                    throw new ZodyError(`Expected valid IPv4, received ${result}`);
                }
                if (options.ipv6 && !testFormat(result, 'ipv6')) {
                    throw new ZodyError(`Expected valid IPv6, received ${result}`);
                }
                if (options.jwt && !testFormat(result, 'jwt')) {
                    throw new ZodyError(`Expected valid JWT, received ${result}`);
                }
                if (options.base64 && !testFormat(result, 'base64')) {
                    throw new ZodyError(`Expected valid base64, received ${result}`);
                }
                if (options.hex && !testFormat(result, 'hex')) {
                    throw new ZodyError(`Expected valid hex, received ${result}`);
                }
                if (options.regex) {
                    const pattern =
                        typeof options.regex.pattern === 'string' ? new RegExp(options.regex.pattern) : options.regex.pattern;
                    if (!pattern.test(result)) {
                        throw new ZodyError(
                            options.regex.message || `Expected to match pattern ${pattern.source}, received ${result}`,
                        );
                    }
                }

                // For strings, min/max can mean minLength/maxLength
                if (options.min !== undefined && result.length < Number(options.min)) {
                    throw new ZodyError(`Expected string with min length ${options.min}, received ${result.length}`);
                }
                if (options.max !== undefined && result.length > Number(options.max)) {
                    throw new ZodyError(`Expected string with max length ${options.max}, received ${result.length}`);
                }

                // Length validations for strings (minLength/maxLength are more explicit)
                if (options.minLength !== undefined && result.length < options.minLength) {
                    throw new ZodyError(`Expected string with min length ${options.minLength}, received ${result.length}`);
                }
                if (options.maxLength !== undefined && result.length > options.maxLength) {
                    throw new ZodyError(`Expected string with max length ${options.maxLength}, received ${result.length}`);
                }
                if (options.length !== undefined && result.length !== options.length) {
                    throw new ZodyError(`Expected string with length ${options.length}, received ${result.length}`);
                }
            }

            // Numeric constraints
            if (typeof result === 'number' || typeof result === 'bigint') {
                if (options.int && typeof result === 'number' && !Number.isInteger(result)) {
                    throw new ZodyError(`Expected integer, received decimal`);
                }
                if (options.float && typeof result === 'number' && Number.isInteger(result)) {
                    // Allow floats that happen to be integers
                }
                if (options.min !== undefined && result < (options.min as unknown)) {
                    throw new ZodyError(`Expected >= ${options.min}, received ${result}`);
                }
                if (options.max !== undefined && result > (options.max as unknown)) {
                    throw new ZodyError(`Expected <= ${options.max}, received ${result}`);
                }
                if (options.gte !== undefined && result < (options.gte as unknown)) {
                    throw new ZodyError(`Expected >= ${options.gte}, received ${result}`);
                }
                if (options.lte !== undefined && result > (options.lte as unknown)) {
                    throw new ZodyError(`Expected <= ${options.lte}, received ${result}`);
                }
                if (options.gt !== undefined && result <= (options.gt as unknown)) {
                    throw new ZodyError(`Expected > ${options.gt}, received ${result}`);
                }
                if (options.lt !== undefined && result >= (options.lt as unknown)) {
                    throw new ZodyError(`Expected < ${options.lt}, received ${result}`);
                }
            }

            return result;
        };

        return {
            validate(input: unknown): boolean {
                try {
                    compiledParse(input);
                    return true;
                } catch {
                    return false;
                }
            },
            parse(input: unknown): T {
                return compiledParse(input);
            },
        };
    };

    // Chainable methods
    validator.optional = () => createValidator(typeName, parseFn, { ...options, optional: true });
    validator.nullable = () => createValidator(typeName, (v) => (v === null ? null : parseFn(v)), options);
    validator.default = (v: T) => createValidator(typeName, parseFn, { ...options, default: v });
    validator.min = (v: number | bigint) => createValidator(typeName, parseFn, { ...options, min: v });
    validator.max = (v: number | bigint) => createValidator(typeName, parseFn, { ...options, max: v });
    validator.gte = (v: number | bigint) => createValidator(typeName, parseFn, { ...options, gte: v });
    validator.lte = (v: number | bigint) => createValidator(typeName, parseFn, { ...options, lte: v });
    validator.gt = (v: number | bigint) => createValidator(typeName, parseFn, { ...options, gt: v });
    validator.lt = (v: number | bigint) => createValidator(typeName, parseFn, { ...options, lt: v });
    validator.email = () => createValidator(typeName, parseFn, { ...options, email: true });
    validator.int = () => createValidator(typeName, parseFn, { ...options, int: true });
    validator.float = () => createValidator(typeName, parseFn, { ...options, float: true });
    validator.url = () => createValidator(typeName, parseFn, { ...options, url: true });
    validator.uuid = () => createValidator(typeName, parseFn, { ...options, uuid: true });
    validator.hostname = () => createValidator(typeName, parseFn, { ...options, hostname: true });
    validator.ipv4 = () => createValidator(typeName, parseFn, { ...options, ipv4: true });
    validator.ipv6 = () => createValidator(typeName, parseFn, { ...options, ipv6: true });
    validator.jwt = () => createValidator(typeName, parseFn, { ...options, jwt: true });
    validator.base64 = () => createValidator(typeName, parseFn, { ...options, base64: true });
    validator.hex = () => createValidator(typeName, parseFn, { ...options, hex: true });
    validator.regex = (pattern: RegExp | string, message?: string) =>
        createValidator(typeName, parseFn, { ...options, regex: { pattern, message } });
    validator.trim = () => createValidator(typeName, parseFn, { ...options, trim: true });
    validator.toLowerCase = () => createValidator(typeName, parseFn, { ...options, toLowerCase: true });
    validator.toUpperCase = () => createValidator(typeName, parseFn, { ...options, toUpperCase: true });
    validator.minLength = (len: number) => createValidator(typeName, parseFn, { ...options, minLength: len });
    validator.maxLength = (len: number) => createValidator(typeName, parseFn, { ...options, maxLength: len });
    validator.describe = (text: string) => createValidator(typeName, parseFn, { ...options, describe: text });

    // Use Object.defineProperty for 'length' since it's read-only on functions
    Object.defineProperty(validator, 'length', {
        value: (len: number) => createValidator(typeName, parseFn, { ...options, length: len }),
        writable: false,
        enumerable: false,
        configurable: true,
    });

    return validator;
}

const stringValidator = () =>
    createValidator('string', (v) => {
        if (typeof v === 'string') return v;
        throw new Error(`Expected string, received ${typeof v}`);
    });

const numberValidator = () =>
    createValidator('number', (v) => {
        if (typeof v === 'number') return v;
        const coerced = Number(v);
        if (Number.isNaN(coerced)) throw new Error(`Cannot coerce ${typeof v} to number`);
        return coerced;
    });

const booleanValidator = () =>
    createValidator('boolean', (v) => {
        if (typeof v === 'boolean') return v;
        throw new Error(`Expected boolean, received ${typeof v}`);
    });

const bigintValidator = () =>
    createValidator('bigint', (v) => {
        if (typeof v === 'bigint') return v;
        try {
            return BigInt(v);
        } catch {
            throw new Error(`Cannot coerce ${typeof v} to bigint`);
        }
    });

const dateValidator = () =>
    createValidator('Date', (v) => {
        if (v instanceof Date) return v;
        const coerced = new Date(v);
        if (Number.isNaN(coerced.getTime())) throw new Error(`Cannot coerce ${typeof v} to Date`);
        return coerced;
    });

const arrayValidator = (
    inner: Validator<unknown> = { parse: (v) => v, safeParse: (v) => ({ success: true, data: v }) } as unknown,
) => {
    const validator = createValidator('array', (v) => {
        if (!Array.isArray(v)) throw new Error(`Expected array, received ${typeof v}`);
        return v.map((item) => inner.parse(item));
    });

    const baseCompile = validator.compile;
    validator.compile = () => {
        const compiled = inner.compile?.() ?? { validate: (_v: unknown) => true, parse: (v: unknown) => v };
        const baseNode = baseCompile();

        return {
            validate(input: unknown): boolean {
                if (!Array.isArray(input)) return false;
                for (const item of input) {
                    if (!compiled.validate(item)) return false;
                }
                return true;
            },
            parse(input: unknown) {
                return baseNode.parse(input);
            },
        };
    };

    return validator;
};

const unknownValidator = () => createValidator('unknown', (v) => v);

const objectValidator = (shape: Record<string, Validator<unknown>>) => {
    const validator = createValidator('object', (v) => {
        if (typeof v !== 'object' || v === null) throw new Error(`Expected object, received ${typeof v}`);
        const result: Record<string, unknown> = {};
        for (const [key, validator] of Object.entries(shape)) {
            result[key] = validator.parse((v as unknown)[key]);
        }
        return result;
    });

    const baseCompile = validator.compile;
    validator.compile = () => {
        const compiledFields: Array<[string, CompiledNode]> = [];
        for (const [key, fieldValidator] of Object.entries(shape)) {
            const compiled = fieldValidator.compile?.() ?? { validate: (_v: unknown) => true, parse: (v: unknown) => v };
            compiledFields.push([key, compiled]);
        }

        const baseNode = baseCompile();

        return {
            validate(input: unknown): boolean {
                if (typeof input !== 'object' || input === null) return false;
                for (const [key, compiled] of compiledFields) {
                    if (!compiled.validate((input as unknown)[key])) return false;
                }
                return true;
            },
            parse(input: unknown) {
                return baseNode.parse(input);
            },
        };
    };

    return validator;
};

export type ZodyInfer<T extends { [PHANTOM]?: unknown }> = T extends { [PHANTOM]?: infer O } ? O : never;
export type ZodyInferInput<T extends { [PHANTOM]?: unknown }> = T extends { [PHANTOM]?: { input: infer I } } ? I : never;
export type ZodyInferOutput<T extends { [PHANTOM]?: unknown }> = T extends { [PHANTOM]?: { output: infer O } } ? O : never;

type Op =
    | { kind: 'root'; value: RootKind }
    | { kind: 'int' }
    | { kind: 'float' }
    | { kind: 'min'; value: number | bigint }
    | { kind: 'max'; value: number | bigint }
    | { kind: 'gte'; value: number | bigint }
    | { kind: 'lte'; value: number | bigint }
    | { kind: 'gt'; value: number | bigint }
    | { kind: 'lt'; value: number | bigint }
    | { kind: 'email' }
    | { kind: 'url' }
    | { kind: 'uuid' }
    | { kind: 'hostname' }
    | { kind: 'ipv4' }
    | { kind: 'ipv6' }
    | { kind: 'jwt' }
    | { kind: 'base64' }
    | { kind: 'hex' }
    | { kind: 'regex'; value: { pattern: RegExp | string; message?: string } }
    | { kind: 'trim' }
    | { kind: 'toLowerCase' }
    | { kind: 'toUpperCase' }
    | { kind: 'minLength'; value: number }
    | { kind: 'maxLength'; value: number }
    | { kind: 'length'; value: number }
    | { kind: 'describe'; value: string }
    | { kind: 'optional' }
    | { kind: 'nullable' }
    | { kind: 'default'; value: unknown }
    | { kind: 'arrayOf'; value: ChainSpec }
    | { kind: 'unionOf'; value: ChainSpec[] };

type ChainSpec = { ops: Op[] };

type FieldMeta = {
    key: string;
    ops: Op[];
    inferredType?: RootKind | undefined;
    optional?: boolean;
    defaultValue?: unknown;
};

type ClassMeta = {
    fields: Map<string, FieldMeta>;
    inferDefault: boolean;
    sealed?: boolean;
};

type DecoratorFn = ((value: undefined, context: ClassFieldDecoratorContext) => void) & Record<string, unknown>;

// Type inference: extract the parsed/validated type from the schema validator
type InferIn<T extends Ctor> = T extends { toZod(): Validator<infer S> } ? Parameters<Validator<S>['parse']>[0] : never;
type InferOut<T extends Ctor> = T extends { toZod(): Validator<infer S> } ? S : never;

function getClassMeta(ctor: object): ClassMeta {
    if (!ctor[META_KEY]) {
        Object.defineProperty(ctor, META_KEY, {
            value: { fields: new Map(), inferDefault: true } satisfies ClassMeta,
            enumerable: false,
            configurable: false,
            writable: false,
        });
    }
    return ctor[META_KEY] as ClassMeta;
}

function getOrCreateFieldMeta(owner: object, key: string): FieldMeta {
    const meta = getClassMeta(owner.constructor ?? owner);
    let field = meta.fields.get(key);
    if (!field) {
        field = { key, ops: [] };
        meta.fields.set(key, field);
    }
    return field;
}

function _tsCtorToRoot(ctor: object): RootKind | undefined {
    if (ctor === String) return 'string';
    if (ctor === Number) return 'number';
    if (ctor === Boolean) return 'boolean';
    if (ctor === BigInt) return 'bigint';
    if (ctor === Date) return 'date';
    if (ctor === Array) return 'array';
    return undefined;
}

function makeDecorator(spec: ChainSpec): DecoratorFn {
    const plus = (op: Op) => makeDecorator({ ops: [...spec.ops, op] });

    const dec: any = (_value: undefined, context: ClassFieldDecoratorContext) => {
        const fieldName = String(context.name);

        // Store the decorator spec on the context metadata for later retrieval
        // This allows the Schema decorator to access field decorator info without needing instances
        const metadata = (context.metadata as unknown) ?? {};
        if (!metadata[Symbol.for('zody.fields')]) {
            metadata[Symbol.for('zody.fields')] = {};
        }
        (metadata[Symbol.for('zody.fields')] as unknown)[fieldName] = {
            ops: spec.ops,
        };

        // Use addInitializer to capture both decorator info AND default values
        let initializerRan = false;
        context.addInitializer(function () {
            if (initializerRan) return; // Prevent duplicate execution
            initializerRan = true;

            const ctor = (this as unknown).constructor;

            // Register the field decoration in the global registry
            registerFieldDecoration(fieldName, spec.ops);

            const field = getOrCreateFieldMeta(ctor, fieldName);
            // Only add ops from addInitializer if not already added
            if (!field.ops.some((op) => spec.ops.includes(op))) {
                field.ops.push(...spec.ops);
            }

            // Capture the initial value (default) if present
            const current = (this as unknown)[fieldName];
            if (current !== undefined) {
                field.defaultValue = current;
                field.inferredType ??= inferFromValue(current);
            }
        });
    };

    // Create lazy getter using Object.defineProperty one at a time to avoid conflicts
    const addLazyGetter = (name: string, fn: () => DecoratorFn) => {
        Object.defineProperty(dec, name, {
            get: fn,
            configurable: true,
            enumerable: false,
        });
    };

    // Root types
    addLazyGetter('string', () => plus({ kind: 'root', value: 'string' }));
    addLazyGetter('number', () => plus({ kind: 'root', value: 'number' }));
    addLazyGetter('boolean', () => plus({ kind: 'root', value: 'boolean' }));
    addLazyGetter('bigint', () => plus({ kind: 'root', value: 'bigint' }));
    addLazyGetter('date', () => plus({ kind: 'root', value: 'date' }));
    addLazyGetter('int', () => makeDecorator({ ops: [...spec.ops, { kind: 'root', value: 'number' }, { kind: 'int' }] }));
    addLazyGetter('float', () => makeDecorator({ ops: [...spec.ops, { kind: 'root', value: 'number' }, { kind: 'float' }] }));

    // Formats
    addLazyGetter('email', () => plus({ kind: 'email' }));
    addLazyGetter('url', () => plus({ kind: 'url' }));
    addLazyGetter('uuid', () => plus({ kind: 'uuid' }));
    addLazyGetter('hostname', () => plus({ kind: 'hostname' }));
    addLazyGetter('ipv4', () => plus({ kind: 'ipv4' }));
    addLazyGetter('ipv6', () => plus({ kind: 'ipv6' }));
    addLazyGetter('jwt', () => plus({ kind: 'jwt' }));
    addLazyGetter('base64', () => plus({ kind: 'base64' }));
    addLazyGetter('hex', () => plus({ kind: 'hex' }));

    // Transforms
    addLazyGetter('trim', () => plus({ kind: 'trim' }));
    addLazyGetter('toLowerCase', () => plus({ kind: 'toLowerCase' }));
    addLazyGetter('toUpperCase', () => plus({ kind: 'toUpperCase' }));

    // Null handling
    addLazyGetter('optional', () => plus({ kind: 'optional' }));
    addLazyGetter('nullable', () => plus({ kind: 'nullable' }));

    // Methods
    dec.min = (value: number | bigint) => plus({ kind: 'min', value });
    dec.max = (value: number | bigint) => plus({ kind: 'max', value });
    dec.gte = (value: number | bigint) => plus({ kind: 'gte', value });
    dec.lte = (value: number | bigint) => plus({ kind: 'lte', value });
    dec.gt = (value: number | bigint) => plus({ kind: 'gt', value });
    dec.lt = (value: number | bigint) => plus({ kind: 'lt', value });
    dec.default = (value: unknown) => plus({ kind: 'default', value });
    dec.array = (inner?: ChainSpec | DecoratorFn) => {
        const innerSpec = inner && 'ops' in (inner as unknown) ? (inner as unknown as ChainSpec) : { ops: [] };
        return makeDecorator({ ops: [...spec.ops, { kind: 'root', value: 'array' }, { kind: 'arrayOf', value: innerSpec }] });
    };
    dec.union = (options: (ChainSpec | DecoratorFn)[]) => plus({ kind: 'unionOf', value: options as ChainSpec[] });
    dec.regex = (pattern: RegExp | string, message?: string) => plus({ kind: 'regex', value: { pattern, message } });
    dec.minLength = (len: number) => plus({ kind: 'minLength', value: len });
    dec.maxLength = (len: number) => plus({ kind: 'maxLength', value: len });
    dec.describe = (text: string) => plus({ kind: 'describe', value: text });
    dec.ops = spec.ops;

    // Define 'length' using Object.defineProperty since it's read-only on functions
    Object.defineProperty(dec, 'length', {
        value: (len: number) => plus({ kind: 'length', value: len }),
        writable: false,
        enumerable: false,
        configurable: true,
    });

    return dec as DecoratorFn;
}

function inferFromValue(value: unknown): RootKind | undefined {
    switch (typeof value) {
        case 'string':
            return 'string';
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'bigint':
            return 'bigint';
        case 'object':
            if (value instanceof Date) return 'date';
            if (Array.isArray(value)) return 'array';
            return undefined;
        default:
            return undefined;
    }
}

function gatherMeta(ctor: object): ClassMeta {
    const chain: any[] = [];
    let cur = ctor;
    while (cur && cur !== Function.prototype) {
        if (cur[META_KEY]) chain.unshift(cur[META_KEY]);
        cur = Object.getPrototypeOf(cur);
    }
    const out: ClassMeta = { fields: new Map(), inferDefault: true };
    for (const meta of chain as ClassMeta[]) {
        out.inferDefault = meta.inferDefault;
        for (const [k, v] of meta.fields) {
            const prev = out.fields.get(k);
            out.fields.set(k, prev ? { ...prev, ...v, ops: [...prev.ops, ...v.ops] } : { ...v, ops: [...v.ops] });
        }
    }
    return out;
}

function normalizeField(field: FieldMeta, inferDefault: boolean): FieldMeta {
    const roots = field.ops.filter((x) => x.kind === 'root').map((x) => x.value as RootKind);
    const unique = [...new Set(roots)];
    if (unique.length > 1) throw new Error(`zody schema conflict on ${field.key}: multiple roots ${unique.join(', ')}`);
    const explicit = unique[0];
    if (explicit && field.inferredType && explicit !== field.inferredType) {
        throw new Error(`zody schema conflict on ${field.key}: inferred ${field.inferredType} contradicts explicit ${explicit}`);
    }
    const inferred = explicit ?? field.inferredType;
    if (!inferred)
        throw new Error(`zody schema error on ${field.key}: cannot infer type - please use @z.string, @z.number, etc.`);
    const out: FieldMeta = { ...field, ops: [...field.ops], inferredType: inferred };
    if (inferDefault && field.defaultValue !== undefined && !out.ops.some((x) => x.kind === 'default')) {
        out.ops.push({ kind: 'default', value: field.defaultValue });
    }
    return out;
}

function applyOps(schema: any, field: FieldMeta): any {
    for (const op of field.ops) {
        switch (op.kind) {
            case 'root':
                break; // Skip root ops, they're handled by toZodNode
            case 'int':
                schema = schema.int();
                break;
            case 'float':
                schema = schema.float();
                break;
            case 'min':
                schema = schema.min(op.value as unknown);
                break;
            case 'max':
                schema = schema.max(op.value as unknown);
                break;
            case 'gte':
                schema = schema.gte(op.value as unknown);
                break;
            case 'lte':
                schema = schema.lte(op.value as unknown);
                break;
            case 'gt':
                schema = schema.gt(op.value as unknown);
                break;
            case 'lt':
                schema = schema.lt(op.value as unknown);
                break;
            case 'email':
                schema = schema.email();
                break;
            case 'url':
                schema = schema.url();
                break;
            case 'uuid':
                schema = schema.uuid();
                break;
            case 'hostname':
                schema = schema.hostname();
                break;
            case 'ipv4':
                schema = schema.ipv4();
                break;
            case 'ipv6':
                schema = schema.ipv6();
                break;
            case 'jwt':
                schema = schema.jwt();
                break;
            case 'base64':
                schema = schema.base64();
                break;
            case 'hex':
                schema = schema.hex();
                break;
            case 'regex':
                schema = schema.regex(op.value.pattern, op.value.message);
                break;
            case 'trim':
                schema = schema.trim();
                break;
            case 'toLowerCase':
                schema = schema.toLowerCase();
                break;
            case 'toUpperCase':
                schema = schema.toUpperCase();
                break;
            case 'minLength':
                schema = schema.minLength(op.value);
                break;
            case 'maxLength':
                schema = schema.maxLength(op.value);
                break;
            case 'length':
                schema = schema.length(op.value);
                break;
            case 'describe':
                break; // describe is only used in .defs(), not at parse time
            case 'optional':
                schema = schema.optional();
                break;
            case 'nullable':
                schema = schema.nullable();
                break;
            case 'default':
                schema = schema.default(op.value as unknown);
                break;
        }
    }
    return schema;
}

function toZodNode(field: FieldMeta): Validator<any> {
    let schema: Validator<any>;
    switch (field.inferredType) {
        case 'string':
            schema = stringValidator();
            break;
        case 'number':
            schema = numberValidator();
            break;
        case 'boolean':
            schema = booleanValidator();
            break;
        case 'bigint':
            schema = bigintValidator();
            break;
        case 'date':
            schema = dateValidator();
            break;
        case 'array': {
            const arrayOp = field.ops.find((x) => x.kind === 'arrayOf') as Extract<Op, { kind: 'arrayOf' }> | undefined;
            const inner = arrayOp ? toZodFromSpec(arrayOp.value as ChainSpec) : unknownValidator();
            schema = arrayValidator(inner);
            break;
        }
        case 'union': {
            const unionOp = field.ops.find((x) => x.kind === 'unionOf') as Extract<Op, { kind: 'unionOf' }> | undefined;
            if (!unionOp) throw new Error(`zody schema error on ${field.key}: missing union options`);
            schema = toZodFromSpec(unionOp.value[0]);
            break;
        }
        default:
            throw new Error(`Unsupported root ${field.inferredType}`);
    }
    if (field.optional && !field.ops.some((x) => x.kind === 'optional') && !field.ops.some((x) => x.kind === 'default')) {
        schema = schema.optional();
    }
    return applyOps(schema, field);
}

function toZodFromSpec(spec: ChainSpec): any {
    const fake: FieldMeta = normalizeField({ key: '<inline>', ops: spec.ops }, false);
    return toZodNode(fake);
}

function makeCompiledValidate(schema: object) {
    const compiled = schema.compile?.();
    return compiled ? (input: unknown) => compiled.validate(input) : (input: unknown) => schema.safeParse(input).success;
}

function buildArtifacts(ctor: object) {
    if (ctor[CACHE]) return ctor[CACHE];
    const meta = gatherMeta(ctor);
    const shape: Record<string, any> = {};
    for (const [key, raw] of meta.fields) {
        const norm = normalizeField(raw, meta.inferDefault);
        shape[key] = toZodNode(norm);
    }
    const schema = objectValidator(shape);
    const validate = makeCompiledValidate(schema);
    const cache = { schema, validate };
    Object.defineProperty(ctor, CACHE, { value: cache, enumerable: false });
    return cache;
}

function Schema(options?: { inferDefault?: boolean; autocompile?: boolean }) {
    return <T extends Ctor>(target: T, _context: ClassDecoratorContext<T>) => {
        const meta = getClassMeta(target);
        meta.inferDefault = options?.inferDefault ?? true;
        const shouldAutocompile = options?.autocompile ?? false;

        class ZodyClass extends (target as unknown) {
            static toZod() {
                return buildArtifacts(ZodyClass).schema;
            }
            static validate(input: unknown): input is InferOut<typeof ZodyClass> {
                return buildArtifacts(ZodyClass).validate(input);
            }
            static safeParse(input: unknown) {
                return ZodyClass.toZod().safeParse(input);
            }
            static parse(input: unknown) {
                return ZodyClass.toZod().parse(input);
            }
            static defs(includeSchemaVersion = true): Record<string, any> {
                const metadata = gatherMeta(ZodyClass);
                const properties: Record<string, any> = {};
                const required: string[] = [];

                for (const [key, field] of metadata.fields) {
                    const norm = normalizeField(field, metadata.inferDefault);
                    const propSchema = buildPropertySchema(norm);
                    properties[key] = propSchema;

                    // Add to required if not optional and not nullable and no default
                    if (
                        !norm.ops.some((op) => op.kind === 'optional') &&
                        !norm.ops.some((op) => op.kind === 'nullable') &&
                        !norm.ops.some((op) => op.kind === 'default')
                    ) {
                        required.push(key);
                    }
                }

                const schema: Record<string, any> = {
                    type: 'object',
                    properties,
                };

                if (required.length > 0) {
                    schema.required = required;
                }

                if (includeSchemaVersion) {
                    schema.$schema = 'http://json-schema.org/draft-07/schema#';
                }

                return schema;
            }
            static [PHANTOM]?: { input: InferIn<typeof ZodyClass>; output: InferOut<typeof ZodyClass> };
        }

        Object.defineProperty(ZodyClass, META_KEY, { value: meta, enumerable: false });

        // Set the last decorated class for field decorators to register with
        setLastDecoratedClass(ZodyClass);

        // Trigger field initializers by creating a temporary instance with undefined values
        // This ensures field decorator metadata is populated at class definition time
        // Mark that we're in initialization mode so validators don't throw on undefined
        const originalIsInitializing = (globalThis as unknown).__z_initializing__;
        (globalThis as unknown).__z_initializing__ = true;
        try {
            new (ZodyClass as unknown)();
        } catch (_e) {
            // Ignore errors from instantiation - some initializers may have run anyway
        } finally {
            (globalThis as unknown).__z_initializing__ = originalIsInitializing;
        }

        // Populate any missing field metadata from the global decoration registry
        // This handles fields that don't have initializers (no default values)
        const registeredFields = getFieldDecorations(ZodyClass);
        if (registeredFields) {
            for (const [fieldName, ops] of registeredFields) {
                // Directly add to meta.fields instead of using getOrCreateFieldMeta
                if (!meta.fields.has(fieldName)) {
                    meta.fields.set(fieldName, { key: fieldName, ops: [] });
                }
                const field = meta.fields.get(fieldName)!;
                // Add ops that haven't been added yet
                for (const op of ops) {
                    if (!field.ops.includes(op)) {
                        field.ops.push(op);
                    }
                }
            }
        }

        // Trigger autocompile if requested
        if (shouldAutocompile) {
            setImmediate(() => {
                buildArtifacts(ZodyClass);
            });
        }

        return ZodyClass as unknown;
    };
}

function buildPropertySchema(field: FieldMeta): Record<string, any> {
    const schema: Record<string, any> = {};

    // Determine base type
    const isOptional = field.ops.some((op) => op.kind === 'optional');
    const isNullable = field.ops.some((op) => op.kind === 'nullable');

    if (field.inferredType === 'string') {
        schema.type = 'string';
    } else if (field.inferredType === 'number') {
        schema.type = 'number';
    } else if (field.inferredType === 'boolean') {
        schema.type = 'boolean';
    } else if (field.inferredType === 'date') {
        schema.type = 'string';
        schema.format = 'date-time';
    } else if (field.inferredType === 'bigint') {
        schema.type = 'integer';
    } else if (field.inferredType === 'array') {
        schema.type = 'array';
        const arrayOp = field.ops.find((x) => x.kind === 'arrayOf') as Extract<Op, { kind: 'arrayOf' }> | undefined;
        if (arrayOp) {
            const innerField = normalizeField({ key: '<inner>', ops: (arrayOp.value as ChainSpec).ops }, false);
            schema.items = buildPropertySchema(innerField);
        } else {
            schema.items = {};
        }
    }

    // Apply constraints
    for (const op of field.ops) {
        switch (op.kind) {
            case 'email':
                schema.format = 'email';
                break;
            case 'url':
                schema.format = 'uri';
                break;
            case 'uuid':
                schema.format = 'uuid';
                break;
            case 'hostname':
                schema.format = 'hostname';
                break;
            case 'ipv4':
                schema.format = 'ipv4';
                break;
            case 'ipv6':
                schema.format = 'ipv6';
                break;
            case 'jwt':
                schema.pattern = '^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*$';
                break;
            case 'base64':
                schema.pattern = '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';
                break;
            case 'hex':
                schema.pattern = '^[0-9a-fA-F]*$';
                break;
            case 'regex':
                schema.pattern = typeof op.value.pattern === 'string' ? op.value.pattern : op.value.pattern.source;
                break;
            case 'minLength':
                schema.minLength = op.value;
                break;
            case 'maxLength':
                schema.maxLength = op.value;
                break;
            case 'length':
                schema.minLength = op.value;
                schema.maxLength = op.value;
                break;
            case 'min':
                schema.minimum = Number(op.value);
                break;
            case 'max':
                schema.maximum = Number(op.value);
                break;
            case 'gte':
                schema.minimum = Number(op.value);
                break;
            case 'lte':
                schema.maximum = Number(op.value);
                break;
            case 'gt':
                schema.exclusiveMinimum = Number(op.value);
                break;
            case 'lt':
                schema.exclusiveMaximum = Number(op.value);
                break;
            case 'int':
                schema.type = 'integer';
                break;
            case 'float':
                schema.type = 'number';
                break;
            case 'describe':
                schema.description = op.value;
                break;
        }
    }

    // Handle optional/nullable
    if (isOptional || isNullable) {
        if (isNullable) {
            schema.type = [schema.type, 'null'];
        }
        // Optional means it's not in required[], no schema change needed
    }

    return schema;
}

// Internal functional-layer exports for test schemas within zody package
// These are not exported from the main barrel (index.ts) to avoid namespace collision
// but are available for internal tests and ad-hoc schemas
const string = stringValidator;
const number = numberValidator;
const boolean = booleanValidator;
const bigint = bigintValidator;
const date = dateValidator;
const array = arrayValidator;
const object = objectValidator;
const unknown = unknownValidator;

// Export for internal/test use only
export { array, bigint, boolean, date, number, object, string, unknown };

// Type for zody class constructors
export type ZodyCtor<T = any> = {
    parse(input: unknown): T;
    safeParse(input: unknown): { success: boolean; data?: T; error?: Error };
    toZod(): Validator<T>;
    defs(includeSchemaVersion?: boolean): Record<string, any>;
};

const baseDecorator = makeDecorator({ ops: [] });

export const z: any = baseDecorator;

// Add Schema and toZod - keep the lazy getters from makeDecorator for decorators
Object.defineProperties(z, {
    Schema: { value: Schema, writable: false, enumerable: true, configurable: false },
    toZod: {
        value: <T extends Ctor>(ctor: T) => buildArtifacts(ctor).schema,
        writable: false,
        enumerable: true,
        configurable: false,
    },
});

export namespace z {
    export type Infer<T extends Ctor> = InferOut<T>;
    export type InferInput<T extends Ctor> = InferIn<T>;
    export type InferOutput<T extends Ctor> = InferOut<T>;
}

// Export error class
export { ZodyError };
