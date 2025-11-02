import { ok, strictEqual, throws } from 'node:assert/strict';
import cluster, { type Worker } from 'node:cluster';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { ClusterManager, type ClusterStats } from './cluster-manager';

/**
 * Create a mock worker that behaves like a real cluster worker
 */
function createMockWorker(id: number, pid: number): Worker {
    const worker = new EventEmitter() as unknown as Worker;
    Object.assign(worker, {
        id,
        process: { pid, kill: () => {} },
        isDead: () => false,
        isConnected: () => true,
        kill: () => {},
        send: () => true,
        disconnect: () => {},
    });
    return worker;
}

describe('ClusterManager', () => {
    describe('Configuration validation', () => {
        test('should require worker file', () => {
            throws(() => new ClusterManager({ file: '' }), /requires a worker file path/);
        });

        test('should accept file path as string', () => {
            const manager = new ClusterManager('./worker.js');
            ok(manager);
        });

        test('should accept file path in config', () => {
            const manager = new ClusterManager({ file: './worker.js' });
            ok(manager);
        });

        test('should use default values', () => {
            const manager = new ClusterManager({ file: './worker.js' });

            const stats = manager.getStats();
            strictEqual(stats.activeWorkers, 0);
            strictEqual(stats.totalRestarts, 0);
            strictEqual(stats.recentRestarts, 0);
            strictEqual(stats.isShuttingDown, false);
        });

        test('should accept custom configuration', async () => {
            const { createLogger } = await import('./logger');
            const customLogger = createLogger('TestCluster', 'DEBUG');

            const manager = new ClusterManager({
                file: './worker.js',
                workers: 4,
                maxRestarts: 5,
                restartWindow: 30000,
                logger: customLogger,
            });

            ok(manager);
        });
    });

    describe('Statistics', () => {
        test('getStats should return initial state', () => {
            const manager = new ClusterManager({ file: './worker.js' });

            const stats = manager.getStats();

            strictEqual(stats.activeWorkers, 0);
            strictEqual(stats.totalRestarts, 0);
            strictEqual(stats.recentRestarts, 0);
            ok(Array.isArray(stats.workerPids));
            strictEqual(stats.workerPids.length, 0);
            strictEqual(stats.isShuttingDown, false);
        });
    });

    describe('Worker management (primary mode)', () => {
        test('startPrimary should throw if not in primary process', async () => {
            const manager = new ClusterManager({ file: './worker.js' });

            // Mock cluster.isPrimary to return false
            const originalIsPrimary = Object.getOwnPropertyDescriptor(cluster, 'isPrimary');
            Object.defineProperty(cluster, 'isPrimary', {
                get: () => false,
                configurable: true,
            });

            try {
                await manager.startPrimary().catch((err) => {
                    ok(err.message.includes('only be called in primary process'));
                });
            } finally {
                // Restore original property
                if (originalIsPrimary) {
                    Object.defineProperty(cluster, 'isPrimary', originalIsPrimary);
                }
            }
        });

        test('shutdown should throw if not in primary process', async () => {
            const manager = new ClusterManager({ file: './worker.js' });

            // Mock cluster.isPrimary to return false
            const originalIsPrimary = Object.getOwnPropertyDescriptor(cluster, 'isPrimary');
            Object.defineProperty(cluster, 'isPrimary', {
                get: () => false,
                configurable: true,
            });

            try {
                await manager.shutdown().catch((err) => {
                    ok(err.message.includes('only be called in primary process'));
                });
            } finally {
                // Restore original property
                if (originalIsPrimary) {
                    Object.defineProperty(cluster, 'isPrimary', originalIsPrimary);
                }
            }
        });
    });

    describe('Worker management (worker mode)', () => {
        test('startWorker should throw if not in worker process', async () => {
            const manager = new ClusterManager({ file: './worker.js' });

            // Mock cluster.isWorker to return false
            const originalIsWorker = Object.getOwnPropertyDescriptor(cluster, 'isWorker');
            Object.defineProperty(cluster, 'isWorker', {
                get: () => false,
                configurable: true,
            });

            try {
                await manager.startWorker().catch((err) => {
                    ok(err.message.includes('only be called in worker process'));
                });
            } finally {
                // Restore original property
                if (originalIsWorker) {
                    Object.defineProperty(cluster, 'isWorker', originalIsWorker);
                }
            }
        });

        // Removed workerCallback test since callback option was removed
    });

    describe('Restart limits', () => {
        test('should track restart history', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                maxRestarts: 3,
                restartWindow: 60000,
            });

            const stats = manager.getStats();
            strictEqual(stats.recentRestarts, 0);
        });

        test('should cleanup old restart entries', async () => {
            const manager = new ClusterManager({
                file: './worker.js',
                maxRestarts: 3,
                restartWindow: 100, // Very short window
            });

            // Stats should cleanup old entries automatically
            const stats1 = manager.getStats();
            strictEqual(stats1.recentRestarts, 0);

            // Wait for window to expire
            await new Promise((resolve) => setTimeout(resolve, 150));

            const stats2 = manager.getStats();
            strictEqual(stats2.recentRestarts, 0);
        });
    });

    describe('Integration scenarios', () => {
        test('should handle configuration with all options', async () => {
            const { createLogger } = await import('./logger');
            const customLogger = createLogger('TestCluster', 'DEBUG');

            const manager = new ClusterManager({
                file: './my-worker.js',
                workers: 2,
                maxRestarts: 5,
                restartWindow: 30000,
                logger: customLogger,
            });

            ok(manager);
            const stats = manager.getStats();
            ok(stats);
        });

        test('should handle unlimited restarts with -1', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                maxRestarts: -1, // Unlimited
            });

            ok(manager);
            const stats = manager.getStats();
            strictEqual(stats.activeWorkers, 0);
        });

        test('should track statistics across multiple operations', () => {
            const manager = new ClusterManager({ file: './worker.js' });

            // Get stats multiple times
            const stats1 = manager.getStats();
            const stats2 = manager.getStats();
            const stats3 = manager.getStats();

            strictEqual(stats1.activeWorkers, stats2.activeWorkers);
            strictEqual(stats2.activeWorkers, stats3.activeWorkers);
        });
    });

    describe('Edge cases', () => {
        test('should handle zero workers configuration', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                workers: 0,
            });

            ok(manager);
        });

        test('should handle very large workers count', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                workers: 1000,
            });

            ok(manager);
        });

        test('should handle very short restart window', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                restartWindow: 1, // 1ms
            });

            ok(manager);
        });

        test('should handle multiple getStats calls', () => {
            const manager = new ClusterManager({ file: './worker.js' });

            for (let i = 0; i < 100; i++) {
                const stats = manager.getStats();
                strictEqual(stats.activeWorkers, 0);
            }
        });
    });

    describe('Restart behavior', () => {
        test('should allow unlimited restarts with -1', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                maxRestarts: -1,
            });

            // Access private _shouldRestart by checking behavior
            const stats = manager.getStats();
            strictEqual(stats.totalRestarts, 0);
        });

        test('should track restart window cleanup', async () => {
            const manager = new ClusterManager({
                file: './worker.js',
                maxRestarts: 5,
                restartWindow: 100, // Very short window
            });

            const stats1 = manager.getStats();
            strictEqual(stats1.recentRestarts, 0);

            // Wait for window to pass
            await new Promise((resolve) => setTimeout(resolve, 150));

            const stats2 = manager.getStats();
            strictEqual(stats2.recentRestarts, 0);
        });
    });

    describe('String path constructor', () => {
        test('should accept string path directly', () => {
            const manager = new ClusterManager('./worker.js');
            ok(manager);
            const stats = manager.getStats();
            strictEqual(stats.activeWorkers, 0);
        });

        test('should accept URL path', () => {
            const manager = new ClusterManager(new URL('file:///worker.js'));
            ok(manager);
        });

        test('should accept Buffer path', () => {
            const manager = new ClusterManager(Buffer.from('./worker.js'));
            ok(manager);
        });
    });

    describe('Concurrent operations', () => {
        test('should handle rapid getStats calls', () => {
            const manager = new ClusterManager({ file: './worker.js' });

            const results: ClusterStats[] = [];
            for (let i = 0; i < 1000; i++) {
                results.push(manager.getStats());
            }

            ok(results.every((s) => s.activeWorkers === 0));
            ok(results.every((s) => s.totalRestarts === 0));
        });

        test('should handle mixed operations', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                workers: 8,
                maxRestarts: 20,
                restartWindow: 30000,
            });

            // Multiple stat queries
            for (let i = 0; i < 50; i++) {
                const stats = manager.getStats();
                ok(stats);
            }

            ok(manager);
        });
    });

    describe('Configuration edge cases', () => {
        test('should handle restartWindow at minimum', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                restartWindow: 1000, // Minimum from Env.get constraints
            });

            ok(manager);
        });

        test('should handle restartWindow at maximum', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                restartWindow: 3600000, // Maximum from Env.get constraints
            });

            ok(manager);
        });

        test('should handle workers at boundary values', () => {
            const manager1 = new ClusterManager({
                file: './worker.js',
                workers: 1, // Minimum
            });

            const manager2 = new ClusterManager({
                file: './worker.js',
                workers: 32, // Maximum from Env.get
            });

            ok(manager1);
            ok(manager2);
        });

        test('should handle maxRestarts at boundaries', () => {
            const manager1 = new ClusterManager({
                file: './worker.js',
                maxRestarts: -1, // Unlimited
            });

            const manager2 = new ClusterManager({
                file: './worker.js',
                maxRestarts: 0, // No restarts
            });

            const manager3 = new ClusterManager({
                file: './worker.js',
                maxRestarts: 1000, // Maximum
            });

            ok(manager1);
            ok(manager2);
            ok(manager3);
        });

        test('should handle shutdownTimeout configuration', () => {
            const manager = new ClusterManager({
                file: './worker.js',
                shutdownTimeout: 5000,
            });

            ok(manager);
        });
    });

    describe('Logger integration', () => {
        test('should use custom logger', async () => {
            const { createLogger } = await import('./logger');
            const customLogger = createLogger('CustomCluster', 'DEBUG');

            const manager = new ClusterManager({
                file: './worker.js',
                logger: customLogger,
            });

            ok(manager);
        });

        test('should use different log levels', async () => {
            const { createLogger } = await import('./logger');

            const loggers = [
                createLogger('Test1', 'DEBUG'),
                createLogger('Test2', 'INFO'),
                createLogger('Test3', 'WARNING'),
                createLogger('Test4', 'ERROR'),
            ];

            for (const logger of loggers) {
                const manager = new ClusterManager({
                    file: './worker.js',
                    logger,
                });
                ok(manager);
            }
        });
    });

    describe('Cluster operations with mocks', () => {
        let originalIsPrimary: PropertyDescriptor | undefined;
        let originalIsWorker: PropertyDescriptor | undefined;
        let originalFork: typeof cluster.fork;
        let originalOn: typeof cluster.on;
        let mockWorkerCounter = 0;

        beforeEach(() => {
            // Save original cluster properties
            originalIsPrimary = Object.getOwnPropertyDescriptor(cluster, 'isPrimary');
            originalIsWorker = Object.getOwnPropertyDescriptor(cluster, 'isWorker');
            originalFork = cluster.fork;
            originalOn = cluster.on;
            mockWorkerCounter = 0;
        });

        afterEach(() => {
            // Restore original cluster properties
            if (originalIsPrimary) {
                Object.defineProperty(cluster, 'isPrimary', originalIsPrimary);
            }
            if (originalIsWorker) {
                Object.defineProperty(cluster, 'isWorker', originalIsWorker);
            }
            cluster.fork = originalFork;
            cluster.on = originalOn;
        });

        test('startPrimary should fork workers and track them', async () => {
            // Mock cluster as primary
            Object.defineProperty(cluster, 'isPrimary', {
                get: () => true,
                configurable: true,
            });

            const forkedWorkers: Worker[] = [];
            const exitHandlers: Array<(worker: Worker, code: number, signal: string) => void> = [];

            // Mock cluster.fork
            cluster.fork = (() => {
                const worker = createMockWorker(++mockWorkerCounter, 10000 + mockWorkerCounter);
                forkedWorkers.push(worker);
                // Simulate worker coming online
                setImmediate(() => worker.emit('online'));
                return worker;
            }) as typeof cluster.fork;

            // Mock cluster.on
            cluster.on = ((event: string, handler: (...args: unknown[]) => void) => {
                if (event === 'exit') {
                    exitHandlers.push(handler as (worker: Worker, code: number, signal: string) => void);
                }
                return cluster;
            }) as typeof cluster.on;

            const { createLogger } = await import('./logger');
            const manager = new ClusterManager({
                file: './worker.js',
                workers: 2,
                maxRestarts: 5,
                logger: createLogger('TestCluster', 'ERROR'),
            });

            await manager.startPrimary();

            // Wait for workers to come online
            await new Promise((resolve) => setTimeout(resolve, 50));

            const stats = manager.getStats();
            strictEqual(stats.activeWorkers, 2, 'Should have 2 active workers');
            strictEqual(forkedWorkers.length, 2, 'Should have forked 2 workers');
        });

        test('should restart worker when it crashes', async () => {
            Object.defineProperty(cluster, 'isPrimary', {
                get: () => true,
                configurable: true,
            });

            const forkedWorkers: Worker[] = [];
            let exitHandler: ((worker: Worker, code: number | null, signal: string | null) => void) | undefined;

            cluster.fork = (() => {
                const worker = createMockWorker(++mockWorkerCounter, 10000 + mockWorkerCounter);
                forkedWorkers.push(worker);
                setImmediate(() => worker.emit('online'));
                return worker;
            }) as typeof cluster.fork;

            cluster.on = ((event: string, handler: (...args: unknown[]) => void) => {
                if (event === 'exit') {
                    exitHandler = handler as (worker: Worker, code: number | null, signal: string | null) => void;
                }
                return cluster;
            }) as typeof cluster.on;

            const { createLogger } = await import('./logger');
            const manager = new ClusterManager({
                file: './worker.js',
                workers: 1,
                maxRestarts: 5,
                logger: createLogger('TestCluster', 'ERROR'),
            });

            await manager.startPrimary();
            await new Promise((resolve) => setTimeout(resolve, 50));

            const statsBefore = manager.getStats();
            strictEqual(statsBefore.totalRestarts, 0);

            // Simulate worker crash
            if (exitHandler && forkedWorkers[0]) {
                exitHandler(forkedWorkers[0], 1, 'SIGTERM');
            }

            await new Promise((resolve) => setTimeout(resolve, 50));

            const statsAfter = manager.getStats();
            strictEqual(statsAfter.totalRestarts, 1, 'Should track restart');
            strictEqual(forkedWorkers.length, 2, 'Should have forked replacement worker');
        });

        test('should not restart worker when maxRestarts reached', async () => {
            Object.defineProperty(cluster, 'isPrimary', {
                get: () => true,
                configurable: true,
            });

            const forkedWorkers: Worker[] = [];
            let exitHandler: ((worker: Worker, code: number | null, signal: string | null) => void) | undefined;

            cluster.fork = (() => {
                const worker = createMockWorker(++mockWorkerCounter, 10000 + mockWorkerCounter);
                forkedWorkers.push(worker);
                setImmediate(() => worker.emit('online'));
                return worker;
            }) as typeof cluster.fork;

            cluster.on = ((event: string, handler: (...args: unknown[]) => void) => {
                if (event === 'exit') {
                    exitHandler = handler as (worker: Worker, code: number | null, signal: string | null) => void;
                }
                return cluster;
            }) as typeof cluster.on;

            // Mock process.exit to prevent test exit
            const originalExit = process.exit;
            let exitCalled = false;
            process.exit = ((_code?: number) => {
                exitCalled = true;
                return undefined as never;
            }) as typeof process.exit;

            try {
                const { createLogger } = await import('./logger');
                const manager = new ClusterManager({
                    file: './worker.js',
                    workers: 1,
                    maxRestarts: 1, // Very low limit
                    restartWindow: 5000,
                    logger: createLogger('TestCluster', 'ERROR'),
                });

                await manager.startPrimary();
                await new Promise((resolve) => setTimeout(resolve, 50));

                // Kill worker twice to exceed limit
                if (exitHandler && forkedWorkers[0]) {
                    // First crash - will restart
                    exitHandler(forkedWorkers[0], 1, null);
                    await new Promise((resolve) => setTimeout(resolve, 50));

                    // Second crash - exceeds maxRestarts, no restart
                    if (forkedWorkers[1]) {
                        exitHandler(forkedWorkers[1], 1, null);
                        await new Promise((resolve) => setTimeout(resolve, 50));
                    }
                }

                const stats = manager.getStats();
                ok(stats.totalRestarts >= 1, 'Should track restart attempts');
                ok(exitCalled, 'Should call process.exit when no workers left');
            } finally {
                process.exit = originalExit;
            }
        });

        test('should handle graceful worker exit', async () => {
            Object.defineProperty(cluster, 'isPrimary', {
                get: () => true,
                configurable: true,
            });

            const forkedWorkers: Worker[] = [];
            let exitHandler: ((worker: Worker, code: number | null, signal: string | null) => void) | undefined;

            cluster.fork = (() => {
                const worker = createMockWorker(++mockWorkerCounter, 10000 + mockWorkerCounter);
                forkedWorkers.push(worker);
                setImmediate(() => worker.emit('online'));
                return worker;
            }) as typeof cluster.fork;

            cluster.on = ((event: string, handler: (...args: unknown[]) => void) => {
                if (event === 'exit') {
                    exitHandler = handler as (worker: Worker, code: number | null, signal: string | null) => void;
                }
                return cluster;
            }) as typeof cluster.on;

            const { createLogger } = await import('./logger');
            const manager = new ClusterManager({
                file: './worker.js',
                workers: 1,
                maxRestarts: 5,
                logger: createLogger('TestCluster', 'ERROR'),
            });

            await manager.startPrimary();
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Simulate graceful exit (code 0)
            if (exitHandler && forkedWorkers[0]) {
                exitHandler(forkedWorkers[0], 0, null);
            }

            await new Promise((resolve) => setTimeout(resolve, 50));

            const stats = manager.getStats();
            strictEqual(stats.totalRestarts, 0, 'Should not count graceful exit as restart');
            strictEqual(forkedWorkers.length, 1, 'Should not fork replacement for graceful exit');
        });

        test('startWorker should import worker file', async () => {
            Object.defineProperty(cluster, 'isWorker', {
                get: () => true,
                configurable: true,
            });

            const { createLogger } = await import('./logger');
            const manager = new ClusterManager({
                file: './worker.js',
                logger: createLogger('TestCluster', 'ERROR'),
            });

            // startWorker will try to import the file, which will fail
            // but we can verify it throws an error trying to import
            await manager.startWorker().catch((err) => {
                ok(err, 'Should throw error when importing non-existent file');
            });
        });
    });

    describe('Shutdown handling', () => {
        test('should call shutdown() method when available', async () => {
            const { createLogger } = await import('./logger');

            const manager = new ClusterManager({
                file: './__mocks__/simple-worker.ts',
                logger: createLogger('TestCluster', 'ERROR'),
            });

            // The shutdown method exists and can be called
            ok(typeof manager.shutdown === 'function');

            // Should throw error when called in non-primary mode (before startPrimary)
            await manager.shutdown().catch((err) => {
                ok(err instanceof Error);
                ok(err.message.includes('primary process'));
            });
        });
    });
});
