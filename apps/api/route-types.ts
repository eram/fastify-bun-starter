/* istanbul ignore file */
/**
 * Fastify route type helpers
 *
 * These helpers make it explicit where PascalCase properties come from (Fastify's RouteGenericInterface)
 * and allow type-safe route parameter/body definitions without inline type assertions.
 */

import type { FastifySchema, RouteGenericInterface } from 'fastify';
import type { Validator } from '@libs/validator';
import type { ZodyCtor } from '@libs/zody';
import type { Union } from '@libs/utils/immutable';

// Union type for validator and zody schemas
export type ValidatorOrZody = Validator | ZodyCtor | Record<string, Validator>;

// biome-ignore lint/style/useNamingConvention: Fastify's RouteGenericInterface requires PascalCase property names
export type WithQuerystring<T> = Pick<RouteGenericInterface, 'Querystring'> & { Querystring: T };

// biome-ignore lint/style/useNamingConvention: Fastify's RouteGenericInterface requires PascalCase property names
export type WithParams<T> = Pick<RouteGenericInterface, 'Params'> & { Params: T };

// biome-ignore lint/style/useNamingConvention: Fastify's RouteGenericInterface requires PascalCase property names
export type WithBody<T> = Pick<RouteGenericInterface, 'Body'> & { Body: T };

export type WithParamsAndBody<P, B> = Union<WithParams<P> | WithBody<B>>;

/**
 * Type-safe route schema definition for Fastify routes
 *
 * This interface provides the same structure as Fastify's FastifySchema
 * but with type-safe Validator types instead of unknown.
 *
 */
export interface RouteSchema extends FastifySchema {
    // Validation schemas (FastifySchema properties)
    body?: ValidatorOrZody;
    querystring?: ValidatorOrZody;
    params?: ValidatorOrZody;
    headers?: ValidatorOrZody;
    response: {
        [statusCode: string]: ValidatorOrZody;
        [statusCode: number]: ValidatorOrZody;
    };

    // OpenAPI/Swagger metadata (from @fastify/swagger module augmentation)
    description: string;
    tags: readonly string[];
    hide?: boolean;
    deprecated?: boolean;
    summary?: string;
    consumes?: readonly string[];
    produces?: readonly string[];
    security?: ReadonlyArray<{ [securityLabel: string]: readonly string[] }>;
    operationId?: string;
}
