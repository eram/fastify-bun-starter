import Fastify from 'fastify';
import { type JsonSchemaTypeProvider, JsonSchemaValidatorCompiler } from '../lib/validator';
import { registerHealthRoute } from './health';
import { registerHelloRoute } from './hello';
import { registerSwagger } from './swagger';

/**
 * Create and configure Fastify server instance
 */
export function createServer() {
    const app = Fastify({
        logger: false, // Using plain console instead of pino
    })
        .withTypeProvider<JsonSchemaTypeProvider>()
        .setValidatorCompiler(JsonSchemaValidatorCompiler);

    return app;
}

/**
 * Register all routes and plugins
 */
export async function registerAll(app: ReturnType<typeof createServer>) {
    // Register Swagger documentation
    await registerSwagger(app);

    // Register all routes
    await registerHealthRoute(app);
    await registerHelloRoute(app);

    console.log('✓ Fastify app initialized');
}

/**
 * Start HTTP server
 */
export async function startServer(app: ReturnType<typeof createServer>) {
    const port = Number.parseInt(process.env.PORT ?? '3000', 10);
    const host = process.env.HOST ?? '0.0.0.0';

    try {
        await app.listen({ port, host });
        console.log(`Server listening on http://${host}:${port}`);
        console.log(`Health check: http://${host}:${port}/health`);
        console.log(`Swagger UI: http://${host}:${port}/docs`);
    } catch (err) {
        console.error('Error starting server:', err);
        process.exit(1);
    }
}
