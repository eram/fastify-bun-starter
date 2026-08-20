import { JwtPayload, verifyToken } from '@libs/utils';
import type { FastifyInstance } from 'fastify';
import type { RouteSchema } from '../route-types';

declare module 'fastify' {
    interface FastifyRequest {
        user?: JwtPayload;
    }
}

/**
 * Registers a global onRequest hook that enforces JWT authentication on any
 * route whose schema sets `requireAuth: true` (see route-types.ts).
 *
 * On success, the verified claims are attached to `request.user`.
 * On failure (missing/invalid/expired token), responds 401.
 */
export function registerAuth(app: FastifyInstance) {
    const secret = process.env['JWT_SECRET'];
    if (!secret || secret === 'secret') {
        throw new Error('JWT_SECRET must be set to a non-default value before starting the server.');
    }

    app.decorateRequest('user', undefined);

    app.addHook('onRequest', async (request, reply) => {
        const schema = request.routeOptions.schema as RouteSchema | undefined;
        if (!schema?.requireAuth) return;

        const header = request.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

        if (!token) {
            reply.code(401).send({ message: 'Authentication required.' });
            return;
        }

        try {
            request.user = verifyToken(token, secret);
        } catch {
            reply.code(401).send({ message: 'Authentication required.' });
        }

        // Note: reply.sent derives from raw.writableEnded, which can lag a tick behind send()
        // (most visible under app.inject()) — so Fastify's hook runner can race ahead into the
        // route handler below even after we've already responded here. Protected handlers must
        // treat a missing request.user as "the hook already replied" and bail without
        // calling reply.send() again (see api/admin.ts).
    });
}
