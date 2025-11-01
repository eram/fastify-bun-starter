// !!! DO NOT IMPORT env, POJO or ExtendedError !!!

import cluster from 'node:cluster';
import inspector from 'node:inspector';
import path from 'node:path';
import process from 'node:process';
import { format, styleText } from 'node:util';
import { ObjectPool, PoolObject } from './objectPool';
import { POJO } from './pojo';

/**
 * Logger is a replacement for console logger:
 * - high performance async output (much faster than using pino)
 * - log levels (will not output below the set level)
 * - JSON output with context (optional)
 * - colors on line output to stdout (optional. using styledText is much slower than line)
 *
 * You can also hook the global console to use this logger while calling standard console methods.
 *
 * Logger configuration environment variables:
 * LOG_LEVEL: The minimum level of messages that will be logged. Default: "INFO".
 * LOG_NAME: The name of the logger, defaults to process info. Default: process.title.
 * LOG_FORMAT: The log output format, can be "json", "line". Default: json unless a debugger is attached.
 * LOG_ADD_TIME: If "true", adds a timestamp to each log message. Default: false.
 * APP_NAME: The application name to include in JSON logs. Default: process.execPath
 */

// RFC5424: syslog levels
export enum LogLevel {
    EMERGENCY = 0,
    ALERT = 1,
    CRITICAL = 2,
    ERROR = 3,
    WARNING = 4,
    NOTICE = 5,
    INFO = 6,
    DEBUG = 7,
}

// chalk colors to match LogLevels
type Chalk = Parameters<typeof styleText>[0];
export type ChalkFn = typeof styleText;
export type LogFn = typeof console.log;
export type Formatter = (this: LoggerConf, lvl: LogLevel, fn: LogFn, chalk: Chalk, ...params: unknown[]) => void;
export type Transport = Pick<Console, 'log' | 'error'>;

export type LoggerOptions = Partial<
    Omit<LoggerConf, 'level' | 'formatter'> & { level?: LogLevel | keyof typeof LogLevel } & {
        // level as number or string
        formatter?: Formatter | 'json' | 'line';
    }
>; // formatter as function or "json" or "line"
const registrar = new Map<string, Logger>();

export class LoggerConf {
    level: LogLevel;
    readonly scope: string;
    readonly addTime: boolean;
    readonly chalkFn: ChalkFn;
    readonly formatter: Formatter;
    readonly app: string;
    readonly useObjectPool: boolean;

    constructor({
        scope = this._defName(),
        level = (process.env.LOG_LEVEL ?? LogLevel.INFO) as LogLevel,
        addTime = (process.env.LOG_ADD_TIME ?? 'false').toLowerCase() === 'true',
        formatter = (process.env.LOG_FORMAT ?? (isDebuggerAttached() ? 'line' : 'json')).toLowerCase() === 'json'
            ? jsonFn
            : lineFn,
        chalkFn = styleText,
        app = process.env.APP_NAME ?? path.basename(process.execPath),
        useObjectPool = false, // most objects are very small - the pool does not help much
    }: LoggerOptions = {}) {
        this.scope = scope;
        this.level = LoggerConf._normalizeLevel(level);
        this.addTime = addTime;
        this.chalkFn = chalkFn;
        this.formatter = formatter === 'json' ? jsonFn : formatter === 'line' ? lineFn : formatter;
        assertFn.call(this, typeof this.formatter === 'function', 'Invalid formatter');
        this.app = app;
        this.useObjectPool = useObjectPool;
    }

    private _defName() {
        const name = process.env.LOG_NAME ?? process.env.LOGNAME;
        return name || `${process.pid}:${cluster.isWorker ? (cluster.worker?.id ?? 'worker') : 'main'}`;
    }

    static _normalizeLevel(level: string | number): LogLevel {
        // LOG_LEVEL can be a number 0-7 or a level string (e.g. "SILLY")

        if (typeof level === 'number' && level >= LogLevel.EMERGENCY && level <= LogLevel.DEBUG) {
            return level;
        }

        level = String(level);
        level = LoggerConf.MAP[level.toLowerCase()] ?? level;
        level = Number(level) || Number(LogLevel[level.toUpperCase() as keyof typeof LogLevel]) || -1;
        return level >= LogLevel.EMERGENCY && level <= LogLevel.DEBUG ? level : LogLevel.INFO;
    }

    // map some constant strings from other logging libraries
    static readonly MAP: Record<string, string> = {
        warn: 'WARNING',
        informational: 'INFO',
        log: 'INFO',
        verbose: 'DEBUG',
        silly: 'DEBUG',
    };
}

