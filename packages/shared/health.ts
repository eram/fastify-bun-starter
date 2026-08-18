import { z } from '../libs/validator/index';

/**
 * Health check response schema
 */
export const healthResponseSchema = z.object({
    status: z.string().describe('Health status'),
    timestamp: z.string().describe('Current server timestamp in ISO 8601 format'),
    workers: z.number().optional().describe('Number of active worker processes (only in cluster mode)'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
