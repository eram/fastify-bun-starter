import { ZodySchema, z } from '@libs/zody';

/**
 * Health check response schema
 */
@z.Schema()
export class HealthCheckResponse extends ZodySchema {
    @z.string.describe('Health status') status!: string;
    @z.string.describe('Current server timestamp in ISO 8601 format') timestamp!: string;
    @z.number.optional.describe('Number of active worker processes (only in cluster mode)') workers?: number;
    @z.number.optional.describe('Number of live worker threads') 'workers.alive'?: number;
    @z.number.optional.describe('Total calls to the health endpoint') 'api.health.calls'?: number;
    @z.number.optional.describe('Total calls to the hello view') 'views.hello.calls'?: number;
}

export type HealthResponse = InstanceType<typeof HealthCheckResponse>;
