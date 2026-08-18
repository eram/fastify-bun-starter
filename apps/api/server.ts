import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSystemErrorName } from 'node:util';
import Fastify, { type FastifyInstance } from 'fastify';
import { Env } from '@libs/utils/env';
import { ErrorEx } from '@libs/utils/error';
import { fromHumanBytes } from '@libs/utils/text';
import { replacerFn, reviverFn } from '@libs/utils/immutable';
import { registerErrorHandler } from './error-handler';
import { registerHealth } from './health';
import { registerHello } from './hello';
import { registerSecurityPlugins } from './security';
import { registerStatic } from './static';
import { registerSwagger } from './swagger';
import { registerEnvInject, registerTranspile } from './transpile';
import { type Provider, schemaCompiler, serializerCompiler } from './type-provider';

/**
 * Type alias for our Fastify app instance (supports both HTTP/1.1 and HTTP/2)
 * We use 'never' for generics to avoid type conflicts between HTTP/1.1 and HTTP/2
 */
// biome-ignore lint/suspicious/noExplicitAny: FastifyInstance needs flexible server type
export type AppInstance = FastifyInstance<any, any, any, any, any>;

/**
 * Get user-friendly error message from any error type
 * Handles system errors (NodeJS.ErrnoException) with special formatting
 */
/* istanbul ignore next **/
function getErrorMessage(err: unknown, port?: number): string {
    // Handle NodeJS system errors with error codes
    if (err && typeof err === 'object' && 'code' in err) {
        const sysErr = err as NodeJS.ErrnoException;
        const code = sysErr.code;

        if (!code) {
            return sysErr.message || String(err);
        }

        // Get the system error name (e.g., EADDRINUSE)
        // Note: getSystemErrorName requires negative errno, use code as fallback
        let errorName = code;
        if (sysErr.errno && sysErr.errno < 0) {
            try {
                errorName = getSystemErrorName(sysErr.errno) || code;
            } catch {
                // Fallback to code if getSystemErrorName fails
                errorName = code;
            }
        }

        // Special case for EADDRINUSE
        if (code === 'EADDRINUSE') {
            return `Port ${port ?? 'unknown'} is already in use. Is another server already running?`;
        }

        // Map common error codes to user-friendly messages
        const errorMessages: Record<string, string> = {
            EACCES: `Permission denied. Port ${port ?? 'unknown'} requires elevated privileges (try sudo or use port > 1024)`,
            EADDRNOTAVAIL: 'Address not available. Check if the host address is valid',
            ECONNREFUSED: 'Connection refused. The server is not accepting connections',
            ECONNRESET: 'Connection reset by peer',
            ETIMEDOUT: 'Connection timed out',
            ENOTFOUND: 'Host not found. Check your network connection',
            ENOENT: 'File or directory not found',
        };

        return errorMessages[code] || `${errorName}: ${sysErr.message}`;
    }

    // Handle standard Error objects
    if (err instanceof Error) {
        return err.message;
    }

    // Fallback for unknown error types
    return String(err);
}

/**
 * Load TLS certificate and key files for HTTPS/HTTP2
 * Returns undefined if cert paths are not configured (plain HTTP mode)
 */
async function loadTlsConfig() {
    const certPath = Env.get('TLS_CERT_PATH', '');
    const keyPath = Env.get('TLS_KEY_PATH', '');

    // Skip HTTPS if cert paths not configured
    if (!certPath || !keyPath) {
        return undefined;
    }

    try {
        const [cert, key] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);

        return {
            key,
            cert,
            allowHTTP1: true, // ALPN: fallback to HTTP/1.1 for legacy clients
        };
    } catch (err) {
        console.error(`Failed to load TLS certificates: ${err instanceof Error ? err.message : String(err)}`);
        console.error(`  TLS_CERT_PATH: ${certPath}`);
        console.error(`  TLS_KEY_PATH: ${keyPath}`);
        throw err;
    }
}

/**
 * Get optimized HTTP/2 settings based on article recommendations
 * @see https://medium.com/@connect.hashblock/7-node-js-tls-http-2-3-tweaks-for-faster-handshakes-12326355828b
 */
function getHttp2Settings() {
    return {
        enablePush: false, // HTTP/2 push is effectively deprecated
        initialWindowSize: Env.get('HTTP2_INITIAL_WINDOW_SIZE', 1024 * 1024), // 1 MiB: reduces early stalls
        headerTableSize: Env.get('HTTP2_HEADER_TABLE_SIZE', 16 * 1024), // 16 KiB: enough for typical header sets
        maxConcurrentStreams: Env.get('HTTP2_MAX_CONCURRENT_STREAMS', 100), // tune per backend capacity
    };
}

