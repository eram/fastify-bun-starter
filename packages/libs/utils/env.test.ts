import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { Env } from './env';

describe('env', () => {
    let save: NodeJS.ProcessEnv;

    beforeAll(async () => {
        save = { ...process.env };
        process.env['NODE_ENV'] = 'test';
        process.env['NODE_TEST_CONTEXT'] ??= 'env';
        const envFile = resolve(Env.__dirname, '.env.development');
        expect(fs.existsSync(envFile)).toBeTruthy();

        process.env['DOT_ENV_FILE'] = envFile;
        await Env.init(true); // Force re-initialization
    });

    afterAll(() => {
        process.env = save;
    });

    test('static memebers', () => {
        expect(Env.nodeEnv).toEqual('test');
        expect(Env.runtime).toEqual('bun');
        expect(typeof Env.runtimeVer === 'string').toBeTruthy();
        expect(parseFloat(Env.runtimeVer) > 0).toBeTruthy();
        // With happy-dom preloaded for tests, DOM is available
        expect(Env.hasDOM).toEqual(true);
        expect(Env.isTestMode).toEqual(true);
    });

    test('cover env defaults', () => {
        // Env is already initialized, just check that vars are set
        expect(typeof process.env['NODE_ENV'] === 'string').toBeTruthy();
        expect(typeof process.env['DOT_ENV_FILE'] === 'string').toBeTruthy();
        expect(typeof process.env['APP_NAME'] === 'string').toBeTruthy();
        expect(typeof process.env['HOSTNAME'] === 'string').toBeTruthy();
        expect(typeof process.env['LOG_ADD_TIME'] === 'string').toBeTruthy();
        expect(typeof process.env['LOG_LEVEL'] === 'string').toBeTruthy();
        expect(typeof process.env['LOG_FORMAT'] === 'string').toBeTruthy();
    });

    test('cluster and worker detection', () => {
        // In test environment, we're the primary process
        expect(Env.isPrimary).toEqual(true);
        // Since we're not a worker, workerId should be empty
        expect(Env.workerId).toEqual('');
        // We're on the main thread
        expect(Env.isMainThread).toEqual(true);
        // Thread ID should be a number
        expect(typeof Env.threadId === 'number').toBeTruthy();
    });

    test('print info', async () => {
        const fn = spyOn(process.stdout, 'write').mockImplementation((txt: string) => {
            expect(txt.includes('-------')).toBeTruthy();
            return true;
        });
        Env.print();
        expect(fn.mock.calls.length).toEqual(1);
        fn.mockRestore();
    });

    test('get Env vars with defaults, min, max', () => {
        process.env['TEST_INT'] = '123';
        process.env['TEST_STR'] = 'hello';

        expect(Env.get('TEST_INT', 0)).toEqual(123);
        expect(Env.get('TEST_INT', 0, 100)).toEqual(123);
        expect(Env.get('TEST_INT', 0, 200, 400)).toEqual(200);
        expect(Env.get('NO_EXIST', 42)).toEqual(42);

        expect(Env.get('TEST_STR', 'def')).toEqual('hello');
        expect(Env.get('TEST_STR', 'def', 'aa', 'zz')).toEqual('hello');
        expect(Env.get('TEST_STR', 'def', 'zz')).toEqual('zz');
        expect(Env.get('TEST_STR', 'def', 'aa', 'bb')).toEqual('bb');
        expect(Env.get('NO_EXIST', 'def')).toEqual('def');
    });

    test('get Env var with object default and JSON parsing', () => {
        // Valid JSON
        process.env['TEST_OBJ'] = '{"foo":42,"bar":"baz"}';
        const defObj = { foo: 0, bar: '' };
        const result = Env.get('TEST_OBJ', defObj);
        expect(result.foo).toEqual(42);
        expect(result.bar).toEqual('baz');

        // Invalid JSON falls back to default
        process.env['TEST_OBJ'] = 'not-json';
        const result2 = Env.get('TEST_OBJ', defObj);
        expect(result2.foo).toEqual(0);
        expect(result2.bar).toEqual('');

        // No env var returns default
        delete process.env['TEST_OBJ'];
        const result3 = Env.get('TEST_OBJ', defObj);
        expect(result3.foo).toEqual(0);
        expect(result3.bar).toEqual('');
    });

    test('get all Env vars', () => {
        const allVars = Env.vars;
        expect(typeof allVars === 'object').toBeTruthy();
        expect(Object.keys(allVars).length > 0).toBeTruthy();
        //expect(allVars.NODE_ENV).toEqual('test');
    });
});
