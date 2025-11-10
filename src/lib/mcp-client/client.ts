/**
 * @file MCP client types and interfaces
 * Common types shared across all MCP transport implementations
 */

import type { ToolDefinition, ToolResult } from '../mcp-server';
import { type ArrV, array, type Validator } from '../validator';

/**
 * Shared validators for MCP responses
 * Lazy initialization to avoid circular dependency
 */
let _validators: { list: ArrV<ToolDefinition>; result: Validator<ToolResult> } | undefined;

/** Initialize validators on first access */
function initValidators() {
    if (!_validators) {
        const { toolDefinitionSchema, toolResultSchema } = require('../mcp-server');
        _validators = {
            list: array(toolDefinitionSchema),
            result: toolResultSchema,
        };
    }
}

export const validators = {
    get list(): ArrV<ToolDefinition> {
        initValidators();
        return _validators!.list;
    },
    get result(): Validator<ToolResult> {
        initValidators();
        return _validators!.result;
    },
} as const;

/**
 * Event detail for 'error' events
 */
export interface MCPClientErrorDetail {
    error: Error;
}

/**
 * Event detail for 'disconnected' events (stdio only)
 */
export interface MCPClientDisconnectedDetail {
    code: number | null;
}

/**
 * Event callback types for MCP clients
 *
 * All clients extend EventTarget and emit lifecycle events:
 * - **connected**: Fired when connection is established
 * - **disconnected**: Fired when connection is closed
 * - **error**: Fired when an error occurs (detail: { error: Error })
 *
 * Additional transport-specific events:
 * - **stdio**: 'message' for each JSON-RPC message received
 * - **sse**: 'reconnecting', 'session-changed', 'sse:{eventType}'
 * - **http**: Uses synthetic events (connected fires immediately, disconnected on close)
 */
export type MCPClientEventMap = {
    /** Fired when client successfully connects */
    connected: Event;
    /** Fired when client disconnects (detail varies by transport) */
    disconnected: CustomEvent<MCPClientDisconnectedDetail> | Event;
    /** Fired when an error occurs */
    error: CustomEvent<MCPClientErrorDetail>;
    /** Fired when reconnecting (SSE only) */
    reconnecting?: Event;
    /** Fired when session ID changes (SSE only) */
    'session-changed'?: Event;
    /** Fired for each JSON-RPC message (stdio only) */
    message?: CustomEvent<unknown>;
};

/**
 * Common MCP Client interface for all transports
 * Provides a unified API for stdio, SSE, and HTTP clients
 */
export interface MCPClient {
    /** Connect to the MCP server */
    connect(): Promise<void>;

    /** Check if client is connected */
    readonly connected: boolean;

    /** Reference count tracking how many tools use this connection */
    refCount: number;

    /** List available tools from the MCP server */
    listTools(): Promise<ToolDefinition[]>;

    /** Call a tool on the MCP server */
    callTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult>;

    /** Close the client connection */
    close(): Promise<void> | void;

    /** Add event listener (inherited from EventTarget) */
    addEventListener<K extends keyof MCPClientEventMap>(
        type: K,
        listener: (event: MCPClientEventMap[K]) => void,
        options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;

    /** Remove event listener (inherited from EventTarget) */
    removeEventListener<K extends keyof MCPClientEventMap>(
        type: K,
        listener: (event: MCPClientEventMap[K]) => void,
        options?: boolean | EventListenerOptions,
    ): void;
    removeEventListener(type: string, listener: EventListener, options?: boolean | EventListenerOptions): void;

    /** Dispatch event (inherited from EventTarget) */
    dispatchEvent(event: Event): boolean;
}

/**
 * MCP initialization parameters
 */
export interface McpInitializeParams {
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    clientInfo: {
        name: string;
        version: string;
    };
}
