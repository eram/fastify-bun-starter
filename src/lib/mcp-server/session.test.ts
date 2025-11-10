/**
 * Tests for MCP session management
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import type { MCPServer } from './server';
import { SessionStore } from './session';

describe('SessionStore', () => {
    let store: SessionStore;

    beforeEach(() => {
        store = new SessionStore();
    });

    test('create() creates a new session with unique ID', () => {
        const session1 = store.create({ name: 'test-server', version: '1.0.0' });
        const session2 = store.create({ name: 'test-server', version: '1.0.0' });

        ok(session1.sessionId, 'Session 1 should have an ID');
        ok(session2.sessionId, 'Session 2 should have an ID');
        ok(session1.sessionId !== session2.sessionId, 'Session IDs should be unique');
    });

    test('create() includes server info in session', () => {
        const serverInfo = { name: 'my-server', version: '2.0.0' };
        const session = store.create(serverInfo);

        ok(session.server, 'Session should have a server');
        strictEqual(typeof session.server, 'object', 'Server should be an object');
    });

    test('create() sets timestamps', () => {
        const before = new Date();
        const session = store.create({ name: 'test', version: '1.0.0' });
        const after = new Date();

        ok(session.createdAt >= before && session.createdAt <= after, 'createdAt should be set to current time');
        ok(session.lastActivity >= before && session.lastActivity <= after, 'lastActivity should be set to current time');
    });

    test('create() accepts optional metadata', () => {
        const metadata = { userId: '123', role: 'admin' };
        const session = store.create({ name: 'test', version: '1.0.0' }, metadata);

        deepStrictEqual(session.metadata, metadata, 'Metadata should be stored');
    });

    test('get() retrieves session by ID', () => {
        const session = store.create({ name: 'test', version: '1.0.0' });
        const retrieved = store.get(session.sessionId);

        strictEqual(retrieved?.sessionId, session.sessionId, 'Should retrieve the correct session');
    });

    test('get() returns undefined for non-existent session', () => {
        const retrieved = store.get('non-existent-id');
        strictEqual(retrieved, undefined, 'Should return undefined for non-existent session');
    });

    test('get() updates lastActivity timestamp', () => {
        const session = store.create({ name: 'test', version: '1.0.0' });
        const originalActivity = session.lastActivity;

        // Wait a bit
        const waitPromise = new Promise((resolve) => setTimeout(resolve, 10));
        return waitPromise.then(() => {
            const retrieved = store.get(session.sessionId);
            ok(retrieved!.lastActivity > originalActivity, 'lastActivity should be updated');
        });
    });

    test('delete() removes session', () => {
        const session = store.create({ name: 'test', version: '1.0.0' });
        const deleted = store.delete(session.sessionId);

        strictEqual(deleted, true, 'delete() should return true');
        strictEqual(store.get(session.sessionId), undefined, 'Session should be removed');
    });

    test('delete() returns false for non-existent session', () => {
        const deleted = store.delete('non-existent-id');
        strictEqual(deleted, false, 'delete() should return false for non-existent session');
    });

    test('clear() removes all sessions', () => {
        store.create({ name: 'test1', version: '1.0.0' });
        store.create({ name: 'test2', version: '1.0.0' });
        store.create({ name: 'test3', version: '1.0.0' });

        strictEqual(store.size, 3, 'Should have 3 sessions');

        store.clear();

        strictEqual(store.size, 0, 'Should have 0 sessions after clear');
    });

    test('size property returns session count', () => {
        strictEqual(store.size, 0, 'Size should start at 0');

        store.create({ name: 'test1', version: '1.0.0' });
        strictEqual(store.size, 1, 'Size should be 1');

        store.create({ name: 'test2', version: '1.0.0' });
        strictEqual(store.size, 2, 'Size should be 2');

        const session = store.create({ name: 'test3', version: '1.0.0' });
        strictEqual(store.size, 3, 'Size should be 3');

        store.delete(session.sessionId);
        strictEqual(store.size, 2, 'Size should be 2 after delete');
    });

    test('getSessionIds() returns array of all session IDs', () => {
        const session1 = store.create({ name: 'test1', version: '1.0.0' });
        const session2 = store.create({ name: 'test2', version: '1.0.0' });
        const session3 = store.create({ name: 'test3', version: '1.0.0' });

        const ids = store.getSessionIds();

        strictEqual(ids.length, 3, 'Should return 3 IDs');
        ok(ids.includes(session1.sessionId), 'Should include session1 ID');
        ok(ids.includes(session2.sessionId), 'Should include session2 ID');
        ok(ids.includes(session3.sessionId), 'Should include session3 ID');
    });

    test('cleanupStale() removes sessions older than maxAge', async () => {
        // Create sessions with different ages by manipulating lastActivity
        const session1 = store.create({ name: 'test1', version: '1.0.0' });
        const session2 = store.create({ name: 'test2', version: '1.0.0' });
        const session3 = store.create({ name: 'test3', version: '1.0.0' });

        // Manually set lastActivity to simulate old sessions
        const now = new Date();
        session1.lastActivity = new Date(now.getTime() - 10000); // 10 seconds ago
        session2.lastActivity = new Date(now.getTime() - 5000); // 5 seconds ago
        session3.lastActivity = new Date(now.getTime() - 1000); // 1 second ago

        // Clean up sessions older than 7 seconds
        const cleaned = store.cleanupStale(7000);

        strictEqual(cleaned, 1, 'Should clean up 1 session');
        strictEqual(store.size, 2, 'Should have 2 sessions remaining');
        strictEqual(store.get(session1.sessionId), undefined, 'Session1 should be removed');
        ok(store.get(session2.sessionId), 'Session2 should remain');
        ok(store.get(session3.sessionId), 'Session3 should remain');
    });

    test('cleanupStale() returns 0 when no sessions are stale', () => {
        store.create({ name: 'test1', version: '1.0.0' });
        store.create({ name: 'test2', version: '1.0.0' });

        const cleaned = store.cleanupStale(60000); // 1 minute
        strictEqual(cleaned, 0, 'Should clean up 0 sessions');
        strictEqual(store.size, 2, 'All sessions should remain');
    });

    test('notifyAllSessions() calls function for each session', () => {
        const session1 = store.create({ name: 'test1', version: '1.0.0' });
        const session2 = store.create({ name: 'test2', version: '1.0.0' });
        const session3 = store.create({ name: 'test3', version: '1.0.0' });

        const notifiedServers: MCPServer[] = [];

        store.notifyAllSessions((server) => {
            notifiedServers.push(server);
        });

        strictEqual(notifiedServers.length, 3, 'Should notify all 3 sessions');
        ok(notifiedServers.includes(session1.server), 'Should include session1 server');
        ok(notifiedServers.includes(session2.server), 'Should include session2 server');
        ok(notifiedServers.includes(session3.server), 'Should include session3 server');
    });

    test('notifyAllSessions() handles errors gracefully', () => {
        store.create({ name: 'test1', version: '1.0.0' });
        store.create({ name: 'test2', version: '1.0.0' });
        store.create({ name: 'test3', version: '1.0.0' });

        let callCount = 0;

        // Should not throw even if notification function fails
        store.notifyAllSessions((_server) => {
            callCount++;
            if (callCount === 2) {
                throw new Error('Notification failed');
            }
        });

        strictEqual(callCount, 3, 'Should call function for all sessions despite error');
    });

    test('notifyAllSessions() does nothing when no sessions exist', () => {
        let called = false;

        store.notifyAllSessions(() => {
            called = true;
        });

        strictEqual(called, false, 'Should not call function when no sessions exist');
    });

    test('session ID format is correct', () => {
        const session = store.create({ name: 'test', version: '1.0.0' });
        ok(session.sessionId.startsWith('mcp-'), 'Session ID should start with "mcp-"');
        ok(session.sessionId.length > 10, 'Session ID should be reasonably long');
    });

    test('multiple creates in rapid succession generate unique IDs', () => {
        const sessions = Array.from({ length: 100 }, () => store.create({ name: 'test', version: '1.0.0' }));

        const ids = new Set(sessions.map((s) => s.sessionId));
        strictEqual(ids.size, 100, 'All 100 session IDs should be unique');
    });
    test('createWithSharedServer() creates session with shared server instance', () => {
        // Create a mock server
        const mockServer = { name: 'shared-server', version: '1.0.0' } as MCPServer;

        const session1 = store.createWithSharedServer(mockServer);
        const session2 = store.createWithSharedServer(mockServer);

        ok(session1.sessionId, 'Session 1 should have an ID');
        ok(session2.sessionId, 'Session 2 should have an ID');
        ok(session1.sessionId !== session2.sessionId, 'Session IDs should be unique');

        // Both sessions should share the same server instance
        strictEqual(session1.server, mockServer, 'Session 1 should use the shared server');
        strictEqual(session2.server, mockServer, 'Session 2 should use the shared server');
        strictEqual(session1.server, session2.server, 'Both sessions should share the same server instance');
    });

    test('createWithSharedServer() accepts custom session ID', () => {
        const mockServer = { name: 'test', version: '1.0.0' } as MCPServer;
        const customId = 'custom-session-123';

        const session = store.createWithSharedServer(mockServer, customId);

        strictEqual(session.sessionId, customId, 'Should use custom session ID');
        strictEqual(store.get(customId)?.sessionId, customId, 'Should be retrievable by custom ID');
    });

    test('createWithSharedServer() accepts metadata', () => {
        const mockServer = { name: 'test', version: '1.0.0' } as MCPServer;
        const metadata = { userId: '456', context: 'test' };

        const session = store.createWithSharedServer(mockServer, undefined, metadata);

        deepStrictEqual(session.metadata, metadata, 'Should store metadata');
    });
});
