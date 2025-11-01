/** biome-ignore-all lint/complexity/noBannedTypes: Object is required here */
/** biome-ignore-all lint/style/useNamingConvention: similar to JSON */

import { deepStrictEqual } from 'node:assert/strict';

// Simplified Dict<T>, Record<K,T> and a readonly version of Dict and Record<>
export type Dict<T = string> = { [key: string | number]: T | undefined };
export type ReadOnlyDict<T = string> = { readonly [key: string | number]: Readonly<T> | undefined };
export type RoDict<T = string> = ReadOnlyDict<T>;
export type IDictionary<T = string> = Dict<T>; // C#-like notation
export type IReadOnlyDictionary<T = string> = ReadOnlyDict<T>; // C#-like notation

// DeepPartial<T>: makes all properties in T optional, recursively.
// Usage: function updateConfig(cfg: DeepPartial<Config>) { ... }
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends Array<infer U> ? Array<DeepPartial<U>> : T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Union type: combines properties from multiple types into a single type.
// Usage: type Both = Union<Box | Polygon>;
// see https://www.steveruiz.me/posts/smooshed-object-union
export type Union<T> = {
    [K in T extends infer P ? keyof P : never]: T extends infer P ? (K extends keyof P ? P[K] : never) : never;
};

// BigInt reviver and replacer for JSON.parse and JSON.stringify
const reviverFn = (key: string, val: unknown): unknown =>
    typeof val === 'string' && val.match(/^[+,-]?\d*n$/) ? BigInt(val.slice(0, -1)) : key.startsWith('__') ? undefined : val;
const replacerFn = (_key: string, val: unknown) => (typeof val === 'bigint' ? `${val}n` : val);

/**
 * POJO: An extension of Object that is also a drop-in replacement for Javascript's JSON.
 * It adds the following features over JSON:
 * 1. bigint support
 * 2. typed parser
 * 3. optional safe parse: add a default object to return instead of exception.
 * 4. parsing of null and undefined returns an empty POJO.
 * 5. Initiatizer and key-value iteration.
 * 6. isEmpty method to check if an object is empty (no own enumerable properties).
 */
export class POJO extends Object {
    /**
     * any key-value pair
     */
    [key: string]: unknown;

    constructor(arg?: Readonly<Partial<POJO>>) {
        super();
        if (arg) POJO.copyIn(this, arg);
    }

    /**
     * Like JSON.parse but adds the above features.
     * If a primitive is parsed, returns the primitive directly (not a POJO instance).
     * If an object is parsed it would parse(stringify) it into a POJO instance.
     * It returns an undefined instead of a null.
     * On invalid JSON it return a fallback object (empty object by default) instead of throwing.
     * If you want it to throw on invalid JSON, pass a custom reviver function that throws set fallback=false
     */
    static parse<T extends Object = POJO>(
        value: unknown,
        reviver?: typeof reviverFn,
        fallback: false | T = {} as T,
    ): T | undefined {
        // Support SharedArrayBuffer/ArrayBuffer input: decode to string
        if (value instanceof SharedArrayBuffer || value instanceof ArrayBuffer) {
            const bytes = new Uint8Array(value);
            value = new TextDecoder().decode(bytes);
        }
        let rc: T | undefined;

        try {
            rc = JSON.parse(
                typeof value === 'string' ? value : POJO.stringify(value),
                typeof reviver === 'function' ? reviver : reviverFn,
            );

            if (rc == null) {
                rc = undefined;
            } else if (typeof rc === 'object' && Object.getPrototypeOf(rc)?.constructor?.name === 'Object') {
                // If the parsed object is a plain object, set its prototype to POJO
                Object.setPrototypeOf(rc, POJO.prototype);
            }
        } catch (e) {
            if (fallback) {
                console.error('POJO.parse: invalid JSON', String(value).substring(0, 100));
            } else {
                // Replaced CustomError with standard Error
                class ParseError extends Error {
                    constructor(cause?: unknown) {
                        super(cause instanceof Error ? cause.message : String(cause));
                        this.name = 'ParseError';
                    }
                }
                throw new ParseError(e);
            }
        }

        if (!rc && fallback) {
            rc = POJO.merge(fallback) as T;
        }

        return rc as T | undefined;
    }

    /**
     * Like JSON.stringify but adds support for bigint.
     */
    static stringify(value: unknown, replacer?: typeof replacerFn, space: number | string = 2): string {
        return JSON.stringify(value, typeof replacer === 'function' ? replacer : replacerFn, space);
    }

