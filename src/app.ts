import { createServer, registerAll } from './http/server';
import { hookConsole } from './util';

// Initialize environment and hook console
hookConsole();

// Create and configure Fastify app
export const app = createServer();
await registerAll(app);
