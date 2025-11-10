/**
 * MCP Client Connection Pool
 * Manages a pool of MCP client connections with reference counting
 */

import type { MCPClient } from './client';

/**
 * Connection pool for managing MCP client connections
 * Extends Map to provide connection-specific cleanup functionality
 */
class MCPConnectionPool extends Map<string, MCPClient> {
    /**
     * Close all connections in the pool and clear the map
     * Used for cleanup and forced shutdown
     */
    async closeAll(): Promise<void> {
        for (const [name, connection] of this.entries()) {
            try {
                await connection.close();
                console.log(`Closed MCP connection: ${name}`);
            } catch (error) {
                console.warn(`Failed to close MCP connection ${name}:`, error);
            }
        }
        this.clear();
    }
}

/**
 * Singleton connection pool instance
 * Used throughout the application to manage MCP client connections
 */
export const connectionPool = new MCPConnectionPool();
