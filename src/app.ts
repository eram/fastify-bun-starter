import { createServer, registerAll, startServer } from './http/server';
import { hookConsole, logger } from './util';

// Initialize environment and hook console with the global logger
hookConsole(logger);

// Create and configure Fastify app
export const app = createServer();
await registerAll(app);

// Auto-start server when run directly (not imported)
// Check if this file is the main module using Bun.main
if (import.meta.path === Bun.main) {
    await startServer(app);
}
