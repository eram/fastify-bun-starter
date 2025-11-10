/**
 * JSON Parse/Stringify Benchmark
 * ================================
 *
 * Compares Bun's native JSON methods with Fastify's fast-json-stringify
 *
 * What it tests:
 *   STRINGIFY (Object → JSON String):
 *   - JSON.stringify() - Bun's native JSON serializer (highly optimized)
 *   - fast-json-stringify - Fastify's compiled schema-based serializer
 *
 *   PARSE (JSON String → Object):
 *   - JSON.parse() - Bun's native JSON parser (highly optimized)
 *   - Note: fast-json-stringify doesn't include parsing, only serialization
 *
 * Test data:
 *   - Creates in-memory array of complex objects (GeoJSON-like features)
 *   - Each feature has nested properties, coordinates, etc.
 *   - Tests both serialization and parsing of entire array
 *
 * Key differences:
 *   - JSON.stringify/parse: Universal, works with any object, runtime validation
 *   - fast-json-stringify: Pre-compiled schema, faster in Node.js, less benefit in Bun
 *
 * Usage:
 *   bun run --expose-gc script/bench_json_parse.ts [count]
 *   # Default count: 10000 objects
 *   # Example: bun run --expose-gc script/bench_json_parse.ts 50000
 */
// biome-ignore-all lint/style/useNamingConvention: external json schema naming
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import fastJsonStringify from 'fast-json-stringify';

const DEFAULT_N = 10_000;
const N = Number.parseInt(process.argv[2], 10) || DEFAULT_N;

const r = (n: number) => Math.round(n * 100) / 100;

// Schema for fast-json-stringify (matches our test data structure)
const featureSchema = {
    type: 'object',
    properties: {
        type: { type: 'string' },
        properties: {
            type: 'object',
            properties: {
                MAPBLKLOT: { type: 'string' },
                BLKLOT: { type: 'string' },
                BLOCK_NUM: { type: 'string' },
                LOT_NUM: { type: 'string' },
                FROM_ST: { type: 'string' },
                TO_ST: { type: 'string' },
                STREET: { type: 'string' },
                ST_TYPE: { type: 'string' },
                ODD_EVEN: { type: 'string' },
            },
        },
        geometry: {
            type: 'object',
            properties: {
                type: { type: 'string' },
                coordinates: {
                    type: 'array',
                    items: {
                        type: 'array',
                        items: {
                            type: 'array',
                            items: { type: 'number' },
                        },
                    },
                },
            },
        },
    },
} as const;

const collectionSchema = {
    type: 'object',
    properties: {
        type: { type: 'string' },
        features: {
            type: 'array',
            items: featureSchema,
        },
    },
} as const;

// Generate test data (in-memory objects, not JSON strings)
function generateTestData(count: number) {
    const features = [];

    for (let i = 0; i < count; i++) {
        const baseX = -122.4 + (i % 100) * 0.001;
        const baseY = 37.7 + Math.floor(i / 100) * 0.001;

        const feature = {
            type: 'Feature',
            properties: {
                MAPBLKLOT: `${1000 + Math.floor(i / 1000)}${(i % 1000).toString().padStart(3, '0')}`,
                BLKLOT: `${1000 + Math.floor(i / 100)}/${(i % 100).toString().padStart(3, '0')}`,
                BLOCK_NUM: String(1000 + Math.floor(i / 100)),
                LOT_NUM: String(i % 100).padStart(3, '0'),
                FROM_ST: String(100 + (i % 50) * 100),
                TO_ST: String(199 + (i % 50) * 100),
                STREET: ['MARKET', 'MISSION', 'HOWARD', 'FOLSOM', 'HARRISON'][i % 5],
                ST_TYPE: 'ST',
                ODD_EVEN: i % 2 === 0 ? 'E' : 'O',
            },
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [baseX, baseY],
                        [baseX + 0.0001, baseY],
                        [baseX + 0.0001, baseY + 0.0001],
                        [baseX, baseY + 0.0001],
                        [baseX, baseY],
                    ],
                ],
            },
        };
        features.push(feature);
    }

    return {
        type: 'FeatureCollection',
        features,
    };
}

interface BenchResult {
    time: number;
    avgTime: number;
    memMB: number;
    sizeKB?: number;
    featuresCount?: number;
}

