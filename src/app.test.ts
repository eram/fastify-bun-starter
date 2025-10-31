import { match, ok, strictEqual } from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { Logger } from '@deepkit/logger';
import { app, TestCommand } from './app';

describe('TestCommand', () => {
    test('class is exported and decorated', () => {
        ok(TestCommand, 'TestCommand should be defined');
        strictEqual(typeof TestCommand, 'function', 'TestCommand should be a function');
    });

    test('execute method exists with correct signature', () => {
        const cmd = new TestCommand();
        strictEqual(typeof cmd.execute, 'function', 'execute should be a function');
    });
});

describe('app', () => {
    test('instance is exported and configured', () => {
        ok(app, 'app should be defined');
        ok(app.setup, 'app.setup should be defined');
    });

    test('has test controller registered', async () => {
        // Setup the app to introspect it
        app.setup(() => {});

        // Check if TestCommand is in the controllers
        const hasTestCommand = app.appModule.controllers.includes(TestCommand);
        strictEqual(hasTestCommand, true, 'TestCommand should be in controllers');
    });
});

describe('TestCommand execution', () => {
    let logs: string[];
    let mockLogger: Logger;

    beforeEach(() => {
        logs = [];
        mockLogger = {
            log: (msg: string) => logs.push(msg),
        } as unknown as Logger;
    });

    test('can be instantiated and executed with mock logger', async () => {
        const cmd = new TestCommand();
        await cmd.execute('TestUser', 5, false, mockLogger);

        // Verify logs contain expected output
        const allLogs = logs.join('\n');
        match(allLogs, /Deepkit Type System Test/);
        match(allLogs, /Hello TestUser!/);
        match(allLogs, /Count: 5/);
        match(allLogs, /Verbose mode: false/);
        match(allLogs, /Type compiler is working/);
        match(allLogs, /Decorators are working/);
        match(allLogs, /Dependency injection is working/);
    });

    test('verbose mode shows user data', async () => {
        const cmd = new TestCommand();
        await cmd.execute('Verbose', 1, true, mockLogger);

        const allLogs = logs.join('\n');
        match(allLogs, /Verbose mode: true/);
        match(allLogs, /User object with Deepkit types/);
        match(allLogs, /John Doe/);
        match(allLogs, /john@example.com/);
    });
});
