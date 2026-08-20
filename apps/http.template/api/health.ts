import { apm } from '@libs/utils/apm';
import type { FastifyInstance } from 'fastify';

import { getCluster } from '../cluster';
import type { RouteSchema } from '../route-types';
import { HealthCheckResponse } from './schemas';

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
            200: HealthCheckResponse,
        },
    };

    app.get(
        '/health',
        {
            schema,
        },
        async () => {
            apm.cInc('api.health.calls');

            const workers = getCluster()?.getStats().activeWorkers ?? 0;
            return {
                status: 'ok',
                timestamp: new Date().toISOString(),
                ...(workers !== undefined && { workers }),
                'workers.alive': apm.counters['workers.alive']?.val ?? 0,
                'api.health.calls': apm.counters['api.health.calls']?.val ?? 0,
                'views.hello.calls': apm.counters['views.hello.calls']?.val ?? 0,
            };
        },
    );
}
