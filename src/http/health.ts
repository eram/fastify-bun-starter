import type { FastifyInstance } from 'fastify';
import { getWorkerCount } from '../cluster';
import { z } from '../lib/validator';

/**
 * Register health check endpoint
 * Returns status, timestamp, and worker count (if in cluster mode)
 */
export async function registerHealthRoute(app: FastifyInstance) {
    app.get(
        '/health',
        {
            schema: {
                description: 'Health check endpoint',
                tags: ['monitoring'],
                response: {
                    200: {
                        status: z.string(),
                        timestamp: z.string(),
                        workers: z.number().optional(),
                    },
                },
            },
        },
        async () => {
            const workers = getWorkerCount();
            return {
                status: 'ok',
                timestamp: new Date().toISOString(),
                ...(workers !== undefined && { workers }),
            };
        },
    );
}
