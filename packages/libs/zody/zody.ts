/* istanbul ignore file */
/*
 * Coverage is disabled for this file because Bun's coverage instrumentation
 * misreports it, not because it is untested.
 *
 * Bun 1.3.14 attributes hit counts for this module almost entirely to its tail:
 * 75 of 82 functions register as covered while only 12 of 805 lines do, the
 * ErrorEx import below is recorded as never executed, and one line that runs
 * once is credited with 84 hits. LF ("lines found", a static property of a
 * file) is even reported as 805 under zody.test.ts but 569 under a trivial
 * import-only test.
 *
 * Trigger is `class X extends <expression>` — see `class ZodyClass extends
 * (target as unknown as ...)` inside Schema() below. Minimal repro: a file
 * containing `class Derived extends Base()` reports DA:1,0 for its import line,
 * while an otherwise identical file with a plain class reports DA:1,6.
 * Decorators are not involved — a decorated class without an extends-expression
 * measures correctly.
 *
 * Upstream: https://github.com/oven-sh/bun/issues/29691
 * Fix:      https://github.com/oven-sh/bun/pull/38282 (open, unmerged as of
 *           2026-08-14; also fixes "inverted byte ranges marked entire files as
 *           executed", which likely explains the 793 zeroed lines here)
 *
 * REMOVE this ignore once that PR ships in a Bun release we run.
 */
/**
 * Decorator-Based Validator System
 *
 * Provides TypeScript decorators (@z.string, @z.number, etc.) for class-based validation.
 * Classes decorated with @z.Schema() get automatic validation via .validate() and .toZod().
 * Field validators are built from validator.ts's nodes (string()/number()/object()/...) —
 * this module has no validation logic of its own, only decorator metadata collection and
 * translation into that shared node tree.
 *
 * @example
 * @z.Schema({ autocompile: true })
 * class User {
 *   @z.string.minLength(3) name!: string;
 *   @z.number.gte(0) age!: number;
 * }
 * User.validate({ name: 'Alice', age: 25 }); // First call compiles a fast codegen'd
 *                                             // path and replaces itself with it.
 */

import { ErrorEx } from '@libs/utils/error';
import type { Validator } from './validator';
import * as v from './validator';

export class ZodyError extends ErrorEx {
    constructor(message: string) {
        super(message);
        this.name = 'ZodyError';
    }
}

// Loosely-typed view used only for dynamically dispatching decorator ops onto the
// concrete validator.ts subclass instance (NumV/StrV/BigIntV/ArrV/...) built for a
// field's root type — each subclass exposes a different, non-overlapping method set,
// and there is no shared typed interface across all of them worth declaring here.
// biome-ignore lint/suspicious/noExplicitAny: dynamic dispatch across validator.ts subclasses with no shared method surface
type DynSchema = Validator<unknown> & Record<string, (...args: any[]) => Validator<unknown>>;

type Ctor<T = unknown> = abstract new (...args: unknown[]) => T;
type PrimitiveKind = 'string' | 'number' | 'boolean' | 'bigint' | 'date';
type RootKind = PrimitiveKind | 'array' | 'union' | 'literal' | 'enum' | 'object';

const META_KEY = '__z_meta__';
const CACHE = Symbol.for('zody.cache');
const PHANTOM = Symbol.for('zody.phantom');

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

