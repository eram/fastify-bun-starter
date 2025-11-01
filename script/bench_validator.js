/***
 * Validator Benchmark: Our validator vs Zod v4
 * ============================================
 *
 * NOTE: This benchmark is currently disabled as it was designed for a different
 * validator API (jsonValidator). The current project uses Fastify's validator API.
 * TODO: Rewrite this benchmark to work with the current validator implementation.
 *
 * This benchmark compares our custom validator implementation against Zod v4,
 * testing both scenarios where Zod v4 excels and where it struggles.
 *
 * Test Scenarios:
 *   1. Reused Schema (Zod v4 advantage) - Schema created once, parse many times
 *   2. Create Once (Our advantage) - Schema created and used once (React pattern)
 *   3. Complex Nested Object - Deep validation with multiple types
 *   4. Array of Objects - Collection validation performance
 *
 * Key Insights:
 *   - Zod v4 uses JIT compilation (new Function) for 7-8x speed on reused schemas
 *   - Zod v4 schema creation is 15x slower than v3 (6 ops/ms vs 93 ops/ms)
 *   - Our validator aims for balance: fast schema creation + decent runtime
 *
 * Usage:
 *   node --expose-gc scripts/bench_validator.js
 *
 * Benchmark Design:
 *   - Uses GC cleanup between tests (like other /scripts benchmarks)
 *   - Measures time in ms and memory in MB
 *   - Tests with realistic data sizes (1000-10000 validations)
 *   - Includes both valid and invalid data scenarios
 *
 * LAST RESULT SUMMARY (2025-10-22):
 * ====================================================================
 * ┌───────────────────┬─────────────────────┐
 * │ (index)           │ Values              │
 * ├───────────────────┼─────────────────────┤
 * │ time              │ '2025-10-22 17:06Z' │
 * │ host              │ 'eram-lap-23'       │
 * │ reused iterations │ 1000000             │
 * │ once iterations   │ 100000              │
 * │ array size        │ 10000               │
 * └───────────────────┴─────────────────────┘
 * ┌─────────┬───────────────────────────────┬──────────┬────────┬─────────┬──────────────┐
 * │ (index) │ test                          │ time     │ mem MB │ ops/ms  │ successCount │
 * ├─────────┼───────────────────────────────┼──────────┼────────┼─────────┼──────────────┤
 * │ 0       │ 'Validator (simple, reused)'  │ 369.64   │ 69.37  │ 2705.3  │ 1000000      │
 * │ 1       │ 'Zod4 (simple, reused)'       │ 460.67   │ 81.6   │ 2170.75 │ 1000000      │
 * │ 2       │ 'Validator (complex, reused)' │ 2444.02  │ 87.78  │ 409.16  │ 1000000      │
 * │ 3       │ 'Zod4 (complex, reused)'      │ 1877.02  │ 59.18  │ 532.76  │ 1000000      │
 * │ 4       │ 'Validator (create once)'     │ 505.92   │ 18.56  │ 197.66  │ 100000       │
 * │ 5       │ 'Zod4 (create once)'          │ 66245.63 │ 133.85 │ 1.51    │ 100000       │
 * │ 6       │ 'Validator (array)'           │ 5565.21  │ 424.8  │ 0.18    │ 1000         │
 * │ 7       │ 'Zod4 (array)'                │ 5045.48  │ 408.78 │ 0.2     │ 1000         │
 * └─────────┴───────────────────────────────┴──────────┴────────┴─────────┴──────────────┘
 *
 ***/

import { performance } from 'node:perf_hooks';

const ITERATIONS_REUSED = 1000000; // Parse same schema many times (100x)
const ITERATIONS_ONCE = 100000; // Create schema + parse once (React component pattern) (100x)
const ARRAY_SIZE = 10000; // Items in array validation test (100x)

const r = (n) => Math.round(n * 100) / 100;

// Generate random test data
function generateUser(id) {
    return {
        id,
        name: `User${id}`,
        email: `user${id}@example.com`,
        age: 18 + (id % 50),
        isActive: id % 2 === 0,
        profile: {
            bio: `Bio for user ${id}`.repeat(3),
            website: `https://user${id}.example.com`,
            location: {
                city: ['NYC', 'SF', 'LA', 'Seattle', 'Boston'][id % 5],
                country: 'USA',
                coordinates: {
                    lat: 37.7749 + (id % 100) * 0.01,
                    lng: -122.4194 + (id % 100) * 0.01,
                },
            },
        },
        tags: ['tag1', 'tag2', 'tag3'].slice(0, (id % 3) + 1),
        metadata: {
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString(),
            loginCount: id * 10,
        },
    };
}

