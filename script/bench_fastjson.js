/***
 * FastJson Stress Test
 * ====================
 *
 * Compares custom FastJson implementation with fast-json library and JSON.parse().
 *
 * What it tests:
 *   - FastJson (with object pooling) - Custom streaming parser with memory optimization
 *   - FastJson (no pool) - Custom streaming parser without pooling
 *   - fast-json (library) - Original fast-json npm package
 *   - JSON.parse() - Native JavaScript JSON parser
 *
 * Test data:
 *   - Uses citylots.json (189MB GeoJSON file from San Francisco open data)
 *   - Structure: { type: "FeatureCollection", features: [...] }
 *   - Tests deeply nested path: features[293].geometry.coordinates[0][0]
 *   - Also counts all features with STREET property
 *
 * Key benefit:
 *   Streaming parsers can stop parsing early when target data is found,
 *   saving both time and memory compared to JSON.parse() which must parse
 *   the entire document. For large files where you only need a small subset
 *   of data, this can be 5-10x faster.
 *
 * Usage:
 *   # Run with citylots.json (189MB, auto-downloaded and cached in .cache/) - DEFAULT
 *   node --expose-gc scripts/stress_test_fastjson.js
 *
 *   # Or generate synthetic GeoJSON data (5M features, ~800MB)
 *   node --expose-gc scripts/stress_test_fastjson.js --generate
 *
 *   # Or use your own JSON file
 *   node --expose-gc scripts/stress_test_fastjson.js path/to/your.json
 *
 * Results from my laptop:
 *
 * ┌─────────────┬─────────────────────┐
 * │ (index)     │ Values              │
 * ├─────────────┼─────────────────────┤
 * │ time        │ '2025-10-16 07:51Z' │
 * │ host        │ 'eram-lap-23'       │
 * │ data source │ 'generated'         │
 * │ CHECK       │ 10000               │
 * │ N           │ 100000              │
 * └─────────────┴─────────────────────┘
 *
 * ┌─────────┬────────────────────────┬────────┬────────┐
 * │ (index) │ method                 │ time   │ mem MB │
 * ├─────────┼────────────────────────┼────────┼────────┤
 * │ 0       │ 'JSON.parse'           │ 335.48 │ 106.19 │
 * │ 1       │ 'fast-json (library)'  │ 12.19  │ 0.33   │
 * │ 2       │ 'FastJson (no pool)'   │ 15.62  │ 2.43   │
 * │ 3       │ 'FastJson (with pool)' │ 19.56  │ 2.62   │
 * └─────────┴────────────────────────┴────────┴────────┘
 *
 ***/

import { performance } from 'node:perf_hooks';

const N = 100000;
const CHECK = 10000;

const r = (n) => Math.round(n * 100) / 100;

// Test configuration based on data type
function getTestConfig(useRealFile) {
    // Both real and generated data now use GeoJSON FeatureCollection structure
    // Match the example from fast-json repo: examples/performance.js
    return {
        checkPath: `features[${CHECK}].geometry.coordinates[0][0]`,
        countPath: 'features[*].properties.STREET',
        description: useRealFile ? 'citylots.json' : 'generated GeoJSON',
    };
}

function fastJsonN(jsonArrayStr, useRealFile) {
    return new Promise(async (resolve) => {
        const { FastJson } = await import('../src/utils/FastJson');
        const fastJson = new FastJson({ yieldEvery: N, useObjectPool: true });
        const config = getTestConfig(useRealFile);
        let checkValue = null;

        // Register check listener - stop when found to demonstrate streaming performance benefit
        fastJson.on(config.checkPath, (v) => {
            checkValue = v;
            console.log('fastJson_N', config.checkPath, '=', v);
            return true; // stop parsing - we found what we need!
        });

        const t0 = performance.now();
        const mem0 = process.memoryUsage().heapUsed;
        await fastJson.parse(jsonArrayStr);
        const time = performance.now() - t0;
        const mem = process.memoryUsage().heapUsed - mem0;
        resolve({ time: r(time), 'mem MB': r(mem / 1024 / 1024), checkValue });
    });
}

