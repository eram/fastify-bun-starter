/* istanbul ignore file */
/**
 * ClusterManager - Manages Node.js cluster mode with worker lifecycle management
 *
 * Features:
 * - Automatic worker spawning based on CPU count or custom configuration
 * - Worker restart on crash/error with configurable limits
 * - Graceful shutdown handling
 * - Restart tracking and statistics
 * - Configurable restart windows to prevent restart loops
 */
import cluster, { type Worker } from 'node:cluster';
import type { PathLike } from 'node:fs';
import os from 'node:os';
import { Env } from './env';
import { createLogger, type LogFn, type Logger, LogLevel } from './logger';

/**
 * Default configuration options for ClusterManager
 */
class ClusterManagerDefaults {
    /** Path to the worker file to execute */
    readonly file: PathLike = '';

    /** Number of worker processes (1 if debugger attached, else from env/default CPU count, max 32) */
    readonly workers: number = Env.isDebuggerAttached ? 1 : Env.get('CLUSTER_WORKERS', os.cpus().length, 1, 32);

    /** Maximum restarts per window (0 if debugger attached, else from env/default 10) */
    readonly maxRestarts: number = Env.isDebuggerAttached ? 0 : Env.get('CLUSTER_RESTART_MAX', 10, -1, 1000);

    /** Time window for restart tracking in ms */
    readonly restartWindow: number = Env.get('CLUSTER_RESTART_WINDOW', 60000, 1000, 3600000);

    /** Logger instance for cluster operations */
    readonly logger: Logger = createLogger('ClusterManager', LogLevel.INFO);

    /** Termination timeout in ms */
    readonly shutdownTimeout = Env.get('CLUSTER_SHUTDOWN_TIMEOUT', 5000, 500, 20000);
}

/**
 * Configuration options for ClusterManager
 */
export type Options = Partial<ClusterManagerDefaults>;

/**
 * Statistics about cluster workers
 */
export interface ClusterStats {
    /** Number of currently active workers */
    activeWorkers: number;

    /** Total worker restarts since cluster started */
    totalRestarts: number;

    /** Restarts within current window */
    recentRestarts: number;

    /** Active worker PIDs */
    workerPids: number[];

    /** Whether cluster is shutting down */
    isShuttingDown: boolean;
}

interface RestartEntry {
    timestamp: number;
    workerId: number;
    pid: number;
}

/**
 * ClusterManager
 */
export class ClusterManager {
    private _config: Required<Options>;
    private _active: Map<number, Worker> = new Map();
    private _restarts = 0;
    private _log: RestartEntry[] = [];
    private _isShuttingDown = false;
    private _info: LogFn;
    private _error: LogFn;
    private _crit: LogFn;

    constructor(config: Options | PathLike = {}) {
        if (typeof config === 'string' || config instanceof URL || Buffer.isBuffer(config)) {
            this._config = { ...new ClusterManagerDefaults(), file: config } as Required<Options>;
        } else {
            this._config = { ...new ClusterManagerDefaults(), ...config } as Required<Options>;
        }

        // Validate configuration
        if (!this._config.file) {
            throw new Error('ClusterManager requires a worker file path');
        }

        this._info = this._config.logger.info.bind(this._config.logger);
        this._error = this._config.logger.error.bind(this._config.logger);
        this._crit = this._config.logger.crit.bind(this._config.logger);
    }

    getStats(): ClusterStats {
        this._reset();

        return {
            activeWorkers: this._active.size,
            totalRestarts: this._restarts,
            recentRestarts: this._log.length,
            workerPids: Array.from(this._active.values())
                .map((w) => w.process.pid)
                .filter((pid): pid is number => pid !== undefined),
            isShuttingDown: this._isShuttingDown,
        };
    }

    private _reset(): void {
        const cutoffTime = Date.now() - this._config.restartWindow;
        this._log = this._log.filter((entry) => entry.timestamp > cutoffTime);
    }

    private _shouldRestart(): boolean {
        if (this._isShuttingDown) {
            return false;
        }

        if (this._config.maxRestarts === -1) {
            return true; // Unlimited restarts
        }

        this._reset();
        return this._log.length < this._config.maxRestarts;
    }

    private _fork(): Worker {
        const worker = cluster.fork();

        // Wait for worker to come online
        worker.once('online', () => {
            this._info(`Worker ${worker.process.pid} (ID: ${worker.id}) online`);
            this._active.set(worker.id, worker);
        });

        // Handle worker errors during startup
        worker.once('error', (err) => {
            this._error(`Worker ${worker.process.pid} (ID: ${worker.id}) error: ${err.message}`);
        });

        return worker;
    }

