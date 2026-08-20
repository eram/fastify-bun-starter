import { afterEach, describe, expect, test } from 'bun:test';

import {
    arrayOfCheck,
    buildToFunction,
    comparison,
    createCodegenCtx,
    enableCodeGen,
    isArrayCheck,
    isCodeGenEnabled,
    isFiniteCheck,
    isIntegerCheck,
    isPlainObjectCheck,
    lengthCheck,
    numberCoercible,
    objectShapeCheck,
    regexTest,
    typeofCheck,
} from './codegen';
import { number, object, string } from './validator';

describe('codegen.ts builder functions', () => {
    test('typeofCheck emits a typeof expression', () => {
        expect(typeofCheck('input', 'string')).toBe("typeof input === 'string'");
        expect(typeofCheck('input', 'boolean')).toBe("typeof input === 'boolean'");
    });

    test('numberCoercible / isIntegerCheck / isFiniteCheck emit Number()-based expressions', () => {
        expect(numberCoercible('x')).toBe('!Number.isNaN(Number(x))');
        expect(isIntegerCheck('x')).toBe('Number.isInteger(Number(x))');
        expect(isFiniteCheck('x')).toBe('Number.isFinite(Number(x))');
    });

    test('comparison binds the value via addConst and emits the matching operator', () => {
        const ctx = createCodegenCtx();
        const expr = comparison(ctx, 'x', 'gte', 10);
        expect(expr).toBe('(Number(x) >= C[0])');
        expect(ctx.consts).toEqual([10]);
    });

    test('comparison guards bigint coercion in a try/catch IIFE', () => {
        const ctx = createCodegenCtx();
        const expr = comparison(ctx, 'x', 'lt', 5n);
        expect(expr).toContain('try {');
        expect(expr).toContain('BigInt(x)');
        expect(ctx.consts).toEqual([5n]);
    });

    test('lengthCheck emits a .length comparison bound via addConst', () => {
        const ctx = createCodegenCtx();
        const expr = lengthCheck(ctx, 'x', 'min', 3);
        expect(expr).toBe('(x.length >= C[0])');
        expect(ctx.consts).toEqual([3]);
    });

    test('regexTest binds the RegExp object via addConst, never string-interpolating its source', () => {
        const ctx = createCodegenCtx();
        const pattern = /^[a-z]+$/;
        const expr = regexTest(ctx, 'x', pattern);
        expect(expr).toBe('C[0].test(x)');
        expect(expr).not.toContain(pattern.source);
        expect(ctx.consts).toEqual([pattern]);
    });

    test('isArrayCheck / isPlainObjectCheck emit structural checks', () => {
        expect(isArrayCheck('x')).toBe('Array.isArray(x)');
        expect(isPlainObjectCheck('x')).toBe("(typeof x === 'object' && x !== null && !Array.isArray(x))");
    });

    test('arrayOfCheck composes isArrayCheck with a per-item .every()', () => {
        const ctx = createCodegenCtx();
        const expr = arrayOfCheck(ctx, 'x', (item) => `typeof ${item} === 'number'`);
        expect(expr).toContain('Array.isArray(x)');
        expect(expr).toContain('.every(function');
        expect(expr).toContain("typeof _item1 === 'number'");
    });

    test('objectShapeCheck composes a plain-object check with each field, honoring optional', () => {
        const ctx = createCodegenCtx();
        const expr = objectShapeCheck(ctx, 'x', [
            { key: 'name', optional: false, codegen: (p) => `typeof ${p} === 'string'` },
            { key: 'age', optional: true, codegen: (p) => `typeof ${p} === 'number'` },
        ]);
        expect(expr).toContain('typeof x["name"] === \'string\'');
        expect(expr).toContain('x["age"] === undefined ||');
    });

    test('objectShapeCheck with strictKeys rejects unknown properties', () => {
        const ctx = createCodegenCtx();
        const expr = objectShapeCheck(ctx, 'x', [], ['a', 'b']);
        expect(expr).toContain('Object.keys(x).every');
        expect(ctx.consts).toEqual([['a', 'b']]);
    });
});

describe('buildToFunction', () => {
    test('materializes a real Function whose source contains the generated expression', () => {
        const node = { codegen: (_ctx: ReturnType<typeof createCodegenCtx>, expr: string) => typeofCheck(expr, 'string') };
        const fn = buildToFunction(node);

        expect(fn).toBeInstanceOf(Function);
        expect(fn.toString()).toContain("typeof input === 'string'");
        expect(fn('hello')).toBe(true);
        expect(fn(42)).toBe(false);
    });

    test('throws when the node has no codegen()', () => {
        // @ts-expect-error deliberately missing codegen for the error-path test
        expect(() => buildToFunction({})).toThrow();
    });
});

describe('self-replacing validate() is backed by real generated source, not a reinterpretation closure', () => {
    afterEach(() => {
        enableCodeGen(true);
    });

    test('schema.validate source contains inlined checks for every field after the first call', () => {
        const schema = object({
            name: string().min(1),
            age: number().gte(0).lte(120),
        });

        expect(isCodeGenEnabled()).toBe(true);
        schema.validate({ name: 'Alice', age: 30 });

        const source = schema.validate.toString();
        // Proves the compiled function is real generated JS, not a wrapper that just
        // calls back into the interpreted parse()/safeParse() path.
        expect(source).not.toContain('safeParse');
        expect(source).not.toContain('.parse(');
        expect(source).toContain('name');
        expect(source).toContain('age');
        expect(source).toContain('.length');
    });

    test('enableCodeGen(false) keeps validate() as the plain interpreted function (no generated source)', () => {
        enableCodeGen(false);
        const schema = object({ name: string().min(1) });
        const before = schema.validate;

        schema.validate({ name: 'Alice' });

        expect(schema.validate).toBe(before);
        expect(schema.validate.toString()).not.toContain('C[');
    });
});
