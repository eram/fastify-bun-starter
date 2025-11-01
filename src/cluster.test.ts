import { ok } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, test } from 'node:test';

/**
 * Helper to run cluster and capture output
 */
function runCluster(workers: number, timeout = 5000): Promise<{ stdout: string; stderr: string; killed: boolean }> {
    return new Promise((resolve) => {
        const proc = spawn('bun', ['run', 'src/cluster.ts'], {
            cwd: process.cwd(),
            // biome-ignore lint/style/useNamingConvention: WORKERS is an environment variable
            env: { ...process.env, WORKERS: workers.toString() },
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        // Kill after timeout
        setTimeout(() => {
            proc.kill('SIGTERM');
        }, timeout);

        proc.on('close', () => {
            resolve({ stdout, stderr, killed: true });
        });
    });
}

describe.skip('Cluster', () => {
    test('starts primary process', async () => {
        const { stdout } = await runCluster(2, 3000);

        ok(stdout.includes('Cluster primary'));
        ok(stdout.includes('started'));
    });

    test('forks correct number of workers', async () => {
        const { stdout } = await runCluster(2, 3000);

        ok(stdout.includes('Starting 2 workers'));
        ok(stdout.includes('Cluster mode: 2 workers active'));
    });

    test('starts worker processes', async () => {
        const { stdout } = await runCluster(2, 3000);

        ok(stdout.includes('Cluster worker'));
        // Should have at least one worker start message
        const workerMatches = stdout.match(/Cluster worker \d+ started/g);
        ok(workerMatches);
        ok(workerMatches.length >= 1);
    });

    test('workers start HTTP server', async () => {
        const { stdout } = await runCluster(1, 3000);

        ok(stdout.includes('Server listening on'));
        ok(stdout.includes('Health check:'));
        ok(stdout.includes('Swagger UI:'));
    });

    test('respects WORKERS environment variable', async () => {
        const { stdout } = await runCluster(3, 3000);

        ok(stdout.includes('Starting 3 workers'));
        ok(stdout.includes('Cluster mode: 3 workers active'));
    });

    test('prints environment information', async () => {
        const { stdout } = await runCluster(1, 3000);

        // env.print() output should be present
        ok(stdout.includes('app:'));
        ok(stdout.includes('version:'));
    });

    test('getWorkerCount is exported', async () => {
        const { getWorkerCount } = await import('./cluster');
        ok(typeof getWorkerCount === 'function');
    });

    test('getWorkerCount returns number when in cluster primary mode', async () => {
        // When importing cluster.ts, it runs as primary and starts workers
        const { getWorkerCount } = await import('./cluster');
        const count = getWorkerCount();
        // In cluster primary mode, should return a number >= 0
        ok(typeof count === 'number');
        ok(count >= 0);
    });
});