/**
 * Create and configure Fastify server instance
 * Supports both HTTP/1.1 and HTTP/2 (HTTP/2 requires HTTPS)
 */
export async function createServer(): Promise<AppInstance> {
    const https = await loadTlsConfig();

    const app = Fastify({
        logger: false, // Using plain console instead of pino
        bodyLimit: fromHumanBytes(Env.get('MAX_BODY_SIZE', '10mb')),
        routerOptions: {
            maxParamLength: Env.get('MAX_URL_LENGTH', 4096),
        },
        // HTTP/2 configuration - only enable with HTTPS (h2c not widely supported by clients)
        ...(https && {
            http2: true,
            https,
            http2SessionTimeout: Env.get('HTTP2_SESSION_TIMEOUT', 60000),
        }),
    })
        .withTypeProvider<Provider>()
        .setValidatorCompiler(schemaCompiler)
        .setSerializerCompiler(serializerCompiler);

    // Use JSON.parse with custom reviver for BigInt support and __ property filtering
    // This replaces Fastify's default secure-json-parse with the much faster Bun.parse.
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
        try {
            const text = typeof body === 'string' ? body : body.toString();
            const json = JSON.parse(text, reviverFn);
            done(null, json);
        } catch (err) {
            done(err instanceof Error ? err : new ErrorEx(err), undefined);
        }
    });

    // Set default reply serializer to handle BigInt globally (for routes without schemas)
    app.setReplySerializer((payload, _statusCode) => {
        return JSON.stringify(payload, replacerFn, 0);
    });

    // Log HTTP/2 settings and connection observability
    if (https) {
        const settings = getHttp2Settings();
        console.log('HTTP/2 mode (HTTPS enabled)');
        console.log('HTTP/2 settings:', settings);
    } else {
        console.log('HTTP/1.1 mode (no TLS configured)');
    }

    // Log connection protocol for observability
    app.addHook('onRequest', async (request) => {
        const protocol = request.raw.httpVersion;
        const socket = request.raw.socket;

        // Type guard for TLS socket
        if ('alpnProtocol' in socket) {
            const tlsSocket = socket as {
                alpnProtocol?: string;
                getProtocol?: () => string;
                getCipher?: () => { name: string; standardName?: string; version: string };
            };
            const alpn = tlsSocket.alpnProtocol || 'http/1.1';
            const tlsVersion = tlsSocket.getProtocol?.();
            const cipher = tlsSocket.getCipher?.();

            console.log(`[handshake] ${tlsVersion || 'N/A'} ${alpn} ${cipher?.standardName || cipher?.name || 'N/A'}`);
        } else {
            console.log(`[request] HTTP/${protocol} (plain HTTP)`);
        }
    });

    return app;
}

/**
 * Register all routes and plugins
 */
export async function registerRoutes(app: AppInstance) {
    // Security plugins FIRST (order matters!)
    await registerSecurityPlugins(app);

    // Swagger plugin BEFORE routes (to capture route schemas during registration)
    await registerSwagger(app);

    // API routes
    registerHealth(app);
    registerHello(app);

    // Error handlers for nice-looing error page
    registerErrorHandler(app);

    // Inject env vars into HTML files
    const publicDir = join(__dirname, '..', 'public');
    await registerEnvInject(app, ['index.html'], publicDir);

    // Live-transpile frontend components (TS/JS/CSS/JSON served on demand, browser-facing)
    const componentsDir = join(__dirname, '..', 'app', 'components');
    registerTranspile(app, componentsDir, '/app/components');

    // Static file serving (must be last to avoid route conflicts)
    await registerStatic(app, '../public', '/');
}

/**
 * Start HTTP server
 */
export async function startServer(app: AppInstance) {
    const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
    const host = process.env['HOST'] ?? '0.0.0.0';

    try {
        await app.listen({ port, host });
        console.log(`Server listening on http://${host}:${port}`);
        console.log(`Health check: http://${host}:${port}/health`);
        console.log(`Swagger UI: http://${host}:${port}/api/v1/swagger`);
    } catch (err) {
        // Get user-friendly error message
        const errorMessage = getErrorMessage(err, port);
        console.error(`Error starting server: ${errorMessage}`);

        // In test mode (NODE_TEST_CONTEXT set), throw error instead of exiting
        if (process.env['NODE_TEST_CONTEXT']) {
            throw err;
        }
        process.exit(1);
    }
}
