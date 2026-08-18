import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';

/**
 * Helper to run cluster and capture output
 */
function runCluster(workers: number, timeout = 5000): Promise<{ stdout: string; stderr: string; killed: boolean }> {
    return new Promise((resolve) => {
        const proc = spawn('bun', ['run', 'src/cluster.ts'], {
            cwd: process.cwd(),
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

        expect(stdout.includes('Cluster primary')).toBeTruthy();
        expect(stdout.includes('started')).toBeTruthy();
    });

    test('forks correct number of workers', async () => {
        const { stdout } = await runCluster(2, 3000);

        expect(stdout.includes('Starting 2 workers')).toBeTruthy();
        expect(stdout.includes('Cluster mode: 2 workers active')).toBeTruthy();
    });

    test('starts worker processes', async () => {
        const { stdout } = await runCluster(2, 3000);

        expect(stdout.includes('Cluster worker')).toBeTruthy();
        // Should have at least one worker start message
        const workerMatches = stdout.match(/Cluster worker \d+ started/g);
        expect(workerMatches).toBeTruthy();
        expect((workerMatches ?? []).length >= 1).toBeTruthy();
    });

    test('workers start HTTP server', async () => {
        const { stdout } = await runCluster(1, 3000);

        expect(stdout.includes('Server listening on')).toBeTruthy();
        expect(stdout.includes('Health check:')).toBeTruthy();
        expect(stdout.includes('Swagger UI:')).toBeTruthy();
    });

    test('respects WORKERS environment variable', async () => {
        const { stdout } = await runCluster(3, 3000);

        expect(stdout.includes('Starting 3 workers')).toBeTruthy();
        expect(stdout.includes('Cluster mode: 3 workers active')).toBeTruthy();
    });

    test('prints environment information', async () => {
        const { stdout } = await runCluster(1, 3000);

        // env.print() output should be present
        expect(stdout.includes('app:')).toBeTruthy();
        expect(stdout.includes('version:')).toBeTruthy();
    });

    test('getWorkerCount is exported', async () => {
        const { getActiveWorkers: getWorkerCount } = await import('./cluster');
        expect(typeof getWorkerCount === 'function').toBeTruthy();
    });

    test('getWorkerCount returns number when in cluster primary mode', async () => {
        // When importing cluster.ts, it runs as primary and starts workers
        const { getActiveWorkers: getWorkerCount } = await import('./cluster');
        const count = getWorkerCount();
        // In cluster primary mode, should return a number >= 0
        expect(typeof count === 'number').toBeTruthy();
        expect((count ?? -1) >= 0).toBeTruthy();
    });
});