function _generateInvalidUser(id) {
    const user = generateUser(id);
    // Make it invalid in various ways
    if (id % 3 === 0) user.email = 'invalid-email'; // Bad email
    if (id % 3 === 1) user.age = -5; // Negative age
    if (id % 3 === 2) delete user.name; // Missing required field
    return user;
}

//----------------------------------------------------------------
// Test 1: Reused Schema - Parse Many Times (Zod v4 advantage)
//----------------------------------------------------------------

async function benchOurValidatorReused() {
    const { parse, object, string, number, boolean, array } = await import('../src/lib/validator/schema.ts');

    // Create schema once
    const schema = {
        id: number(),
        name: string().min(3),
        email: string().email(),
        age: number().min(0).max(120),
        isActive: boolean(),
        profile: object({
            bio: string(),
            website: string(),
            location: object({
                city: string(),
                country: string(),
                coordinates: object({
                    lat: number(),
                    lng: number(),
                }),
            }),
        }),
        tags: array(string()),
        metadata: object({
            createdAt: string(),
            lastLogin: string(),
            loginCount: number(),
        }),
    };

    const testData = Array.from({ length: ITERATIONS_REUSED }, (_, i) => generateUser(i));

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const data of testData) {
        const result = parse(schema, data);
        if (result) successCount++;
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return {
        time: r(time),
        'mem MB': r(mem),
        'ops/ms': r(ITERATIONS_REUSED / time),
        successCount,
    };
}

async function benchZodReused() {
    const z = await import('zod').then((m) => m.z);

    // Create schema once
    const schema = z.object({
        id: z.number(),
        name: z.string().min(3),
        email: z.string().email(),
        age: z.number().min(0).max(120),
        isActive: z.boolean(),
        profile: z.object({
            bio: z.string(),
            website: z.string(),
            location: z.object({
                city: z.string(),
                country: z.string(),
                coordinates: z.object({
                    lat: z.number(),
                    lng: z.number(),
                }),
            }),
        }),
        tags: z.array(z.string()),
        metadata: z.object({
            createdAt: z.string(),
            lastLogin: z.string(),
            loginCount: z.number(),
        }),
    });

    const testData = Array.from({ length: ITERATIONS_REUSED }, (_, i) => generateUser(i));

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const data of testData) {
        try {
            const result = schema.parse(data);
            if (result) successCount++;
        } catch (_e) {
            // Invalid data
        }
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return {
        time: r(time),
        'mem MB': r(mem),
        'ops/ms': r(ITERATIONS_REUSED / time),
        successCount,
    };
}

//----------------------------------------------------------------
// Test 2: Create Once - Schema + Parse (Our advantage)
//----------------------------------------------------------------

async function benchOurValidatorCreateOnce() {
    const { parse, object, string, number, boolean, array } = await import('../src/lib/validator/schema.ts');

    const testData = Array.from({ length: ITERATIONS_ONCE }, (_, i) => generateUser(i));

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const data of testData) {
        // Create schema every time (React component pattern)
        const schema = {
            id: number(),
            name: string().min(3),
            email: string().email(),
            age: number().min(0).max(120),
            isActive: boolean(),
            profile: object({
                bio: string(),
                website: string(),
                location: object({
                    city: string(),
                    country: string(),
                    coordinates: object({
                        lat: number(),
                        lng: number(),
                    }),
                }),
            }),
            tags: array(string()),
            metadata: object({
                createdAt: string(),
                lastLogin: string(),
                loginCount: number(),
            }),
        };
        const result = parse(schema, data);
        if (result) successCount++;
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return {
        time: r(time),
        'mem MB': r(mem),
        'ops/ms': r(ITERATIONS_ONCE / time),
        successCount,
    };
}

async function benchZodCreateOnce() {
    const z = await import('zod').then((m) => m.z);

    const testData = Array.from({ length: ITERATIONS_ONCE }, (_, i) => generateUser(i));

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const data of testData) {
        // Create schema every time (React component pattern)
        const schema = z.object({
            id: z.number(),
            name: z.string().min(3),
            email: z.string().email(),
            age: z.number().min(0).max(120),
            isActive: z.boolean(),
            profile: z.object({
                bio: z.string(),
                website: z.string(),
                location: z.object({
                    city: z.string(),
                    country: z.string(),
                    coordinates: z.object({
                        lat: z.number(),
                        lng: z.number(),
                    }),
                }),
            }),
            tags: z.array(z.string()),
            metadata: z.object({
                createdAt: z.string(),
                lastLogin: z.string(),
                loginCount: z.number(),
            }),
        });

        try {
            const result = schema.parse(data);
            if (result) successCount++;
        } catch (_e) {
            // Invalid data
        }
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return {
        time: r(time),
        'mem MB': r(mem),
        'ops/ms': r(ITERATIONS_ONCE / time),
        successCount,
    };
}

