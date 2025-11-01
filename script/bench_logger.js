/***
 * Logger Stress Test results
 * This script tests various logging methods by outputting a large number of log lines
 * and measuring the time taken and memory usage for each method.
 *
 * Usage: bun --expose-gc scripts/bench_logger.js
 * Results from my laptop:
 * ┌────────────────────┬──────────────────────────┐
 * │               time │ 2025-11-01T11:04:04.114Z │
 * │               host │ eram-lap-23              │
 * │           LT_LINES │ 20000                    │
 * │ LT_MIN_LINE_LENGTH │ 20                       │
 * │ LT_MAX_LINE_LENGTH │ 200                      │
 * │     LT_SLEEP_EVERY │ 10                       │
 * │       output lines │ 180000                   │
 * └────────────────────┴──────────────────────────┘
 * ┌───┬────────────────────────────┬──────────┬────────┐
 * │   │ test                       │ time     │ mem MB │
 * ├───┼────────────────────────────┼──────────┼────────┤
 * │ 0 │ console.log                │ 22194.18 │ 1.86   │
 * │ 1 │ pino (stdout)              │ 4816.78  │ 0      │
 * │ 2 │ logZ.stdout                │ 3032.76  │ 0      │
 * │ 3 │ logZ2 array>batch>stdout   │ 8.06     │ 0      │
 * │ 4 │ logZ3 map>batch>stdout     │ 15.96    │ 0      │
 * │ 5 │ Logger console             │ 18277.54 │ 2.49   │
 * │ 6 │ Logger json on speedy      │ 55.63    │ 0      │
 * │ 7 │ Logger raw on speedy       │ 12.66    │ 0      │
 * │ 8 │ Logger raw/chalk on speedy │ 18.24    │ 0      │
 * └───┴────────────────────────────┴──────────┴────────┘
 *
 ***********/

const LT_LINES = 20 * 1000;
const LT_MIN_LINE_LENGTH = 20;
const LT_MAX_LINE_LENGTH = 200;
const LT_SLEEP_EVERY = 10;

function logZ(message, ..._optionalParams) {
    process.stdout.write(`${message}\n`);
}

const batch2 = [];
let timer2 = 0;
function logZ2(message, ..._optionalParams) {
    if (!timer2) {
        timer2 = setInterval(() => {
            if (batch2.length === 0) {
                clearInterval(timer2);
                timer2 = 0;
                return;
            }
            const msg = batch2.join('\n');
            process.stdout.write(`${msg}\n`);
            batch2.length = 0;
        }, 50);
    }

    batch2.push(message);
}

const batch3 = new Map();
let timer3 = 0;
function logZ3(message, ..._optionalParams) {
    function flush() {
        const msg = Array.from(batch3.values()).join('\n');
        batch3.clear();
        process.stdout.write(`${msg}\n`);
    }

    if (!timer3) {
        timer3 = setInterval(() => {
            if (batch3.size === 0) {
                clearInterval(timer3);
                timer3 = 0;
                return;
            }
            flush();
        }, 50);
    }

    batch3.set(batch3.size, message);
    if (batch3.size >= 50) {
        setImmediate(flush);
    }
}

let outputLines = 0;