type DecoratorFn = ((value: undefined, context: ClassFieldDecoratorContext) => void) & {
    readonly string: DecoratorFn;
    readonly number: DecoratorFn;
    readonly boolean: DecoratorFn;
    readonly bigint: DecoratorFn;
    readonly date: DecoratorFn;
    readonly int: DecoratorFn;
    readonly float: DecoratorFn;
    readonly email: DecoratorFn;
    readonly url: DecoratorFn;
    readonly uuid: DecoratorFn;
    readonly hostname: DecoratorFn;
    readonly ipv4: DecoratorFn;
    readonly ipv6: DecoratorFn;
    readonly jwt: DecoratorFn;
    readonly base64: DecoratorFn;
    readonly hex: DecoratorFn;
    readonly trim: DecoratorFn;
    readonly toLowerCase: DecoratorFn;
    readonly toUpperCase: DecoratorFn;
    readonly optional: DecoratorFn;
    readonly nullable: DecoratorFn;
    min(value: number | bigint): DecoratorFn;
    max(value: number | bigint): DecoratorFn;
    gte(value: number | bigint): DecoratorFn;
    lte(value: number | bigint): DecoratorFn;
    gt(value: number | bigint): DecoratorFn;
    lt(value: number | bigint): DecoratorFn;
    default(value: unknown): DecoratorFn;
    array(inner?: ChainSpec | DecoratorFn): DecoratorFn;
    union(options: (ChainSpec | DecoratorFn)[]): DecoratorFn;
    regex(pattern: RegExp | string, message?: string): DecoratorFn;
    minLength(len: number): DecoratorFn;
    maxLength(len: number): DecoratorFn;
    length(len: number): DecoratorFn;
    describe(text: string): DecoratorFn;
    ops: Op[];
};

// Type inference: extract the parsed/validated type from the schema validator
type InferIn<T extends Ctor> = T extends { toZod(): Validator<infer S> } ? Parameters<Validator<S>['parse']>[0] : never;
type InferOut<T extends Ctor> = T extends { toZod(): Validator<infer S> } ? S : never;

function getClassMeta(ctor: object): ClassMeta {
    const holder = ctor as Record<string, unknown>;
    if (!holder[META_KEY]) {
        Object.defineProperty(ctor, META_KEY, {
            value: { fields: new Map(), inferDefault: true } satisfies ClassMeta,
            enumerable: false,
            configurable: false,
            writable: false,
        });
    }
    return holder[META_KEY] as ClassMeta;
}

// `owner` is always already a class constructor (its one call site passes
// `this.constructor` from inside a field initializer) — using `owner.constructor`
// would resolve to `Function` instead, silently attaching metadata to the wrong
// object and losing defaultValue/inferredType capture for every class.
function getOrCreateFieldMeta(owner: object, key: string): FieldMeta {
    const meta = getClassMeta(owner);
    let field = meta.fields.get(key);
    if (!field) {
        field = { key, ops: [] };
        meta.fields.set(key, field);
    }
    return field;
}

