/**
 * @file MCP SSE client implementation
 * Uses SSESession from resilient-client for Server-Sent Events transport
 */

import { sleep } from '../../util';
import { ErrorEx } from '../../util/error';
import { type ClientOptions, ResilientClient, type SSESession } from '../../util/resilient-client';
import type { ToolDefinition, ToolResult } from '../mcp-server';
import { type MCPClient, type McpInitializeParams, validators as v } from './client';

/**
 * Options for SseClient
 */
export interface SseClientOptions extends Partial<ClientOptions> {
    /** SSE endpoint path (default: '/sse') */
    endpoint?: string;
    /** User agent string (e.g., 'mcp-sse-client/1.0.0') */
    userAgent?: string;
    /** Client capabilities */
    capabilities?: Record<string, unknown>;
    /** Client info (name and version) */
    clientInfo?: { name: string; version: string };
}

/**
 * SSE (Server-Sent Events) client for MCP servers.
 * Uses SSESession from resilient-client for reliable SSE connection management.
 *
 * Events emitted (inherited from SSESession):
 * - 'connected': When connection is established
 * - 'disconnected': When connection is closed
 * - 'reconnecting': When attempting to reconnect
 * - 'session-changed': When session ID changes
 * - 'error': When an error occurs
 * - 'sse:{eventType}': For each SSE event received
 */
export class SseClient extends EventTarget implements MCPClient {
    private _session?: SSESession;
    private _client: ResilientClient;
    private _endpoint: string;
    private _initParams: McpInitializeParams;
    private _closed = false;

    /** Reference count tracking how many tools use this connection */
    refCount = 0;

    constructor(url: string, options: SseClientOptions = {}) {
        super();
        const { endpoint, capabilities, clientInfo, ...clientOptions } = options;
        this._endpoint = endpoint ?? '/sse';

        // Store initialization parameters with MCP protocol version
        this._initParams = {
            protocolVersion: '2024-11-05',
            capabilities: capabilities ?? {},
            clientInfo: clientInfo ?? { name: 'mcp-client', version: '1.0.0' },
        };

        this._client = new ResilientClient(url, {
            afterFn: 'sse',
            timeout: 30000,
            ...clientOptions,
        });
    }

    /**
     * Connect to the SSE server and initialize MCP session
     */
    async connect(): Promise<void> {
        if (this._session) {
            throw new ErrorEx('Already connected');
        }

        // Create SSE session
        this._session = await this._client.fetch<SSESession>(this._endpoint, { method: 'GET' });

        // Forward events from SSESession to this client
        this._session.addEventListener('connected', () => this.dispatchEvent(new Event('connected')));
        this._session.addEventListener('disconnected', () => this.dispatchEvent(new Event('disconnected')));
        this._session.addEventListener('error', (e) => this.dispatchEvent(e));

        // Wait for session ID and endpoint
        let attempts = 0;
        while ((!this._session.sessionId || !this._session.endpoint) && attempts < 50) {
            await sleep(100);
            attempts++;
        }

        if (!this._session.sessionId || !this._session.endpoint) {
            throw new ErrorEx('Failed to establish SSE session');
        }

        // Initialize MCP session with stored params
        await this.sendRequest('initialize', this._initParams);
    }

    get connected(): boolean {
        return this._session?.connected ?? false;
    }

    /**
     * Send a JSON-RPC request to the server
     */
    sendRequest(method: string, params: unknown): Promise<unknown> {
        if (!this._session) {
            return Promise.reject(new ErrorEx('Not connected'));
        }

        return this._session.sendRequest(method, params);
    }

    /**
     * List available tools from the MCP server
     */
    async listTools(): Promise<ToolDefinition[]> {
        const result = (await this.sendRequest('tools/list', undefined)) as { tools: unknown[] };
        return v.list.parse(result.tools);
    }

    /**
     * Call a tool on the MCP server
     */
    async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
        const result = (await this.sendRequest('tools/call', {
            name: toolName,
            arguments: args,
        })) as unknown;

        return v.result.parse(result);
    }

    /**
     * Close the SSE connection
     */
    close(): void {
        if (this._closed) return;

        this._closed = true;
        if (this._session) {
            this._session.close();
            this._session = undefined;
        }
    }

    /**
     * Get the current session ID
     */
    get sessionId(): string | undefined {
        return this._session?.sessionId;
    }

    /**
     * Get the current endpoint URL
     */
    get endpoint(): string | undefined {
        return this._session?.endpoint;
    }
}