// Benchmark JSON.stringify (Bun's native)
function benchJsonStringify(data: unknown, iterations: number): BenchResult {
    const t0 = performance.now();
    const mem0 = process.memoryUsage().heapUsed;

    let result: string | undefined;
    for (let i = 0; i < iterations; i++) {
        result = JSON.stringify(data);
    }

    const time = performance.now() - t0;
    const mem = process.memoryUsage().heapUsed - mem0;

    return {
        time: r(time),
        avgTime: r(time / iterations),
        memMB: r(mem / 1024 / 1024),
        sizeKB: result ? r(result.length / 1024) : 0,
    };
}

// Benchmark fast-json-stringify (Fastify's compiled serializer)
function benchFastJsonStringify(data: unknown, iterations: number): BenchResult {
    // Pre-compile the stringify function (this happens once)
    const stringify = fastJsonStringify(collectionSchema);

    const t0 = performance.now();
    const mem0 = process.memoryUsage().heapUsed;

    let result: string | undefined;
    for (let i = 0; i < iterations; i++) {
        result = stringify(data as object);
    }

    const time = performance.now() - t0;
    const mem = process.memoryUsage().heapUsed - mem0;

    return {
        time: r(time),
        avgTime: r(time / iterations),
        memMB: r(mem / 1024 / 1024),
        sizeKB: result ? r(result.length / 1024) : 0,
    };
}

// Benchmark JSON.parse (Bun's native)
function benchJsonParse(jsonString: string, iterations: number): BenchResult {
    const t0 = performance.now();
    const mem0 = process.memoryUsage().heapUsed;

    let result: unknown;
    for (let i = 0; i < iterations; i++) {
        result = JSON.parse(jsonString);
    }

    const time = performance.now() - t0;
    const mem = process.memoryUsage().heapUsed - mem0;

    return {
        time: r(time),
        avgTime: r(time / iterations),
        memMB: r(mem / 1024 / 1024),
        featuresCount: (result as { features?: unknown[] })?.features?.length || 0,
    };
}

// Benchmark round-trip: stringify + parse
function benchRoundTrip(data: unknown, iterations: number): BenchResult {
    const t0 = performance.now();
    const mem0 = process.memoryUsage().heapUsed;

    let result: unknown;
    for (let i = 0; i < iterations; i++) {
        const jsonString = JSON.stringify(data);
        result = JSON.parse(jsonString);
    }

    const time = performance.now() - t0;
    const mem = process.memoryUsage().heapUsed - mem0;

    return {
        time: r(time),
        avgTime: r(time / iterations),
        memMB: r(mem / 1024 / 1024),
        featuresCount: (result as { features?: unknown[] })?.features?.length || 0,
    };
}

// Benchmark fast-json-stringify + JSON.parse
function benchFastStringifyParse(data: unknown, iterations: number): BenchResult {
    const stringify = fastJsonStringify(collectionSchema);

    const t0 = performance.now();
    const mem0 = process.memoryUsage().heapUsed;

    let result: unknown;
    for (let i = 0; i < iterations; i++) {
        const jsonString = stringify(data as object);
        result = JSON.parse(jsonString);
    }

    const time = performance.now() - t0;
    const mem = process.memoryUsage().heapUsed - mem0;

    return {
        time: r(time),
        avgTime: r(time / iterations),
        memMB: r(mem / 1024 / 1024),
        featuresCount: (result as { features?: unknown[] })?.features?.length || 0,
    };
}