    /**
     * Handle worker exit and restart if appropriate
     */
    private _handleExit(worker: Worker, code: number | null, signal: string | null): void {
        this._active.delete(worker.id);

        const exitReason = signal || code || 'unknown';
        const wasGraceful = code === 0;

        if (wasGraceful) {
            this._info(`Worker ${worker.process.pid} exited gracefully`);
            return;
        }

        // Track restart
        this._restarts++;
        this._log.push({
            timestamp: Date.now(),
            workerId: worker.id,
            pid: worker.process.pid ?? 0,
        });

        if (this._shouldRestart()) {
            this._error(`Worker ${worker.process.pid} died (${exitReason}). Restarting...`);
            this._fork();
        } else {
            const aboveMax = this._log.length > this._config.maxRestarts;
            const logFn = aboveMax ? this._crit : this._error;
            logFn(
                `Worker ${worker.process.pid} died (${exitReason}). ` +
                    `Max restarts (${this._config.maxRestarts}) reached within ${this._config.restartWindow}ms window. Not restarting.`,
            );

            // If no workers left, exit primary
            if (this._active.size === 0) {
                this._crit('No workers remaining. Shutting down cluster.');
                process.exit(1);
            }
        }
    }

    /**
     * Setup graceful shutdown handlers
     */
    private _setup(): void {
        const shutdown = async (signal: string) => {
            if (this._isShuttingDown) {
                return;
            }

            this._info(`${signal} received. Gracefully shutting down cluster...`);
            this._isShuttingDown = true;

            // Disconnect all workers
            const workers = Array.from(this._active.values());
            const promises = workers.map((worker) => {
                return new Promise<void>((resolve) => {
                    if (!worker.isConnected()) {
                        resolve();
                        return;
                    }

                    // Set timeout for worker shutdown
                    const timeout = setTimeout(() => {
                        this._info(`Worker ${worker.process.pid} did not exit gracefully, killing...`);
                        worker.kill('SIGKILL');
                        resolve();
                    }, 5000);

                    worker.on('exit', () => {
                        clearTimeout(timeout);
                        resolve();
                    });

                    worker.disconnect();
                });
            });

            await Promise.all(promises);
            this._info('All workers shut down. Exiting primary.');
            process.exit(0);
        };

        // Note: These handlers are required. Node.js cluster does NOT automatically
        // handle graceful shutdown when primary receives SIGTERM/SIGINT.
        // Without these, workers would be abruptly killed without cleanup.
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }

    /**
     * Start the cluster in primary mode
     */
    async startPrimary(): Promise<void> {
        if (!cluster.isPrimary) {
            throw new Error('startPrimary() can only be called in primary process');
        }

        this._info(`Cluster primary ${process.pid} started`);
        this._info(`Starting ${this._config.workers} workers...`);

        // Setup exit handler
        cluster.on('exit', (worker, code, signal) => {
            this._handleExit(worker, code, signal);
        });

        // Setup shutdown handlers
        this._setup();

        // Fork workers
        for (let i = 0; i < this._config.workers; i++) {
            this._fork();
        }

        const stats = this.getStats();
        this._info(`Cluster mode: ${stats.activeWorkers} workers active`);
    }

    /**
     * Start the cluster in worker mode
     */
    async startWorker(): Promise<void> {
        if (!cluster.isWorker) {
            throw new Error('startWorker() can only be called in worker process');
        }

        this._info(`Cluster worker ${process.pid} started`);

        // Dynamic import of worker file
        await import(this._config.file.toString());
    }

    /**
     * Start the cluster (automatically detects primary vs worker)
     */
    async start(): Promise<void> {
        if (cluster.isPrimary) {
            await this.startPrimary();
        } else if (cluster.isWorker) {
            await this.startWorker();
        }
    }

    /**
     * Gracefully shutdown the cluster
     */
    async shutdown(): Promise<void> {
        if (!cluster.isPrimary) {
            throw new Error('shutdown() can only be called in primary process');
        }

        this._isShuttingDown = true;
        this._info('Shutting down cluster...');

        const workers = Array.from(this._active.values());
        for (const worker of workers) {
            worker.disconnect();
        }

        // Wait for all workers to exit (with timeout)
        await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
                if (this._active.size === 0) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);

            // Force exit after 5 seconds
            setTimeout(() => {
                clearInterval(interval);
                for (const worker of this._active.values()) {
                    worker.kill('SIGKILL');
                }
                resolve();
            }, this._config.shutdownTimeout);
        });

        this._info('Cluster shutdown complete');
    }
}
