import type { ZodyCtor } from '@libs/zody';
import { HealthCheckResponse } from '@shared/health';
import type { FastifyInstance } from 'fastify';
import { getCluster } from './cluster';
import type { RouteSchema } from './route-types';

/**
 * Register health check endpoint
 * Returns status, timestamp, and worker count (if in cluster mode)
 */
export function registerHealth(app: FastifyInstance) {
    const schema: RouteSchema = {
        summary: 'Health check endpoint',
        description: 'Returns server health status and timestamp',
        tags: ['Monitoring'],
        response: {
            200: HealthCheckResponse as unknown as ZodyCtor,
        },
    };

    app.get(
        '/health',
        {
            schema,
        },
        async () => {
            const workers = getCluster()?.getStats().activeWorkers ?? 0;
            return {
                status: 'ok',
                timestamp: new Date().toISOString(),
                ...(workers !== undefined && { workers }),
            };
        },
    );
}
