/**
 * @file MCP Stdio client implementation
 * Manages MCP servers running as child processes via stdin/stdout
 */

import { ErrorEx } from '../../util/error';
import type { ToolDefinition, ToolResult } from '../mcp-server';
import { type MCPClient, validators as v } from './client';

/**
 * Options for StdioClient
 */
export interface StdioClientOptions {
    /** Request timeout in milliseconds (default: 30000) */
    timeout?: number;
    /** Working directory for the spawned process */
    cwd?: string;
}

/**
 * Stdio (Standard Input/Output) client for MCP servers running as child processes.
 * Extends EventTarget to emit events for lifecycle and JSON-RPC messages.
 *
 * Events emitted:
 * - 'connected': When process is spawned and ready
 * - 'disconnected': When process exits (detail: { code: number | null })
 * - 'error': When an error occurs (detail: { error: Error })
 * - 'message': For each JSON-RPC message received (detail: message object)
 */
export class StdioClient extends EventTarget implements MCPClient {
    private _process?: ReturnType<typeof import('node:child_process').spawn>;
    private _buffer = '';
    private _pendingRequests = new Map<
        number,
        { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timeout: NodeJS.Timeout }
    >();
    private _requestId = 1;
    private _options: Required<StdioClientOptions>;
    private _command: string;
    private _args: string[];
    private _closed = false;

    /** Reference count tracking how many tools use this connection */
    refCount = 0;

    constructor(command: string, args: string[] = [], options: StdioClientOptions = {}) {
        super();

        this._command = command;
        this._args = args;
        this._options = {
            timeout: options.timeout ?? 30000,
            cwd: options.cwd ?? process.cwd(),
        };
    }

    /**
     * Connect to the stdio server by spawning the process
     */
    async connect(): Promise<void> {
        if (this._process) {
            throw new ErrorEx('Process already spawned');
        }

        const { spawn } = require('node:child_process');

        // Spawn the MCP server process
        this._process = spawn(this._command, this._args, {
            stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
            cwd: this._options.cwd,
        });

        if (!this._process) {
            throw new ErrorEx('Failed to spawn process');
        }

        const process = this._process; // Capture for type narrowing

        // Handle stdout - parse JSON-RPC messages
        process.stdout?.on('data', (data: Buffer) => {
            if (!this._process) return;
            this._buffer += data.toString();

            // Process complete JSON-RPC messages (one per line in stdio)
            const lines = this._buffer.split('\n');
            this._buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const message = JSON.parse(line);
                    this.dispatchEvent(new CustomEvent('message', { detail: message }));

                    // Handle response to pending request
                    if (message.id !== undefined && this._pendingRequests.has(message.id)) {
                        const pending = this._pendingRequests.get(message.id)!;
                        this._pendingRequests.delete(message.id);
                        clearTimeout(pending.timeout);

                        if (message.error) {
                            pending.reject(new ErrorEx(`JSON-RPC error: ${JSON.stringify(message.error)}`));
                        } else {
                            pending.resolve(message.result);
                        }
                    }
                } catch (err) {
                    const error = err instanceof Error ? err : new ErrorEx(`Failed to parse JSON: ${line}`);
                    this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
                }
            }
        });

        process.on('error', (err) => {
            if (this._closed) return;
            this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));
        });

        process.on('exit', (code) => {
            this._closed = true;
            this.dispatchEvent(
                new CustomEvent('disconnected', {
                    detail: { code },
                }),
            );

            // Reject all pending requests
            for (const [_id, pending] of this._pendingRequests.entries()) {
                clearTimeout(pending.timeout);
                pending.reject(new ErrorEx(`Process exited with code ${code}`));
            }
            this._pendingRequests.clear();
        });

        setImmediate(() => {
            this.dispatchEvent(new Event('connected'));
        });
    }

    get connected(): boolean {
        return !this._closed && this._process !== undefined && this._process.exitCode === null;
    }

    /**
     * Send a JSON-RPC request to the server
     * @param method - The JSON-RPC method name
     * @param params - The parameters for the method
     * @returns Promise that resolves with the result
     */
    sendRequest(method: string, params: unknown): Promise<unknown> {
        if (this._closed) {
            return Promise.reject(new ErrorEx('Client is closed'));
        }
        if (!this._process) {
            return Promise.reject(new ErrorEx('Client not connected - call connect() first'));
        }

        return new Promise((resolve, reject) => {
            const id = this._requestId++;

            const timeoutHandle = setTimeout(() => {
                if (this._pendingRequests.has(id)) {
                    this._pendingRequests.delete(id);
                    reject(new ErrorEx(`Request timeout for method: ${method}`));
                }
            }, this._options.timeout);

            this._pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });

            const request = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };

            const line = `${JSON.stringify(request)}\n`;
            this._process!.stdin?.write(line);
        });
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
     * Close the client and kill the process
     */
    close(): void {
        if (this._closed) return;

        this._closed = true;
        if (this._process) {
            this._process.stdin?.end();
            this._process.kill();
        }
    }
}
