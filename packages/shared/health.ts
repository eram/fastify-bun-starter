import { z, type ZodyInfer } from '../libs/zody/index';

/**
 * Health check response schema
 */
@z.Schema()
export class HealthCheckResponse {
  @z.string.describe('Health status') status!: string;
  @z.string.describe('Current server timestamp in ISO 8601 format') timestamp!: string;
  @z.number.optional.describe('Number of active worker processes (only in cluster mode)') workers?: number;
}

export type HealthResponse = ZodyInfer<typeof HealthCheckResponse>;
