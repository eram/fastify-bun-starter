/* istanbul ignore file */
/**
 * MCP (Model Context Protocol) types and validation schemas
 * Based on MCP specification with adaptations for this project
 * Schemas are the source of truth - types are inferred from them
 */

import { ErrorEx } from '../../util';
import { array, boolean, type Infer, literal, number, object, record, string, union } from '../validator';

// Constants
export const JSONRPC_VERSION = '2.0';
export const MCP_PROTOCOL_VERSION = '2024-11-05';

// Error codes
export enum ErrorCode {
    PARSE_ERROR = -32700,
    INVALID_REQUEST = -32600,
    METHOD_NOT_FOUND = -32601,
    INVALID_PARAMS = -32602,
    INTERNAL_ERROR = -32603,
}

// JSON-RPC base types
export interface JSONRPCRequest {
    jsonrpc: typeof JSONRPC_VERSION;
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
    jsonrpc: typeof JSONRPC_VERSION;
    id: string | number;
    result?: unknown;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

export interface JSONRPCNotification {
    jsonrpc: typeof JSONRPC_VERSION;
    method: string;
    params?: Record<string, unknown> | unknown;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// Validation schemas for MCP types
export const serverInfoSchema = {
    name: string(),
    version: string(),
};

export type ServerInfo = Infer<typeof serverInfoSchema>;

export const rootSchema = {
    uri: string(),
    name: string().optional(),
};

export type Root = Infer<typeof rootSchema>;

export const toolResultContentSchema = {
    type: literal('text'),
    text: string(),
};

export const cancelledNotifParamsSchema = {
    requestId: union([string(), number()] as const),
    reason: string().optional(),
};

export type CancelledNotificationParams = Infer<typeof cancelledNotifParamsSchema>;

export const initializeParamsSchema = {
    protocolVersion: string(),
    capabilities: record(),
    clientInfo: object(serverInfoSchema),
};

export type InitializeParams = Infer<typeof initializeParamsSchema>;

export const initializeResultSchema = {
    protocolVersion: string(),
    capabilities: object({
        tools: record().optional(),
        roots: object({
            listChanged: boolean().optional(),
        }).optional(),
    }),
    serverInfo: object(serverInfoSchema),
};

export type InitializeResult = Infer<typeof initializeResultSchema>;

export const listRootsResultSchema = {
    roots: array(object(rootSchema)),
};

export type ListRootsResult = Infer<typeof listRootsResultSchema>;

export const progressNotifParamsSchema = {
    progressToken: union([string(), number()] as const),
    progress: number(),
    total: number().optional(),
    message: string().optional(),
};

export type ProgressNotificationParams = Infer<typeof progressNotifParamsSchema>;

export const toolCallParamsSchema = {
    name: string(),
    arguments: object().optional(),
    // biome-ignore lint/style/useNamingConvention: _meta is part of MCP spec
    _meta: object({
        progressToken: union([string(), number()] as const).optional(),
    }).optional(),
};

export type ToolCallParams = Infer<typeof toolCallParamsSchema>;

export const toolDefinitionSchema = object({
    name: string(),
    description: string(),
    inputSchema: object().passthrough(), // Allow any JSON object structure
});

export type ToolDefinition = Infer<typeof toolDefinitionSchema>;

export const toolResultSchema = object({
    content: array(object(toolResultContentSchema)),
    isError: boolean().optional(),
});

export type ToolResult = Infer<typeof toolResultSchema>;

// Inferred types from schemas
export type Progress = {
    progress: number;
    total?: number;
    message?: string;
};
export type ProgressToken = string | number;

// Specific notification types
export interface CancelledNotification extends JSONRPCNotification {
    method: 'notifications/cancelled';
    params: CancelledNotificationParams;
}

export interface ProgressNotification extends JSONRPCNotification {
    method: 'notifications/progress';
    params: ProgressNotificationParams;
}

export interface PromptListChangedNotification extends JSONRPCNotification {
    method: 'notifications/prompts/list_changed';
    params?: Record<string, unknown>;
}

export interface ResourceListChangedNotification extends JSONRPCNotification {
    method: 'notifications/resources/list_changed';
    params?: Record<string, unknown>;
}

export interface RootsListChangedNotification extends JSONRPCNotification {
    method: 'notifications/roots/list_changed';
    params?: Record<string, unknown>;
}

export interface ToolListChangedNotification extends JSONRPCNotification {
    method: 'notifications/tools/list_changed';
    params?: Record<string, unknown>;
}

/**
 * McpError - Custom error class for MCP operations
 *
 * Extends ErrorEx to provide MCP-specific error handling
 * with proper error chaining and serialization support.
 *
 * Usage:
 *   throw new McpError('Server not found');
 *   throw new McpError(err); // Wraps another error
 *   return [undefined, new McpError(err)]; // For [data, error] tuples
 */
export class McpError extends ErrorEx {}