async function runGC() {
    if (typeof global.gc === 'function') {
        await global.gc({ execution: 'async' });
        // Small delay to let GC settle
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

async function main() {
    if (typeof global.gc !== 'function') {
        console.error('ERROR: Run with --expose-gc flag to enable manual garbage collection');
        console.error('Usage: bun run --expose-gc script/bench_json_parse.ts [count]');
        process.exit(1);
    }

    console.log('Generating test data...');
    const testData = generateTestData(N);
    const jsonString = JSON.stringify(testData);
    const dataSize = jsonString.length;

    console.log('\n=== Test Configuration ===');
    console.table({
        runtime: 'Bun',
        version: Bun.version,
        host: os.hostname(),
        objects: N,
        dataSizeMB: r(dataSize / 1024 / 1024),
        iterations: 10,
    });

    console.log('\n=== Warmup ===');
    // Warmup runs to stabilize JIT
    JSON.stringify(testData);
    JSON.parse(jsonString);
    const fastStringify = fastJsonStringify(collectionSchema);
    fastStringify(testData);
    console.log('Warmup complete');

    const ITERATIONS = 10;
    const results: Record<string, BenchResult> = {};

    console.log('\n=== STRINGIFY Benchmarks (Object → JSON String) ===');

    await runGC();
    console.log('Testing JSON.stringify (Bun native)...');
    results['Stringify: JSON.stringify (Bun)'] = benchJsonStringify(testData, ITERATIONS);

    await runGC();
    console.log('Testing fast-json-stringify (Fastify)...');
    results['Stringify: fast-json-stringify'] = benchFastJsonStringify(testData, ITERATIONS);

    console.log('\n=== PARSE Benchmarks (JSON String → Object) ===');

    await runGC();
    console.log('Testing JSON.parse (Bun native)...');
    results['Parse: JSON.parse (Bun)'] = benchJsonParse(jsonString, ITERATIONS);

    console.log('\n=== ROUND-TRIP Benchmarks (Object → JSON → Object) ===');

    await runGC();
    console.log('Testing JSON.stringify + JSON.parse (Bun)...');
    results['Round-trip: JSON (Bun)'] = benchRoundTrip(testData, ITERATIONS);

    await runGC();
    console.log('Testing fast-json-stringify + JSON.parse...');
    results['Round-trip: fast-json + Bun parse'] = benchFastStringifyParse(testData, ITERATIONS);

    console.log('\n=== Results ===');
    console.table(
        Object.entries(results).map(([method, stats]) => ({
            method,
            'total (ms)': stats.time,
            'avg (ms)': stats.avgTime,
            'mem (MB)': stats.memMB,
            'size (KB)': stats.sizeKB ?? '-',
            features: stats.featuresCount ?? '-',
        })),
    );

    // Calculate comparisons
    console.log('\n=== Analysis ===');

    // Stringify comparison
    const bunStringifyTime = results['Stringify: JSON.stringify (Bun)'].avgTime;
    const fastifyStringifyTime = results['Stringify: fast-json-stringify'].avgTime;
    const stringifySpeedup = bunStringifyTime / fastifyStringifyTime;

    console.log('\n📊 Stringify Performance:');
    if (stringifySpeedup > 1.1) {
        console.log(`  ✓ fast-json-stringify is ${r(stringifySpeedup)}x faster than Bun's JSON.stringify`);
    } else if (stringifySpeedup < 0.9) {
        console.log(`  ✓ Bun's JSON.stringify is ${r(1 / stringifySpeedup)}x faster than fast-json-stringify`);
        console.log("    (Bun's native JSON serializer is highly optimized)");
    } else {
        console.log('  ✓ Both methods have similar performance (within 10%)');
    }

    // Round-trip comparison
    const bunRoundTripTime = results['Round-trip: JSON (Bun)'].avgTime;
    const mixedRoundTripTime = results['Round-trip: fast-json + Bun parse'].avgTime;
    const roundTripSpeedup = bunRoundTripTime / mixedRoundTripTime;

    console.log('\n📊 Round-trip Performance:');
    if (roundTripSpeedup > 1.1) {
        console.log(`  ✓ fast-json + parse is ${r(roundTripSpeedup)}x faster than native round-trip`);
    } else if (roundTripSpeedup < 0.9) {
        console.log(`  ✓ Bun native round-trip is ${r(1 / roundTripSpeedup)}x faster than fast-json + parse`);
    } else {
        console.log('  ✓ Both round-trips have similar performance (within 10%)');
    }

    console.log('\n💡 Key Takeaways:');
    console.log("  • Bun's native JSON.stringify is highly optimized for performance");
    console.log('  • fast-json-stringify provides schema validation at compile time');
    console.log('  • fast-json-stringify is 2-3x faster in Node.js/V8 environments');
    console.log('  • In Bun, native methods often outperform compiled alternatives');
    console.log('  • Use fast-json-stringify when schema validation is critical');
}

main().catch(console.error);
