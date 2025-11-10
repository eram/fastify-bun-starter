/**
 * MCP Server Configuration REST API
 * CRUD operations for MCP server configurations
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getManager } from '../controller/mcp-controller/config';
import type { MCPServerConfig } from '../controller/mcp-controller/types';
import { mcpServerConfigSchema } from '../controller/mcp-controller/types';
import { z } from '../lib/validator';
import type { WithBody, WithParams, WithParamsAndBody } from './route-types';

/**
 * Common response schemas
 */
const successResponse = z
    .object({
        name: z.string(),
        message: z.string(),
    })
    .describe('Success');

const errorResponse = z.object({
    error: z.string(),
});

const enabledResponse = z
    .object({
        name: z.string(),
        enabled: z.boolean(),
        message: z.string(),
    })
    .describe('Server enabled/disabled response');

const listResponse = z
    .object({
        servers: z.array(z.unknown()),
        total: z.number(),
    })
    .describe('List of MCP servers');

/**
 * Request schemas for MCP configuration endpoints
 */
const listServersSchema = {
    description: 'List all MCP server configurations',
    tags: ['MCP Configuration'],
    summary: 'Get all MCP servers',
    response: {
        200: listResponse,
        404: errorResponse.describe('Servers not found'),
    },
};

const getServerSchema = {
    description: 'Get a specific MCP server configuration by name',
    tags: ['MCP Configuration'],
    summary: 'Get MCP server by name',
    params: z.object({
        name: z.string().min(1).max(120),
    }),
    response: {
        200: mcpServerConfigSchema,
        404: errorResponse.describe('Server not found'),
    },
};

const createServerSchema = {
    description: 'Create a new MCP server configuration',
    tags: ['MCP Configuration'],
    summary: 'Create MCP server',
    body: mcpServerConfigSchema,
    response: {
        201: successResponse,
        400: errorResponse.describe('Invalid server configuration'),
        409: errorResponse.describe('Server already exists'),
    },
};

const updateServerSchema = {
    description: 'Update an existing MCP server configuration',
    tags: ['MCP Configuration'],
    summary: 'Update MCP server',
    params: z.object({
        name: z.string().min(1).max(120),
    }),
    body: z.object({
        transport: z.union([z.literal('stdio'), z.literal('sse'), z.literal('http')]).optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional(),
        env: z.map(z.string()).optional(),
        enabled: z.boolean().optional(),
        description: z.string().optional(),
    }),
    response: {
        200: successResponse,
        404: errorResponse.describe('Server not found'),
        400: errorResponse.describe('Invalid server configuration'),
    },
};

const deleteServerSchema = {
    description: 'Delete an MCP server configuration',
    tags: ['MCP Configuration'],
    summary: 'Delete MCP server',
    params: z.object({
        name: z.string().min(1).max(120),
    }),
    response: {
        200: successResponse,
        404: errorResponse.describe('Server not found'),
    },
};

const enableServerSchema = {
    description: 'Enable or disable an MCP server',
    tags: ['MCP Configuration'],
    summary: 'Enable/disable MCP server',
    params: z.object({
        name: z.string().min(1).max(120),
    }),
    body: z.object({
        enabled: z.boolean(),
    }),
    response: {
        200: enabledResponse,
        404: errorResponse.describe('Server not found'),
    },
};

/**
 * Fastify schema validation handles all request validation
 * No need for additional manual validators
 */

/**
 * Register MCP configuration management routes
 */
