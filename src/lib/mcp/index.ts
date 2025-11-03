/**
 * MCP (Model Context Protocol) Library
 * Based on the official MCP TypeScript SDK v1.21.0
 * From https://github.com/modelcontextprotocol/typescript-sdk
 *
 * Differences from official SDK:
 * 1. Simplified to core JSON-RPC 2.0 protocol features:
 *   - Implements core methods: initialize, tools/list, tools/call, process, cancelation, change
 *      notif and roots.
 *   - Official SDK supports also:  completions, ResourceLinks, resources, prompts, sampling, logging, elicitation, etc. (see below)
 *   - No Protocol class inheritance - direct JSON-RPC message handling
 *   - No capability negotiation beyond basic tools support
 *   - No advanced features: OAuth, etc.
 *
 * 2. Custom session management vs SDK transport layers:
 *   - Official SDK: Separate transport classes (StdioServerTransport, StreamableHTTPServerTransport, SSEServerTransport)
 *   - Official SDK: Built-in session management with sessionIdGenerator, DNS rebinding protection, CORS support
 *   - Official SDK: Complex transport lifecycle (connect, disconnect, request routing, SSE streaming)
 *   - This implementation: Simple SessionStore class managing Map<sessionId, MCPServer>
 *   - This implementation: Session lifecycle in HTTP route handler (create on init, reuse via header)
 *   - This implementation: No transport abstraction - directly handles HTTP requests in Fastify
 *   - This implementation: Manual session ID generation and cleanup (no automatic lifecycle)
 */

export { MCPServer } from './server';
export type { SessionData } from './session';
export { SessionStore } from './session';
export { startStdioServer } from './stdio';
export { registerAllTools, registerHealthTool, registerNumberFormatTool } from './tools';
export type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, ServerInfo, ToolDefinition, ToolResult } from './types';


/*** FOR FUTURE EXPANSION ***
 * Additional MCP features NOT implemented in this simplified version:
 *
 * 1. Resources (file/data access)
 * What it is: Expose readable data/files to LLMs (like config files, database records, file system)
 * When needed: When LLMs need to READ data before taking actions
 * Example: file://project/README.md, db://users/123, config://app
 *
 * 2. Prompts (reusable templates)
 * What it is: Pre-defined prompt templates with parameters (like slash commands)
 * When needed: To help users quickly invoke common AI workflows
 * Example: /review-code {filename} → "Please review this code for best practices..."
 *
 * 3. Sampling (LLM requests)
 * What it is: MCP server can REQUEST the LLM to generate completions
 * When needed: When tools need AI assistance to complete their work
 * Example: A "summarize" tool that asks the LLM to summarize text
 *
 * 4. Logging (structured logs)
 * What it is: Servers send log messages to clients for debugging
 * When needed: Production debugging, monitoring tool execution
 * Example: [INFO] Fetching data from API..., [ERROR] Connection failed
 *
 * 5. Completions (autocomplete)
 * What it is: Suggest parameter values as user types
 * When needed: Better UX for complex tools with many options
 * Example: Typing "New Y" → suggests "New York", "New Zealand"
 *
 */