//----------------------------------------------------------------
// Test 3: Simple Object (Quick validation)
//----------------------------------------------------------------

async function benchOurValidatorSimple() {
    const { parse, string, number } = await import('../src/lib/validator/schema.ts');

    const schema = {
        name: string(),
        age: number().min(0),
        email: string().email(),
    };

    const testData = Array.from({ length: ITERATIONS_REUSED }, (_, i) => ({
        name: `User${i}`,
        age: 25 + (i % 50),
        email: `user${i}@example.com`,
    }));

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const data of testData) {
        const result = parse(schema, data);
        if (result) successCount++;
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return {
        time: r(time),
        'mem MB': r(mem),
        'ops/ms': r(ITERATIONS_REUSED / time),
        successCount,
    };
}

async function benchZodSimple() {
    const z = await import('zod').then((m) => m.z);

    const schema = z.object({
        name: z.string(),
        age: z.number().min(0),
        email: z.string().email(),
    });

    const testData = Array.from({ length: ITERATIONS_REUSED }, (_, i) => ({
        name: `User${i}`,
        age: 25 + (i % 50),
        email: `user${i}@example.com`,
    }));

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const data of testData) {
        try {
            const result = schema.parse(data);
            if (result) successCount++;
        } catch (_e) {
            // Invalid data
        }
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return {
        time: r(time),
        'mem MB': r(mem),
        'ops/ms': r(ITERATIONS_REUSED / time),
        successCount,
    };
}

//----------------------------------------------------------------
// Test 4: Array of Objects
//----------------------------------------------------------------

async function benchOurValidatorArray() {
    const { parse, array, object, string, number } = await import('../src/lib/validator/schema.ts');

    const schema = {
        users: array(
            object({
                id: number(),
                name: string(),
                email: string().email(),
            }),
        ),
    };

    const testData = Array.from({ length: 1000 }, (_, i) => ({
        users: Array.from({ length: ARRAY_SIZE }, (_, j) => ({
            id: i * ARRAY_SIZE + j,
            name: `User${j}`,
            email: `user${j}@example.com`,
        })),
    }));

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const data of testData) {
        const result = parse(schema, data);
        if (result) successCount++;
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return {
        time: r(time),
        'mem MB': r(mem),
        'ops/ms': r(1000 / time),
        successCount,
    };
}

async function benchZodArray() {
    const z = await import('zod').then((m) => m.z);

    const schema = z.object({
        users: z.array(
            z.object({
                id: z.number(),
                name: z.string(),
                email: z.string().email(),
            }),
        ),
    });

    const testData = Array.from({ length: 1000 }, (_, i) => ({
        users: Array.from({ length: ARRAY_SIZE }, (_, j) => ({
            id: i * ARRAY_SIZE + j,
            name: `User${j}`,
            email: `user${j}@example.com`,
        })),
    }));

    if (global.gc) global.gc();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mem0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    let successCount = 0;
    for (const data of testData) {
        try {
            const result = schema.parse(data);
            if (result) successCount++;
        } catch (_e) {
            // Invalid data
        }
    }

    const time = performance.now() - t0;
    const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;

    return {
        time: r(time),
        'mem MB': r(mem),
        'ops/ms': r(1000 / time),
        successCount,
    };
}

//----------------------------------------------------------------
// Main
//----------------------------------------------------------------

