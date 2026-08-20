import { hookConsole, logger } from '@libs/utils/logger';
import { initOtel } from './otel';
import pkg from './package.json' with { type: 'json' };

// Initialize environment and hook console with the global logger
hookConsole(logger, pkg.name);

// Must resolve before Fastify/http are imported anywhere in the module graph,
// so the dynamic import of ./server below is what first loads Fastify.
await initOtel();
const { createServer, registerRoutes, startServer } = await import('./server');

// Create and configure Fastify app
export const instance = await createServer();
await registerRoutes(instance);

// Auto-start server when run directly (not imported)
// Check if this file is the main module using Bun.main
if (import.meta.path === Bun.main) {
    await startServer(instance);
}