function fastJsonNopN(jsonArrayStr, useRealFile) {
    return new Promise(async (resolve) => {
        const { FastJson } = await import('../src/utils/FastJson');
        const fastJson = new FastJson({ yieldEvery: N, useObjectPool: false });
        const config = getTestConfig(useRealFile);
        let checkValue = null;

        // Register check listener - stop when found to demonstrate streaming performance benefit
        fastJson.on(config.checkPath, (v) => {
            checkValue = v;
            console.log('fastJson_NOP_N', config.checkPath, '=', v);
            return true; // stop parsing - we found what we need!
        });

        const t0 = performance.now();
        const mem0 = process.memoryUsage().heapUsed;
        await fastJson.parse(jsonArrayStr);
        const time = performance.now() - t0;
        const mem = process.memoryUsage().heapUsed - mem0;
        resolve({ time: r(time), 'mem MB': r(mem / 1024 / 1024), checkValue });
    });
}

function jsonParseN(jsonArrayStr, useRealFile) {
    const config = getTestConfig(useRealFile);
    const t0 = performance.now();
    const mem0 = process.memoryUsage().heapUsed;
    const data = JSON.parse(jsonArrayStr);
    let count = 0;
    let checkValue = null;

    // checkPath format: features[INDEX].geometry.coordinates[0][0]
    checkValue = data.features[CHECK]?.geometry?.coordinates?.[0]?.[0];

    // Count features with STREET property (non-empty string)
    count = data.features?.filter((f) => typeof f.properties?.STREET === 'string' && f.properties.STREET.length > 0).length || 0;

    const time = performance.now() - t0;
    const mem = process.memoryUsage().heapUsed - mem0;
    console.log('jsonParse_N', 'count=', count, 'mem=', r(mem / 1024 / 1024), 'MB');
    return { time: r(time), 'mem MB': r(mem / 1024 / 1024), count, checkValue };
}

function fastJsonLibN(jsonArrayStr, useRealFile) {
    return new Promise(async (resolve) => {
        const { FastJson: FastJsonLib } = await import('fast-json');
        const fastJson = new FastJsonLib();
        const config = getTestConfig(useRealFile);
        let checkValue = null;

        // Register check listener - stop when found
        fastJson.on(config.checkPath, (v) => {
            checkValue = v;
            console.log('fastJsonLib_N', config.checkPath, '=', v);
            fastJson.skip(); // stop parsing
        });

        const t0 = performance.now();
        const mem0 = process.memoryUsage().heapUsed;

        // fast-json uses write() method, not parse()
        fastJson.write(jsonArrayStr);

        const time = performance.now() - t0;
        const mem = process.memoryUsage().heapUsed - mem0;
        resolve({ time: r(time), 'mem MB': r(mem / 1024 / 1024), checkValue });
    });
}

async function downloadAndExtractCityLots() {
    const https = await import('node:https');
    const fs = await import('node:fs');
    const fsPromises = await import('node:fs/promises');
    const path = await import('node:path');
    const zlib = await import('node:zlib');
    const { spawn } = await import('node:child_process');

    const cacheDir = path.join(process.cwd(), '.cache');
    const tarGzPath = path.join(cacheDir, 'citylots.json.tar.gz');
    const jsonPath = path.join(cacheDir, 'citylots.json');

    // Check if already extracted
    try {
        await fsPromises.access(jsonPath);
        console.log('Using cached citylots.json from .cache/');
        return jsonPath;
    } catch {}

    // Create cache directory
    await fsPromises.mkdir(cacheDir, { recursive: true });

    // Download the file
    const url = 'https://github.com/alemures/fast-json/raw/master/examples/json/citylots.json.tar.gz';
    console.log('Downloading citylots.json.tar.gz (~50MB)...');

    await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tarGzPath);
        https
            .get(url, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    // Follow redirect
                    https
                        .get(response.headers.location, (redirectResponse) => {
                            redirectResponse.pipe(file);
                            file.on('finish', () => {
                                file.close();
                                resolve();
                            });
                        })
                        .on('error', reject);
                } else {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }
            })
            .on('error', reject);
    });

    console.log('Extracting citylots.json...');

    // Use tar command if available (Unix/Linux/Mac), or fallback
    await new Promise((resolve, reject) => {
        const tar = spawn('tar', ['-xzf', tarGzPath, '-C', cacheDir]);
        let stderr = '';

        tar.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        tar.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`tar extraction failed: ${stderr}`));
            }
        });

        tar.on('error', (err) => {
            // tar command not available, try alternative method
            reject(err);
        });
    }).catch(async (err) => {
        // Fallback: manually extract using zlib and tar-stream
        console.log('Using Node.js built-in extraction...');
        const tarStream = await import('tar-stream');
        const extract = tarStream.extract();

        return new Promise((resolve, reject) => {
            extract.on('entry', (header, stream, next) => {
                if (header.name.endsWith('citylots.json')) {
                    const writeStream = fs.createWriteStream(jsonPath);
                    stream.pipe(writeStream);
                    writeStream.on('finish', () => {
                        resolve();
                    });
                } else {
                    stream.resume();
                }
                stream.on('end', next);
            });

            extract.on('finish', resolve);
            extract.on('error', reject);

            fs.createReadStream(tarGzPath).pipe(zlib.createGunzip()).pipe(extract);
        });
    });

    console.log('Extraction complete. File cached in .cache/');
    return jsonPath;
}

