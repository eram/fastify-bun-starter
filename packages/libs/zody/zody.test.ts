import { expect, test } from 'bun:test';
import { z, string, number, array } from './zody';

@z.Schema({ inferDefault: true })
class User {
  @z.int.min(1) id!: number;
  @z.string.minLength(3) name = 'john';
  @z.string.email.optional email?: string;
  @z.bigint visits!: bigint;
}

test('validate and parse basic class', () => {
  expect(User.validate({ id: 1, name: 'john', visits: 4n })).toBe(true);
  expect(User.validate({ id: 0, name: 'jo', visits: 4n })).toBe(false);
  const parsed = User.parse({ id: 1, name: 'john', visits: 4n });
  expect(parsed.name).toBe('john');
});

test('toZod returns real zod-like schema', () => {
  const schema = User.toZod();
  const res = schema.safeParse({ id: 2, name: 'john', visits: 3n });
  expect(res.success).toBe(true);
});

test('conflicting roots throw', () => {
  expect(() => {
    @z.Schema()
    class Bad {
      @z.string.int bad!: string;
    }
    Bad.toZod();
  }).toThrow();
});

// Compilation layer tests
test('compile() returns CompiledNode with validate and parse', () => {
  const numValidator = number().gte(0).lte(100);
  const compiled = numValidator.compile();

  expect(compiled).toBeDefined();
  expect(typeof compiled.validate).toBe('function');
  expect(typeof compiled.parse).toBe('function');

  // Valid cases
  expect(compiled.validate(50)).toBe(true);
  expect(compiled.parse(50)).toBe(50);

  // Invalid cases
  expect(compiled.validate(-1)).toBe(false);
  expect(compiled.validate(101)).toBe(false);
});

test('compiled primitive validator parity with safeParse', () => {
  const stringValidator = string().minLength(2).maxLength(5).optional();
  const compiled = stringValidator.compile();

  const testCases = ['', 'a', 'ab', 'abc', 'abcde', 'abcdef', undefined, null];

  for (const input of testCases) {
    const safeResult = stringValidator.safeParse(input);
    const compiledValid = compiled.validate(input);

    expect(compiledValid).toBe(safeResult.success);
  }
});

test('compiled array validator validates elements', () => {
  const arraySchema = array(number().int());
  const compiled = arraySchema.compile();

  expect(compiled.validate([1, 2, 3])).toBe(true);
  expect(compiled.validate([1, 2.5, 3])).toBe(false);
  expect(compiled.validate([1, 'two', 3])).toBe(false);
  expect(compiled.validate('not an array')).toBe(false);
});

test('compiled object validator with multiple fields', () => {
  @z.Schema()
  class Profile {
    @z.number.int.gte(1) age!: number;
    @z.string.minLength(1) name!: string;
    @z.string.email.optional email?: string;
  }

  const schema = Profile.toZod();
  const compiled = schema.compile();

  // Valid case
  expect(compiled.validate({ age: 25, name: 'Alice', email: 'a@example.com' })).toBe(true);

  // Missing optional field is valid
  expect(compiled.validate({ age: 25, name: 'Alice' })).toBe(true);

  // Invalid age
  expect(compiled.validate({ age: 0, name: 'Alice' })).toBe(false);

  // Missing required name
  expect(compiled.validate({ age: 25 })).toBe(false);

  // Invalid email format
  expect(compiled.validate({ age: 25, name: 'Alice', email: 'not-an-email' })).toBe(false);
});

test('Class.validate() uses compiled path', () => {
  const validInput = { id: 1, name: 'john', visits: 4n };
  const invalidInput = { id: 0, name: 'jo', visits: 4n };

  // validate() should use the compiled path
  expect(User.validate(validInput)).toBe(true);
  expect(User.validate(invalidInput)).toBe(false);
});

test('compiled parse() throws same errors as uncompiled', () => {
  const validator = string().email();
  const compiled = validator.compile();

  expect(() => compiled.parse('not-an-email')).toThrow();
  expect(() => validator.parse('not-an-email')).toThrow();

  // Both should work for valid input
  expect(compiled.parse('test@example.com')).toBe('test@example.com');
  expect(validator.parse('test@example.com')).toBe('test@example.com');
});

test('autocompile option triggers compilation on class decoration', async () => {
  const cache = Symbol.for('zody.cache');

  @z.Schema({ autocompile: true })
  class AutocompileUser {
    @z.int.min(1) id!: number;
    @z.string name!: string;
  }

  // autocompile happens in setImmediate, so we need to wait a tick
  await new Promise(resolve => setImmediate(resolve));

  // After autocompile, cache should be populated
  const hasCache = (AutocompileUser as any)[cache] !== undefined;
  expect(hasCache).toBe(true);

  // Verify the compiled validator works
  expect(AutocompileUser.validate({ id: 1, name: 'test' })).toBe(true);
  expect(AutocompileUser.validate({ id: 0, name: 'test' })).toBe(false);
});
