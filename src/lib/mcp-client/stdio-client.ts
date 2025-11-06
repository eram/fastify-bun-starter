/**
 * @file MCP Stdio client implementation
 * Manages MCP servers running as child processes via stdin/stdout
 */

import { ErrorEx } from '../../util/error';
import { McpClient } from './client';

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
export class StdioClient extends McpClient {
    private _process: ReturnType<typeof import('node:child_process').spawn>;
    private _buffer = '';
    private _pendingRequests = new Map<
        number,
        { resolve: (value: any) => void; reject: (reason: any) => void; timeout: NodeJS.Timeout }
    >();
    private _requestId = 1;
    private _options: Required<StdioClientOptions>;

    constructor(command: string, args: string[] = [], options: StdioClientOptions = {}) {
        super();

        this._options = {
            timeout: options.timeout ?? 30000,
            cwd: options.cwd ?? process.cwd(),
        };

        const { spawn } = require('node:child_process');

        // Spawn the MCP server process
        this._process = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
            cwd: this._options.cwd,
        });

        // Handle stdout - parse JSON-RPC messages
        this._process.stdout?.on('data', (data: Buffer) => {
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

        this._process.on('error', (err) => {
            if (this._closed) return;
            this.dispatchEvent(new CustomEvent('error', { detail: { error: err } }));
        });

        this._process.on('exit', (code) => {
            this._closed = true;
            this.dispatchEvent(
                new CustomEvent('disconnected', {
                    detail: { code },
                }),
            );

            // Reject all pending requests
            for (const [id, pending] of this._pendingRequests.entries()) {
                clearTimeout(pending.timeout);
                pending.reject(new ErrorEx(`Process exited with code ${code}`));
            }
            this._pendingRequests.clear();
        });

        // Emit connected event after a short delay to allow process to initialize
        setTimeout(() => {
            if (!this._closed) {
                this.dispatchEvent(new Event('connected'));
            }
        }, 100);
    }

    get connected(): boolean {
        return !this._closed && this._process.exitCode === null;
    }

    /**
     * Send a JSON-RPC request to the server
     * @param method - The JSON-RPC method name
     * @param params - The parameters for the method
     * @returns Promise that resolves with the result
     */
    sendRequest(method: string, params: any): Promise<any> {
        if (this._closed) {
            return Promise.reject(new ErrorEx('Client is closed'));
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

            const line = JSON.stringify(request) + '\n';
            this._process.stdin?.write(line);
        });
    }

    /**
     * Close the client and kill the process
     */
    close(): void {
        if (this._closed) return;

        this._closed = true;
        this._process.stdin?.end();
        this._process.kill();
    }
}
