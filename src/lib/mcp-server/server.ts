/**
 * Simplified MCP Server implementation
 * Handles JSON-RPC 2.0 protocol for Model Context Protocol
 */

import { logger } from '../../util';
import { connectionPool } from '../mcp-client';
import { parse } from '../validator';
import type {
    CancelledNotificationParams,
    InitializeParams,
    InitializeResult,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    ListRootsResult,
    ProgressNotificationParams,
    ProgressToken,
    Root,
    ServerInfo,
    ToolCallParams,
    ToolDefinition,
    ToolResult,
} from './types';
import { initializeParamsSchema, JSONRPC_VERSION, MCP_PROTOCOL_VERSION, toolCallParamsSchema } from './types';

export type ToolHandler = (args: Record<string, unknown>, progressToken?: ProgressToken) => Promise<ToolResult>;
export type ToolCleanup = () => Promise<void>;

interface ToolRegistration {
    definition: ToolDefinition;
    handler: ToolHandler;
    cleanup: ToolCleanup;
}

export type NotificationSender = (notification: JSONRPCNotification) => void;

export class MCPServer {
    private _tools = new Map<string, ToolRegistration>();
    private _reqId = 0;
    private _roots: Root[] = [];
    private _pending = new Map<string | number, boolean>();
    private _emit?: NotificationSender;

    constructor(
        private _info: ServerInfo,
        private _log = logger,
    ) {}

    setEmitter(fn: NotificationSender): void {
        this._emit = fn;
    }

    register(def: ToolDefinition, handler: ToolHandler, cleanup: ToolCleanup): void {
        const existing = this._tools.get(def.name);
        if (existing) {
            existing.cleanup().catch((err: Error) => {
                this._log.error(`Error cleaning up tool ${def.name}:`, err);
            });
        }
        this._tools.set(def.name, { definition: def, handler, cleanup });
    }

    unregister(name: string): boolean {
        const existing = this._tools.get(name);
        if (!existing) return false;

        existing.cleanup().catch((err: Error) => {
            this._log.error(`Error cleaning up tool ${name}:`, err);
        });

        this._tools.delete(name);
        this._emitToolListChanged();
        return true;
    }

    /**
     * Close the MCP server and cleanup all registered tools
     * @param force - If true, also force close all MCP client connections regardless of refCount
     */
    async close(force = false): Promise<void> {
        const tasks = Array.from(this._tools.entries()).map(([name, reg]) =>
            reg.cleanup().catch((err: Error) => this._log.error(`Cleanup error for ${name}:`, err)),
        );
        await Promise.all(tasks);
        this._tools.clear();

        // Force close all MCP connections if requested
        if (force) {
            await connectionPool.closeAll();
        }
    }

    /**
     * Get tool definitions for a specific server name prefix
     * Used to count tools registered from MCP servers (e.g., "serverName:toolName")
     */
    getToolsByPrefix(prefix: string): ToolDefinition[] {
        const tools: ToolDefinition[] = [];
        const searchPrefix = `${prefix}:`;

        for (const [name, registration] of this._tools.entries()) {
            if (name.startsWith(searchPrefix)) {
                tools.push(registration.definition);
            }
        }

        return tools;
    }

