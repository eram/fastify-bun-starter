/**
 * Fastify route type helpers
 *
 * These helpers make it explicit where PascalCase properties come from (Fastify's RouteGenericInterface)
 * and allow type-safe route parameter/body definitions without inline type assertions.
 */

import type { RouteGenericInterface } from 'fastify';
import type { Union } from '../util/immutable';

// biome-ignore lint/style/useNamingConvention: Fastify's RouteGenericInterface requires PascalCase property names
export type WithParams<T> = Pick<RouteGenericInterface, 'Params'> & { Params: T };

// biome-ignore lint/style/useNamingConvention: Fastify's RouteGenericInterface requires PascalCase property names
export type WithBody<T> = Pick<RouteGenericInterface, 'Body'> & { Body: T };

export type WithParamsAndBody<P, B> = Union<WithParams<P> | WithBody<B>>;