export interface Logger extends Readonly<Transport>, Readonly<Console> {
    readonly notice: LogFn;
    readonly warning: LogFn;
    readonly alert: LogFn;
    readonly crit: LogFn;
    readonly critical: LogFn;
    readonly emerg: LogFn;
    readonly conf: LoggerConf;
    level: LogLevel;
    scoped(name: string, level?: LogLevel): Logger;
}

/**
 * Checks if the Node.js process is running under a connected debugger.
 * This is useful to determine if we should log more detailed information.
 * @returns {boolean} True if the process is running under a debugger.
 */
let _attached: boolean | undefined;
export function isDebuggerAttached() {
    return (
        _attached ??
        (_attached =
            typeof process === 'object' &&
            typeof process.debugPort === 'number' &&
            process.debugPort !== 0 &&
            typeof inspector.url() === 'string')
    );
}

// Poolable log entry object for JSON formatter
class LogEntry extends PoolObject {
    message?: string;
    ctx?: string;
    type?: string;
    timestamp?: string;
    // biome-ignore lint/style/useNamingConvention: common log format
    process_id?: number;
    // biome-ignore lint/style/useNamingConvention: common log format
    app_name?: string;

    init(message: string, ctx: string, type: string, pid: number, app: string, timestamp?: string) {
        this.message = message;
        this.ctx = ctx;
        this.type = type;
        this.process_id = pid;
        this.app_name = app;
        this.timestamp = timestamp;
        return this;
    }
}

const pool = new ObjectPool(LogEntry, 0);

// Formatter for json output
function jsonFn(this: LoggerConf, lvl: LogLevel, fn: LogFn, _chalk: Chalk, ...params: unknown[]) {
    if (lvl <= this.level) {
        let out: LogEntry;
        const message = format(...params);
        const type = lvl >= LogLevel.ERROR ? 'out' : 'err';
        const timestamp = this.addTime ? new Date().toUTCString() : undefined;

        if (this.useObjectPool) {
            out = pool.acquire(message, this.scope, type, process.pid, this.app, timestamp);
        } else {
            out = Object({
                message,
                ctx: this.scope,
                type,
                process_id: process.pid,
                app_name: this.app,
                timestamp,
            });
        }
        fn(out);
    }
}

// Formatter for line output
function lineFn(this: LoggerConf, lvl: LogLevel, fn: LogFn, chalk: Chalk, ...params: unknown[]) {
    if (lvl <= this.level) {
        // biome-ignore lint/style/useTemplate: internal whitespace
        const out = `${this.addTime ? new Date().toISOString() + ' ' : ''}${this.scope ? `[${this.scope}] ` : ''}${format(...params)}`;
        fn(this.chalkFn(chalk, out));
    }
}

function assertFn(this: LoggerConf, condition?: boolean, ...data: unknown[]) {
    if (condition) return;
    // Replaced CustomError with standard Error
    class AssertError extends Error {
        constructor(message: string) {
            super(message);
            this.name = 'AssertError';
        }
    }
    throw new AssertError(data.length > 0 ? format(...data) : 'Assertion failed');
}

// create a new logger scoped to a sub-name
function scoped(this: Logger, sub: string, level?: LogLevel): Logger {
    const fullName = `${this.conf.scope}.${sub}`;
    return createLogger(fullName, level, this);
}

/**
 * Creates a logger instance with the specified name, log level, and base logger.
 * Returns a logger object with methods for each log level.
 * @param scope Optional logger name (defaults to process name)
 * @param level Optional log level (defaults to env or info)
 * @param base Optional base logger (defaults to console)
 */
