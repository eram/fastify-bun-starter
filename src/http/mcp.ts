/**
 * MCP (Model Context Protocol) HTTP endpoint
 * Handles JSON-RPC 2.0 requests for MCP tools
 * Supports both JSON and SSE (Server-Sent Events) responses
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, FastifySchema } from 'fastify';
import { getManager } from '../controller/mcp-config/manager';
import { registerAllTools } from '../controller/tools';
import { type JSONRPCMessage, SessionStore } from '../lib/mcp';
import { Env } from '../util';

/**
 * Extended Fastify schema with OpenAPI/Swagger documentation fields
 */
interface FastifySchemaWithDocs extends FastifySchema {
    description?: string;
    tags?: string[];
    summary?: string;
    hide?: boolean;
}

// Create session store for managing per-session MCP servers
const sessions = new SessionStore();

// Default server info
const SERVER_INFO = {
    name: Env.appName,
    version: Env.appVersion,
};

/**
 * Get or create MCP server for a session
 */
function getOrCreateSession(sessionId?: string) {
    if (sessionId) {
        const session = sessions.get(sessionId);
        if (session) {
            return session;
        }
    }

    // Create new session
    const session = sessions.create(SERVER_INFO);
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
    // Setup config manager and event listeners
    setupConfigManager();

    // GET /mcp - Establish SSE connection for server notifications
    app.get(
        '/mcp',
        {
            schema: {
                description: `Establish SSE (Server-Sent Events) connection for MCP notifications.

This endpoint creates a long-lived connection for receiving server-side notifications:
- tools/list_changed: When available tools change
- Progress updates from long-running operations

The server will return the session ID in the Mcp-Session-Id header.
Use this session ID in POST requests to the same endpoint.`,
                tags: ['MCP'],
                hide: false,
            } as FastifySchemaWithDocs,
        },
        async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                // Get or create session
                const sessionId = request.headers['mcp-session-id'] as string | undefined;
                const session = getOrCreateSession(sessionId);

                // Setup SSE headers
                reply.raw.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
                    'Mcp-Session-Id': session.sessionId,
                });

                // Send initial endpoint event with session info
                reply.raw.write(`event: endpoint\n`);
                reply.raw.write(`data: /mcp?sessionId=${session.sessionId}\n\n`);

                // Setup notification sender for this session
                session.server.setNotificationSender((notification) => {
                    if (!reply.raw.destroyed) {
                        reply.raw.write(`event: notification\n`);
                        reply.raw.write(`data: ${JSON.stringify(notification)}\n\n`);
                    }
                });

                // Keep connection alive with periodic pings
                const pingInterval = setInterval(() => {
                    if (!reply.raw.destroyed) {
                        reply.raw.write(`:ping\n\n`);
                    } else {
                        clearInterval(pingInterval);
                    }
                }, 30000); // Ping every 30 seconds

                // Cleanup on close
                request.raw.on('close', () => {
                    clearInterval(pingInterval);
                    // Note: We don't delete the session here, as it can be reused
                    // Sessions expire after inactivity (handled by SessionStore)
                });

                // Don't call reply.raw.end() - keep connection open!
                // Return reply to signal Fastify we're handling the response
                return reply;
            } catch (error) {
                console.error('SSE connection error:', error);
                reply.code(500).send({ error: 'Internal server error' });
            }
        },
    );

    // POST /mcp - Handle JSON-RPC requests
    app.post(
        '/mcp',
        {
            schema: {
                description: `Model Context Protocol (MCP) endpoint - JSON-RPC 2.0 interface for MCP tools.

Supports two response modes:
- **JSON mode** (default): Set Content-Type: application/json
- **SSE mode**: Set Accept: text/event-stream (single response)

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
            } as FastifySchemaWithDocs,
        },
        async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const message = request.body as JSONRPCMessage;

                // Check if client wants SSE response (for compatibility - single response then close)
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
                    // SSE mode for POST: single response then close
                    reply.raw.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Mcp-Session-Id': session.sessionId,
                    });
                    reply.raw.write(`data: ${JSON.stringify(response)}\n\n`);
                    reply.raw.end();
                } else {
                    // JSON mode: standard JSON response
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

/**
 * Setup MCP config manager and event listeners
 * Call this once during server initialization
 */
function setupConfigManager(): void {
    // Get manager (auto-initializes on first call with file watching)
    const manager = getManager();

    // Listen for config changes and broadcast synchronously
    manager.on('config:changed', () => {
        console.log('Config changed - broadcasting to clients');

        // Broadcast is synchronous - queue the async notification
        sessions
            .notifyAllSessions(async (server) => {
                await server.sendToolListChangedNotification();
            })
            .catch((error) => {
                // Log but don't throw - notifications are best-effort
                console.error('Failed to broadcast tool list changed notification:', error);
            });
    });

    console.log('MCP config manager initialized with file watching');
}
