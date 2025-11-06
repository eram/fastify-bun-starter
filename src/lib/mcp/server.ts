/**
 * Simplified MCP Server implementation
 * Handles JSON-RPC 2.0 protocol for Model Context Protocol
 */

import { parse } from '../validator/validator';
import type {
    CancelledNotification,
    CancelledNotificationParams,
    InitializeParams,
    InitializeResult,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    ListRootsResult,
    ProgressNotification,
    ProgressNotificationParams,
    ProgressToken,
    Root,
    RootsListChangedNotification,
    ServerInfo,
    ToolCallParams,
    ToolDefinition,
    ToolListChangedNotification,
    ToolResult,
} from './types';
import { initializeParamsSchema, JSONRPC_VERSION, MCP_PROTOCOL_VERSION, toolCallParamsSchema } from './types';

export type ToolHandler = (args: Record<string, unknown>, progressToken?: ProgressToken) => Promise<ToolResult>;

interface ToolRegistration {
    definition: ToolDefinition;
    handler: ToolHandler;
}

/**
 * Notification sender callback
 * Used to send notifications to the client
 */
export type NotificationSender = (notification: JSONRPCNotification) => void | Promise<void>;

export class MCPServer {
    private _tools: Map<string, ToolRegistration> = new Map();
    private _requestId = 0;
    private _roots: Root[] = [];
    private _pendingRequests: Map<string | number, boolean> = new Map();
    private _notificationSender?: NotificationSender;

    constructor(private _serverInfo: ServerInfo) {}

    /**
     * Set the notification sender callback
     * Must be called before using notification features
     */
    setNotificationSender(sender: NotificationSender): void {
        this._notificationSender = sender;
    }

    /**
     * Register a tool with the server
     */
    registerTool(definition: ToolDefinition, handler: ToolHandler): void {
        this._tools.set(definition.name, { definition, handler });
    }

    /**
     * Unregister a tool from the server
     * Triggers tools/list_changed notification
     */
    unregisterTool(name: string): boolean {
        const deleted = this._tools.delete(name);
        if (deleted) {
            this._sendToolListChangedNotification();
        }
        return deleted;
    }

    /**
     * Set roots for workspace awareness
     * Triggers roots/list_changed notification if roots change
     */
    setRoots(roots: Root[]): void {
        const changed = JSON.stringify(this._roots) !== JSON.stringify(roots);
        this._roots = roots;
        if (changed) {
            this._sendRootsListChangedNotification();
        }
    }

    /**
     * Get current roots
     */
    getRoots(): Root[] {
        return [...this._roots];
    }

    /**
     * Handle a JSON-RPC message
     */
    async handleMessage(message: JSONRPCMessage): Promise<JSONRPCResponse | undefined> {
        if (!this._isRequest(message)) {
            // Handle notifications (like cancelled)
            if ('method' in message && message.method === 'notifications/cancelled') {
                const params = message.params as { requestId: string | number };
                this._cancelRequest(params.requestId);
            }
            return undefined;
        }

        // Track pending request for cancellation support
        this._pendingRequests.set(message.id, true);

        try {
            const result = await this._handleRequest(message);
            this._pendingRequests.delete(message.id);
            return {
                jsonrpc: JSONRPC_VERSION,
                id: message.id,
                result,
            };
        } catch (error) {
            this._pendingRequests.delete(message.id);
            return {
                jsonrpc: JSONRPC_VERSION,
                id: message.id,
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
            serverInfo: this._serverInfo,
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
            // Check if request was cancelled before starting
            if (!this._pendingRequests.has(requestId)) {
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

    /**
     * Get next request ID
     */
    getNextRequestId(): number {
        return ++this._requestId;
    }

    /**
     * Send a progress notification
     * Used by tools to report progress during long-running operations
     */
    async sendProgress(progressToken: ProgressToken, progress: number, total?: number, message?: string): Promise<void> {
        if (!this._notificationSender) {
            return;
        }

        const notification: ProgressNotification = {
            jsonrpc: JSONRPC_VERSION,
            method: 'notifications/progress',
            params: {
                progressToken,
                progress,
                ...(total !== undefined && { total }),
                ...(message !== undefined && { message }),
            } as ProgressNotificationParams,
        };

        await this._notificationSender(notification);
    }

    /**
     * Cancel a request
     * Sends a cancelled notification to the client
     */
    async cancelRequest(requestId: string | number, reason?: string): Promise<void> {
        this._cancelRequest(requestId);

        if (!this._notificationSender) {
            return;
        }

        const notification: CancelledNotification = {
            jsonrpc: JSONRPC_VERSION,
            method: 'notifications/cancelled',
            params: {
                requestId,
                ...(reason !== undefined && { reason }),
            } as CancelledNotificationParams,
        };

        await this._notificationSender(notification);
    }

    /**
     * Check if a request is still pending (not cancelled)
     */
    isRequestPending(requestId: string | number): boolean {
        return this._pendingRequests.has(requestId);
    }

    /**
     * Internal cancellation - just marks request as cancelled
     */
    private _cancelRequest(requestId: string | number): void {
        this._pendingRequests.delete(requestId);
    }

    /**
     * Send tools/list_changed notification
     * Public method to allow external triggers (e.g., config changes)
     */
    async sendToolListChangedNotification(): Promise<void> {
        if (!this._notificationSender) {
            return;
        }

        const notification: ToolListChangedNotification = {
            jsonrpc: JSONRPC_VERSION,
            method: 'notifications/tools/list_changed',
        };

        await this._notificationSender(notification);
    }

    /**
     * Send tools/list_changed notification (private wrapper)
     */
    private async _sendToolListChangedNotification(): Promise<void> {
        await this.sendToolListChangedNotification();
    }

    /**
     * Send roots/list_changed notification
     */
    private async _sendRootsListChangedNotification(): Promise<void> {
        if (!this._notificationSender) {
            return;
        }

        const notification: RootsListChangedNotification = {
            jsonrpc: JSONRPC_VERSION,
            method: 'notifications/roots/list_changed',
        };

        await this._notificationSender(notification);
    }

    /**
     * Send a generic notification to the client
     * Used for custom notifications like tools/list_changed
     */
    async sendNotification(method: string, params?: unknown): Promise<void> {
        if (!this._notificationSender) {
            return;
        }

        const notification: JSONRPCNotification = {
            jsonrpc: JSONRPC_VERSION,
            method,
            ...(params !== undefined && { params }),
        };

        await this._notificationSender(notification);
    }
}
