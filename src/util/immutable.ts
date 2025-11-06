/** biome-ignore-all lint/complexity/noBannedTypes: Object is required here */

import { isDeepStrictEqual } from 'node:util';
import type { Infer, Schema } from '../lib/validator/validator';
import { parse as validateSchema } from '../lib/validator/validator';
import { safeSync } from './safe';

/** Type Utilities */
export type Dict<T = string> = { [key: string | number]: T | undefined };
export type ReadOnlyDict<T = string> = { readonly [key: string | number]: Readonly<T> | undefined };
export type RoDict<T = string> = ReadOnlyDict<T>;
export type IDictionary<T = string> = Dict<T>;
export type IReadOnlyDictionary<T = string> = ReadOnlyDict<T>;

/** Like Partial<T> but recursive */
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends Array<infer U> ? Array<DeepPartial<U>> : T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Combines properties from multiple types into one.
 * See https://www.steveruiz.me/posts/smooshed-object-union
 */
export type Union<T> = {
    [K in T extends infer P ? keyof P : never]: T extends infer P ? (K extends keyof P ? P[K] : never) : never;
};

/** Typescript helper to get a proper type */
export function is<T>(val: unknown): val is T {
    return val !== undefined;
}

/** Converts SharedArrayBuffer/ArrayBuffer to string for JSON.parse */
export function toJsonString(input: string | SharedArrayBuffer | ArrayBuffer): string {
    if (input instanceof SharedArrayBuffer || input instanceof ArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(input));
    }
    return input;
}

/** Handles BigInt ("123n" → 123n) and filters "__*" properties to prevent prototype pollution */
export const reviverFn = (key: string, val: unknown): unknown =>
    typeof val === 'string' && val.match(/^[+,-]?\d*n$/) ? BigInt(val.slice(0, -1)) : key.startsWith('__') ? undefined : val;

/** Encodes BigInt as string (123n → "123n") */
export const replacerFn = (_key: string, val: unknown) => (typeof val === 'bigint' ? `${val}n` : val);

/** Returns true if object has no own enumerable properties */
export function isEmpty(obj: unknown): boolean {
    if (obj == null) return true;
    if (typeof obj !== 'object') return true;
    if (Array.isArray(obj)) return obj.length === 0;
    if (obj instanceof Map || obj instanceof Set) return obj.size === 0;
    return Object.keys(obj).length === 0;
}

/** Wrapper around util.isDeepStrictEqual() that returns boolean with type guard */
export function isDeepEqual<T>(a: unknown, b: T): a is T {
    return isDeepStrictEqual(a, b);
}

/** Frozen objects with mutating methods set to undefined. Use Immutable.parse() to create from JSON. */
export class Immutable extends Object {
    [key: string]: unknown;

    static parse<T extends Object = Immutable>(
        text: string | SharedArrayBuffer | ArrayBuffer,
        reviver: typeof reviverFn = reviverFn,
    ): Readonly<T> {
        const parsed = JSON.parse(toJsonString(text), reviver) as T;
        return Immutable.freeze(parsed);
    }

    /** Returns [data, undefined] on success or [undefined, error] on failure */
    static safeParse<T extends Object = Immutable>(
        text: string | SharedArrayBuffer | ArrayBuffer,
        reviver: typeof reviverFn = reviverFn,
    ): [Readonly<T>, undefined] | [undefined, Error] {
        return safeSync(() => Immutable.parse<T>(text, reviver));
    }

    /** Parse + validate with schema. Return type inferred from schema. */
    static parseValidate<S extends Schema>(
        schema: S,
        text: string | SharedArrayBuffer | ArrayBuffer,
        reviver: typeof reviverFn = reviverFn,
    ): Readonly<Infer<S>> {
        const parsed = Immutable.parse(text, reviver);
        const validated = validateSchema<Infer<S>>(schema, parsed);
        if (validated === undefined) {
            throw new Error('Validation failed: schema validation returned undefined');
        }
        return Immutable.freeze(validated);
    }

    /** Safe version of parseValidate - returns [data, undefined] or [undefined, error] */
    static safeParseValidate<S extends Schema>(
        schema: S,
        text: string | SharedArrayBuffer | ArrayBuffer,
        reviver: typeof reviverFn = reviverFn,
    ): [Readonly<Infer<S>>, undefined] | [undefined, Error] {
        return safeSync(() => Immutable.parseValidate(schema, text, reviver));
    }

    /** Freezes object and sets mutating methods to undefined (non-enumerable) */
    static freeze<T extends object>(obj: T): Readonly<T> {
        if (obj != null && typeof obj === 'object' && Object.getPrototypeOf(obj)?.constructor?.name === 'Object') {
            Object.setPrototypeOf(obj, Immutable.prototype);
        }

        const mutatingMethods = [
            'set',
            'deleteProperty',
            'assign',
            'defineProperty',
            'delete',
            'clear',
            'setPrototypeOf',
            'preventExtensions',
            'seal',
            'push',
            'pop',
            'shift',
            'unshift',
            'splice',
            'sort',
            'reverse',
            'fill',
            'copyWithin',
        ] as const;

        for (const method of mutatingMethods) {
            Object.defineProperty(obj, method, { value: undefined, writable: false, enumerable: false, configurable: false });
        }

        return Object.freeze(obj);
    }

    static stringify(value: unknown, replacer: typeof replacerFn = replacerFn, space: number | string = 2): string {
        return JSON.stringify(value, replacer, space);
    }
}

/** Set Symbol.toStringTag to "Immutable" */
Object.defineProperty(Immutable.prototype, Symbol.toStringTag, {
    value: 'Immutable',
    writable: false,
    enumerable: false,
    configurable: true,
});

/** Custom inspect: show only enumerable properties */
Object.defineProperty(Immutable.prototype, Symbol.for('nodejs.util.inspect.custom'), {
    value: function () {
        const obj: Record<string, unknown> = {};
        for (const key of Object.keys(this)) {
            obj[key] = (this as Record<string, unknown>)[key];
        }
        return obj;
    },
    writable: false,
    enumerable: false,
    configurable: true,
});

export const RO = Immutable;
