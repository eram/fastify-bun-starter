import { deepStrictEqual, equal, ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ErrorEx } from '../../util/error';
import { MCPServer } from './server';
import type {
    CancelledNotification,
    JSONRPCNotification,
    ProgressNotification,
    RootsListChangedNotification,
    ToolListChangedNotification,
} from './types';
import { McpError } from './types';

describe('MCP Server - Progress Notifications', () => {
    test('should send progress notification when configured', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        const notifications: JSONRPCNotification[] = [];

        server.setEmitter((notification) => {
            notifications.push(notification);
        });

        await server.sendProgress('token-123', 50, 100, 'Processing...');

        strictEqual(notifications.length, 1);
        const notification = notifications[0] as ProgressNotification;
        strictEqual(notification.method, 'notifications/progress');
        strictEqual(notification.params.progressToken, 'token-123');
        strictEqual(notification.params.progress, 50);
        strictEqual(notification.params.total, 100);
        strictEqual(notification.params.message, 'Processing...');
    });

    test('should not throw when notification sender not configured', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        // Should not throw even without notification sender
        await server.sendProgress('token-123', 50, 100);
        ok(true);
    });

    test('should support progress without total or message', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        const notifications: JSONRPCNotification[] = [];

        server.setEmitter((notification) => {
            notifications.push(notification);
        });

        await server.sendProgress('token-456', 75);

        strictEqual(notifications.length, 1);
        const notification = notifications[0] as ProgressNotification;
        strictEqual(notification.params.progress, 75);
        strictEqual(notification.params.total, undefined);
        strictEqual(notification.params.message, undefined);
    });
});

describe('MCP Server - Cancellation', () => {
    test('should track pending requests', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });

        server.register(
            {
                name: 'slow-tool',
                description: 'A slow tool',
                inputSchema: { type: 'object', properties: new Map(), required: [] },
            },
            async () => {
                // Simulate slow operation
                await new Promise((resolve) => setTimeout(resolve, 100));
                return { content: [{ type: 'text', text: 'Done' }], isError: false };
            },
            async () => {},
        );

        // Start handling a request (doesn't wait for completion)
        const responsePromise = server.handleMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'slow-tool' },
        });

        // Request should be tracked as pending initially
        ok(server.isPending(1));

        await responsePromise;

        // After completion, should no longer be pending
        ok(!server.isPending(1));
    });

    test('should handle cancellation notification', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });

        server.register(
            {
                name: 'test-tool',
                description: 'A test tool',
                inputSchema: { type: 'object', properties: new Map(), required: [] },
            },
            async () => {
                return { content: [{ type: 'text', text: 'Result' }], isError: false };
            },
            async () => {},
        );

        // Start a request
        const responsePromise = server.handleMessage({
            jsonrpc: '2.0',
            id: 100,
            method: 'tools/call',
            params: { name: 'test-tool' },
        });

        ok(server.isPending(100));

        // Send cancellation notification
        await server.handleMessage({
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId: 100 },
        });

        // Request should no longer be pending
        ok(!server.isPending(100));

        await responsePromise;
    });

    test('should send cancelled notification when cancelling request', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        const notifications: JSONRPCNotification[] = [];

        server.setEmitter((notification) => {
            notifications.push(notification);
        });

        await server.cancelRequest(42, 'User cancelled');

        strictEqual(notifications.length, 1);
        const notification = notifications[0] as CancelledNotification;
        strictEqual(notification.method, 'notifications/cancelled');
        strictEqual(notification.params.requestId, 42);
        strictEqual(notification.params.reason, 'User cancelled');
    });
});

describe('MCP Server - List Change Notifications', () => {
    test('should send notification when tool is unregistered', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        const notifications: JSONRPCNotification[] = [];

        server.setEmitter((notification) => {
            notifications.push(notification);
        });

        // Register a tool
        server.register(
            {
                name: 'test-tool',
                description: 'A test tool',
                inputSchema: { type: 'object', properties: new Map(), required: [] },
            },
            async () => {
                return { content: [{ type: 'text', text: 'Result' }], isError: false };
            },
            async () => {},
        );

        // Unregister the tool
        const deleted = server.unregister('test-tool');

        ok(deleted);
        strictEqual(notifications.length, 1);
        const notification = notifications[0] as ToolListChangedNotification;
        strictEqual(notification.method, 'notifications/tools/list_changed');
    });

    test('should not send notification when unregistering non-existent tool', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        const notifications: JSONRPCNotification[] = [];

        server.setEmitter((notification) => {
            notifications.push(notification);
        });

        const deleted = server.unregister('non-existent');

        ok(!deleted);
        strictEqual(notifications.length, 0);
    });
});

