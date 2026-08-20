import { describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from './worker';

describe('worker', () => {
    test('runs a TS worker script directly and captures its exit code', async () => {
        const folder = dirname(fileURLToPath(import.meta.url));
        const workerScript = resolve(folder, './__mocks__/worker_exit.ts');
        const code = Math.floor(Math.random() * 256); // process exit codes are truncated to a byte (0-255)

        const worker = await Worker.create(workerScript, { workerData: { code } });
        await worker.exit;

        expect(worker.exitCode).toBe(code);
    });
});
