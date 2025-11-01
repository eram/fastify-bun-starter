// cluster entry point for running the Fastify app in cluster mode
/* istanbul ignore file */

import cluster from 'node:cluster';
import os from 'node:os';
import { env } from './util';

// Track number of active workers
let workerCount = 0;

/**
 * Get the current number of active workers
 * @returns The number of active workers, or undefined if not in cluster mode
 */
export function getWorkerCount(): number | undefined {
    if (cluster.isPrimary) {
        return workerCount;
    }
    if (cluster.isWorker) {
        // Workers need to communicate with primary to get the count
        // For now, return undefined in workers
        return undefined;
    }
    return undefined;
}

// Import and start server in worker
/* istanbul ignore next */
const startServerInWorker = async () => {
    const { app } = await import('./app');
    const { startServer } = await import('./http/server');
    await startServer(app);
};

/**
 * Start cluster mode - only runs when this file is executed directly
 */
/* istanbul ignore next */
async function startCluster() {
    if (cluster.isPrimary) {
        console.log(`Cluster primary ${process.pid} started`);
        env.print();

        // Fork workers for each CPU core
        const numWorkers = Number(process.env.WORKERS) || os.cpus().length;
        console.log(`Starting ${numWorkers} workers...`);

        for (let i = 0; i < numWorkers; i++) {
            cluster.fork();
            workerCount++;
        }

        cluster.on('exit', (worker, code, signal) => {
            console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
            workerCount--;
            cluster.fork();
            workerCount++;
        });

        console.log(`Cluster mode: ${workerCount} workers active`);
    } else {
        console.log(`Cluster worker ${process.pid} started`);
        await startServerInWorker();
    }
}

// Only run cluster if this file is executed directly (not imported)
if (import.meta.main) {
    await startCluster();
}