    /**
     * Serialize a value into a SharedArrayBuffer.
     * @param value - The value to serialize.
     * @param replacer - Optional replacer function for JSON.stringify.
     * @returns SharedArrayBuffer containing UTF-8 JSON.
     */
    static toSharedBuffer(value: unknown, replacer?: typeof replacerFn): SharedArrayBuffer {
        const json = POJO.stringify(value, replacer);
        const encoded = new TextEncoder().encode(json);
        const sab = new SharedArrayBuffer(encoded.byteLength);
        new Uint8Array(sab).set(encoded);
        return sab;
    }

    /**
     * copyIn() is much like Object.assign(o1,o2), mostly used for copying options passed into a constructor.
     * By default it copies enumerable properties from target to me, skipping keys in skipKeys.
     * Does not copy inherited properties or symbols.
     * Usage examples:
     *
     *  POJO.copyIn(obj1, obj2, (m, k, v) => { m[k] += v[k]; });
     *
     *  class A {
     *    //...
     *    constructor(other: Readonly<Partial<A>>) {
     *      POJO.copyIn(this, other);
     *    }
     * }
     * @param me The target object to copy properties into.
     * @param other The source object to copy properties from.
     * @param skipKeys An array of property names to skip.
     * @param updater A function to update the value in me, defaults to simple assignment.
     *                If not provided, it will simply assign the value from other to me.
     * @returns The target object (me) after copying.
     */
    static copyIn = Object.assign(
        <T extends Object>(
            me: T,
            other: Readonly<Partial<T>>,
            { skipKeys = undefined as Array<string | number> | undefined, updater = POJO.copyIn.append } = {},
        ): T => {
            if (typeof me !== 'object' || me === null || POJO.isEmpty(other)) return me;
            skipKeys ||= [];

            // prevent prototype pollution
            if ('__proto__' in Object(other)) skipKeys.push('__proto__');

            // Replace the array of {if, then} with a switch-case style block
            switch (true) {
                case Array.isArray(other):
                    for (const [key] of other.entries()) {
                        if (!skipKeys.includes(key)) updater(me, key, other);
                    }
                    break;
                case other instanceof Set:
                    for (const key of other) {
                        if (!skipKeys.includes(key)) Object(me).add(key);
                    }
                    break;
                case other instanceof Map:
                    for (const [key, _val] of other) {
                        if (!skipKeys.includes(key)) updater(me, key, other);
                    }
                    break;
                case Symbol.iterator in Object(other):
                    for (const key of Object(other)) {
                        if (!skipKeys.includes(key)) updater(me, key, Object(other));
                    }
                    break;
                case typeof other === 'object':
                    Object.keys(other as object).forEach((key) => {
                        if (!skipKeys.includes(key)) updater(me, key, Object(other));
                    });
                    break;
                default:
                    // natives: boolean, nummber, string etc.
                    me = other as T; // Assign the primitive directly
            }

            return me;
        },
        // Attach common updater operations to POJO.copyIn.
        // Usage: POJO.copyIn(obj1, obj2, POJO.copyIn.assign);
        {
            // append - add or replace a property in an object
            append: <M extends Object, O extends Readonly<Partial<M>>>(me: M, key: string | number, other: O) => {
                const value = typeof Object(other).get === 'function' ? Object(other).get(key) : Object(other)[key];
                if (typeof Object(me).set === 'function') {
                    Object(me).set(key, value);
                } else {
                    // check if prop is undefined or configurable and not readonly
                    const prop = Object.getOwnPropertyDescriptor(me, key);
                    if (!prop || (prop.writable && prop.configurable)) {
                        // keep prop configurable to prevent ctors up the stack from throwing
                        Object.defineProperty(me, key, { value, enumerable: true, configurable: true, writable: true });
                    }
                }
            },

            // assign - replace but don't add a property in an object.
            // it is used to update **existing** keys only.
            assign: <M extends Object, O extends Readonly<Partial<M>>>(me: M, key: string | number, other: O) => {
                if (key in me) POJO.copyIn.append(me, key, other);
            },

            // add - assign with a plus operator (only for strings a numbers)
            add: <M extends Object, O extends Readonly<Partial<M>>>(me: M, key: string | number, other: O) => {
                const tok = typeof Object(other)[key],
                    tmk = typeof Object(me)[key];
                if (tok === 'string' || tok === 'number') {
                    const val = typeof Object(other).get === 'function' ? Object(other).get(key) : Object(other)[key];
                    Object(me)[key] = tmk === 'undefined' ? val : Object(me)[key] + val;
                } else {
                    throw new Error(`Unsupported type for addition operation: ${tok}`);
                }
            },
        },
    );

