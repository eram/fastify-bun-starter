import { warn } from 'node:console';
import { constants } from 'node:os';

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
 */
export class ErrorEx extends Error {
    constructor(
        err: Error | string | undefined | null | unknown, // catch "e" is unknown
        public readonly errno?: number,
        public readonly code?: string,
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
        } catch (e) {
            // stack may be read-only or other assignment errors
            warn(new.target.prototype, e);
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

/**
 * errno utility: provides map from errno codes to names.
 * this replaces the buggy util.getSystemErrorName and util.getSystemErrorMessage
 * Example: getErrorName(errno.ENOENT) === "ENOENT"
 */
export const errno = constants.errno;
export const getErrorName = (e: number) => Object.keys(errno).find((key) => Object(errno)[key] === e) || e.toString();

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
