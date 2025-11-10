import { equal, ok } from 'node:assert/strict';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { describe, mock, test } from 'node:test';

import { Env } from './env';
import { createLogger, LogLevel } from './logger';

describe('env', (t) => {
    process.env.NODE_TEST_CONTEXT ??= t.name;

    test('NODE_ENV is test', () => {
        const save = { ...process.env };

        try {
            new Env();
            ok(['unit_test', 'test', 'development'].includes(Env.nodeEnv));
        } finally {
            // restore
            Object.assign(process.env, save);
        }
    });

    test('cover env defaults', () => {
        const save = { ...process.env };

        try {
            delete process.env.NODE_ENV;
            delete process.env.DOT_ENV_FILE;
            delete process.env.APP_NAME;
            delete process.env.HOSTNAME;
            delete process.env.LOG_ADD_TIME;
            delete process.env.LOG_LEVEL;
            delete process.env.LOG_FORMAT;

            // setup env and check if all vars are now assign
            new Env();
            ok(typeof process.env.NODE_ENV === 'string');
            ok(typeof process.env.DOT_ENV_FILE === 'string');
            ok(typeof process.env.APP_NAME === 'string');
            ok(typeof process.env.HOSTNAME === 'string');
            ok(typeof process.env.LOG_ADD_TIME === 'string');
            ok(typeof process.env.LOG_LEVEL === 'string');
            ok(typeof process.env.LOG_FORMAT === 'string');
        } finally {
            // restore
            Object.assign(process.env, save);
        }
    });

    test('print info even if logger elevated', (t) => {
        const fn = mock.fn();
        const log = createLogger(t.name, LogLevel.EMERGENCY, { log: fn, error: fn });
        Env.print(log);
        equal(fn.mock.calls.length, 1);
    });

    test('get Env vars with defaults, min, max', () => {
        const save = { ...process.env };

        try {
            process.env.TEST_INT = '123';
            process.env.TEST_STR = 'hello';

            equal(Env.get('TEST_INT', 0), 123);
            equal(Env.get('TEST_INT', 0, 100), 123);
            equal(Env.get('TEST_INT', 0, 200, 400), 200);
            equal(Env.get('NO_EXIST', 42), 42);

            equal(Env.get('TEST_STR', 'def'), 'hello');
            equal(Env.get('TEST_STR', 'def', 'aa', 'zz'), 'hello');
            equal(Env.get('TEST_STR', 'def', 'zz'), 'zz');
            equal(Env.get('TEST_STR', 'def', 'aa', 'bb'), 'bb');
            equal(Env.get('NO_EXIST', 'def'), 'def');
        } finally {
            // restore
            Object.assign(process.env, save);
        }
    });

    test('load .env file', () => {
        const save = { ...process.env };

        try {
            const before = Object.keys(save).length;
            process.env.DOT_ENV_FILE = resolve(Env.__dirname, 'src/util/__mocks__/test.env');
            ok(fs.existsSync(process.env.DOT_ENV_FILE));
            const env = new Env();
            equal(env.get('TEST_INT_ZZ', 0), 123);
            equal(env.get('TEST_STR_ZZ', 'def'), 'hello');
            equal(env.get('NO_EXIST', 'def'), 'def');
            const after = Object.keys(process.env).length;
            ok(after > before);
        } finally {
            Object.assign(process.env, save);
        }
    });

    test('hasDOM detection', () => {
        equal(Env.hasDOM, false);
    });

    test('runtime detection', () => {
        equal(Env.runtime, 'bun');
        ok(typeof Env.runtimeVer === 'number');
        ok(Env.runtimeVer > 0);
    });

    test('cluster and worker detection', () => {
        // In test environment, we're the primary process
        equal(Env.isPrimary, true);
        // Since we're not a worker, workerId should be empty
        equal(Env.workerId, '');
        // We're on the main thread
        equal(Env.isMainThread, true);
        // Thread ID should be a number
        ok(typeof Env.threadId === 'number');
    });
});
