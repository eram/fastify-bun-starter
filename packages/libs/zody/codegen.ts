/**
 * Shared source-generation backend for validator.ts's TypeV hierarchy, which powers
 * both the functional API (validator.ts / zod.ts) and the decorator system (zody.ts,
 * which delegates to validator.ts's nodes rather than reimplementing validation).
 *
 * A validator node that wants a fast path implements `codegen(ctx, expr)`, returning
 * a boolean JS expression that tests `expr`. Parent nodes (array/object/union) compose
 * their children's expressions bottom-up; the schema root then materializes the whole
 * tree into one `new Function(...)` via `buildToFunction()`.
 *
 * Constants (regex patterns) are always bound as closure arguments via `addConst` —
 * never string-interpolated into the generated source — so codegen can't turn
 * untrusted schema data into injectable code.
 */

export type CodegenCtx = {
    consts: unknown[];
    addConst(value: unknown): string;
    freshVar(hint?: string): string;
};

export function createCodegenCtx(): CodegenCtx {
    const consts: unknown[] = [];
    let varCounter = 0;
    return {
        consts,
        addConst(value: unknown): string {
            consts.push(value);
            return `C[${consts.length - 1}]`;
        },
        freshVar(hint = 'v'): string {
            varCounter += 1;
            return `_${hint}${varCounter}`;
        },
    };
}

type CodegenNode = {
    codegen(ctx: CodegenCtx, expr: string): string;
};

/** Stage 2 entry point: materializes one compiled function from a validator's codegen(). */
export function buildToFunction(node: CodegenNode): (input: unknown) => boolean {
    if (!node.codegen) throw new Error('cannot build fast validator: node has no codegen()');
    const ctx = createCodegenCtx();
    const expr = node.codegen(ctx, 'input');
    const factory = new Function('C', `return function (input) { return !!(${expr}); };`) as (
        consts: unknown[],
    ) => (input: unknown) => boolean;
    return factory(ctx.consts);
}

//
// --- Global codegen toggle ---
//
// Governs whether `validate()` on a schema root ever materializes a `new Function(...)`.
// Disabled, `validate()` always falls back to interpreted `safeParse().success` — useful
// under a strict CSP that disallows `new Function`, or for debugging.
//

let codeGenEnabled = true;

export function enableCodeGen(enabled = true): void {
    codeGenEnabled = enabled;
}

export function isCodeGenEnabled(): boolean {
    return codeGenEnabled;
}

//
// --- Shared codegen fragment builders ---
//

export function typeofCheck(expr: string, type: 'string' | 'boolean'): string {
    return `typeof ${expr} === '${type}'`;
}

/** Matches NumV's coercing base check: value coerces to a non-NaN number. */
export function numberCoercible(expr: string): string {
    return `!Number.isNaN(Number(${expr}))`;
}

export function isIntegerCheck(expr: string): string {
    return `Number.isInteger(Number(${expr}))`;
}

export function isFiniteCheck(expr: string): string {
    return `Number.isFinite(Number(${expr}))`;
}

export type ComparisonOp = 'gte' | 'lte' | 'gt' | 'lt';

const COMPARISON_OPERATORS: Record<ComparisonOp, string> = {
    gte: '>=',
    lte: '<=',
    gt: '>',
    lt: '<',
};

export function comparison(ctx: CodegenCtx, expr: string, op: ComparisonOp, value: number | bigint): string {
    const valueRef = ctx.addConst(value);
    if (typeof value === 'bigint') {
        // BigInt(x) throws on non-coercible input; guard inline rather than let the
        // whole generated validate() function throw.
        return `(function () { try { return BigInt(${expr}) ${COMPARISON_OPERATORS[op]} ${valueRef}; } catch { return false; } })()`;
    }
    return `(Number(${expr}) ${COMPARISON_OPERATORS[op]} ${valueRef})`;
}

export type LengthOp = 'min' | 'max' | 'eq';

export function lengthCheck(ctx: CodegenCtx, expr: string, op: LengthOp, value: number): string {
    const lenRef = ctx.addConst(value);
    const operator = op === 'min' ? '>=' : op === 'max' ? '<=' : '===';
    return `(${expr}.length ${operator} ${lenRef})`;
}

/** Binds `pattern` via addConst (never string-interpolated) and emits an inline `.test()` call. */
export function regexTest(ctx: CodegenCtx, expr: string, pattern: RegExp): string {
    const patternRef = ctx.addConst(pattern);
    return `${patternRef}.test(${expr})`;
}

export function isArrayCheck(expr: string): string {
    return `Array.isArray(${expr})`;
}

export function isPlainObjectCheck(expr: string): string {
    return `(typeof ${expr} === 'object' && ${expr} !== null && !Array.isArray(${expr}))`;
}

/** Generalizes the `Array.isArray(x) && x.every(item => innerCheck)` pattern. */
export function arrayOfCheck(ctx: CodegenCtx, expr: string, innerCodegen: (itemExpr: string) => string): string {
    const itemVar = ctx.freshVar('item');
    const innerExpr = innerCodegen(itemVar);
    return `(${isArrayCheck(expr)} && ${expr}.every(function (${itemVar}) { return !!(${innerExpr}); }))`;
}

export type ObjectShapeField = {
    key: string;
    optional: boolean;
    codegen: (propExpr: string) => string;
};

/** Generalizes the object-shape check pattern: type check AND (optional strict-key check) AND each field. */
export function objectShapeCheck(ctx: CodegenCtx, expr: string, fields: ObjectShapeField[], strictKeys?: string[]): string {
    const parts = [isPlainObjectCheck(expr)];
    if (strictKeys) {
        const keysConst = ctx.addConst(strictKeys);
        parts.push(`Object.keys(${expr}).every(function (_k) { return ${keysConst}.includes(_k); })`);
    }
    for (const field of fields) {
        const propExpr = `${expr}[${JSON.stringify(field.key)}]`;
        const checkExpr = field.codegen(propExpr);
        parts.push(
            field.optional ? `(${propExpr} === undefined || (${checkExpr}))` : `(${propExpr} !== undefined && (${checkExpr}))`,
        );
    }
    return `(${parts.join(' && ')})`;
}
