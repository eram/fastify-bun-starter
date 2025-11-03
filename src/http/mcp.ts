/**
 * MCP (Model Context Protocol) HTTP endpoint
 * Handles JSON-RPC 2.0 requests for MCP tools
 * Supports both JSON and SSE (Server-Sent Events) responses
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JSONRPCMessage } from '../lib/mcp';
import { registerAllTools } from '../lib/mcp';
import { SessionStore } from '../lib/mcp/session';

// Create session store for managing per-session MCP servers
const sessionStore = new SessionStore();

// Default server info
const DEFAULT_SERVER_INFO = {
    name: 'fastify-bun-starter',
    version: '1.0.0',
};

/**
 * Get or create MCP server for a session
 */
function getOrCreateSession(sessionId?: string) {
    if (sessionId) {
        const session = sessionStore.get(sessionId);
        if (session) {
            return session;
        }
    }

    // Create new session
    const session = sessionStore.create(DEFAULT_SERVER_INFO);
    registerAllTools(session.server);
    return session;
}

/**
 * Register MCP endpoint
 *
 * POST /mcp
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/list"
 * }
 *
 * Response 200:
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "result": {
 *     "tools": [...]
 *   }
 * }
 */
export async function registerMCPRoute(app: FastifyInstance) {
    app.post(
        '/mcp',
        {
            schema: {
                description: `Model Context Protocol (MCP) endpoint - JSON-RPC 2.0 interface for MCP tools.

Supports two transport modes:
- **JSON mode** (default): Set Content-Type: application/json
- **SSE mode**: Set Accept: text/event-stream

Available methods:
- initialize: Handshake with protocol version negotiation
- tools/list: List available tools
- tools/call: Execute a tool

Session management:
- Use Mcp-Session-Id header to reuse sessions
- Server returns session ID in response headers`,
                tags: ['MCP'],
                // Note: We don't define body/response schemas here because Fastify
                // will validate them, but MCP has dynamic nested structures.
                // The description above documents the expected format.
                hide: false,
            },
        },
        async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const message = request.body as JSONRPCMessage;

                // Check if client wants SSE response
                const accept = request.headers.accept || '';
                const wantsSSE = accept.includes('text/event-stream');

                // Get or create session
                const sessionId = request.headers['mcp-session-id'] as string | undefined;
                const session = getOrCreateSession(sessionId);

                // Validate JSON-RPC structure
                if (!message || typeof message !== 'object') {
                    const errorResponse = {
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32600,
                            message: 'Invalid Request',
                        },
                    };

                    if (wantsSSE) {
                        reply.raw.writeHead(400, {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            Connection: 'keep-alive',
                            'Mcp-Session-Id': session.sessionId,
                        });
                        reply.raw.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
                        reply.raw.end();
                        return;
                    }

                    return reply.status(400).send(errorResponse);
                }

                if (message.jsonrpc !== '2.0') {
                    const errorResponse = {
                        jsonrpc: '2.0',
                        id: (message as { id?: unknown }).id ?? null,
                        error: {
                            code: -32600,
                            message: 'Invalid JSON-RPC version',
                        },
                    };

                    if (wantsSSE) {
                        reply.raw.writeHead(400, {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            Connection: 'keep-alive',
                            'Mcp-Session-Id': session.sessionId,
                        });
                        reply.raw.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
                        reply.raw.end();
                        return;
                    }

                    return reply.status(400).send(errorResponse);
                }

                // Handle the message
                const response = await session.server.handleMessage(message);

                if (!response) {
                    // This was a notification, no response needed
                    return reply.status(204).send();
                }

                // Send response based on client preference
                if (wantsSSE) {
                    reply.raw.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                        'Mcp-Session-Id': session.sessionId,
                    });
                    reply.raw.write(`data: ${JSON.stringify(response)}\n\n`);
                    reply.raw.end();
                } else {
                    reply.header('Mcp-Session-Id', session.sessionId);
                    return reply.status(200).send(response);
                }
            } catch (error) {
                // Unexpected error
                return reply.status(500).send({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32603,
                        message: 'Internal error',
                        data: error instanceof Error ? error.message : String(error),
                    },
                });
            }
        },
    );
}
