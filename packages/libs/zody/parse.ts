import { Immutable, reviverFn, toJsonString } from '@libs/utils/immutable';
import { safeSync } from '@libs/utils/safe';

// Zody-shaped validator type (used by parseValidate/safeParseValidate)
type ZodyValidator<T = unknown> = {
  parse(input: unknown): T;
  safeParse(input: unknown): { success: boolean; data?: T; error?: Error };
};

/**
 * Parse + validate with schema. Return type inferred from schema.
 * Result is frozen/immutable.
 */
export function parseValidate<T>(
  validator: ZodyValidator<T>,
  text: string | SharedArrayBuffer | ArrayBuffer,
  reviver: typeof reviverFn = reviverFn,
): Readonly<T> {
  const parsed = Immutable.parse(toJsonString(text), reviver);
  const value = validator.parse(parsed);
  if (value === undefined) {
    throw new Error('Validation failed: schema validation returned undefined');
  }
  return Object.freeze(value) as Readonly<T>;
}

/**
 * Safe version of parseValidate - returns [data, undefined] or [undefined, error]
 */
export function safeParseValidate<T>(
  validator: ZodyValidator<T>,
  text: string | SharedArrayBuffer | ArrayBuffer,
  reviver: typeof reviverFn = reviverFn,
): [Readonly<T>, undefined] | [undefined, Error] {
  return safeSync(() => parseValidate(validator, text, reviver));
}
