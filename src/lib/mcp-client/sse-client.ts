/**
 * @file MCP SSE client implementation
 * Uses SSESession from resilient-client for Server-Sent Events transport
 */

import { ErrorEx } from '../../util/error';
import { type ClientOptions, ResilientClient, type SSESession } from '../../util/resilient-client';
import { McpClient, type McpInitializeParams } from './client';

/**
 * Options for SseClient
 */
export interface SseClientOptions extends Partial<ClientOptions> {
    /** SSE endpoint path (default: '/sse') */
    endpoint?: string;
    /** User agent string (e.g., 'mcp-sse-client/1.0.0') */
    userAgent?: string;
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
export class SseClient extends McpClient {
	private _session?: SSESession;
	private _client: ResilientClient;
	private _endpoint: string;

	constructor(url: string, options: SseClientOptions = {}) {
		super();

		const { endpoint, ...clientOptions } = options;
		this._endpoint = endpoint ?? '/sse';

		this._client = new ResilientClient(url, {
			afterFn: 'sse',
			timeout: 30000,
			...clientOptions,
		});
	}    /**
     * Connect to the SSE server and initialize MCP session
     * @param params - MCP initialization parameters
     */
    async connect(params?: McpInitializeParams): Promise<void> {
        if (this._session) {
            throw new ErrorEx('Already connected');
        }

		// Create SSE session
		this._session = await this._client.fetch<SSESession>(this._endpoint, { method: 'GET' });        // Forward events from SSESession to this client
        this._session.addEventListener('connected', () => this.dispatchEvent(new Event('connected')));
        this._session.addEventListener('disconnected', () => this.dispatchEvent(new Event('disconnected')));
        this._session.addEventListener('error', (e) => this.dispatchEvent(e));

        // Wait for session ID and endpoint
        let attempts = 0;
        while ((!this._session.sessionId || !this._session.endpoint) && attempts < 50) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            attempts++;
        }

        if (!this._session.sessionId || !this._session.endpoint) {
            throw new ErrorEx('Failed to establish SSE session');
        }

        // Initialize MCP session if params provided
        if (params) {
            await this.initialize(params);
        }
    }

    get connected(): boolean {
        return this._session?.connected ?? false;
    }

    /**
     * Send a JSON-RPC request to the server
     */
    sendRequest(method: string, params: any): Promise<any> {
        if (!this._session) {
            return Promise.reject(new ErrorEx('Not connected'));
        }

        return this._session.sendRequest(method, params);
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