    async handleMessage(msg: JSONRPCMessage): Promise<JSONRPCResponse | undefined> {
        if (!this._isRequest(msg)) {
            if ('method' in msg && msg.method === 'notifications/cancelled') {
                const params = msg.params as { requestId: string | number };
                this._cancel(params.requestId);
            }
            return undefined;
        }

        this._pending.set(msg.id, true);

        try {
            const result = await this._handleRequest(msg);
            this._pending.delete(msg.id);
            return { jsonrpc: JSONRPC_VERSION, id: msg.id, result };
        } catch (error) {
            this._pending.delete(msg.id);
            return {
                jsonrpc: JSONRPC_VERSION,
                id: msg.id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : 'Unknown error',
                    data: error instanceof Error ? error.stack : undefined,
                },
            };
        }
    }

    /**
     * Handle a specific request
     */
    private async _handleRequest(request: JSONRPCRequest): Promise<unknown> {
        switch (request.method) {
            case 'initialize': {
                const params = parse(initializeParamsSchema, request.params) as InitializeParams | undefined;
                if (!params) {
                    throw new Error('Invalid initialize parameters');
                }
                return this._handleInitialize(params);
            }
            case 'tools/list':
                return this._handleListTools();
            case 'tools/call': {
                const params = parse(toolCallParamsSchema, request.params) as ToolCallParams | undefined;
                if (!params) {
                    throw new Error('Invalid tool call parameters');
                }
                return this._handleCallTool(params, request.id);
            }
            case 'roots/list':
                return this._handleListRoots();
            default:
                throw new Error(`Method not found: ${request.method}`);
        }
    }

    /**
     * Handle initialize request
     */
    private async _handleInitialize(_params: InitializeParams): Promise<InitializeResult> {
        return {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
                tools: new Map(),
                roots: {
                    listChanged: true, // We support roots/list_changed notifications
                },
            },
            serverInfo: this._info,
        };
    }

    /**
     * Handle tools/list request
     */
    private async _handleListTools(): Promise<{ tools: ToolDefinition[] }> {
        const tools = Array.from(this._tools.values()).map((t) => t.definition);
        return { tools };
    }

    /**
     * Handle tools/call request
     */
    private async _handleCallTool(params: ToolCallParams, requestId: string | number): Promise<ToolResult> {
        const tool = this._tools.get(params.name);

        if (!tool) {
            throw new Error(`Tool not found: ${params.name}`);
        }

        // Extract progressToken from _meta if present
        const meta = (params as unknown as Record<string, unknown>)._meta as { progressToken?: ProgressToken } | undefined;
        const progressToken = meta?.progressToken;

        try {
            if (!this._pending.has(requestId)) {
                throw new Error('Request was cancelled');
            }
            return await tool.handler(params.arguments || {}, progressToken);
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error calling tool: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }

    /**
     * Handle roots/list request
     */
    private async _handleListRoots(): Promise<ListRootsResult> {
        return { roots: this._roots };
    }

    /**
     * Type guard to check if message is a request
     */
    private _isRequest(message: JSONRPCMessage): message is JSONRPCRequest {
        return 'id' in message && 'method' in message;
    }

    nextId(): number {
        return ++this._reqId;
    }

    private _cancel(id: string | number): void {
        this._pending.delete(id);
    }

    private _emitToolListChanged(): void {
        this.emitToolListChanged();
    }

    emitToolListChanged(): void {
        this._emit?.({
            jsonrpc: JSONRPC_VERSION,
            method: 'notifications/tools/list_changed',
        });
    }

    sendProgress(token: ProgressToken, progress: number, total?: number, msg?: string): void {
        this._emit?.({
            jsonrpc: JSONRPC_VERSION,
            method: 'notifications/progress',
            params: {
                progressToken: token,
                progress,
                ...(total !== undefined && { total }),
                ...(msg && { message: msg }),
            } as ProgressNotificationParams,
        });
    }

    cancelRequest(reqId: string | number, reason?: string): void {
        this._cancel(reqId);
        this._emit?.({
            jsonrpc: JSONRPC_VERSION,
            method: 'notifications/cancelled',
            params: { requestId: reqId, ...(reason && { reason }) } as CancelledNotificationParams,
        });
    }

    isPending(id: string | number): boolean {
        return this._pending.has(id);
    }

    setRoots(roots: Root[]): void {
        const changed = JSON.stringify(this._roots) !== JSON.stringify(roots);
        this._roots = roots;
        if (changed) {
            this._emit?.({ jsonrpc: JSONRPC_VERSION, method: 'notifications/roots/list_changed' });
        }
    }

    getRoots(): Root[] {
        return [...this._roots];
    }
}
