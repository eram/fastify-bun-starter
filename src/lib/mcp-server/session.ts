/**
 * Session management for MCP server
 * Provides per-session state management for MCP connections
 */

import { createLogger } from '../../util';
import { MCPServer } from './server';
import type { ServerInfo } from './types';

// Logger for session management
const log = createLogger({ scope: 'mcp:session' });

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
     * Create a new session with a shared MCP server instance
     * Useful for sharing tools across multiple sessions
     */
    createWithSharedServer(server: MCPServer, sessionId?: string, metadata?: Record<string, unknown>): SessionData {
        const id = sessionId || this._generateSessionId();

        const session: SessionData = {
            sessionId: id,
            server,
            createdAt: new Date(),
            lastActivity: new Date(),
            metadata,
        };

        this._sessions.set(id, session);
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
    notifyAllSessions(notificationFn: (server: MCPServer) => void): void {
        for (const session of this._sessions.values()) {
            try {
                notificationFn(session.server);
            } catch (err) {
                log.warn(`Failed to send notification to session ${session.sessionId}:`, err);
            }
        }
    }

    /**
     * Generate a unique session ID
     */
    private _generateSessionId(): string {
        return `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }
}
