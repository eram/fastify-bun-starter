import { describe, expect, mock, spyOn, test } from 'bun:test';
import { format } from 'node:util';
import { sleep } from '@libs/utils/time';
import * as logger from './logger';
import { warn } from './logger';

const makeConsole = (nullFn: logger.Transport[`log`]): logger.Transport => ({ log: nullFn, error: nullFn });

type FnW = typeof process.stdout.write;
type FnO = typeof process.stdout.once;

describe('logger tests', () => {
    test('logs thru logger function', () => {
        const testName = 'logs thru logger function';
        const nullFn = mock((str: string) => {
            expect(typeof str).toBe('string');
            expect(str.includes('should log')).toBeTruthy();
        });
        const log = logger.createLogger(
            testName,
            logger.LogLevel.ERROR,
            makeConsole(nullFn),
            // these options should be ignored!
            { level: logger.LogLevel.CRITICAL, scope: `zib2`, formatter: 'line' },
        );

        expect(log.conf.scope).toBe(testName);
        expect(log.conf.level).toBe(logger.LogLevel.ERROR);
        log.warn('should not log');
        log.error({ a: 'should log' });
        expect(nullFn.mock.calls.length).toBe(1);
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

    test('created only once for the same name', () => {
        const testName = 'created only once for the same name';
        const log1 = logger.createLogger(testName, logger.LogLevel.DEBUG);
        expect(log1).not.toBe(undefined);
        expect(typeof log1.critical).toBe('function');
        Object(log1).marker = Math.random().toString(6);

        const log2 = logger.createLogger(testName, logger.LogLevel.ERROR);
        expect(log1).toEqual(log2);
        expect(Object(log1).marker).toBe(Object(log2).marker);
        expect(log1.conf.level).toBe(logger.LogLevel.ERROR);
    });

    test('logs with formatting', () => {
        const testName = 'logs with formatting';
        const nullFn = mock((str) => {
            if (typeof str !== 'string') return; // sometimes i get here an object....
            expect(str.includes('foo:bar')).toBeTruthy();
        });
        const log = logger.createLogger(testName, logger.LogLevel.ERROR, makeConsole(nullFn));
        log.error('%s:%s', 'foo', 'bar');
        expect(nullFn.mock.calls.length).toBe(1);
    });

    test('emerg always logged thru error function', () => {
        const testName = 'emerg always logged thru error function';
        const nullFn = mock();
        const log = logger.createLogger(testName, logger.LogLevel.EMERGENCY, makeConsole(nullFn));
        log.emerg('test emerg');
        expect(nullFn.mock.calls.length).toBe(1);
    });

    test('json logger with params', () => {
        const testName = 'json logger with params';
        const save = process.env.LOG_FORMAT;
        try {
            const nullFn = mock((obj: Record<string, unknown>) => {
                expect(typeof obj).toBe('object');
                expect(typeof obj.message).toBe('string');
                expect(obj.message).toBe('foo:bar');
                expect(obj.ctx).toBe(testName);
            });

            process.env.LOG_FORMAT = 'json';
            const log = logger.createLogger(testName, logger.LogLevel.INFO, makeConsole(nullFn));
            log.log('%s:%s', 'foo', 'bar');
            expect(nullFn.mock.calls.length).toBe(1);
        } finally {
            process.env.LOG_FORMAT = save;
        }
    });

    test('log with time', () => {
        const testName = 'log with time';
        const save = { ...process.env };
        const fn = mock((str: string) => {
            expect(str).toMatch(/\d{1,2}T\d{1,2}:\d{1,2}:\d{1,2}\.\d{1,3}Z/);
        });
        try {
            process.env.LOG_ADD_TIME = 'true';
            process.env.LOG_FORMAT = 'line';
            // Use a custom console object instead of mocking the global one
            const customConsole = makeConsole(fn);
            const log = logger.createLogger(testName, logger.LogLevel.INFO, customConsole);
            delete process.env.LOG_ADD_TIME;
            log.info('logs with time');
            expect(fn.mock.calls.length).toBe(1);
        } finally {
            Object.assign(process.env, save);
        }
    });

    test('check all types of log levels', () => {
        const testName = 'check all types of log levels';
        const nullFn = mock();
        const log = logger.createLogger(testName, logger.LogLevel.DEBUG, makeConsole(nullFn));
        log.debug(1);
        log.trace(2);
        log.info(3);
        log.warn(4);
        log.error(5);
        log.critical(6);
        expect(nullFn.mock.calls.length).toBe(6);
    });

    test('check log only above log level', () => {
        const testName = 'check log only above log level';
        const nullFn = mock();
        const log = logger.createLogger(testName, logger.LogLevel.WARNING, makeConsole(nullFn));
        log.debug(0);
        log.trace(0);
        log.info(0);
        log.warn(1);
        log.error(2);
        log.critical(3);
        expect(nullFn.mock.calls.length).toBe(3);
    });

    test('check assertion failed throws', () => {
        const testName = 'check assertion failed throws';
        // global logger throws
        expect(() => {
            logger.assert(0, 'assertion1');
        }).toThrow(/assertion1/);

        // new logger throws
        const log = logger.createLogger(testName, logger.LogLevel.DEBUG, makeConsole(mock()));
        expect(() => {
            log.assert(false, 'assertion2');
        }).toThrow(/assertion2/);
    });

    test('createLogger LOG_LEVEL is normalized', () => {
        const testName = 'createLogger LOG_LEVEL is normalized';
        process.env.LOG_LEVEL = 'silly';
        const log = logger.createLogger(testName);
        expect(log.conf.level).toBe(logger.LogLevel.DEBUG);
        delete process.env.LOG_LEVEL;
    });

    test('createLogger uses LOG_LEVEL as number', () => {
        const testName = 'createLogger uses LOG_LEVEL as number';
        process.env.LOG_LEVEL = '2';
        const log = logger.createLogger(testName);
        expect(log.conf.level).toBe(logger.LogLevel.CRITICAL);
        delete process.env.LOG_LEVEL;
    });

    test('createLogger with/without time', () => {
        const testName = 'createLogger with/without time';
        const nullFn = mock();
        delete process.env.LOG_ADD_TIME;
        const log0 = logger.createLogger(`${testName}0`, logger.LogLevel.INFO, makeConsole(nullFn));
        log0.info('should not have time');

        // add time thru env var
        process.env.LOG_ADD_TIME = 'true';
        const log1 = logger.createLogger(`${testName}1`, logger.LogLevel.INFO, makeConsole(nullFn));
        log1.info('should have time');
        delete process.env.LOG_ADD_TIME;

        // add time thru option
        const log2 = logger.createLogger(`${testName}2`, logger.LogLevel.INFO, makeConsole(nullFn), { addTime: true });
        log2.info('should have time');

        expect(nullFn.mock.calls.length).toBe(3);
        const regex = /\d{1,2}T\d{1,2}:\d{1,2}:\d{1,2}\.\d{1,3}Z\s/;
        // @ts-expect-error - Mock calls are indexable
        expect(!nullFn.mock.calls[0][0].match(regex)).toBeTruthy();
        // @ts-expect-error - Mock calls are indexable
        expect(nullFn.mock.calls[1][0].match(regex)).toBeTruthy();
        // @ts-expect-error - Mock calls are indexable
        expect(nullFn.mock.calls[2][0].match(regex)).toBeTruthy();
    });

    test('createLogger with undefined logName and baseLogger', async () => {
        const testName = 'createLogger with undefined logName and baseLogger';
        process.stdout.write(''); // make sure stdout exists for the test
        const fn = spyOn(process.stdout, 'write').mockImplementation((_txt: string) => {
            return true;
        });
        try {
            // this should get the global async logger (SpeedStd).
            // We should see the log output after a short delay
            const log = logger.createLogger();
            expect(log).toBeTruthy();
            log.info(testName);
            await sleep(60); // must be larger than the default flush interval (50ms)

            // stdout may have been called by others while we slept
            expect(fn.mock.calls.length >= 1).toBeTruthy();
            const found = fn.mock.calls.find((c) => Array.isArray(c) && c[0].toString().includes(testName));
            expect(found).toBeTruthy();
        } finally {
            fn.mockRestore();
        }
    });

    test('assertion throw on failure', () => {
        const testName = 'assertion throw on failure';
        const log = logger.createLogger(testName, logger.LogLevel.INFO);
        expect(() => log.assert(true, 'should not throw')).not.toThrow();
        expect(() => log.assert(false, 'should throw')).toThrow(/should throw/);
    });

    test('jsonFn logs with all fields', () => {
        const testName = 'jsonFn logs with all fields';
        const nullFn = mock();
        const log = logger.createLogger(testName, logger.LogLevel.INFO, makeConsole(nullFn));
        log.level = logger.LogLevel.INFO;
        log.info('jsonTest');
        expect(nullFn.mock.calls.length === 1).toBeTruthy();
    });

    test('jsonFn does not log if below level', () => {
        const testName = 'jsonFn does not log if below level';
        const nullFn = mock();
        const log = logger.createLogger(testName, logger.LogLevel.WARNING, makeConsole(nullFn));
        log.info('should not log');
        expect(nullFn.mock.calls.length).toBe(0);
    });

    test('change level', () => {
        const testName = 'change level';
        const nullFn = mock();
        const log = logger.createLogger(testName, logger.LogLevel.CRITICAL, makeConsole(nullFn));
        log.debug('debugTest 1');
        log.critical('criticalTest 1');
        expect(nullFn.mock.calls.length).toBe(1);
        expect(log.level).toBe(logger.LogLevel.CRITICAL);

        log.level = logger.LogLevel.DEBUG;
        log.debug('debugTest 2');
        log.critical('criticalTest 2');
        expect(nullFn.mock.calls.length).toBe(3);
        expect(log.level).toBe(logger.LogLevel.DEBUG);
        expect(log.conf.level).toBe(logger.LogLevel.DEBUG);
    });

    test('other console funcs are alive', () => {
        const testName = 'other console funcs are alive';
        const log = logger.createLogger(testName, logger.LogLevel.INFO, makeConsole(mock()));

        // sample a few funcs
        expect(typeof log.clear).toBe('function');
        log.clear();
        expect(typeof log.profileEnd).toBe('function');
        log.profileEnd(testName); // should not throw
        expect(typeof log.timeStamp).toBe('function');
        log.timeStamp(testName);
        expect(typeof log.groupEnd).toBe('function');
        log.groupEnd();
    });

    test('logger scopes', () => {
        const testName = 'logger scopes';
        const nullFn = mock();
        const log = logger.createLogger(testName, logger.LogLevel.INFO, makeConsole(nullFn));
        const sub1 = log.scoped('sub1');
        const sub2 = sub1.scoped('sub2', logger.LogLevel.ERROR);

        expect(sub1.conf.scope).toBe(`${testName}.sub1`);
        expect(sub2.conf.scope).toBe(`${testName}.sub1.sub2`);
        expect(sub1.level).toBe(log.level);
        expect(sub2.level).toBe(logger.LogLevel.ERROR);

        sub2.info('below level - should not log');
        sub2.error('test');
        expect(nullFn.mock.calls.length).toBe(1);
    });

    test('logger with formatter func', () => {
        const testName = 'logger with formatter func';
        const nullFn = mock((str: string) => {
            expect(str.includes('<6>')).toBeTruthy(); // info level
            expect(str.includes('syslogTest')).toBeTruthy();
            expect(str.includes(testName)).toBeTruthy();
        });

        function fmt(this: logger.LoggerConf, lvl: logger.LogLevel, fn: logger.LogFn, _chalk: unknown, ...params: unknown[]) {
            fn(`<${lvl}> ${this.scope}: ${format(...params)}`);
        }

        const log = logger.createLogger(testName, logger.LogLevel.INFO, makeConsole(nullFn), { formatter: fmt });
        log.info('syslogTest');
        expect(nullFn.mock.calls.length).toBe(1);
    });

    test('invalid formatter throws', () => {
        const testName = 'invalid formatter throws';
        expect(() => {
            logger.createLogger(testName, logger.LogLevel.INFO, makeConsole(mock()), {
                formatter: 'invalid' as unknown as 'json',
            });
        }).toThrow(/Invalid formatter/);
    });

    test('logger with object pool', () => {
        const testName = 'logger with object pool';
        const nullFn = mock((obj: Record<string, unknown>) => {
            expect(typeof obj).toBe('object');
            expect(typeof obj.message).toBe('string');
            expect(obj.message).toBe('foo:bar');
            expect(obj.ctx).toBe(testName);
        });

        const log = logger.createLogger(testName, logger.LogLevel.INFO, makeConsole(nullFn), {
            formatter: 'json',
        });
        log.log('foo:%s', 'bar');
        expect(nullFn.mock.calls.length).toBe(1);
    });

    // Speed logger tests
    test('speed logger works', async () => {
        const write = mock<FnW>((txt: string) => {
            expect(['error1\nerror2\n', '{"log1":1}\n'].indexOf(txt) > -1).toBeTruthy();
            return true;
        });
        const once = mock<FnO>();
        const nullStream = {
            write,
            once,
        } as unknown as NodeJS.WritableStream;

        const speedLog = new logger.SpeedStd(nullStream, nullStream, 5, 5);
        speedLog.error('error1');
        speedLog.error('error2');
        speedLog.log({ log1: 1 });
        await sleep(20);
        expect(write.mock.calls.length).toBe(2);
        expect(once.mock.calls.length).toBe(0);
    });

    test('speed logger flushMax parameter', async () => {
        const write = mock<FnW>((txt: string) => {
            expect(typeof txt).toBe('string');
            return true;
        });
        const once = mock<FnO>();
        const nullStream = {
            write,
            once,
        } as unknown as NodeJS.WritableStream;

        const speedLog = new logger.SpeedStd(nullStream, nullStream, 5, 1);
        speedLog.error('error1');
        speedLog.error('error2');
        speedLog.log('log1');
        await sleep(10);
        expect(write.mock.calls.length).toBe(3);
        expect(once.mock.calls.length).toBe(0);
    });

    test('speed logger max retries', async () => {
        const write = mock<FnW>(() => false);
        const once = mock((_name: string, fn: (...args: unknown[]) => void) => {
            setImmediate((...args: unknown[]) => fn(...args));
        });
        const nullStream = {
            write,
            once,
        } as unknown as NodeJS.WritableStream;

        const speedLog = new logger.SpeedStd(nullStream, nullStream, 10, 1);
        speedLog.error('error1');
        await sleep(10);
        expect(write.mock.calls.length).toBe(3);
        expect(once.mock.calls.length).toBe(2);
    });

    test('speed logger a transport for createLogger', async () => {
        const testName = 'speed logger a transport for createLogger';
        const save = process.env.LOG_FORMAT;
        try {
            process.env.LOG_FORMAT = 'json';
            const write = mock<FnW>((txt: string) => {
                expect(txt.indexOf(`,"ctx":"${testName}"`) > 0).toBeTruthy();
                return true;
            });
            const once = mock<FnO>();
            const nullStream = {
                write,
                once,
            } as unknown as NodeJS.WritableStream;

            const speedLog = new logger.SpeedStd(nullStream, nullStream, 10, 10);
            const log = logger.createLogger(testName, logger.LogLevel.DEBUG, speedLog);
            log.error('error1');
            log.error('error2');
            log.log('log1');
            await sleep(30);
            expect(write.mock.calls.length).toBe(2);
            expect(once.mock.calls.length).toBe(0);
        } finally {
            process.env.LOG_FORMAT = save;
        }
    });

    // hookConsole tests
    test('hookConsole and unhookConsole are idempotent', async () => {
        const testName = 'hookConsole and unhookConsole are idempotent';
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
            expect(console.log.name === 'log' || console.log.name === 'bound log').toBeTruthy();
            const unhook = logger.hookConsole(logger.createLogger(testName));
            logger.hookConsole(); // should not throw or double-hook
            unhook();
            unhook(); // should not throw or double-unhook
            // validate we're ending with original
            expect(console.log.name === 'log' || console.log.name === 'bound log').toBeTruthy();
        } finally {
            // Restore previous state (may be wrapped)
            Object.assign(console, currentConsole);
        }
    });

    test('hookConsole actually hooks and unhooks', async () => {
        const testName = 'hookConsole actually hooks and unhooks';
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
            expect(console.log.name === 'log' || console.log.name === 'bound log').toBeTruthy();

            const unhook = logger.hookConsole(logger.createLogger(testName));

            // All methods should have been replaced
            for (const key of ['debug', 'trace', 'info', 'warn', 'error'] as const) {
                expect(typeof Object(console)[key]).toBe('function');
                expect(Object(console)[key].name).not.toBe(Object(originalConsole)[key].name);
            }

            unhook();
            // Should be restored (may be bound from filter, so check both)
            for (const key of ['debug', 'trace', 'info', 'warn', 'error'] as const) {
                expect(typeof Object(console)[key]).toBe('function');
                // Check name matches or is bound version (from test-output-filter)
                const consoleFnName = Object(console)[key].name;
                const originalFnName = Object(originalConsole)[key].name;
                expect(consoleFnName === originalFnName || consoleFnName === `bound ${originalFnName}`).toBeTruthy();
            }
        } finally {
            // Restore previous state
            Object.assign(console, currentConsole);
        }
    });
});
