import type { FastifyInstance } from 'fastify';
import { registerHealthRoute } from './health';
import { registerHelloRoute } from './hello';

/**
 * Register all HTTP routes
 */
export async function registerRoutes(app: FastifyInstance) {
    await registerHealthRoute(app);
    await registerHelloRoute(app);
}