    /**
     * merge() is much like Object.assign({},o1,o2) but it merges two classes into a new class, copying
     * properties from both and setting the prototype to the latter.
     * @param src1 The first source object.
     * @param src2 The second source object.
     * @returns A new object with merged properties and prototype.
     */
    static merge<T1 extends Object = Object, T2 extends T1 | Object = T1>(src1: T1, src2?: T2): T1 & T2 {
        if (['string', 'number', 'boolean', 'undefined', 'bigint'].includes(typeof src1)) {
            // If src1 is a primitive, return it directly
            console.warn('POJO.merge: src1 is a primitive');
            return src1 as T1 & T2;
        }

        // create a new object with the prototype of src1 if it exists, otherwise POJO
        const rc = (() => {
            try {
                const ctor = Object.getPrototypeOf(src1).constructor;
                return ctor.name === 'Object' ? new POJO() : new ctor();
            } catch (_e) {
                return new POJO(); // Fallback to POJO if constructor fails
            }
        })() as unknown as T1;

        POJO.copyIn(rc as T1, src1);

        if (src2) {
            if (Object.getPrototypeOf(src2)?.constructor?.name !== 'Object') {
                Object.setPrototypeOf(rc, Object.getPrototypeOf(src2));
            }
            POJO.copyIn(rc as T2, src2);
        }

        return rc as T1 & T2;
    }

    /**
     * Checks if the object is empty (no own enumerable properties).
     * Returns true for {}, [], Map(), null, number, string, undefined etc.
     * false for { a: 1 }, Maps and Sets with data.
     * Note: does not check for prototype properties.
     *
     * Usage: if (POJO.isEmpty(formErrors)) submitForm();
     */
    static isEmpty(obj: unknown) {
        if (obj == null) return true;
        if (typeof obj !== 'object') return true;
        if (Array.isArray(obj)) return obj.length === 0;
        if (obj instanceof Map || obj instanceof Set) return obj.size === 0;
        return Object.keys(obj).length === 0;
    }

    /**
     * Creates a deep clone of the given value using the built-in `structuredClone` method.
     *
     * @param value - The value to clone. Can be any structured data type, including objects, arrays, maps, sets, and more.
     * @returns A deep copy of the provided value.
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/structuredClone
     */
    static deepClone = structuredClone;

    /**
     * Checks if two values are deeply equal by comparing their structure and content.
     * Wrapper around assert.deepStrictEqual().
     * @param a
     * @param b
     * @returns true if a and b are deeply equal, false otherwise.
     */
    static isDeepClone = <T>(a: unknown, b: T): a is T => {
        let rc = false;
        try {
            deepStrictEqual(a, b);
            rc = true;
        } catch {}
        return rc;
    };

    // Symbol iterator for POJO as a generator:
    // Used by Object.entries(o) and spread operator (...)
    *[Symbol.iterator]() {
        for (const key of Object.keys(this)) {
            yield [key, this[key]];
        }
    }
}

/**
 * ROJO: Readonly POJO (frozen and immutable).
 * Overwrites mutating methods to throw, for runtime safety.
 */
export class ROJO extends POJO {
    static parse<T extends Object = ROJO>(
        text: unknown,
        reviver?: typeof reviverFn,
        fallback: false | T = {} as T,
    ): Readonly<T> | undefined {
        return Object.freeze(POJO.parse<T>(text, reviver, fallback));
    }

    // Undefine mutating methods to prevent accidental use
    set: undefined;
    deleteProperty: undefined;
    assign: undefined;
    defineProperty: undefined;
    delete: undefined;
    clear: undefined;
    setPrototypeOf: undefined;
    preventExtensions: undefined;
    seal: undefined;
    // Array mutators (if used as array-like)
    push: undefined;
    pop: undefined;
    shift: undefined;
    unshift: undefined;
    splice: undefined;
    sort: undefined;
    reverse: undefined;
    fill: undefined;
    copyWithin: undefined;
    // POJO mutators
    init: undefined;
}

/**
 * Set POJO's Symbol.toStringTag at runtime to "Object" (cannot be at Typescript compile time):
 * Object.prototype.toString.call(POJO), it will return "[object Object]" to keep it simple to compare objects and POJO.toString().
 * Set ROJO's Symbol.toStringTag at runtime to "ROJO" >> it will return "[object ROJO]"
 */
Object.defineProperty(POJO.prototype, Symbol.toStringTag, {
    value: 'Object',
    writable: false,
    enumerable: false,
    configurable: true,
});
Object.defineProperty(ROJO.prototype, Symbol.toStringTag, {
    value: 'ROJO',
    writable: false,
    enumerable: false,
    configurable: true,
});

/**
 * Custom inspect to hide class name and show only enumerable properties
 */
Object.defineProperty(POJO.prototype, Symbol.for('nodejs.util.inspect.custom'), {
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

// // Define the iterator on the prototype (instance-level, not static)
// Object.defineProperty(POJO.prototype, Symbol.iterator, {
//     value: function* () {
//         for (const key of Object.keys(this)) {
//             yield [key, this[key]];
//         }
//     },
//     writable: true,
//     configurable: true,
//     enumerable: false
// });
