// cluster entry point for running the Fastify app in cluster mode
/* istanbul ignore file */

import cluster from 'node:cluster';
import { ClusterManager } from '@libs/cluster';
import { Env } from '@libs/utils/env';

// Global cluster manager instance
let clusterManager: ClusterManager | undefined;

/**
 * Get the current cluster manager instance
 * @returns The cluster manager instance, or undefined if not initialized
 */
export function getCluster(): ClusterManager | undefined {
    return clusterManager;
}

/**
 * Get the current number of active workers
 * @returns The number of active workers, or undefined if not in cluster mode
 */
export function getActiveWorkers(): number | undefined {
    return clusterManager?.getStats().activeWorkers;
}

/**
 * Worker entry point - starts the Fastify server
 * This is called by ClusterManager in worker processes
 */
async function startWorker() {
    const { instance } = await import('./instance');
    const { startServer } = await import('./server');

    await startServer(instance);
}

/**
 * Start cluster mode - only runs when this file is executed directly
 */
async function startCluster() {
    Env.print();

    // If this is a worker process, just start the server
    if (cluster.isWorker) {
        await startWorker();
        return;
    }

    // Create cluster manager with configuration (primary process)
    clusterManager = new ClusterManager({
        file: import.meta.url,
    });

    // Start cluster (will fork workers)
    await clusterManager.startPrimary();
}

// Only run cluster if this file is executed directly (not imported)
if (import.meta.main) {
    await startCluster();
}
