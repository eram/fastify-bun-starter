import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Env } from '@libs/utils/env';
import type { FastifyInstance } from 'fastify';

/**
 * Register Helmet security headers plugin
 * Sets security-related HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
 */
async function registerHelmet(app: FastifyInstance) {
    const isDev = Env.nodeEnv === 'development';
    const port = process.env['PORT'] ?? 3000;

    await app.register(helmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                // In development, allow localhost AND remote APIs for apiBase feature
                connectSrc: isDev
                    ? ["'self'", `http://localhost:${port}`, `ws://localhost:${port}`, 'https:', 'http:']
                    : ["'self'"],
                // Scalar API Reference from jsdelivr CDN (requires unsafe-eval for Vue reactivity)
                styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net'],
                scriptSrcElem: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
                imgSrc: ["'self'", 'data:', 'https:'],
                fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net', 'https://fonts.scalar.com'],
                // Allow blob: URLs for Scalar API downloads (used in /api/v1/swagger iframe)
                frameSrc: ["'self'", 'blob:'],
                // Prevent object/embed exploitation
                objectSrc: ["'none'"],
            },
        },
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
        },
        frameguard: {
            action: 'deny',
        },
        // noSniff and xssFilter are enabled by default
    });
}

/**
 * Register CORS plugin
 * Configurable via CORS_ALLOWED_ORIGINS environment variable
 * Format: comma-separated list of origins or "*" for all
 * Example: "https://example.com,https://app.example.com"
 *
 * Includes a session-id header pair for browser-based SSE/streaming clients:
 * - X-Session-Id: Required for browser-based clients to read session IDs
 * - x-session-id: Required for browser-based clients to send session IDs
 */
async function registerCors(app: FastifyInstance) {
    const allowedOrigins = Env.get('CORS_ALLOWED_ORIGINS', '*');
    const origin = allowedOrigins === '*' ? true : allowedOrigins.split(',').map((o: string) => o.trim());

    await app.register(cors, {
        origin,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Requested-With',
            'Accept',
            'x-session-id', // Allow clients to send session ID
        ],
        exposedHeaders: [
            'Content-Range',
            'X-Content-Range',
            'X-Session-Id', // Allow clients to read session ID from responses
        ],
        maxAge: 86400,
    });
}

/**
 * Register rate limiting plugin
 * Configurable via environment variables:
 * - RATE_LIMIT_WINDOW_MS: Time window in milliseconds (default: 15 minutes)
 * - RATE_LIMIT_MAX_REQUESTS: Maximum requests per window (default: 100)
 */
async function registerRateLimit(app: FastifyInstance) {
    const timeWindow = Env.get('RATE_LIMIT_WINDOW_MS', 60 * 1000);
    const max = Env.get('RATE_LIMIT_MAX_REQUESTS', 10000);

    await app.register(rateLimit, {
        max,
        timeWindow,
        // Uses in-memory store by default
        // For multi-server deployments, configure Redis:
        // redis: redisClient,
    });
}

/**
 * Register DNS rebinding protection
 * Validates Host header to prevent DNS rebinding attacks on local servers
 * Only active when ALLOWED_HOSTS is configured
 *
 * DNS rebinding attack: Malicious DNS switches from external IP to localhost/127.0.0.1
 * mid-request, tricking your local server into responding to attacker-controlled origins.
 */
function registerDnsRebindingProtection(app: FastifyInstance) {
    const allowedHosts = Env.get('ALLOWED_HOSTS', '');

    // Skip if not configured (production servers typically don't need this)
    if (!allowedHosts) {
        return;
    }

    const hosts = allowedHosts.split(',').map((h: string) => h.trim());

    app.addHook('onRequest', async (request, reply) => {
        const host = request.hostname; // Gets hostname without port

        // Check if host is in allowed list
        if (!hosts.includes(host)) {
            return reply.code(403).send({
                error: 'Forbidden',
                message: 'Host header not allowed',
            });
        }
        return undefined;
    });
}

/**
 * Register all security plugins in parallel for better performance:
 * 1. Helmet (security headers)
 * 2. CORS (handle cross-origin requests)
 * 3. DNS rebinding protection (for local servers)
 * 4. Rate limiting (prevent abuse)
 *
 * Body size and URL length limits are configured in server.ts via Fastify options.
 */
export async function registerSecurityPlugins(app: FastifyInstance) {
    await Promise.all([registerHelmet(app), registerCors(app), registerDnsRebindingProtection(app), registerRateLimit(app)]);
    console.log('Security plugins registered');
}