function makeDecorator(spec: ChainSpec): DecoratorFn {
    const plus = (op: Op) => makeDecorator({ ops: [...spec.ops, op] });

    const dec = ((_value: undefined, context: ClassFieldDecoratorContext) => {
        const fieldName = String(context.name);

        // Store the decorator spec on the context metadata for later retrieval
        // This allows the Schema decorator to access field decorator info without needing instances
        const metadata = (context.metadata ?? {}) as Record<PropertyKey, unknown>;
        if (!metadata[Symbol.for('zody.fields')]) {
            metadata[Symbol.for('zody.fields')] = {};
        }
        (metadata[Symbol.for('zody.fields')] as Record<string, unknown>)[fieldName] = {
            ops: spec.ops,
        };

        // Use addInitializer to capture both decorator info AND default values
        let initializerRan = false;
        context.addInitializer(function () {
            if (initializerRan) return; // Prevent duplicate execution
            initializerRan = true;

            const ctor = (this as { constructor: object }).constructor;

            // Register the field decoration in the global registry
            registerFieldDecoration(fieldName, spec.ops);

            const field = getOrCreateFieldMeta(ctor, fieldName);
            // Only add ops from addInitializer if not already added
            if (!field.ops.some((op) => spec.ops.includes(op))) {
                field.ops.push(...spec.ops);
            }

            // Capture the initial value (default) if present
            const current = (this as Record<string, unknown>)[fieldName];
            if (current !== undefined) {
                field.defaultValue = current;
                field.inferredType ??= inferFromValue(current);
            }
        });
    }) as DecoratorFn;

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
    dec['min'] = (value: number | bigint) => plus({ kind: 'min', value });
    dec['max'] = (value: number | bigint) => plus({ kind: 'max', value });
    dec['gte'] = (value: number | bigint) => plus({ kind: 'gte', value });
    dec['lte'] = (value: number | bigint) => plus({ kind: 'lte', value });
    dec['gt'] = (value: number | bigint) => plus({ kind: 'gt', value });
    dec['lt'] = (value: number | bigint) => plus({ kind: 'lt', value });
    dec['default'] = (value: unknown) => plus({ kind: 'default', value });
    dec['array'] = (inner?: ChainSpec | DecoratorFn) => {
        // Omit the `arrayOf` op entirely when no inner type is given, rather than
        // adding one with an empty ops list — toZodNode()/buildPropertySchema() would
        // otherwise try to normalize that empty spec and throw "cannot infer type",
        // instead of falling through to their intended unknown()/`{}` item fallback.
        const arrayOps: Op[] =
            inner && 'ops' in (inner as object) ? [{ kind: 'arrayOf', value: inner as unknown as ChainSpec }] : [];
        return makeDecorator({ ops: [...spec.ops, { kind: 'root', value: 'array' }, ...arrayOps] });
    };
    dec['union'] = (options: (ChainSpec | DecoratorFn)[]) =>
        makeDecorator({
            ops: [...spec.ops, { kind: 'root', value: 'union' }, { kind: 'unionOf', value: options as ChainSpec[] }],
        });
    dec['regex'] = (pattern: RegExp | string, message?: string) =>
        plus({ kind: 'regex', value: message === undefined ? { pattern } : { pattern, message } });
    dec['minLength'] = (len: number) => plus({ kind: 'minLength', value: len });
    dec['maxLength'] = (len: number) => plus({ kind: 'maxLength', value: len });
    dec['describe'] = (text: string) => plus({ kind: 'describe', value: text });
    dec['ops'] = spec.ops;

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
    const chain: object[] = [];
    let cur = ctor;
    while (cur && cur !== Function.prototype) {
        const curHolder = cur as Record<string, unknown>;
        if (curHolder[META_KEY]) chain.unshift(curHolder[META_KEY] as object);
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

// Calls `name` on `dyn` — dispatched dynamically because NumV/StrV/BigIntV/ArrV each
// expose a different, non-overlapping method set (e.g. `min`/`max` resolve on every
// one of them to that class's own correct semantics: length for strings, gte/lte for
// numbers) with no shared typed interface worth declaring.
function call(dyn: DynSchema, name: string, ...args: unknown[]): DynSchema {
    return dyn[name]!(...args) as DynSchema;
}

// Applies each decorator op onto the validator.ts node built for the field's root type.
function applyOps(schema: Validator<unknown>, field: FieldMeta): Validator<unknown> {
    let dyn = schema as DynSchema;
    for (const op of field.ops) {
        switch (op.kind) {
            case 'root':
                break; // Skip root ops, they're handled by toZodNode
            case 'int':
                dyn = call(dyn, 'int');
                break;
            case 'float':
                dyn = call(dyn, 'float');
                break;
            case 'min':
                dyn = call(dyn, 'min', op.value);
                break;
            case 'max':
                dyn = call(dyn, 'max', op.value);
                break;
            case 'gte':
                dyn = call(dyn, 'gte', op.value);
                break;
            case 'lte':
                dyn = call(dyn, 'lte', op.value);
                break;
            case 'gt':
                dyn = call(dyn, 'gt', op.value);
                break;
            case 'lt':
                dyn = call(dyn, 'lt', op.value);
                break;
            case 'email':
                dyn = call(dyn, 'email');
                break;
            case 'url':
                dyn = call(dyn, 'url');
                break;
            case 'uuid':
                dyn = call(dyn, 'uuid');
                break;
            case 'hostname':
                dyn = call(dyn, 'hostname');
                break;
            case 'ipv4':
                dyn = call(dyn, 'ipv4');
                break;
            case 'ipv6':
                dyn = call(dyn, 'ipv6');
                break;
            case 'jwt':
                dyn = call(dyn, 'jwt');
                break;
            case 'base64':
                dyn = call(dyn, 'base64');
                break;
            case 'hex':
                dyn = call(dyn, 'hex');
                break;
            case 'regex':
                dyn = call(
                    dyn,
                    'regex',
                    typeof op.value.pattern === 'string' ? new RegExp(op.value.pattern) : op.value.pattern,
                    op.value.message,
                );
                break;
            case 'trim':
                dyn = call(dyn, 'trim');
                break;
            case 'toLowerCase':
                dyn = call(dyn, 'toLowerCase');
                break;
            case 'toUpperCase':
                dyn = call(dyn, 'toUpperCase');
                break;
            case 'minLength':
                // StrV names its length constraint `min`; ArrV names it `minLength`.
                dyn = field.inferredType === 'array' ? call(dyn, 'minLength', op.value) : call(dyn, 'min', op.value);
                break;
            case 'maxLength':
                dyn = field.inferredType === 'array' ? call(dyn, 'maxLength', op.value) : call(dyn, 'max', op.value);
                break;
            case 'length':
                dyn = call(dyn, 'length', op.value);
                break;
            case 'describe':
                break; // describe is only used in .defs(), not at parse time
            case 'optional':
                dyn = call(dyn, 'optional');
                break;
            case 'nullable':
                dyn = v.nullable(dyn) as unknown as DynSchema;
                break;
            case 'default':
                dyn = call(dyn, 'default', op.value);
                break;
        }
    }
    return dyn;
}

function toZodNode(field: FieldMeta): Validator<unknown> {
    let schema: Validator<unknown>;
    switch (field.inferredType) {
        case 'string':
            schema = v.string();
            break;
        case 'number':
            schema = v.number();
            break;
        case 'boolean':
            schema = v.boolean();
            break;
        case 'bigint':
            schema = v.bigint();
            break;
        case 'date':
            schema = v.date();
            break;
        case 'array': {
            const arrayOp = field.ops.find((x) => x.kind === 'arrayOf') as Extract<Op, { kind: 'arrayOf' }> | undefined;
            const inner = arrayOp ? toZodFromSpec(arrayOp.value as ChainSpec) : v.unknown();
            schema = v.array(inner);
            break;
        }
        case 'union': {
            const unionOp = field.ops.find((x) => x.kind === 'unionOf') as Extract<Op, { kind: 'unionOf' }> | undefined;
            if (!unionOp || unionOp.value.length === 0)
                throw new Error(`zody schema error on ${field.key}: missing union options`);
            const options = unionOp.value.map((spec) => toZodFromSpec(spec));
            if (options.length < 2) throw new Error(`zody schema error on ${field.key}: union requires at least 2 options`);
            schema = v.union(options as [Validator<unknown>, Validator<unknown>, ...Validator<unknown>[]]);
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

function toZodFromSpec(spec: ChainSpec): Validator<unknown> {
    const fake: FieldMeta = normalizeField({ key: '<inline>', ops: spec.ops }, false);
    return toZodNode(fake);
}

type Artifacts = {
    schema: Validator<unknown>;
};

function buildArtifacts(ctor: object): Artifacts {
    const holder = ctor as Record<symbol, unknown>;
    if (holder[CACHE]) return holder[CACHE] as Artifacts;
    const meta = gatherMeta(ctor);
    const shape: Record<string, Validator<unknown>> = {};
    for (const [key, raw] of meta.fields) {
        const norm = normalizeField(raw, meta.inferDefault);
        shape[key] = toZodNode(norm);
    }
    const schema = v.object(shape);
    const cache: Artifacts = { schema };
    Object.defineProperty(ctor, CACHE, { value: cache, enumerable: false });
    return cache;
}

function Schema(options?: { inferDefault?: boolean; autocompile?: boolean }) {
    return <T extends Ctor>(target: T, _context: ClassDecoratorContext<T>): T & ZodyCtor<InstanceType<T>> => {
        const meta = getClassMeta(target);
        meta.inferDefault = options?.inferDefault ?? true;
        const shouldAutocompile = options?.autocompile ?? false;

        class ZodyClass extends (target as unknown as new (...args: unknown[]) => object) {
            static toZod() {
                return buildArtifacts(ZodyClass).schema;
            }
            // Forwards to the cached root schema (an ObjV instance). That instance's
            // own `validate()` self-replaces with a codegen'd fast path on its first
            // call — because the schema instance is cached per class, that replacement
            // persists across every later `ZodyClass.validate()` call automatically.
            static validate(input: unknown): input is InferOut<typeof ZodyClass> {
                return buildArtifacts(ZodyClass).schema.validate(input) as boolean;
            }
            static safeParse(input: unknown) {
                return ZodyClass.toZod().safeParse(input);
            }
            static parse(input: unknown) {
                return ZodyClass.toZod().parse(input);
            }
            static defs(includeSchemaVersion = true): Record<string, unknown> {
                const metadata = gatherMeta(ZodyClass);
                const properties: Record<string, unknown> = {};
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

                const schema: Record<string, unknown> = {
                    type: 'object',
                    properties,
                };

                if (required.length > 0) {
                    schema['required'] = required;
                }

                if (includeSchemaVersion) {
                    schema['$schema'] = 'http://json-schema.org/draft-07/schema#';
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
        const originalIsInitializing = (globalThis as GlobalWithZodyFlag).__z_initializing__;
        (globalThis as GlobalWithZodyFlag).__z_initializing__ = true;
        try {
            new ZodyClass();
        } catch (_e) {
            // Ignore errors from instantiation - some initializers may have run anyway
        } finally {
            (globalThis as GlobalWithZodyFlag).__z_initializing__ = originalIsInitializing;
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

        // Trigger autocompile if requested: force the root schema's self-replacing
        // validate() to build+install its codegen'd fast path ahead of time. The
        // input doesn't matter — ObjV.validate() self-replaces on its first call
        // regardless of whether that call's input is actually valid.
        if (shouldAutocompile) {
            setImmediate(() => {
                buildArtifacts(ZodyClass).schema.validate(undefined);
            });
        }

        return ZodyClass as unknown as T & ZodyCtor<InstanceType<T>>;
    };
}

// biome-ignore lint/style/useNamingConvention: matches the existing __z_initializing__ runtime flag name
type GlobalWithZodyFlag = typeof globalThis & { __z_initializing__?: boolean | undefined };

function buildPropertySchema(field: FieldMeta): Record<string, unknown> {
    const schema: Record<string, unknown> = {};

    // Determine base type
    const isOptional = field.ops.some((op) => op.kind === 'optional');
    const isNullable = field.ops.some((op) => op.kind === 'nullable');

    if (field.inferredType === 'string') {
        schema['type'] = 'string';
    } else if (field.inferredType === 'number') {
        schema['type'] = 'number';
    } else if (field.inferredType === 'boolean') {
        schema['type'] = 'boolean';
    } else if (field.inferredType === 'date') {
        schema['type'] = 'string';
        schema['format'] = 'date-time';
    } else if (field.inferredType === 'bigint') {
        schema['type'] = 'integer';
    } else if (field.inferredType === 'array') {
        schema['type'] = 'array';
        const arrayOp = field.ops.find((x) => x.kind === 'arrayOf') as Extract<Op, { kind: 'arrayOf' }> | undefined;
        if (arrayOp) {
            const innerField = normalizeField({ key: '<inner>', ops: (arrayOp.value as ChainSpec).ops }, false);
            schema['items'] = buildPropertySchema(innerField);
        } else {
            schema['items'] = {};
        }
    }

    // Apply constraints
    for (const op of field.ops) {
        switch (op.kind) {
            case 'email':
                schema['format'] = 'email';
                break;
            case 'url':
                schema['format'] = 'uri';
                break;
            case 'uuid':
                schema['format'] = 'uuid';
                break;
            case 'hostname':
                schema['format'] = 'hostname';
                break;
            case 'ipv4':
                schema['format'] = 'ipv4';
                break;
            case 'ipv6':
                schema['format'] = 'ipv6';
                break;
            case 'jwt':
                schema['pattern'] = '^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*$';
                break;
            case 'base64':
                schema['pattern'] = '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';
                break;
            case 'hex':
                schema['pattern'] = '^[0-9a-fA-F]*$';
                break;
            case 'regex':
                schema['pattern'] = typeof op.value.pattern === 'string' ? op.value.pattern : op.value.pattern.source;
                break;
            case 'minLength':
                schema['minLength'] = op.value;
                break;
            case 'maxLength':
                schema['maxLength'] = op.value;
                break;
            case 'length':
                schema['minLength'] = op.value;
                schema['maxLength'] = op.value;
                break;
            case 'min':
                schema['minimum'] = Number(op.value);
                break;
            case 'max':
                schema['maximum'] = Number(op.value);
                break;
            case 'gte':
                schema['minimum'] = Number(op.value);
                break;
            case 'lte':
                schema['maximum'] = Number(op.value);
                break;
            case 'gt':
                schema['exclusiveMinimum'] = Number(op.value);
                break;
            case 'lt':
                schema['exclusiveMaximum'] = Number(op.value);
                break;
            case 'int':
                schema['type'] = 'integer';
                break;
            case 'float':
                schema['type'] = 'number';
                break;
            case 'describe':
                schema['description'] = op.value;
                break;
        }
    }

    // Handle optional/nullable
    if (isOptional || isNullable) {
        if (isNullable) {
            schema['type'] = [schema['type'], 'null'];
        }
        // Optional means it's not in required[], no schema change needed
    }

    return schema;
}

// Type for zody class constructors
export type ZodyCtor<T = unknown> = {
    parse(input: unknown): T;
    safeParse(input: unknown): { success: boolean; data?: T; error?: Error };
    validate(input: unknown): input is T;
    toZod(): Validator<T>;
    defs(includeSchemaVersion?: boolean): Record<string, unknown>;
};

/**
 * Optional base class for @z.Schema()-decorated classes.
 *
 * TypeScript only lets a class decorator change the *type* of what it decorates when applied
 * to a class expression, not a class declaration (`class Foo {}`) — so a decorated declaration
 * keeps its plain, undecorated static type at every usage site, even though the decorator does
 * attach `.parse()`/`.safeParse()`/etc. at runtime. That normally forces callers to write
 * `Foo as unknown as ZodyCtor` wherever the class is used as a ZodyCtor.
 *
 * Extending this class instead gives those statics to the subclass via ordinary inheritance
 * (which TS *does* track), so no cast is needed:
 *
 *   @z.Schema()
 *   class Foo extends ZodySchema {
 *       @z.string name!: string;
 *   }
 *   const schema: ZodyCtor<Foo> = Foo; // type-checks, no cast
 *
 * The methods here are never actually called — @z.Schema() always replaces them with real
 * implementations at runtime — they exist purely so TS can see the statics on the subclass.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: exists to be subclassed for its static type declarations, not instantiated
export abstract class ZodySchema {
    declare static parse: <T extends typeof ZodySchema>(this: T, input: unknown) => InstanceType<T>;
    declare static safeParse: <T extends typeof ZodySchema>(
        this: T,
        input: unknown,
    ) => { success: boolean; data?: InstanceType<T>; error?: Error };
    declare static validate: <T extends typeof ZodySchema>(this: T, input: unknown) => input is InstanceType<T>;
    declare static toZod: <T extends typeof ZodySchema>(this: T) => Validator<InstanceType<T>>;
    declare static defs: (includeSchemaVersion?: boolean) => Record<string, unknown>;
}

const baseDecorator = makeDecorator({ ops: [] });

type ZNamespace = DecoratorFn & {
    // biome-ignore lint/style/useNamingConvention: must match the actual runtime property name `z.Schema`
    Schema: typeof Schema;
    toZod<T extends Ctor>(ctor: T): Validator<unknown>;
};

export const z = baseDecorator as unknown as ZNamespace;

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
