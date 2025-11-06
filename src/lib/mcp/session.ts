/**
 * Session management for MCP server
 * Provides per-session state management for MCP connections
 */

import { MCPServer } from './server';
import type { ServerInfo } from './types';

export interface SessionData {
    sessionId: string;
    server: MCPServer;
    createdAt: Date;
    lastActivity: Date;
    metadata?: Record<string, unknown>;
}

/**
 * Session store for managing MCP server instances per session
 * In production, this could be backed by Redis or a database
 */
export class SessionStore {
    private _sessions: Map<string, SessionData> = new Map();

    /**
     * Create a new session with its own MCP server instance
     */
    create(serverInfo: ServerInfo, metadata?: Record<string, unknown>): SessionData {
        const sessionId = this._generateSessionId();
        const server = new MCPServer(serverInfo);

        const session: SessionData = {
            sessionId,
            server,
            createdAt: new Date(),
            lastActivity: new Date(),
            metadata,
        };

        this._sessions.set(sessionId, session);
        return session;
    }

    /**
     * Get an existing session by ID
     */
    get(sessionId: string): SessionData | undefined {
        const session = this._sessions.get(sessionId);
        if (session) {
            session.lastActivity = new Date();
        }
        return session;
    }

    /**
     * Delete a session
     */
    delete(sessionId: string): boolean {
        return this._sessions.delete(sessionId);
    }

    /**
     * Clear all sessions (for testing)
     */
    clear(): void {
        this._sessions.clear();
    }

    /**
     * Get number of active sessions
     */
    get size(): number {
        return this._sessions.size;
    }

    /**
     * Get all session IDs
     */
    getSessionIds(): string[] {
        return Array.from(this._sessions.keys());
    }

    /**
     * Clean up sessions older than the specified duration (in milliseconds)
     */
    cleanupStale(maxAge: number): number {
        const now = new Date();
        let cleaned = 0;

        for (const [sessionId, session] of this._sessions.entries()) {
            const age = now.getTime() - session.lastActivity.getTime();
            if (age > maxAge) {
                this._sessions.delete(sessionId);
                cleaned++;
            }
        }

        return cleaned;
    }

    /**
     * Send notification to all sessions
     * Useful for broadcasting config changes
     */
    async notifyAllSessions(notificationFn: (server: MCPServer) => Promise<void>): Promise<void> {
        const promises = Array.from(this._sessions.values()).map((session) =>
            notificationFn(session.server).catch((err) => {
                console.error(`Failed to send notification to session ${session.sessionId}:`, err);
            }),
        );
        await Promise.all(promises);
    }

    /**
     * Generate a unique session ID
     */
    private _generateSessionId(): string {
        return `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }
}