export function registerConfig(app: FastifyInstance): void {
    const manager = getManager();

    // GET /api/v1/config - List all servers
    app.get('/api/v1/config', { schema: listServersSchema }, async (_request: FastifyRequest, reply: FastifyReply) => {
        const servers = await manager.getAllServers();
        return reply.code(200).send({
            servers,
            total: servers.length,
        });
    });

    // GET /api/v1/config/:name - Get specific server
    app.get<WithParams<{ name: string }>>(
        '/api/v1/config/:name',
        { schema: getServerSchema },
        async (request: FastifyRequest<WithParams<{ name: string }>>, reply: FastifyReply) => {
            const server = await manager.getServer(request.params.name);
            if (!server) {
                return reply.code(404).send({ error: `Server '${request.params.name}' not found` });
            }

            return reply.code(200).send(server);
        },
    );

    // POST /api/v1/config - Create new server
    app.post<WithBody<MCPServerConfig>>(
        '/api/v1/config',
        { schema: createServerSchema },
        async (request: FastifyRequest<WithBody<MCPServerConfig>>, reply: FastifyReply) => {
            // Validate request body
            const config = mcpServerConfigSchema.parse(request.body);

            // Check if server already exists
            const existing = await manager.getServer(config.name);
            if (existing) {
                return reply.code(409).send({ error: `Server '${config.name}' already exists` });
            }

            // Add server
            await manager.upsertServer(config);

            return reply.code(201).send({
                name: config.name,
                message: 'Server created successfully',
            });
        },
    );

    // PUT /api/v1/config/:name - Update server (full replace)
    app.put<WithParamsAndBody<{ name: string }, Partial<MCPServerConfig>>>(
        '/api/v1/config/:name',
        { schema: updateServerSchema },
        async (request: FastifyRequest<WithParamsAndBody<{ name: string }, Partial<MCPServerConfig>>>, reply: FastifyReply) => {
            // Check if server exists
            const existing = await manager.getServer(request.params.name);
            if (!existing) {
                return reply.code(404).send({ error: `Server '${request.params.name}' not found` });
            }

            // Merge with existing config
            const updated = { ...existing, ...request.body, name: request.params.name };

            // Validate merged config
            const validConfig = mcpServerConfigSchema.parse(updated);

            // Upsert server config
            await manager.upsertServer(validConfig);

            return reply.code(200).send({
                name: request.params.name,
                message: 'Server updated successfully',
            });
        },
    );

    // PATCH /api/v1/config/:name - Partial update
    app.patch<WithParamsAndBody<{ name: string }, Partial<MCPServerConfig>>>(
        '/api/v1/config/:name',
        { schema: updateServerSchema },
        async (request: FastifyRequest<WithParamsAndBody<{ name: string }, Partial<MCPServerConfig>>>, reply: FastifyReply) => {
            // Check if server exists
            const existing = await manager.getServer(request.params.name);
            if (!existing) {
                return reply.code(404).send({ error: `Server '${request.params.name}' not found` });
            }

            // Merge with existing config
            const updated = { ...existing, ...request.body, name: request.params.name };

            // Validate merged config
            const validConfig = mcpServerConfigSchema.parse(updated);

            // Upsert server config
            await manager.upsertServer(validConfig);

            return reply.code(200).send({
                name: request.params.name,
                message: 'Server updated successfully',
            });
        },
    );

    // DELETE /api/v1/config/:name - Delete server
    app.delete<WithParams<{ name: string }>>(
        '/api/v1/config/:name',
        { schema: deleteServerSchema },
        async (request: FastifyRequest<WithParams<{ name: string }>>, reply: FastifyReply) => {
            const removed = await manager.removeServer(request.params.name);
            if (!removed) {
                return reply.code(404).send({ error: `Server '${request.params.name}' not found` });
            }

            return reply.code(200).send({
                name: request.params.name,
                message: 'Server deleted successfully',
            });
        },
    );

    // PATCH /api/v1/config/:name/enabled - Enable/disable server
    app.patch<WithParamsAndBody<{ name: string }, { enabled: boolean }>>(
        '/api/v1/config/:name/enabled',
        { schema: enableServerSchema },
        async (request: FastifyRequest<WithParamsAndBody<{ name: string }, { enabled: boolean }>>, reply: FastifyReply) => {
            // Check if server exists
            const existing = await manager.getServer(request.params.name);
            if (!existing) {
                return reply.code(404).send({ error: `Server '${request.params.name}' not found` });
            }

            // Update enabled status
            await manager.enable(request.params.name, request.body.enabled);

            return reply.code(200).send({
                name: request.params.name,
                enabled: request.body.enabled,
                message: `Server ${request.body.enabled ? 'enabled' : 'disabled'} successfully`,
            });
        },
    );
}
