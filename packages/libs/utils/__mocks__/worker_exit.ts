import { workerData } from 'node:worker_threads';

process.exit(workerData.code);