async function main() {
    await import('tsx');
    const { sleep } = await import('../src/utils/sleep');
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const args = process.argv.slice(2);
    let inputFile = args[0];

    let jsonArrayStr;
    let useRealFile = false;

    if (typeof global.gc !== 'function') throw new Error('Run the script with --expose-gc to enable manual garbage collection');

    // Handle different input modes
    if (inputFile === '--generate') {
        // Explicitly request generated data
        inputFile = null;
    } else if (!inputFile) {
        // No arguments: download citylots.json (default)
        try {
            inputFile = await downloadAndExtractCityLots();
        } catch (err) {
            console.error(`Failed to download citylots.json: ${err.message}`);
            console.log('Falling back to generated JSON...');
            inputFile = null;
        }
    }

    if (inputFile) {
        // Load JSON from file
        console.log(`Loading JSON from file: ${inputFile}`);
        try {
            jsonArrayStr = await fs.readFile(inputFile, 'utf-8');
            useRealFile = true;
            console.log(`Loaded JSON file: ${(jsonArrayStr.length / 1024 / 1024).toFixed(2)} MB`);
        } catch (err) {
            console.error(`Failed to load file: ${err.message}`);
            process.exit(1);
        }
    } else {
        // Generate synthetic GeoJSON matching citylots.json structure
        console.log(`Generating ${N} features (GeoJSON)...`);

        const features = [];
        for (let i = 0; i < N; i++) {
            // Generate a simple polygon for each feature (rectangle)
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
            features.push(JSON.stringify(feature));
        }

        jsonArrayStr = `{"type":"FeatureCollection","features":[${features.join(',')}]}`;
        console.log(`Generated GeoJSON: ${(jsonArrayStr.length / 1024 / 1024).toFixed(2)} MB`);
    }

    console.table({
        time: new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z',
        host: os.hostname(),
        'data source': useRealFile ? inputFile : 'generated',
        CHECK,
        N: useRealFile ? 'N/A' : N,
    });

    async function runGC() {
        await global.gc({ execution: 'async' });
        return sleep(500);
    }

    // Collect results for comparison
    const results = {};

    await runGC();
    results['JSON.parse'] = jsonParseN(jsonArrayStr, useRealFile);

    await runGC();
    results['fast-json (library)'] = await fastJsonLibN(jsonArrayStr, useRealFile);

    await runGC();
    results['FastJson (no pool)'] = await fastJsonNopN(jsonArrayStr, useRealFile);

    await runGC();
    results['FastJson (with pool)'] = await fastJsonN(jsonArrayStr, useRealFile);

    // Compare checkValue
    const methods = Object.keys(results);
    const checkValues = methods.map((m) => results[m].checkValue);

    // Assert all checkValues are (approximately) equal (float tolerance)
    // Note: streaming parsers return string representation, JSON.parse returns array
    function normalizeCheckValue(v) {
        if (typeof v === 'string') {
            // Parse string representation like "[ -122.45936, 37.74849, 0.0 ]"
            try {
                return JSON.parse(v.replace(/\s+/g, ' '));
            } catch {
                return v;
            }
        }
        return v;
    }

    function arraysAlmostEqual(a, b, tol = 1e-8) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((v, i) => Math.abs(v - b[i]) < tol);
    }

    const normalizedCheckValues = checkValues.map(normalizeCheckValue);
    const allCheckValuesEqual = normalizedCheckValues.every((v) => arraysAlmostEqual(v, normalizedCheckValues[0]));
    if (!allCheckValuesEqual) {
        console.warn('WARNING: Not all methods produced the same checkValue:');
        console.warn('  Original:', checkValues);
        console.warn('  Normalized:', normalizedCheckValues);
    } else {
        console.log('All methods produced the same checkValue:', normalizedCheckValues[0]);
    }

    // Print table for reference
    const table = methods.map((m) => ({ method: m, time: results[m].time, 'mem MB': results[m]['mem MB'] }));
    console.table(table);
}

main().catch(console.error);
