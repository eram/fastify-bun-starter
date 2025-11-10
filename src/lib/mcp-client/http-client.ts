/**
 * @file MCP HTTP client implementation
 * Uses ResilientClient for HTTP JSON-RPC transport
 */

import { ResilientClient } from '../../util';
import { type JSONRPCRequest, type JSONRPCResponse, McpError, type ToolDefinition, type ToolResult } from '../mcp-server';
import { type MCPClient, validators as v } from './client';

/**
 * HTTP client for MCP servers.
 * Uses JSON-RPC 2.0 over HTTP POST requests.
 *
 * Note: HTTP is stateless, so connection events are synthetic:
 * - 'connected' fires immediately after instantiation
 * - 'disconnected' fires when close() is called
 * - 'error' fires on request errors
 */
export class HttpClient extends EventTarget implements MCPClient {
    private _client: ResilientClient;
    private _reqId = 0;

    /** Reference count tracking how many tools use this connection */
    refCount = 0;

    constructor(url: string, options: { timeout?: number; maxTries?: number } = {}) {
        super();
        this._client = new ResilientClient(url, {
            timeout: options.timeout ?? 30000,
            maxTries: options.maxTries ?? 3,
        });

        // Emit synthetic 'connected' event since HTTP is always ready
        setImmediate(() => {
            this.dispatchEvent(new Event('connected'));
        });
    }

    /**
     * Connect to the HTTP server
     * HTTP is stateless, so this is a no-op but kept for interface consistency
     */
    async connect(): Promise<void> {
        // HTTP is stateless - no connection setup needed
        // Already dispatched 'connected' in constructor
    }

    get connected(): boolean {
        return true; // HTTP client is always "connected" (stateless)
    }

    private async _sendRequest<T>(method: string, params?: unknown): Promise<T> {
        const req: JSONRPCRequest = {
            jsonrpc: '2.0',
            id: ++this._reqId,
            method,
            ...(params ? { params: params as Record<string, unknown> } : {}),
        };

        try {
            const res = await this._client.fetch<JSONRPCResponse>('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req),
            });

            if ('error' in res && res.error) {
                throw new McpError(`JSON-RPC error: ${res.error.message}`, res.error.code);
            }

            return res.result as T;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));
            throw new McpError(err.message);
        }
    }

    /**
     * List available tools from the MCP server
     */
    async listTools(): Promise<ToolDefinition[]> {
        const result = await this._sendRequest<{ tools: unknown[] }>('tools/list');
        return v.list.parse(result.tools);
    }

    /**
     * Call a tool on the MCP server
     */
    async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
        const result = await this._sendRequest('tools/call', { name: toolName, arguments: args });
        return v.result.parse(result);
    }

    close(): void {
        ResilientClient.clearPool();
        this.dispatchEvent(new Event('disconnected'));
    }
}
