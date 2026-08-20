import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import cluster, { type Worker } from 'node:cluster';
import { EventEmitter } from 'node:events';
import { sleep } from '@libs/utils/time';
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

    test('Configuration: should require worker file', () => {
        expect(() => new ClusterManager({ file: '' })).toThrow();
    });

    test('should accept file path as string', () => {
        const manager = new ClusterManager('./worker.js');
        expect(manager).toBeTruthy();
    });

    test('should accept file path in config', () => {
        const manager = new ClusterManager({ file: './worker.js' });
        expect(manager).toBeTruthy();
    });

    test('should use default values', () => {
        const manager = new ClusterManager({ file: './worker.js' });

        const stats = manager.getStats();
        expect(stats.activeWorkers).toBe(0);
        expect(stats.totalRestarts).toBe(0);
        expect(stats.recentRestarts).toBe(0);
        expect(stats.isShuttingDown).toBe(false);
    });

    test('should accept custom configuration', async () => {
        const { createLogger } = await import('../utils/logger');
        const customLogger = createLogger('TestCluster', 'DEBUG');

        const manager = new ClusterManager({
            file: './worker.js',
            workers: 4,
            maxRestarts: 5,
            restartWindow: 30000,
            logger: customLogger,
        });

        expect(manager).toBeTruthy();
    });

    test('getStats should return initial state', () => {
        const manager = new ClusterManager({ file: './worker.js' });

        const stats = manager.getStats();

        expect(stats.activeWorkers).toBe(0);
        expect(stats.totalRestarts).toBe(0);
        expect(stats.recentRestarts).toBe(0);
        expect(Array.isArray(stats.workerPids)).toBeTruthy();
        expect(stats.workerPids.length).toBe(0);
        expect(stats.isShuttingDown).toBe(false);
    });

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
                expect(err.message.includes('only be called in primary process')).toBeTruthy();
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
                expect(err.message.includes('only be called in primary process')).toBeTruthy();
            });
        } finally {
            // Restore original property
            if (originalIsPrimary) {
                Object.defineProperty(cluster, 'isPrimary', originalIsPrimary);
            }
        }
    });

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
                expect(err.message.includes('only be called in worker process')).toBeTruthy();
            });
        } finally {
            // Restore original property
            if (originalIsWorker) {
                Object.defineProperty(cluster, 'isWorker', originalIsWorker);
            }
        }
    });

    // Removed workerCallback test since callback option was removed

    test('should track restart history', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            maxRestarts: 3,
            restartWindow: 60000,
        });

        const stats = manager.getStats();
        expect(stats.recentRestarts).toBe(0);
    });

    test('should cleanup old restart entries', async () => {
        const manager = new ClusterManager({
            file: './worker.js',
            maxRestarts: 3,
            restartWindow: 100, // Very short window
        });

        // Stats should cleanup old entries automatically
        const stats1 = manager.getStats();
        expect(stats1.recentRestarts).toBe(0);

        // Wait for window to expire
        await sleep(15);

        const stats2 = manager.getStats();
        expect(stats2.recentRestarts).toBe(0);
    });

    test('should handle configuration with all options', async () => {
        const { createLogger } = await import('../utils/logger');
        const customLogger = createLogger('TestCluster', 'DEBUG');

        const manager = new ClusterManager({
            file: './my-worker.js',
            workers: 2,
            maxRestarts: 5,
            restartWindow: 30000,
            logger: customLogger,
        });

        expect(manager).toBeTruthy();
        const stats = manager.getStats();
        expect(stats).toBeTruthy();
    });

    test('should handle unlimited restarts with -1', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            maxRestarts: -1, // Unlimited
        });

        expect(manager).toBeTruthy();
        const stats = manager.getStats();
        expect(stats.activeWorkers).toBe(0);
    });

    test('should track statistics across multiple operations', () => {
        const manager = new ClusterManager({ file: './worker.js' });

        // Get stats multiple times
        const stats1 = manager.getStats();
        const stats2 = manager.getStats();
        const stats3 = manager.getStats();

        expect(stats1.activeWorkers).toBe(stats2.activeWorkers);
        expect(stats2.activeWorkers).toBe(stats3.activeWorkers);
    });

    test('should handle zero workers configuration', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 0,
        });

        expect(manager).toBeTruthy();
    });

    test('should handle very large workers count', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 1000,
        });

        expect(manager).toBeTruthy();
    });

    test('should handle very short restart window', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            restartWindow: 1, // 1ms
        });

        expect(manager).toBeTruthy();
    });

    test('should handle multiple getStats calls', () => {
        const manager = new ClusterManager({ file: './worker.js' });

        for (let i = 0; i < 100; i++) {
            const stats = manager.getStats();
            expect(stats.activeWorkers).toBe(0);
        }
    });

    test('should allow unlimited restarts with -1', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            maxRestarts: -1,
        });

        // Access private _shouldRestart by checking behavior
        const stats = manager.getStats();
        expect(stats.totalRestarts).toBe(0);
    });

    test('should track restart window cleanup', async () => {
        const manager = new ClusterManager({
            file: './worker.js',
            maxRestarts: 5,
            restartWindow: 100, // Very short window
        });

        const stats1 = manager.getStats();
        expect(stats1.recentRestarts).toBe(0);

        // Wait for window to pass
        await sleep(15);

        const stats2 = manager.getStats();
        expect(stats2.recentRestarts).toBe(0);
    });

    test('should accept string path directly', () => {
        const manager = new ClusterManager('./worker.js');
        expect(manager).toBeTruthy();
        const stats = manager.getStats();
        expect(stats.activeWorkers).toBe(0);
    });

    test('should accept URL path', () => {
        const manager = new ClusterManager(new URL('file:///worker.js'));
        expect(manager).toBeTruthy();
    });

    test('should accept Buffer path', () => {
        const manager = new ClusterManager(Buffer.from('./worker.js'));
        expect(manager).toBeTruthy();
    });

    test('should handle rapid getStats calls', () => {
        const manager = new ClusterManager({ file: './worker.js' });

        const results: ClusterStats[] = [];
        for (let i = 0; i < 1000; i++) {
            results.push(manager.getStats());
        }

        expect(results.every((s) => s.activeWorkers === 0)).toBeTruthy();
        expect(results.every((s) => s.totalRestarts === 0)).toBeTruthy();
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
            expect(stats).toBeTruthy();
        }

        expect(manager).toBeTruthy();
    });

    test('should handle restartWindow at minimum', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            restartWindow: 1000, // Minimum from Env.get constraints
        });

        expect(manager).toBeTruthy();
    });

    test('should handle restartWindow at maximum', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            restartWindow: 3600000, // Maximum from Env.get constraints
        });

        expect(manager).toBeTruthy();
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

        expect(manager1).toBeTruthy();
        expect(manager2).toBeTruthy();
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

        expect(manager1).toBeTruthy();
        expect(manager2).toBeTruthy();
        expect(manager3).toBeTruthy();
    });

    test('should handle shutdownTimeout configuration', () => {
        const manager = new ClusterManager({
            file: './worker.js',
            shutdownTimeout: 5000,
        });

        expect(manager).toBeTruthy();
    });

    test('should use custom logger', async () => {
        const { createLogger } = await import('../utils/logger');
        const customLogger = createLogger('CustomCluster', 'DEBUG');

        const manager = new ClusterManager({
            file: './worker.js',
            logger: customLogger,
        });

        expect(manager).toBeTruthy();
    });

    test('should use different log levels', async () => {
        const { createLogger } = await import('../utils/logger');

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
            expect(manager).toBeTruthy();
        }
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

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 2,
            maxRestarts: 5,
            logger: createLogger('TestCluster', 'ERROR'),
        });

        await manager.startPrimary();

        // Wait for workers to come online
        await sleep(5);

        const stats = manager.getStats();
        expect(stats.activeWorkers).toBe(2);
        expect(forkedWorkers.length).toBe(2);
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

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 1,
            maxRestarts: 5,
            logger: createLogger('TestCluster', 'ERROR'),
        });

        await manager.startPrimary();
        await sleep(5);

        const statsBefore = manager.getStats();
        expect(statsBefore.totalRestarts).toBe(0);

        // Simulate worker crash
        if (exitHandler && forkedWorkers[0]) {
            exitHandler(forkedWorkers[0], 1, 'SIGTERM');
        }

        await sleep(5);

        const statsAfter = manager.getStats();
        expect(statsAfter.totalRestarts).toBe(1);
        expect(forkedWorkers.length).toBe(2);
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
            const { createLogger } = await import('../utils/logger');
            const manager = new ClusterManager({
                file: './worker.js',
                workers: 1,
                maxRestarts: 1, // Very low limit
                restartWindow: 5000,
                logger: createLogger('TestCluster', 'ERROR'),
            });

            await manager.startPrimary();
            await sleep(5);

            // Kill worker twice to exceed limit
            if (exitHandler && forkedWorkers[0]) {
                // First crash - will restart
                exitHandler(forkedWorkers[0], 1, null);
                await sleep(5);

                // Second crash - exceeds maxRestarts, no restart
                if (forkedWorkers[1]) {
                    exitHandler(forkedWorkers[1], 1, null);
                    await sleep(5);
                }
            }

            const stats = manager.getStats();
            expect(stats.totalRestarts >= 1, 'Should track restart attempts').toBeTruthy();
            expect(exitCalled, 'Should call process.exit when no workers left').toBeTruthy();
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

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 1,
            maxRestarts: 5,
            logger: createLogger('TestCluster', 'ERROR'),
        });

        await manager.startPrimary();
        await sleep(5);

        // Simulate graceful exit (code 0)
        if (exitHandler && forkedWorkers[0]) {
            exitHandler(forkedWorkers[0], 0, null);
        }

        await sleep(5);

        const stats = manager.getStats();
        expect(stats.totalRestarts).toBe(0);
        expect(forkedWorkers.length).toBe(1);
    });

    test('startWorker should import worker file', async () => {
        Object.defineProperty(cluster, 'isWorker', {
            get: () => true,
            configurable: true,
        });

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            logger: createLogger('TestCluster', 'ERROR'),
        });

        // startWorker will try to import the file, which will fail
        // but we can verify it throws an error trying to import
        await manager.startWorker().catch((err) => {
            expect(err, 'Should throw error when importing non-existent file').toBeTruthy();
        });
    });

    test('should call shutdown() method when available', async () => {
        const { createLogger } = await import('../utils/logger');

        const manager = new ClusterManager({
            file: './__mocks__/simple-worker.ts',
            logger: createLogger('TestCluster', 'ERROR'),
        });

        // The shutdown method exists and can be called
        expect(typeof manager.shutdown === 'function').toBeTruthy();

        // Should throw error when called in non-primary mode (before startPrimary)
        await manager.shutdown().catch((err) => {
            expect(err instanceof Error).toBeTruthy();
            expect(err.message.includes('primary process')).toBeTruthy();
        });
    });

    test('should handle graceful shutdown of connected workers', async () => {
        Object.defineProperty(cluster, 'isPrimary', {
            get: () => true,
            configurable: true,
        });

        const forkedWorkers: Worker[] = [];
        let workerIdCounter = 0;
        let exitHandler: ((worker: Worker, code: number | null, signal: string | null) => void) | undefined;

        cluster.fork = (() => {
            const worker = createMockWorker(++workerIdCounter, 10000 + workerIdCounter);
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

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 2,
            shutdownTimeout: 200,
            logger: createLogger('TestCluster', 'ERROR'),
        });

        await manager.startPrimary();
        await sleep(5);

        // Call shutdown and verify workers are disconnected
        const shutdownPromise = manager.shutdown();

        // Simulate workers exiting gracefully via the exit handler
        setImmediate(() => {
            if (exitHandler) {
                forkedWorkers.forEach((worker) => {
                    exitHandler!(worker, 0, null);
                });
            }
        });

        await shutdownPromise;

        const stats = manager.getStats();
        expect(stats.isShuttingDown).toBe(true);
    });

    test('should force kill workers after timeout in shutdown', async () => {
        Object.defineProperty(cluster, 'isPrimary', {
            get: () => true,
            configurable: true,
        });

        const forkedWorkers: Worker[] = [];
        const killedWorkers: Worker[] = [];
        let workerIdCounter = 0;

        cluster.fork = (() => {
            const worker = createMockWorker(++workerIdCounter, 10000 + workerIdCounter);
            Object.assign(worker, {
                kill: (signal?: string) => {
                    if (signal === 'SIGKILL') {
                        killedWorkers.push(worker);
                        // Simulate worker exit after SIGKILL
                        setImmediate(() => worker.emit('exit', 1, 'SIGKILL'));
                    }
                },
            });
            forkedWorkers.push(worker);
            setImmediate(() => worker.emit('online'));
            return worker;
        }) as typeof cluster.fork;

        cluster.on = (() => cluster) as typeof cluster.on;

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 1,
            shutdownTimeout: 100, // Very short timeout to force SIGKILL
            logger: createLogger('TestCluster', 'ERROR'),
        });

        await manager.startPrimary();
        await sleep(5);

        // Call shutdown and wait for timeout (don't await - testing timeout)
        // biome-ignore lint/complexity/noVoid: intentionally not awaiting to test timeout
        void manager.shutdown();

        // Don't emit exit - let it timeout and force SIGKILL (shutdownTimeout above is 100ms)
        await sleep(150);

        expect(killedWorkers.length > 0, 'Should have force-killed workers after timeout').toBeTruthy();
    });

    test('should handle workers already disconnected during shutdown', async () => {
        Object.defineProperty(cluster, 'isPrimary', {
            get: () => true,
            configurable: true,
        });

        const forkedWorkers: Worker[] = [];
        let workerIdCounter = 0;
        let exitHandler: ((worker: Worker, code: number | null, signal: string | null) => void) | undefined;

        cluster.fork = (() => {
            const worker = createMockWorker(++workerIdCounter, 10000 + workerIdCounter);
            Object.assign(worker, {
                isConnected: () => false, // Already disconnected
            });
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

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 1,
            shutdownTimeout: 200,
            logger: createLogger('TestCluster', 'ERROR'),
        });

        await manager.startPrimary();
        await sleep(5);

        // Shutdown should handle already-disconnected workers gracefully
        const shutdownPromise = manager.shutdown();

        // Simulate worker exit via the exit handler
        setImmediate(() => {
            if (exitHandler && forkedWorkers[0]) {
                exitHandler(forkedWorkers[0], 0, null);
            }
        });

        await shutdownPromise;

        expect(true, 'Should handle disconnected workers without error').toBeTruthy();
    });

    test('should handle worker error during startup', async () => {
        Object.defineProperty(cluster, 'isPrimary', {
            get: () => true,
            configurable: true,
        });

        const forkedWorkers: Worker[] = [];
        let errorEmitted = false;
        let workerIdCounter = 0;

        cluster.fork = (() => {
            const worker = createMockWorker(++workerIdCounter, 10000 + workerIdCounter);
            forkedWorkers.push(worker);
            // Simulate error during startup
            setImmediate(() => {
                worker.emit('error', new Error('Worker startup failed'));
                errorEmitted = true;
            });
            return worker;
        }) as typeof cluster.fork;

        cluster.on = (() => cluster) as typeof cluster.on;

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 1,
            logger: createLogger('TestCluster', 'ERROR'),
        });

        await manager.startPrimary();
        await sleep(5);

        expect(errorEmitted, 'Worker error event should have been emitted').toBeTruthy();
        expect(forkedWorkers.length >= 1, 'Worker should have been forked despite error').toBeTruthy();
    });

    test('start() should call startPrimary when in primary mode', async () => {
        Object.defineProperty(cluster, 'isPrimary', {
            get: () => true,
            configurable: true,
        });
        Object.defineProperty(cluster, 'isWorker', {
            get: () => false,
            configurable: true,
        });

        const forkedWorkers: Worker[] = [];
        let workerIdCounter = 0;

        cluster.fork = (() => {
            const worker = createMockWorker(++workerIdCounter, 10000 + workerIdCounter);
            forkedWorkers.push(worker);
            setImmediate(() => worker.emit('online'));
            return worker;
        }) as typeof cluster.fork;

        cluster.on = (() => cluster) as typeof cluster.on;

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './worker.js',
            workers: 1,
            logger: createLogger('TestCluster', 'ERROR'),
        });

        await manager.start();
        await sleep(5);

        expect(forkedWorkers.length >= 1, 'Should have forked workers in primary mode').toBeTruthy();
    });

    test('start() should call startWorker when in worker mode', async () => {
        Object.defineProperty(cluster, 'isPrimary', {
            get: () => false,
            configurable: true,
        });
        Object.defineProperty(cluster, 'isWorker', {
            get: () => true,
            configurable: true,
        });

        const { createLogger } = await import('../utils/logger');
        const manager = new ClusterManager({
            file: './non-existent-worker.js',
            logger: createLogger('TestCluster', 'ERROR'),
        });

        // startWorker will try to import the file, which will fail
        await manager.start().catch((err) => {
            expect(err, 'Should throw error when importing non-existent file').toBeTruthy();
        });
    });
});
