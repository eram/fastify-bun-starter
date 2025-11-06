/**
 * @file Base MCP client class
 * Provides common functionality for all MCP transport implementations
 */

import type { ErrorEx } from '../../util/error';

/**
 * MCP initialization parameters
 */
export interface McpInitializeParams {
    protocolVersion: string;
    capabilities: Record<string, any>;
    clientInfo: {
        name: string;
        version: string;
    };
}

/**
 * MCP tool definition
 */
export interface McpTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

/**
 * MCP tool call result
 */
export interface McpToolResult {
    content: Array<{
        type: string;
        text: string;
    }>;
    isError: boolean;
}

/**
 * Base MCP client interface
 */
export interface IMcpClient {
    /** Check if client is connected */
    readonly connected: boolean;

    /** Check if client is closed */
    readonly closed: boolean;

    /**
     * Initialize the MCP session
     * @param params - Initialization parameters
     */
    initialize(params: McpInitializeParams): Promise<any>;

    /**
     * Get list of available tools
     */
    getTools(): Promise<McpTool[]>;

    /**
     * Call a tool with arguments
     * @param name - Tool name
     * @param args - Tool arguments
     */
    callTool(name: string, args: Record<string, any>): Promise<McpToolResult>;

    /**
     * Send a raw JSON-RPC request
     * @param method - JSON-RPC method name
     * @param params - Method parameters
     */
    sendRequest(method: string, params: any): Promise<any>;

    /**
     * Close the client connection
     */
    close(): void;

    /**
     * Add event listener
     */
    addEventListener(type: string, listener: EventListener): void;

    /**
     * Remove event listener
     */
    removeEventListener(type: string, listener: EventListener): void;
}

/**
 * Base MCP client class with common functionality
 */
export abstract class McpClient extends EventTarget implements IMcpClient {
    protected _closed = false;

    abstract get connected(): boolean;

    get closed(): boolean {
        return this._closed;
    }

    /**
     * Initialize the MCP session
     */
    async initialize(params: McpInitializeParams): Promise<any> {
        return this.sendRequest('initialize', params);
    }

    /**
     * Get list of available tools
     */
    async getTools(): Promise<McpTool[]> {
        const result = await this.sendRequest('tools/list', {});
        return result.tools || [];
    }

    /**
     * Call a tool with arguments
     */
    async callTool(name: string, args: Record<string, any>): Promise<McpToolResult> {
        return this.sendRequest('tools/call', {
            name,
            arguments: args,
        });
    }

    /**
     * Send a raw JSON-RPC request (must be implemented by subclass)
     */
    abstract sendRequest(method: string, params: any): Promise<any>;

    /**
     * Close the client connection (must be implemented by subclass)
     */
    abstract close(): void;
}
