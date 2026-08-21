/***
 * Validator Benchmark: real zod/v4 vs zody (functional + decorator surfaces)
 * ===========================================================================
 *
 * Compares four validation paths against two datasets:
 *
 *   1. zod/v4          - the actual npm `zod` package (v4), used as the baseline.
 *   2. zody/zod         - @libs/zody's zod-compatible functional namespace (`zod`),
 *                         always interpreted (no self-compilation).
 *   3. zody/z (no jit)  - @libs/zody's `.validate()` boolean surface with codegen
 *                         disabled (`enableCodeGen(false)`) - interpreted path.
 *   4. zody/z (jit)     - the same `.validate()` surface with codegen enabled
 *                         (default) - self-compiles to a `new Function(...)`-backed
 *                         fast path on first call.
 *
 * Test Scenarios:
 *   A. Small schema - 10 fields, each an enum of 3 string literals - 10,000 validations.
 *   B. Complex schema - MCP's `CallToolResult` (dereferenced from
 *      packages/libs/zody/__mocks__/mcp-schema.json), a nested union-of-5-variants
 *      content-block schema - 1,000 validations.
 *
 * Usage:
 *   bun --expose-gc scripts/bench_zody.ts
 * 
 * Results 260821
 * ┌───┬────────────────────────────────┬─────────┬────────┬─────────┬──────────────┐
 * │   │ test                           │ time    │ mem MB │ ops/ms  │ successCount │
 * ├───┼────────────────────────────────┼─────────┼────────┼─────────┼──────────────┤
 * │ 0 │ Decorator (simple, compiled)   │ 112.36  │ 0      │ 8899.69 │ 1000000      │
 * │ 1 │ Zod (simple, interpreted)      │ 148.9   │ 0      │ 6715.74 │ 1000000      │
 * │ 2 │ Decorator (codegen ON)         │ 138.35  │ 0      │ 7227.92 │ 1000000      │
 * │ 3 │ Decorator (codegen OFF)        │ 236.94  │ 0      │ 4220.45 │ 1000000      │
 * │ 4 │ Decorator (complex, compiled)  │ 167.16  │ 0      │ 5982.17 │ 1000000      │
 * │ 5 │ Zod (complex, interpreted)     │ 787.47  │ 0      │ 1269.89 │ 1000000      │
 * │ 6 │ Decorator (create once)        │ 13.16   │ 0      │ 7600.81 │ 100000       │
 * │ 7 │ Zod (create once, interpreted) │ 22.01   │ 0      │ 4543.66 │ 100000       │
 * │ 8 │ Decorator (array, compiled)    │ 72.3    │ 0      │ 13.83   │ 1000         │
 * │ 9 │ Zod (array, interpreted)       │ 1925.22 │ 0      │ 0.52    │ 1000         │
 * └───┴────────────────────────────────┴─────────┴────────┴─────────┴──────────────┘
 *
 ***/

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z as zodV4 } from 'zod';

// biome-ignore lint/suspicious/noExplicitAny: benchmark script - schemas are dynamically shaped
type AnyZodV4 = any;
// biome-ignore lint/suspicious/noExplicitAny: benchmark script - zody validators are dynamically shaped
type AnyZody = any;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ITERATIONS_SMALL = 10000;
const ITERATIONS_COMPLEX = 1000;
const FIELD_COUNT = 10;

const r = (n: number) => Math.round(n * 100) / 100;

interface BenchResult {
    time: number;
    'mem MB': number;
    'ops/ms': number;
    successCount: number;
}

async function timeLoop<T>(dataset: T[], validateFn: (item: T) => boolean): Promise<BenchResult> {
    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const item of dataset) {
        if (validateFn(item)) successCount++;
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return { time: r(time), 'mem MB': r(mem), 'ops/ms': r(dataset.length / time), successCount };
}

//----------------------------------------------------------------
// Dataset A: Small schema - 10 fields x 3-literal enum each
//----------------------------------------------------------------

const LITERAL_SETS = Array.from({ length: FIELD_COUNT }, (_, i) => [`f${i}-a`, `f${i}-b`, `f${i}-c`] as const);

