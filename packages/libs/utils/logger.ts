// !!! DO NOT IMPORT env or ExtendedError !!!

import cluster from 'node:cluster';
import path from 'node:path';
import process from 'node:process';
import { format, styleText } from 'node:util';
import { isDebugging } from '@libs/utils/debugger';
import pkg from '../../../package.json' with { type: 'json' };
import { replacerFn } from './immutable';

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
 * APP_NAME: The application name to include in JSON logs. Default: package.json name or process.execPath
 */

// RFC5424: syslog levels
// biome-ignore lint/style/useNamingConvention: enum-replacement pattern (erasableSyntaxOnly forbids real enum); PascalCase matches the merged `type LogLevel` below
export const LogLevel = {
    EMERGENCY: 0,
    ALERT: 1,
    CRITICAL: 2,
    ERROR: 3,
    WARNING: 4,
    NOTICE: 5,
    INFO: 6,
    DEBUG: 7,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

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
    /** Current log level threshold */
    level: LogLevel;
    /** Logger scope/name identifier */
    readonly scope: string;
    /** Whether to add timestamp to logs */
    readonly addTime: boolean;
    /** Function for styling text output */
    readonly chalkFn: ChalkFn;
    /** Log formatter function (json or line) */
    readonly formatter: Formatter;
    /** Application name for logs */
    app: string;

    constructor({
        scope = this._defName(),
        level = (process.env['LOG_LEVEL'] ?? LogLevel.INFO) as LogLevel,
        addTime = (process.env['LOG_ADD_TIME'] ?? 'false').toLowerCase() === 'true',
        formatter = (process.env['LOG_FORMAT'] ?? (isDebugging() ? 'line' : 'json')).toLowerCase() === 'json' ? jsonFn : lineFn,
        chalkFn = styleText,
        app = process.env['APP_NAME'] ?? pkg.name ?? path.basename(process.execPath),
    }: LoggerOptions = {}) {
        this.scope = scope;
        this.level = LoggerConf._normalizeLevel(level);
        this.addTime = addTime;
        this.chalkFn = chalkFn;
        this.formatter = formatter === 'json' ? jsonFn : formatter === 'line' ? lineFn : formatter;
        assertFn.call(this, typeof this.formatter === 'function', 'Invalid formatter');
        this.app = app;
    }

    private _defName() {
        const name = process.env['LOG_NAME'] ?? process.env['LOGNAME'];
        return name || `${process.pid}:${cluster.isWorker ? (cluster.worker?.id ?? 'worker') : 'main'}`;
    }

    static _normalizeLevel(level: string | number): LogLevel {
        // LOG_LEVEL can be a number 0-7 or a level string (e.g. "SILLY")

        if (typeof level === 'number' && level >= LogLevel.EMERGENCY && level <= LogLevel.DEBUG) {
            return level as LogLevel;
        }

        level = String(level);
        level = LoggerConf.MAP[level.toLowerCase()] ?? level;
        level = Number(level) || Number(LogLevel[level.toUpperCase() as keyof typeof LogLevel]) || -1;
        return level >= LogLevel.EMERGENCY && level <= LogLevel.DEBUG ? (level as LogLevel) : LogLevel.INFO;
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

// Formatter for json output
function jsonFn(this: LoggerConf, lvl: LogLevel, fn: LogFn, _chalk: Chalk, ...params: unknown[]) {
    if (lvl <= this.level) {
        const message = format(...params);
        const type = lvl >= LogLevel.ERROR ? 'out' : 'err';
        const timestamp = this.addTime ? new Date().toUTCString() : undefined;

        const out = {
            message,
            ctx: this.scope,
            type,
            process_id: process.pid,
            app_name: this.app,
            timestamp,
        };
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

// [propName, level, useErrorFn, chalkColor] - drives the per-level method binding in createLogger
const LEVEL_BINDINGS: [keyof Logger, LogLevel, boolean, Chalk][] = [
    ['log', LogLevel.INFO, false, 'blue'],
    ['error', LogLevel.ERROR, true, 'red'],
    ['warn', LogLevel.WARNING, false, 'yellow'],
    ['info', LogLevel.INFO, false, 'blue'],
    ['debug', LogLevel.DEBUG, false, 'grey'],
    ['trace', LogLevel.DEBUG, false, 'grey'],
    ['emerg', LogLevel.EMERGENCY, true, 'red'],
    ['alert', LogLevel.ALERT, true, 'red'],
    ['crit', LogLevel.CRITICAL, true, 'red'],
    ['critical', LogLevel.CRITICAL, true, 'red'],
    ['warning', LogLevel.WARNING, false, 'yellow'],
    ['notice', LogLevel.NOTICE, false, 'blue'],
];

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
    const resolvedScope = scope ?? _options.scope;
    const resolvedLevel = level ?? _options.level;
    const options: LoggerOptions = {
        ..._options,
        ...(resolvedScope !== undefined ? { scope: resolvedScope } : {}),
        ...(resolvedLevel !== undefined ? { level: resolvedLevel } : {}),
    };
    const conf = new LoggerConf(options);
    let logger = registrar.get(conf.scope);
    if (logger) {
        logger.level = conf.level;
        return logger;
    }

    // when debugging we dont take console intead of SpeedStd because it makes it hard to debug.
    // make sure required transport functions are there.
    base ??= isDebugging() ? console : new SpeedStd();
    const { log, error } = base;
    if (typeof log !== 'function' || typeof error !== 'function') {
        throw new TypeError('Base logger must have log and error methods');
    }

    // create the logger object from the console (for non-logging funcs) and baseLogger.
    // bind all logging functions to the selected log function with defined parameters.
    const levelFns = Object.fromEntries(
        LEVEL_BINDINGS.map(([name, lvl, useError, chalk]) => [
            name,
            conf.formatter.bind(conf, lvl, useError ? error : log, chalk),
        ]),
    );
    logger = Object.assign({}, console, base, levelFns, {
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
    protected stdout: NodeJS.WritableStream;
    protected stderr: NodeJS.WritableStream;
    protected interval: number;
    protected flushMax: number;
    log = this._out.bind(this, false);
    error = this._out.bind(this, true);

    constructor(
        stdout: NodeJS.WritableStream = process.stdout,
        stderr: NodeJS.WritableStream = process.stderr,
        interval = 50,
        flushMax = 100,
    ) {
        this.stdout = stdout;
        this.stderr = stderr;
        this.interval = interval;
        this.flushMax = flushMax;
    }

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
                    .map((v) => (typeof v === 'string' ? v : JSON.stringify(v, replacerFn, 0)))
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
 * @param appName Optional app/project name to attach to the logger (e.g. the calling app's package.json name),
 * overriding the default resolved from APP_NAME env or the root package.json.
 */

const consoleHooks = ['debug', 'trace', 'log', 'info', 'warn', 'error'];
const save = { hooked: false };

export function hookConsole(_logger = logger, appName?: string) {
    if (appName) _logger.conf.app = appName;
    if (!save.hooked) {
        console.info('[Logger] Hooking console.');
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
            console.info('[Logger] Console unhooked.');
        }
    };
}
