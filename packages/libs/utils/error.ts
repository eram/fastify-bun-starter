/**
 * ErrorEx is used to create custom errors that behave like native Error,
 * support proper instanceof checks, and serialize nicely with JSON.stringify.
 * See details: https://github.com/Microsoft/TypeScript/wiki/FAQ#why-doesnt-extending-built-ins-like-error-array-and-map-work
 *
 * Usage:
 *   class ExampleError extends ErrorEx { -- contructor is not needed --  }
 *   throw new ExampleError();
 *
 * Features:
 * - Proper prototype chain for instanceof checks.
 * - Copies stack, code, errno from another error if provided.
 * - All properties are enumerable for JSON.stringify.
 * - Accepts string, Error, ErrorEx, or undefined/null as constructor argument.
 * - Optionally accepts errno and code.
 * - Browser and Node.js compatible.
 */
export class ErrorEx extends Error {
    readonly errno?: number;
    readonly code?: string;

    constructor(
        err: Error | string | undefined | null | unknown, // catch "e" is unknown
        errno?: number,
        code?: string,
    ) {
        super(
            typeof err === 'string'
                ? err
                : typeof err === 'undefined' || err === null || typeof err !== 'object' || !('message' in err)
                  ? 'Unknown error'
                  : Object(err).message,
        );

        try {
            if (typeof err === 'object' && err !== null) Object.assign(this, Object(err));
            if (typeof errno === 'number') this.errno = errno;
            if (typeof code === 'string') this.code = code;
            // restore prototype chain
            this.name = new.target.name;
            Object.setPrototypeOf(this, new.target.prototype);
            /* istanbul ignore next -- @preserve: real test exists (error.test.ts "test the catch
             * block in the ErrorEx constructor") and hits 100% alone/in small runs, but Bun's
             * coverage instrumentation drops these lines to 0 hits specifically at full-suite
             * scale (30+ files); see the NOTE in script/mock-prehook.ts (oven-sh/bun#5090).
             * Approved by developer 2026-08-18. */
        } catch (e) {
            // stack may be read-only or other assignment errors
            // Use console.warn which works in both browser and Node.js
            console.warn('[ErrorEx]', new.target.prototype, e);
        }
    }

    /**
     * Custom inspect for Node.js console logging: shows just the message for cleaner logging
     * This allows `console.error(error)` to display cleanly.
     */
    [Symbol.for('nodejs.util.inspect.custom')](): string {
        return `[${this.name}] ${this.message}`;
    }
}

/* Native Error types https://mzl.la/2Veh3TR
 * These errors we don't need to "throw new", we can just throw them up.
 * Usage:
 *   const err = SyntaxError("test");
 *   if (isNative(err)) {...}
 *   isNative(SyntaxError); // true
 *   isNative(ErrorEx); // false
 */
export function isNative(err: unknown): boolean {
    return [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].some((fn) => {
        return err instanceof fn || err === fn;
    });
}