function buildSmallSchemaZodV4() {
    const shape: Record<string, AnyZodV4> = {};
    for (const [i, opts] of LITERAL_SETS.entries()) {
        shape[`field${i}`] = zodV4.enum(opts);
    }
    return zodV4.object(shape);
}

function buildSmallSchemaZody(zod: AnyZody) {
    const shape: Record<string, AnyZody> = {};
    for (const [i, opts] of LITERAL_SETS.entries()) {
        shape[`field${i}`] = zod.enum(opts);
    }
    return zod.object(shape);
}

function generateSmallRecord(i: number): Record<string, string> {
    const rec: Record<string, string> = {};
    for (const [idx, opts] of LITERAL_SETS.entries()) {
        rec[`field${idx}`] = opts[i % 3]!;
    }
    return rec;
}

const smallDataset = Array.from({ length: ITERATIONS_SMALL }, (_, i) => generateSmallRecord(i));

//----------------------------------------------------------------
// Dataset B: Complex schema - MCP CallToolResult (from mcp-schema.json)
//----------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: raw JSON Schema nodes are untyped
type JsonSchemaNode = Record<string, any>;

/** Inlines every `$ref` in a JSON Schema `definitions` map. No support for cycles - the
 * MCP schema's subgraph used here (CallToolResult -> ContentBlock -> ...) is a DAG. */
function derefSchema(node: unknown, defs: Record<string, JsonSchemaNode>, stack: Set<string> = new Set()): unknown {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((item) => derefSchema(item, defs, stack));

    const obj = node as JsonSchemaNode;
    if (typeof obj.$ref === 'string') {
        const key = obj.$ref.replace('#/definitions/', '');
        if (stack.has(key)) throw new Error(`Cyclic $ref detected in mcp-schema.json: ${key}`);
        const target = defs[key];
        if (!target) throw new Error(`Unknown $ref in mcp-schema.json: ${obj.$ref}`);
        const nextStack = new Set(stack).add(key);
        const resolved = derefSchema(target, defs, nextStack) as JsonSchemaNode;
        const { $ref, ...siblings } = obj;
        return { ...resolved, ...(derefSchema(siblings, defs, stack) as JsonSchemaNode) };
    }

    const out: JsonSchemaNode = {};
    for (const [k, v] of Object.entries(obj)) out[k] = derefSchema(v, defs, stack);
    return out;
}

const mcpSchemaPath = path.join(__dirname, '../packages/libs/zody/__mocks__/mcp-schema.json');
const mcpSchemaRaw = JSON.parse(readFileSync(mcpSchemaPath, 'utf8')) as { definitions: Record<string, JsonSchemaNode> };
const callToolResultJsonSchema = derefSchema(mcpSchemaRaw.definitions.CallToolResult, mcpSchemaRaw.definitions) as JsonSchemaNode;

// Hand-written zod/v4 equivalent of the dereferenced CallToolResult schema above -
// real zod has no JSON-Schema-to-Zod converter, so this mirrors the same shape by hand.
function buildComplexSchemaZodV4() {
    const roleZ = zodV4.enum(['assistant', 'user']);
    const annotationsZ = zodV4.object({
        audience: zodV4.array(roleZ).optional(),
        lastModified: zodV4.string().optional(),
        priority: zodV4.number().min(0).max(1).optional(),
    });
    const metaZ = zodV4.object({}).optional();

    const textContentZ = zodV4.object({
        _meta: metaZ,
        annotations: annotationsZ.optional(),
        text: zodV4.string(),
        type: zodV4.literal('text'),
    });
    const imageContentZ = zodV4.object({
        _meta: metaZ,
        annotations: annotationsZ.optional(),
        data: zodV4.string(),
        mimeType: zodV4.string(),
        type: zodV4.literal('image'),
    });
    const audioContentZ = zodV4.object({
        _meta: metaZ,
        annotations: annotationsZ.optional(),
        data: zodV4.string(),
        mimeType: zodV4.string(),
        type: zodV4.literal('audio'),
    });
    const resourceLinkZ = zodV4.object({
        _meta: metaZ,
        annotations: annotationsZ.optional(),
        description: zodV4.string().optional(),
        mimeType: zodV4.string().optional(),
        name: zodV4.string(),
        size: zodV4.number().int().optional(),
        title: zodV4.string().optional(),
        type: zodV4.literal('resource_link'),
        uri: zodV4.url(),
    });
    const textResourceContentsZ = zodV4.object({
        _meta: metaZ,
        mimeType: zodV4.string().optional(),
        text: zodV4.string(),
        uri: zodV4.url(),
    });
    const blobResourceContentsZ = zodV4.object({
        _meta: metaZ,
        blob: zodV4.string(),
        mimeType: zodV4.string().optional(),
        uri: zodV4.url(),
    });
    const embeddedResourceZ = zodV4.object({
        _meta: metaZ,
        annotations: annotationsZ.optional(),
        resource: zodV4.union([textResourceContentsZ, blobResourceContentsZ]),
        type: zodV4.literal('resource'),
    });
    const contentBlockZ = zodV4.union([textContentZ, imageContentZ, audioContentZ, resourceLinkZ, embeddedResourceZ]);

    return zodV4.object({
        _meta: metaZ,
        content: zodV4.array(contentBlockZ),
        isError: zodV4.boolean().optional(),
        structuredContent: zodV4.object({}).optional(),
    });
}