async function main() {
    console.error('This benchmark is currently disabled.');
    console.error('It was designed for a different validator API that is not available in this project.');
    console.error('TODO: Rewrite to use the current Fastify validator implementation.');
    process.exit(1);

    const os = await import('node:os');

    if (typeof global.gc !== 'function') {
        throw new Error('Run the script with --expose-gc to enable manual garbage collection');
    }

    console.log('='.repeat(40));
    console.log('Validator Benchmark: Our validator vs Zod v4');
    console.log('='.repeat(40));

    console.table({
        time: `${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`,
        host: os.hostname(),
        'reused iterations': ITERATIONS_REUSED,
        'once iterations': ITERATIONS_ONCE,
        'array size': ARRAY_SIZE,
    });

    const results = [];

    // Test 1: Simple Object (Reused Schema)
    console.log('\n--- Test 1: Simple Object (Reused Schema) ---');
    console.log('Schema created once, parsed', ITERATIONS_REUSED, 'times');

    console.log('Testing Our Validator...');
    const ourSimple = await benchOurValidatorSimple();
    console.log('✓ Complete:', ourSimple);

    console.log('Testing Zod...');
    const zodSimple = await benchZodSimple();
    console.log('✓ Complete:', zodSimple);

    results.push({ test: 'Validator (simple, reused)', ...ourSimple }, { test: 'Zod4 (simple, reused)', ...zodSimple });

    // Test 2: Complex Nested Object (Reused Schema)
    console.log('\n--- Test 2: Complex Nested Object (Reused Schema) ---');
    console.log('Schema created once, parsed', ITERATIONS_REUSED, 'times');

    console.log('Testing Our Validator...');
    const ourReused = await benchOurValidatorReused();
    console.log('✓ Complete:', ourReused);

    console.log('Testing Zod...');
    const zodReused = await benchZodReused();
    console.log('✓ Complete:', zodReused);

    results.push({ test: 'Validator (complex, reused)', ...ourReused }, { test: 'Zod4 (complex, reused)', ...zodReused });

    // Test 3: Create Once Pattern
    console.log('\n--- Test 3: Create Once (React Pattern) ---');
    console.log('Schema created + parsed', ITERATIONS_ONCE, 'times');

    console.log('Testing Our Validator...');
    const ourOnce = await benchOurValidatorCreateOnce();
    console.log('✓ Complete:', ourOnce);

    console.log('Testing Zod...');
    const zodOnce = await benchZodCreateOnce();
    console.log('✓ Complete:', zodOnce);

    results.push({ test: 'Validator (create once)', ...ourOnce }, { test: 'Zod4 (create once)', ...zodOnce });

    // Test 4: Array of Objects
    console.log('\n--- Test 4: Array of Objects ---');
    console.log('1000 arrays, each with', ARRAY_SIZE, 'objects');

    console.log('Testing Our Validator...');
    const ourArray = await benchOurValidatorArray();
    console.log('✓ Complete:', ourArray);

    console.log('Testing Zod...');
    const zodArray = await benchZodArray();
    console.log('✓ Complete:', zodArray);

    results.push({ test: 'Validator (array)', ...ourArray }, { test: 'Zod4 (array)', ...zodArray });

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.table(results);

    // Analysis
    console.log(`\n${'='.repeat(60)}`);
    console.log('PERFORMANCE ANALYSIS');
    console.log('='.repeat(60));

    const speedup = (our, zod) => r(zod.time / our.time);

    console.log('\nSimple Object (Reused):');
    console.log('  Our validator:', ourSimple['ops/ms'], 'ops/ms');
    console.log('  Zod v4:', zodSimple['ops/ms'], 'ops/ms');
    console.log('  → Zod is', speedup(ourSimple, zodSimple), `x faster${speedup(ourSimple, zodSimple) < 1 ? ' (we win!)' : ''}`);

    console.log('\nComplex Object (Reused):');
    console.log('  Our validator:', ourReused['ops/ms'], 'ops/ms');
    console.log('  Zod v4:', zodReused['ops/ms'], 'ops/ms');
    console.log('  → Zod is', speedup(ourReused, zodReused), `x faster${speedup(ourReused, zodReused) < 1 ? ' (we win!)' : ''}`);

    console.log('\nCreate Once Pattern:');
    console.log('  Our validator:', ourOnce['ops/ms'], 'ops/ms');
    console.log('  Zod v4:', zodOnce['ops/ms'], 'ops/ms');
    console.log(
        '  → We are',
        r(ourOnce.time / zodOnce.time),
        `x faster${ourOnce.time > zodOnce.time ? ' (Zod wins!)' : ' (we win!)'}`,
    );

    console.log('\nArray Validation:');
    console.log('  Our validator:', ourArray['ops/ms'], 'ops/ms');
    console.log('  Zod v4:', zodArray['ops/ms'], 'ops/ms');
    console.log('  → Zod is', speedup(ourArray, zodArray), `x faster${speedup(ourArray, zodArray) < 1 ? ' (we win!)' : ''}`);

    console.log(`\n${'='.repeat(60)}`);
}

main().catch(console.error);