describe('MCP Server - Roots Support', () => {
    test('should initialize with empty roots', () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        const roots = server.getRoots();
        deepStrictEqual(roots, []);
    });

    test('should set and get roots', () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });

        const testRoots = [
            { uri: 'file:///project1', name: 'Project 1' },
            { uri: 'file:///project2', name: 'Project 2' },
        ];

        server.setRoots(testRoots);
        const roots = server.getRoots();

        deepStrictEqual(roots, testRoots);
    });

    test('should send notification when roots change', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        const notifications: JSONRPCNotification[] = [];

        server.setEmitter((notification) => {
            notifications.push(notification);
        });

        server.setRoots([{ uri: 'file:///project1', name: 'project1' }]);

        strictEqual(notifications.length, 1);
        const notification = notifications[0] as RootsListChangedNotification;
        strictEqual(notification.method, 'notifications/roots/list_changed');
    });

    test('should not send notification when roots unchanged', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        const notifications: JSONRPCNotification[] = [];

        const testRoots = [{ uri: 'file:///project1', name: 'Project 1' }];
        server.setRoots(testRoots);

        server.setEmitter((notification) => {
            notifications.push(notification);
        });

        // Set same roots again
        server.setRoots(testRoots);

        // Should not send notification for identical roots
        strictEqual(notifications.length, 0);
    });

    test('should handle roots/list request', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });

        const testRoots = [
            { uri: 'file:///workspace1', name: 'Workspace 1' },
            { uri: 'file:///workspace2', name: 'Workspace 2' },
        ];
        server.setRoots(testRoots);

        const response = await server.handleMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'roots/list',
        });

        ok(response);
        strictEqual(response.id, 1);
        ok(response.result);
        const result = response.result as { roots: unknown[] };
        deepStrictEqual(result.roots, testRoots);
    });

    test('should advertise roots capability in initialize', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });

        const response = await server.handleMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
        });

        ok(response);
        ok(response.result);
        const result = response.result as { capabilities: { roots?: { listChanged?: boolean } } };
        ok(result.capabilities.roots);
        strictEqual(result.capabilities.roots.listChanged, true);
    });
});

describe('MCP Server - Progress Token in Tool Calls', () => {
    test('should pass progress token to tool handler', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        let receivedToken: string | number | undefined;

        server.register(
            {
                name: 'progress-tool',
                description: 'A tool with progress',
                inputSchema: { type: 'object', properties: new Map(), required: [] },
            },
            async (_args, progressToken) => {
                receivedToken = progressToken;
                return { content: [{ type: 'text', text: 'Done' }], isError: false };
            },
            async () => {},
        );

        await server.handleMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'progress-tool',
                // biome-ignore lint/style/useNamingConvention: _meta is part of MCP spec
                _meta: { progressToken: 'progress-123' },
            },
        });

        strictEqual(receivedToken, 'progress-123');
    });

    test('should handle tool call without progress token', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });
        let receivedToken: string | number | undefined = 'initial';

        server.register(
            {
                name: 'no-progress-tool',
                description: 'A tool without progress',
                inputSchema: { type: 'object', properties: new Map(), required: [] },
            },
            async (_args, progressToken) => {
                receivedToken = progressToken;
                return { content: [{ type: 'text', text: 'Done' }], isError: false };
            },
            async () => {},
        );

        await server.handleMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'no-progress-tool' },
        });

        strictEqual(receivedToken, undefined);
    });
});

describe('McpError', () => {
    test('creates McpError with string message', () => {
        const err = new McpError('Server not found');
        equal(err.message, 'Server not found');
        equal(err.name, 'McpError');
        ok(err instanceof McpError);
        ok(err instanceof ErrorEx);
        ok(err instanceof Error);
    });

    test('creates McpError from another Error', () => {
        const originalErr = new Error('Original error');
        const mcpErr = new McpError(originalErr);
        equal(mcpErr.message, 'Original error');
        equal(mcpErr.name, 'McpError');
        ok(mcpErr instanceof McpError);
    });

    test('creates McpError from undefined', () => {
        const err = new McpError(undefined);
        equal(err.message, 'Unknown error');
        equal(err.name, 'McpError');
    });

    test('creates McpError from null', () => {
        const err = new McpError(null);
        equal(err.message, 'Unknown error');
        equal(err.name, 'McpError');
    });

    test('McpError in [data, error] tuple pattern', () => {
        function operation(): [undefined, McpError] {
            return [undefined, new McpError('Operation failed')];
        }

        const [, err] = operation();
        ok(err instanceof McpError);
        equal(err.message, 'Operation failed');
    });

    test('McpError thrown and caught', () => {
        try {
            throw new McpError('Test error');
        } catch (e) {
            ok(e instanceof McpError);
            ok(e instanceof Error);
            equal((e as McpError).message, 'Test error');
        }
    });

    test('McpError JSON serialization', () => {
        const err = new McpError('Serialization test');
        const json = JSON.stringify(err);
        // ErrorEx makes properties enumerable, so they should be in JSON
        ok(json.length > 0);
        equal(err.message, 'Serialization test');
        equal(err.name, 'McpError');
    });
});

describe('MCP Server - Tool Query', () => {
    test('should get tools by prefix', async () => {
        const server = new MCPServer({ name: 'test-server', version: '1.0.0' });

        // Register some tools with prefixes
        server.register(
            { name: 'serverA:tool1', description: 'Tool 1 from Server A', inputSchema: { type: 'object' } },
            async () => ({ content: [] }),
            async () => {},
        );

        server.register(
            { name: 'serverA:tool2', description: 'Tool 2 from Server A', inputSchema: { type: 'object' } },
            async () => ({ content: [] }),
            async () => {},
        );

        server.register(
            { name: 'serverB:tool1', description: 'Tool 1 from Server B', inputSchema: { type: 'object' } },
            async () => ({ content: [] }),
            async () => {},
        );

        server.register(
            { name: 'local-tool', description: 'Local tool', inputSchema: { type: 'object' } },
            async () => ({ content: [] }),
            async () => {},
        );

        // Get tools by prefix
        const serverATools = server.getToolsByPrefix('serverA');
        const serverBTools = server.getToolsByPrefix('serverB');
        const serverCTools = server.getToolsByPrefix('serverC');

        strictEqual(serverATools.length, 2);
        strictEqual(serverBTools.length, 1);
        strictEqual(serverCTools.length, 0);

        strictEqual(serverATools[0].name, 'serverA:tool1');
        strictEqual(serverATools[1].name, 'serverA:tool2');
        strictEqual(serverBTools[0].name, 'serverB:tool1');
    });
});
