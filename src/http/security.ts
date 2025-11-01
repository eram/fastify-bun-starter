import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { Env } from '../util/env';

/**
 * Register Helmet security headers plugin
 * Sets security-related HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
 */
async function registerHelmet(app: FastifyInstance) {
    await app.register(helmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'https:'],
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
 */
async function registerCors(app: FastifyInstance) {
    const allowedOrigins: string = Env.get('CORS_ALLOWED_ORIGINS', '*');
    const origin = allowedOrigins === '*' ? true : allowedOrigins.split(',').map((o: string) => o.trim());

    await app.register(cors, {
        origin,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
        exposedHeaders: ['Content-Range', 'X-Content-Range'],
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
    const windowMs = Env.get('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
    const maxRequests = Env.get('RATE_LIMIT_MAX_REQUESTS', 100);

    await app.register(rateLimit, {
        max: Number(maxRequests),
        timeWindow: Number(windowMs),
        // Uses in-memory store by default
        // For multi-server deployments, configure Redis:
        // redis: redisClient,
    });
}

/**
 * Register all security plugins in the recommended order:
 * 1. Helmet (security headers first)
 * 2. CORS (handle cross-origin requests)
 * 3. Rate limiting (prevent abuse)
 *
 * Body size and URL length limits are configured in server.ts via Fastify options.
 */
export async function registerSecurityPlugins(app: FastifyInstance) {
    await registerHelmet(app);
    await registerCors(app);
    await registerRateLimit(app);

    console.log('✓ Security plugins registered');
}
