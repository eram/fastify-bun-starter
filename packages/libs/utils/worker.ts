import { Worker as JsWorker, type WorkerOptions } from 'node:worker_threads';
import { apm } from './apm';

/**
 * A Worker thread that runs TypeScript files directly.
 * Bun's worker_threads implementation runs .ts files natively, so no
 * transpile-loader hack is needed here (unlike plain Node.js).
 *
 * @param fullPath - The path to the worker script (TypeScript file).
 * @param wkOpts - Worker options, including workerData.
 *
 * Example:
 *   await Worker.create("/mnt/fullpath/worker.ts", { workerData: { foo: 1 } });
 */
export class Worker extends JsWorker {
    exitCode: number | undefined;

    private constructor(fullPath: string, wkOpts?: WorkerOptions) {
        super(fullPath, wkOpts);
    }

    // Create a thread. Note: does not wait for the worker's 'online' event -
    // Bun's node:worker_threads compat does not reliably emit it, and Node's
    // Worker already queues postMessage calls sent before the worker is ready.
    static async create(fullPath: string, wkOpts?: WorkerOptions): Promise<Worker> {
        const worker = new Worker(fullPath, wkOpts);
        apm.cInc('workers.alive');
        worker.exit.then(() => apm.cInc('workers.alive', -1));
        return worker;
    }

    // Returns a promise that resolves when the worker exits
    // and sets the exitCode property.
    // Useful for waiting for the worker to finish before exiting the main thread.
    readonly exit = new Promise<void>((resolve) => {
        this.once('exit', (exitCode) => {
            this.exitCode = exitCode;
            resolve();
        });
    });
}
