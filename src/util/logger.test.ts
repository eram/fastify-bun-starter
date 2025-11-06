import { deepEqual, doesNotThrow, match, notEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import { format } from 'node:util';
import * as logger from './logger';
import { warn } from './logger';
import { sleep } from './sleep';

const makeConsole = (nullFn: logger.Transport[`log`]): logger.Transport => ({ log: nullFn, error: nullFn });

type FnW = typeof process.stdout.write;
type FnO = typeof process.stdout.once;

describe('logger tests', () => {
    test('logs thru logger function', (t) => {
        const nullFn = mock.fn((str) => {
            strictEqual(typeof str, 'string', JSON.stringify(str));
            ok(str.includes('should log'));
        });
        const log = logger.createLogger(
            t.name,
            logger.LogLevel.ERROR,
            makeConsole(nullFn),
            // these options should be ignored!
            { level: logger.LogLevel.CRITICAL, scope: `zib2`, formatter: 'line' },
        );

        strictEqual(log.conf.scope, t.name);
        strictEqual(log.conf.level, logger.LogLevel.ERROR);
        log.warn('should not log');
        log.error({ a: 'should log' });
        strictEqual(nullFn.mock.calls.length, 1);
    });

    test('global logger', () => {
        const log = logger.logger; // global logger,
        const origLevel = log.level;
        try {
            log.level = logger.LogLevel.EMERGENCY;
            log.log('should not log');
            warn('should not log either');
        } finally {
            log.level = origLevel;
        }
    });

    test('created only once for the same name', (t) => {
        const log1 = logger.createLogger(t.name, logger.LogLevel.DEBUG);
        notEqual(log1, undefined);
        strictEqual(typeof log1.critical, 'function');
        Object(log1).marker = Math.random().toString(6);

        const log2 = logger.createLogger(t.name, logger.LogLevel.ERROR);
        deepEqual(log1, log2);
        strictEqual(Object(log1).marker, Object(log2).marker);
        strictEqual(log1.conf.level, logger.LogLevel.ERROR);
    });

    test('logs with formatting', (t) => {
        const nullFn = mock.fn((str) => {
            if (typeof str !== 'string') return; // sometimes i get here an object....
            ok(str.includes('foo:bar'));
        });
        const log = logger.createLogger(t.name, logger.LogLevel.ERROR, makeConsole(nullFn));
        log.error('%s:%s', 'foo', 'bar');
        strictEqual(nullFn.mock.calls.length, 1);
    });

    test('emerg always logged thru error function', (t) => {
        const nullFn = mock.fn();
        const log = logger.createLogger(t.name, logger.LogLevel.EMERGENCY, makeConsole(nullFn));
        log.emerg('test emerg');
        strictEqual(nullFn.mock.calls.length, 1);
    });

    test('json logger with params', (t) => {
        const save = process.env.LOG_FORMAT;
        try {
            const nullFn = mock.fn((obj) => {
                strictEqual(typeof obj, 'object');
                strictEqual(typeof obj.message, 'string');
                strictEqual(obj.message, 'foo:bar');
                strictEqual(obj.ctx, t.name);
            });

            process.env.LOG_FORMAT = 'json';
            const log = logger.createLogger(t.name, logger.LogLevel.INFO, makeConsole(nullFn));
            log.log('%s:%s', 'foo', 'bar');
            strictEqual(nullFn.mock.calls.length, 1);
        } finally {
            process.env.LOG_FORMAT = save;
        }
    });

    test('log with time', (t) => {
        const save = { ...process.env };
        try {
            const fn = mock.method(console, 'log', (str: string) => {
                //console.log(str);
                match(str, /\d{1,2}T\d{1,2}:\d{1,2}:\d{1,2}\.\d{1,3}Z/);
            });
            process.env.LOG_ADD_TIME = 'true';
            process.env.LOG_FORMAT = 'line';
            const log = logger.createLogger(t.name, logger.LogLevel.INFO, console);
            delete process.env.LOG_ADD_TIME;
            log.info('logs with time');
            strictEqual(fn.mock.calls.length, 1);
        } finally {
            mock.restoreAll();
            Object.assign(process.env, save);
        }
    });

    test('check all types of log levels', (t) => {
        const nullFn = mock.fn();
        const log = logger.createLogger(t.name, logger.LogLevel.DEBUG, makeConsole(nullFn));
        log.debug(1);
        log.trace(2);
        log.info(3);
        log.warn(4);
        log.error(5);
        log.critical(6);
        strictEqual(nullFn.mock.calls.length, 6);
    });

    test('check log only above log level', (t) => {
        const nullFn = mock.fn();
        const log = logger.createLogger(t.name, logger.LogLevel.WARNING, makeConsole(nullFn));
        log.debug(0);
        log.trace(0);
        log.info(0);
        log.warn(1);
        log.error(2);
        log.critical(3);
        strictEqual(nullFn.mock.calls.length, 3);
    });

    test('check assertion failed throws', (t) => {
        // global logger throws
        throws(() => {
            logger.assert(0, 'assertion1');
        }, /assertion1/);

        // new logger throws
        const log = logger.createLogger(t.name, logger.LogLevel.DEBUG, makeConsole(mock.fn()));
        throws(() => {
            log.assert(false, 'assertion2');
        }, /assertion2/);
    });

    test('createLogger LOG_LEVEL is normalized', (t) => {
        process.env.LOG_LEVEL = 'silly';
        const log = logger.createLogger(t.name);
        strictEqual(log.conf.level, logger.LogLevel.DEBUG);
        delete process.env.LOG_LEVEL;
    });

    test('createLogger uses LOG_LEVEL as number', (t) => {
        process.env.LOG_LEVEL = '2';
        const log = logger.createLogger(t.name);
        strictEqual(log.conf.level, logger.LogLevel.CRITICAL);
        delete process.env.LOG_LEVEL;
    });

    test('createLogger with/without time', (t) => {
        const nullFn = mock.fn();
        delete process.env.LOG_ADD_TIME;
        const log0 = logger.createLogger(`${t.name}0`, logger.LogLevel.INFO, makeConsole(nullFn));
        log0.info('should not have time');

        // add time thru env var
        process.env.LOG_ADD_TIME = 'true';
        const log1 = logger.createLogger(`${t.name}1`, logger.LogLevel.INFO, makeConsole(nullFn));
        log1.info('should have time');
        delete process.env.LOG_ADD_TIME;

        // add time thru option
        const log2 = logger.createLogger(`${t.name}2`, logger.LogLevel.INFO, makeConsole(nullFn), { addTime: true });
        log2.info('should have time');

        strictEqual(nullFn.mock.calls.length, 3);
        const regex = /\d{1,2}T\d{1,2}:\d{1,2}:\d{1,2}\.\d{1,3}Z\s/;
        // @ts-expect-error - Mock calls are indexable
        ok(!nullFn.mock.calls[0][0].match(regex));
        // @ts-expect-error - Mock calls are indexable
        ok(nullFn.mock.calls[1][0].match(regex));
        // @ts-expect-error - Mock calls are indexable
        ok(nullFn.mock.calls[2][0].match(regex));
    });

    test('createLogger with undefined logName and baseLogger', async (t) => {
        process.stdout.write(''); // make sure stdout exists for the test
        const fn = mock.method(process.stdout, 'write', (_txt: string) => {
            return true;
        });
        try {
            // this should get the global async logger (SpeedStd).
            // We should see the log output after a short delay
            const log = logger.createLogger();
            ok(log);
            log.info(t.name);
            await sleep(60); // must be larger than the default flush interval (50ms)

            // stdout may have been called by others while we slept
            ok(fn.mock.calls.length >= 1);
            const found = fn.mock.calls.find((c: any) => c[0].toString().includes(t.name));
            ok(found, 'log message not found');
        } finally {
            mock.restoreAll();
        }
    });

    test('assertion throw on failure', (t) => {
        const log = logger.createLogger(t.name, logger.LogLevel.INFO);
        doesNotThrow(() => log.assert(true, 'should not throw'));
        throws(() => log.assert(false, 'should throw'), /should throw/);
    });

    test('jsonFn logs with all fields', (t) => {
        const nullFn = mock.fn();
        const log = logger.createLogger(t.name, logger.LogLevel.INFO, makeConsole(nullFn));
        log.level = logger.LogLevel.INFO;
        log.info('jsonTest');
        ok(nullFn.mock.calls.length === 1);
    });

    test('jsonFn does not log if below level', (t) => {
        const nullFn = mock.fn();
        const log = logger.createLogger(t.name, logger.LogLevel.WARNING, makeConsole(nullFn));
        log.info('should not log');
        strictEqual(nullFn.mock.calls.length, 0);
    });

    test('change level', (t) => {
        const nullFn = mock.fn();
        const log = logger.createLogger(t.name, logger.LogLevel.CRITICAL, makeConsole(nullFn));
        log.debug('debugTest 1');
        log.critical('criticalTest 1');
        strictEqual(nullFn.mock.calls.length, 1);
        strictEqual(log.level, logger.LogLevel.CRITICAL);

        log.level = logger.LogLevel.DEBUG;
        log.debug('debugTest 2');
        log.critical('criticalTest 2');
        strictEqual(nullFn.mock.calls.length, 3);
        strictEqual(log.level, logger.LogLevel.DEBUG);
        strictEqual(log.conf.level, logger.LogLevel.DEBUG);
    });

    test('other console funcs are alive', (t) => {
        const log = logger.createLogger(t.name, logger.LogLevel.INFO, makeConsole(mock.fn()));

        // sample a few funcs
        strictEqual(typeof log.clear, 'function');
        log.clear();
        strictEqual(typeof log.profileEnd, 'function');
        log.profileEnd(t.name); // should not throw
        strictEqual(typeof log.timeStamp, 'function');
        log.timeStamp(t.name);
        strictEqual(typeof log.groupEnd, 'function');
        log.groupEnd();
    });

    test('logger scopes', (t) => {
        const nullFn = mock.fn();
        const log = logger.createLogger(t.name, logger.LogLevel.INFO, makeConsole(nullFn));
        const sub1 = log.scoped('sub1');
        const sub2 = sub1.scoped('sub2', logger.LogLevel.ERROR);

        strictEqual(sub1.conf.scope, `${t.name}.sub1`);
        strictEqual(sub2.conf.scope, `${t.name}.sub1.sub2`);
        strictEqual(sub1.level, log.level);
        strictEqual(sub2.level, logger.LogLevel.ERROR);

        sub2.info('below level - should not log');
        sub2.error('test');
        strictEqual(nullFn.mock.calls.length, 1);
    });

    test('logger with formatter func', (t) => {
        const nullFn = mock.fn((str) => {
            ok(str.includes('<6>')); // info level
            ok(str.includes('syslogTest'));
            ok(str.includes(t.name));
        });

        function fmt(this: logger.LoggerConf, lvl: logger.LogLevel, fn: logger.LogFn, _chalk: unknown, ...params: unknown[]) {
            fn(`<${lvl}> ${this.scope}: ${format(...params)}`);
        }

        const log = logger.createLogger(t.name, logger.LogLevel.INFO, makeConsole(nullFn), { formatter: fmt });
        log.info('syslogTest');
        strictEqual(nullFn.mock.calls.length, 1);
    });

    test('invalid formatter throws', (t) => {
        throws(() => {
            logger.createLogger(t.name, logger.LogLevel.INFO, makeConsole(mock.fn()), {
                formatter: 'invalid' as unknown as 'json',
            });
        }, /Invalid formatter/);
    });

    test('logger with object pool', (t) => {
        const nullFn = mock.fn((obj) => {
            strictEqual(typeof obj, 'object');
            strictEqual(typeof obj.message, 'string');
            strictEqual(obj.message, 'foo:bar');
            strictEqual(obj.ctx, t.name);
        });

        const log = logger.createLogger(t.name, logger.LogLevel.INFO, makeConsole(nullFn), {
            formatter: 'json',
        });
        log.log('foo:%s', 'bar');
        strictEqual(nullFn.mock.calls.length, 1);
    });

    // Speed logger tests
    test('speed logger works', async (_t) => {
        const write = mock.fn<FnW>((txt: string) => {
            ok(['error1\nerror2\n', '{"log1":1}\n'].indexOf(txt) > -1);
            return true;
        });
        const once = mock.fn<FnO>();
        const nullStream = {
            write,
            once,
        } as unknown as NodeJS.WritableStream;

        const speedLog = new logger.SpeedStd(nullStream, nullStream, 5, 5);
        speedLog.error('error1');
        speedLog.error('error2');
        speedLog.log({ log1: 1 });
        await sleep(20);
        strictEqual(write.mock.calls.length, 2);
        strictEqual(once.mock.calls.length, 0);
    });

    test('speed logger flushMax parameter', async (_t) => {
        const write = mock.fn<FnW>((txt: string) => {
            strictEqual(typeof txt, 'string');
            return true;
        });
        const once = mock.fn<FnO>();
        const nullStream = {
            write,
            once,
        } as unknown as NodeJS.WritableStream;

        const speedLog = new logger.SpeedStd(nullStream, nullStream, 5, 1);
        speedLog.error('error1');
        speedLog.error('error2');
        speedLog.log('log1');
        await sleep(10);
        strictEqual(write.mock.calls.length, 3);
        strictEqual(once.mock.calls.length, 0);
    });

    test('speed logger max retries', async (_t) => {
        const write = mock.fn<FnW>(() => false);
        const once = mock.fn((_name: string, fn: (...args: unknown[]) => void) => {
            setImmediate((...args: unknown[]) => fn(...args));
        });
        const nullStream = {
            write,
            once,
        } as unknown as NodeJS.WritableStream;

        const speedLog = new logger.SpeedStd(nullStream, nullStream, 10, 1);
        speedLog.error('error1');
        await sleep(10);
        strictEqual(write.mock.calls.length, 3);
        strictEqual(once.mock.calls.length, 2);
    });

    test('speed logger a transport for createLogger', async (t) => {
        const save = process.env.LOG_FORMAT;
        try {
            process.env.LOG_FORMAT = 'json';
            const write = mock.fn<FnW>((txt: string) => {
                ok(txt.indexOf(`,"ctx":"${t.name}"`) > 0);
                return true;
            });
            const once = mock.fn<FnO>();
            const nullStream = {
                write,
                once,
            } as unknown as NodeJS.WritableStream;

            const speedLog = new logger.SpeedStd(nullStream, nullStream, 10, 10);
            const log = logger.createLogger(t.name, logger.LogLevel.DEBUG, speedLog);
            log.error('error1');
            log.error('error2');
            log.log('log1');
            await sleep(30);
            strictEqual(write.mock.calls.length, 2);
            strictEqual(once.mock.calls.length, 0);
        } finally {
            process.env.LOG_FORMAT = save;
        }
    });

    // hookConsole tests
    test('hookConsole and unhookConsole are idempotent', async (t) => {
        // Save current state (may be wrapped from test-output-filter.ts)
        const currentConsole = { ...console };

        // First, unhook any existing hooks to reset the hookConsole state
        const resetUnhook = logger.hookConsole();
        resetUnhook();

        // Check if test-output-filter.ts stored originals, restore those
        const g = globalThis as {
            __originalConsoleLog?: typeof console.log;
            __originalConsoleInfo?: typeof console.info;
            __originalConsoleError?: typeof console.error;
            __originalConsoleWarn?: typeof console.warn;
            __originalConsoleDebug?: typeof console.debug;
            __originalConsoleTrace?: typeof console.trace;
        };

        try {
            if (g.__originalConsoleLog) {
                console.log = g.__originalConsoleLog;
                console.info = g.__originalConsoleInfo!;
                console.error = g.__originalConsoleError!;
                console.warn = g.__originalConsoleWarn!;
                console.debug = g.__originalConsoleDebug!;
                console.trace = g.__originalConsoleTrace!;
            } else {
                // Fallback: create fresh console
                const { Console } = await import('node:console');
                const originalConsole = new Console({ stdout: process.stdout, stderr: process.stderr });
                Object.assign(console, originalConsole);
            }

            // validate we're starting with original functions (may be bound from filter)
            ok(console.log.name === 'log' || console.log.name === 'bound log');
            const unhook = logger.hookConsole(logger.createLogger(t.name));
            logger.hookConsole(); // should not throw or double-hook
            unhook();
            unhook(); // should not throw or double-unhook
            // validate we're ending with original
            ok(console.log.name === 'log' || console.log.name === 'bound log');
        } finally {
            // Restore previous state (may be wrapped)
            Object.assign(console, currentConsole);
        }
    });

    test('hookConsole actually hooks and unhooks', async (t) => {
        // Save current state
        const currentConsole = { ...console };

        // First, unhook any existing hooks to reset the hookConsole state
        const resetUnhook = logger.hookConsole();
        resetUnhook();

        // Create a fresh console to use as reference for original state
        const { Console } = await import('node:console');
        const originalConsole = new Console({ stdout: process.stdout, stderr: process.stderr });

        // Check if test-output-filter.ts stored originals, restore those to global console
        const g = globalThis as {
            __originalConsoleLog?: typeof console.log;
            __originalConsoleInfo?: typeof console.info;
            __originalConsoleError?: typeof console.error;
            __originalConsoleWarn?: typeof console.warn;
            __originalConsoleDebug?: typeof console.debug;
            __originalConsoleTrace?: typeof console.trace;
        };
        if (g.__originalConsoleLog) {
            console.log = g.__originalConsoleLog;
            console.info = g.__originalConsoleInfo!;
            console.error = g.__originalConsoleError!;
            console.warn = g.__originalConsoleWarn!;
            console.debug = g.__originalConsoleDebug!;
            console.trace = g.__originalConsoleTrace!;
        } else {
            // Fallback: use fresh console
            Object.assign(console, originalConsole);
        }

        try {
            // validate we're starting with original functions (may be bound from filter)
            ok(console.log.name === 'log' || console.log.name === 'bound log');

            const unhook = logger.hookConsole(logger.createLogger(t.name));

            // All methods should have been replaced
            for (const key of ['debug', 'trace', 'info', 'warn', 'error'] as const) {
                ok(typeof console[key] === 'function');
                notEqual(console[key].name, originalConsole[key].name);
            }

            unhook();
            // Should be restored (may be bound from filter, so check both)
            for (const key of ['debug', 'trace', 'info', 'warn', 'error'] as const) {
                ok(typeof console[key] === 'function');
                // Check name matches or is bound version (from test-output-filter)
                ok(
                    console[key].name === originalConsole[key].name || console[key].name === `bound ${originalConsole[key].name}`,
                    `Expected ${console[key].name} to be ${originalConsole[key].name} or bound ${originalConsole[key].name}`,
                );
            }
        } finally {
            // Restore previous state
            Object.assign(console, currentConsole);
        }
    });
});