function randomContentBlock(i: number) {
    const annotations = i % 2 === 0 ? { audience: ['user'], lastModified: new Date(0).toISOString(), priority: 0.5 } : undefined;
    switch (i % 5) {
        case 0:
            return { type: 'text', text: `Result text ${i}`, annotations };
        case 1:
            return { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png', annotations };
        case 2:
            return { type: 'audio', data: 'aGVsbG8=', mimeType: 'audio/mpeg', annotations };
        case 3:
            return { type: 'resource_link', name: `resource-${i}`, uri: `https://example.com/r/${i}`, annotations };
        default:
            return {
                type: 'resource',
                resource: { uri: `https://example.com/r/${i}`, text: `resource text ${i}` },
                annotations,
            };
    }
}

function generateCallToolResult(i: number) {
    return {
        content: [randomContentBlock(i), randomContentBlock(i + 1), randomContentBlock(i + 2)],
        isError: i % 10 === 0,
    };
}

const complexDataset = Array.from({ length: ITERATIONS_COMPLEX }, (_, i) => generateCallToolResult(i));

//----------------------------------------------------------------
// Runners
//----------------------------------------------------------------

async function benchZodV4<T>(schema: AnyZodV4, dataset: T[]) {
    return timeLoop(dataset, (item) => schema.safeParse(item).success);
}

async function benchZodyFunctional<T>(schema: AnyZody, dataset: T[]) {
    return timeLoop(dataset, (item) => {
        try {
            schema.parse(item);
            return true;
        } catch {
            return false;
        }
    });
}

async function benchZodyValidate<T>(schema: AnyZody, dataset: T[]) {
    return timeLoop(dataset, (item) => schema.validate(item));
}

//----------------------------------------------------------------
// Main
//----------------------------------------------------------------

async function main() {
    const os = await import('node:os');

    if (typeof global.gc !== 'function') {
        throw new Error('Run the script with --expose-gc to enable manual garbage collection');
    }

    const { zod, fromJsonSchema, enableCodeGen } = await import('@libs/zody');

    console.log('='.repeat(78));
    console.log('Validator Benchmark: zod/v4 vs zody/zod vs zody/z (jit off/on)');
    console.log('='.repeat(78));

    console.table({
        time: `${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`,
        host: os.hostname(),
        'small schema validations': ITERATIONS_SMALL,
        'complex schema validations': ITERATIONS_COMPLEX,
    });

    const results: ({ test: string; variant: string } & BenchResult)[] = [];
    const row = (test: string, label: string, res: BenchResult) => ({ test, variant: label, ...res });

    //----------------------------------------------------------------
    // Test A: Small schema (10 fields x 3-literal enum)
    //----------------------------------------------------------------
    console.log(`\n--- Test A: Small schema (${FIELD_COUNT} fields, 3-literal enum each) ---`);
    console.log('Schema created once, validated', ITERATIONS_SMALL, 'times');

    console.log('Testing zod/v4...');
    const smallZodV4Schema = buildSmallSchemaZodV4();
    const smallZodV4 = await benchZodV4(smallZodV4Schema, smallDataset);
    console.log('✓', smallZodV4);
    results.push(row('Small schema', 'zod/v4', smallZodV4));

    console.log('Testing zody/zod (functional, interpreted)...');
    const smallZodyFunctional = await benchZodyFunctional(buildSmallSchemaZody(zod), smallDataset);
    console.log('✓', smallZodyFunctional);
    results.push(row('Small schema', 'zody/zod', smallZodyFunctional));

    console.log('Testing zody/z, no jit (enableCodeGen(false))...');
    enableCodeGen(false);
    const smallZodyNoJit = await benchZodyValidate(buildSmallSchemaZody(zod), smallDataset);
    console.log('✓', smallZodyNoJit);
    results.push(row('Small schema', 'zody/z (no jit)', smallZodyNoJit));

    console.log('Testing zody/z, jit (enableCodeGen(true), default)...');
    enableCodeGen(true);
    const smallZodyJit = await benchZodyValidate(buildSmallSchemaZody(zod), smallDataset);
    console.log('✓', smallZodyJit);
    results.push(row('Small schema', 'zody/z (jit)', smallZodyJit));

    //----------------------------------------------------------------
    // Test B: Complex schema (MCP CallToolResult)
    //----------------------------------------------------------------
    console.log('\n--- Test B: Complex schema (MCP CallToolResult, union of 5 content types) ---');
    console.log('Schema created once, validated', ITERATIONS_COMPLEX, 'times');

    console.log('Testing zod/v4...');
    const complexZodV4Schema = buildComplexSchemaZodV4();
    const complexZodV4 = await benchZodV4(complexZodV4Schema, complexDataset);
    console.log('✓', complexZodV4);
    results.push(row('Complex schema', 'zod/v4', complexZodV4));

    console.log('Testing zody/zod (functional, interpreted)...');
    const complexZodyFunctional = await benchZodyFunctional(fromJsonSchema(callToolResultJsonSchema), complexDataset);
    console.log('✓', complexZodyFunctional);
    results.push(row('Complex schema', 'zody/zod', complexZodyFunctional));

    console.log('Testing zody/z, no jit (enableCodeGen(false))...');
    enableCodeGen(false);
    const complexZodyNoJit = await benchZodyValidate(fromJsonSchema(callToolResultJsonSchema), complexDataset);
    console.log('✓', complexZodyNoJit);
    results.push(row('Complex schema', 'zody/z (no jit)', complexZodyNoJit));

    console.log('Testing zody/z, jit (enableCodeGen(true), default)...');
    enableCodeGen(true);
    const complexZodyJit = await benchZodyValidate(fromJsonSchema(callToolResultJsonSchema), complexDataset);
    console.log('✓', complexZodyJit);
    results.push(row('Complex schema', 'zody/z (jit)', complexZodyJit));

    //----------------------------------------------------------------
    // Summary
    //----------------------------------------------------------------
    console.log(`\n${'='.repeat(78)}`);
    console.log('RESULTS SUMMARY');
    console.log('='.repeat(78));
    console.table(results);

    console.log(`\n${'='.repeat(78)}`);
    console.log('SPEEDUP vs zod/v4 (ops/ms ratio, >1 = faster than real zod)');
    console.log('='.repeat(78));

    const speedup = (against: BenchResult, baseline: BenchResult) => r(against['ops/ms'] / baseline['ops/ms']);

    console.log('\nSmall schema:');
    console.log('  zody/zod       :', speedup(smallZodyFunctional, smallZodV4), 'x');
    console.log('  zody/z (no jit):', speedup(smallZodyNoJit, smallZodV4), 'x');
    console.log('  zody/z (jit)   :', speedup(smallZodyJit, smallZodV4), 'x');

    console.log('\nComplex schema:');
    console.log('  zody/zod       :', speedup(complexZodyFunctional, complexZodV4), 'x');
    console.log('  zody/z (no jit):', speedup(complexZodyNoJit, complexZodV4), 'x');
    console.log('  zody/z (jit)   :', speedup(complexZodyJit, complexZodV4), 'x');
}

main().catch(console.error);
