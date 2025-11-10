import Fastify from 'fastify';
import { type Provider, schemaCompiler } from '../lib/validator';
import { Env } from '../util/env';
import { replacerFn, reviverFn } from '../util/immutable';
import { fromHumanBytes } from '../util/text';
import { registerConfig } from './config';
import { registerHealth } from './health';
import { registerHello } from './hello';
import { registerMCP } from './mcp';
import { registerSecurityPlugins } from './security';
import { registerStatic } from './static';
import { registerSwagger } from './swagger';

/**
 * Create and configure Fastify server instance
 */
export function createServer() {
    const app = Fastify({
        logger: false, // Using plain console instead of pino
        bodyLimit: fromHumanBytes(Env.get('MAX_BODY_SIZE', '10mb')),
        routerOptions: {
            maxParamLength: Env.get('MAX_URL_LENGTH', 2048),
        },
    })
        .withTypeProvider<Provider>()
        .setValidatorCompiler(schemaCompiler);

    // Use JSON.parse with custom reviver for BigInt support and __ property filtering
    // This replaces Fastify's default secure-json-parse with the much faster Bun.parse.
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        try {
            const text = typeof body === 'string' ? body : body.toString();
            const json = JSON.parse(text, reviverFn);
            done(null, json);
        } catch (err) {
            done(err instanceof Error ? err : new Error(String(err)), undefined);
        }
    });

    // Use JSON.stringify with custom replacer for BigInt serialization
    // This replaces Fastify's default fast-json-stringify
    app.setSerializerCompiler(() => {
        return (data) => JSON.stringify(data, replacerFn, 0);
    });

    // Set default reply serializer to handle BigInt globally (for routes without schemas)
    app.setReplySerializer((payload) => {
        return JSON.stringify(payload, replacerFn, 0);
    });

    return app;
}

/**
 * Register all routes and plugins
 */
export async function registerRoutes(app: ReturnType<typeof createServer>) {
    // Register security plugins FIRST (order matters!)
    await registerSecurityPlugins(app);

    // Register Swagger documentation
    registerSwagger(app);

    // Register all HTTP routes
    registerHealth(app);
    registerHello(app);
    registerMCP(app);
    registerConfig(app); // MCP server configuration CRUD API

    // Register static file serving (must be last to avoid route conflicts)
    await registerStatic(app);
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
        console.log(`Swagger UI: http://${host}:${port}/api/v1/swagger`);
    } catch (err) {
        console.error('Error starting server:', err);
        process.exit(1);
    }
}
