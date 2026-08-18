import { expect, test } from 'bun:test';
import { z } from './zody';

@z.Schema({ inferDefault: true })
class User {
  @z.int.min(1) id!: number;
  @z.min(3) name = 'john';
  @z.email.optional email?: string;
  @z.bigint visits!: bigint;
}

test('validate and parse basic class', () => {
  expect(User.validate({ id: 1, name: 'john', visits: 4n })).toBe(true);
  expect(User.validate({ id: 0, name: 'jo', visits: 4n })).toBe(false);
  const parsed = User.parse({ id: 1, visits: 4n });
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
