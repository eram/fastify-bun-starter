import { ZodySchema, z } from '@libs/zody';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteSchema } from '../route-types';

@z.Schema()
class AdminClaimsResponse extends ZodySchema {
    @z.string.optional.describe('Token subject') sub?: string;
    @z.number.optional.describe('Expiration time (unix seconds)') exp?: number;
    @z.number.optional.describe('Issued-at time (unix seconds)') iat?: number;
    @z.number.optional.describe('Not-before time (unix seconds)') nbf?: number;
    @z.string.optional.describe('Role claim') role?: string;
}

@z.Schema()
class UnauthorizedResponse extends ZodySchema {
    @z.string.describe('Error message') message!: string;
}

/**
 * Register the admin endpoint.
 * Requires a valid JWT (see middleware/auth.ts) with a `role:admin` claim, and returns its claims.
 * Missing/invalid/expired tokens get 401 (see middleware/auth.ts); a valid JWT missing the
 * `role:admin` claim also gets 401.
 */
export function registerAdmin(app: FastifyInstance) {
    const schema: RouteSchema = {
        summary: 'Admin endpoint (requires JWT with role:admin claim)',
        description: 'Returns the authenticated JWT claims. Returns 401 if not authenticated or missing the role:admin claim.',
        tags: ['Admin'],
        requireAuth: true,
        security: [{ bearerAuth: [] }],
        response: {
            200: AdminClaimsResponse,
            401: UnauthorizedResponse,
        },
    };

    app.get(
        '/api/v1/admin',
        {
            schema,
        },
        async (request: FastifyRequest, reply: FastifyReply) => {
            // If the auth hook already rejected the request, user stays unset — bail out
            // without touching reply again (see middleware/auth.ts for why this matters).
            if (!request.user) return;

            if (request.user['role'] !== 'admin') {
                reply.code(401).send({ message: 'requires role:admin claim.' });
                return;
            }
            return request.user;
        },
    );
}