async function main() {
    const { performance } = await import('node:perf_hooks');
    const { hostname } = await import('node:os');
    const { createLogger, SpeedStd } = await import('../src/util/logger.ts');
    const pino = (await import('pino')).default;

    function randomLine(minLen = LT_MIN_LINE_LENGTH, maxLen = LT_MAX_LINE_LENGTH) {
        const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
        return Array(len)
            .fill(0)
            .map(() => String.fromCharCode(97 + Math.floor(Math.random() * 26)))
            .join('');
    }

    async function output(logFn, txt) {
        if (++outputLines % LT_SLEEP_EVERY === 0) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        logFn(txt);
    }

    const lines = Array.from({ length: LT_LINES }, () => randomLine());
    let t0;
    const results = [];

    try {
        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 200));
            console.log('\n\n*** Testing console... ***\n\n');
            const mem0 = process.memoryUsage().heapUsed;
            t0 = performance.now();
            for (const line of lines) {
                output(console.log, { line });
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'console.log', time, 'mem MB': Math.round(mem * 100) / 100 });
        }

        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log('\n\n*** Testing pino... ***\n\n');
            const mem0 = process.memoryUsage().heapUsed;
            // Only log the message, not JSON to stdout
            const pinolog = pino({ level: 'info' });
            const fn = pinolog.info.bind(pinolog);
            t0 = performance.now();
            for (const line of lines) {
                output(fn, line);
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'pino (stdout)', time, 'mem MB': Math.round(mem * 100) / 100 });
        }

        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log('\n\n*** Logger with LogZ ***\n\n');
            const mem0 = process.memoryUsage().heapUsed;
            t0 = performance.now();
            for (const line of lines) {
                output(logZ, JSON.stringify({ line }));
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'logZ.stdout', time, 'mem MB': Math.round(mem * 100) / 100 });
        }

        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log('\n\n*** Logger with LogZ2 ***\n\n');
            const mem0 = process.memoryUsage().heapUsed;
            t0 = performance.now();
            for (const line of lines) {
                output(logZ2, JSON.stringify({ line }));
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'logZ2 array>batch>stdout', time, 'mem MB': Math.round(mem * 100) / 100 });
        }

        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log('\n\n*** Logger with LogZ3... ***\n\n');
            const mem0 = process.memoryUsage().heapUsed;
            t0 = performance.now();
            for (const line of lines) {
                output(logZ3, JSON.stringify({ line }));
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'logZ3 map>batch>stdout', time, 'mem MB': Math.round(mem * 100) / 100 });
        }

        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log('\n\n*** Testing Logger console... ***\n\n');
            process.env.LOG_FORMAT = 'json';
            process.env.LOG_LEVEL = 'info';
            const log = createLogger('console', 'info', console);
            const mem0 = process.memoryUsage().heapUsed;
            t0 = performance.now();
            for (const line of lines) {
                output(log.info, line);
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'Logger console', time, 'mem MB': Math.round(mem * 100) / 100 });
        }

        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log('\n\n*** Testing Logger speedy json... ***\n\n');
            const logger = createLogger('speedyJson', 'info', new SpeedStd(), {
                formatter: 'json',
                level: 'info',
            });
            const mem0 = process.memoryUsage().heapUsed;
            t0 = performance.now();
            for (const line of lines) {
                output(logger.info, line);
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'Logger json on speedy', time, 'mem MB': Math.round(mem * 100) / 100 });
        }

        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log('\n\n*** Testing Logger raw speedy ***\n\n');
            const logger = createLogger('speedyRaw', 'info', new SpeedStd(), {
                json: false,
                level: 'info',
                chalkFn: (_, txt) => txt,
            });
            const mem0 = process.memoryUsage().heapUsed;
            t0 = performance.now();
            for (const line of lines) {
                output(logger.info, line);
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'Logger raw on speedy', time, 'mem MB': Math.round(mem * 100) / 100 });
        }

        //----------------------------------------------------------------
        {
            if (global.gc) global.gc();
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log('\n\n*** Testing Logger raw/chalk speedy ***\n\n');
            const logger = createLogger('speedyRawChalk', 'info', new SpeedStd(), { json: false, level: 'info' });
            const mem0 = process.memoryUsage().heapUsed;
            t0 = performance.now();
            for (const line of lines) {
                output(logger.info, line);
            }
            const time = performance.now() - t0;
            const mem = (process.memoryUsage().heapUsed - mem0) / 1024 / 1024;
            results.push({ test: 'Logger raw/chalk on speedy', time, 'mem MB': Math.round(mem * 100) / 100 });
        }
    } finally {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        console.table({
            time: new Date().toISOString(),
            host: hostname(),
            lines: LT_LINES,
            min: LT_MIN_LINE_LENGTH,
            max: LT_MAX_LINE_LENGTH,
            sleep: LT_SLEEP_EVERY,
            'output lines': outputLines,
        });
        const tbl = results.map((r) => {
            const row = { test: r.test, time: Math.round(r.time * 100.0) / 100.0 };
            if (r['mem MB'] !== undefined) row['mem MB'] = r['mem MB'];
            return row;
        });
        console.table(tbl);
    }
}

main().catch(console.error);