export function createLogger(
    scope?: string,
    level?: LoggerOptions['level'],
    base?: Transport | Console | Logger,
    _options: LoggerOptions = {},
): Logger {
    const options: LoggerOptions = { ..._options, scope: scope ?? _options.scope, level: level ?? _options.level };
    const conf = new LoggerConf(options);
    let logger = registrar.get(conf.scope);
    if (logger) {
        logger.level = conf.level;
        return logger;
    }

    // when debugging we dont take console intead of SpeedStd because it makes it hard to debug.
    // make sure required transport functions are there.
    base ??= isDebuggerAttached() ? console : new SpeedStd();
    const { log, error } = base;
    if (typeof log !== 'function' || typeof error !== 'function') {
        throw new TypeError('Base logger must have log and error methods');
    }

    // create the logger object from the console (for non-logging funcs) and baseLogger.
    // bind all logging functions to the selected log function with defined parameters.
    logger = Object.assign({}, console, base, {
        log: conf.formatter.bind(conf, LogLevel.INFO, log, 'blue'),
        error: conf.formatter.bind(conf, LogLevel.ERROR, error, 'red'),

        warn: conf.formatter.bind(conf, LogLevel.WARNING, log, 'yellow'),
        info: conf.formatter.bind(conf, LogLevel.INFO, log, 'blue'),
        debug: conf.formatter.bind(conf, LogLevel.DEBUG, log, 'grey'),
        trace: conf.formatter.bind(conf, LogLevel.DEBUG, log, 'grey'),

        emerg: conf.formatter.bind(conf, LogLevel.EMERGENCY, error, 'red'),
        alert: conf.formatter.bind(conf, LogLevel.ALERT, error, 'red'),
        crit: conf.formatter.bind(conf, LogLevel.CRITICAL, error, 'red'),
        critical: conf.formatter.bind(conf, LogLevel.CRITICAL, error, 'red'),
        warning: conf.formatter.bind(conf, LogLevel.WARNING, log, 'yellow'),
        notice: conf.formatter.bind(conf, LogLevel.NOTICE, log, 'blue'),

        assert: assertFn.bind(conf),
        clear: Object(base).flush ?? console.clear, // clear should flush (if exists)
        conf,
        scoped,
    }) as Logger;

    // getter/setter cannot be added via Object.assign
    Object.defineProperty(logger, 'level', {
        get() {
            return this.conf.level;
        },
        set(lv: LogLevel | keyof typeof LogLevel) {
            this.conf.level = LoggerConf._normalizeLevel(lv);
        },
        enumerable: true,
        configurable: false,
    });

    logger.scoped = scoped.bind(logger);

    registrar.set(conf.scope, logger);
    return logger;
}

/**
 * SpeedStd is a high-performance logger for Node.js applications.
 * It borrows from pino to batch log messages and write them asynchronously.
 * See scripts/logger_stress_test.js for performance comparison.
 */
export class SpeedStd implements Transport {
    protected groups: { err: boolean; txts: (object | string)[] }[] = [];
    protected timer: NodeJS.Timeout | 0 = 0;
    log = this._out.bind(this, false);
    error = this._out.bind(this, true);

    constructor(
        protected stdout: NodeJS.WritableStream = process.stdout,
        protected stderr: NodeJS.WritableStream = process.stderr,
        protected interval = 50,
        protected flushMax = 100,
    ) {}

    private _out(err: boolean, txt: string | object): void {
        const last = this.groups[this.groups.length - 1];
        if (last && last.err === err) {
            last.txts.push(txt);
        } else {
            this.groups.push({ err, txts: [txt] });
        }
        if (!this.timer) {
            this.timer = setInterval(() => this.flush(), this.interval);
        }
        if (this.groups.length >= this.flushMax) {
            this.flush();
        }
    }

    flush() {
        if (this.groups.length) {
            let group: (typeof this.groups)[0] | undefined;
            while ((group = this.groups.shift())) {
                const stream = group.err ? this.stderr : this.stdout;
                const txt = `${group.txts
                    .map((v) => (typeof v === 'string' ? v : POJO.stringify(v, undefined, 0)))
                    .join('\n')}\n`;
                const tryWrite = (attempt: number) => {
                    if (!stream.write(txt) && attempt < 3) stream.once('drain', () => tryWrite(attempt + 1));
                };
                tryWrite(1);
            }
        } else if (this.timer) {
            clearInterval(this.timer);
            this.timer = 0;
        }
    }
}

// Global logger based on speedy with flush on exit
export const logger = (() => {
    const speedy = new SpeedStd();
    process.on('exit', speedy.flush.bind(speedy));
    return createLogger(undefined, undefined, speedy);
})();

// shorthands to make it easier to import
export const { error, warn, info, debug, assert } = logger;

/**
 * Hook Console
 * Shims the global console methods to use the custom logger implementation.
 * Only hooks once per process.
 */

const consoleHooks = ['debug', 'trace', 'log', 'info', 'warn', 'error'];
const save = { hooked: false };

export function hookConsole(_logger = logger) {
    if (!save.hooked) {
        const con = globalThis.console || require('node:console');
        consoleHooks.forEach((key) => {
            Object(save)[key] = Object(con)[key];
            Object(con)[key] = Object(_logger)[key];
        });
        save.hooked = true;
    }
    return function unhook() {
        if (save.hooked) {
            const hooked = globalThis.console || require('node:console');
            consoleHooks.forEach((key) => {
                Object(hooked)[key] = Object(save)[key];
            });
            save.hooked = false;
        }
    };
}
