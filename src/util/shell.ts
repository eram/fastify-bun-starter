import { exec } from 'node:child_process';
import { constants } from 'node:os';
import readline from 'node:readline';
import { PassThrough, type Transform } from 'node:stream';
import { styleText } from 'node:util';

// Replaced CustomError import with local errno and error utilities
export const errno = constants.errno;
export const getErrorName = (e: number) => Object.keys(errno).find((key) => Object(errno)[key] === e) || e.toString();

// Color shorthand functions for styled text (tagged template literals)
type ForegroundColors = Parameters<typeof styleText>[0];
export function color(color: ForegroundColors, strings: TemplateStringsArray, ...values: unknown[]): string {
    const text = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '');
    return styleText(color, text);
}

export const red = color.bind(null, 'red');
export const yellow = color.bind(null, 'yellow');
export const grey = color.bind(null, 'grey');
export const green = color.bind(null, 'green');
export const blue = color.bind(null, 'blue');
export const bold = color.bind(null, 'bold');

/**
 * Run a shell command with optional data filter, spinner and timeout.
 * Resolves with the exit code, or throws Error if throwOnError is true and the command fails.
 *
 * Usage:
 * ```typescript
 * const code = await system("ls -l");
 * await system("badcmd", {throwOnError: true}); // throws on ENOENT or if exit code not 0
 * ```
 */

/**
 * Options for the system() function.
 */
export type SystemOptions = {
    /** Throw if not exiting with exitcode=0 */
    throwOnError?: boolean;
    /** Batch timeout for output processing (ms) */
    batchTimeout?: number;
    /** Spinner string or function: will spin one character every 500 msec */
    spinner?: string | (() => string);
    /** Transform each line of output: send to output */
    lineTransform?: (line: string, outStream: Transform) => void;
    /** After timeout (ms) child process is sent SIGINT */
    timeout?: number;
};

export async function system(
    command: string,
    {
        throwOnError = false,
        batchTimeout = 250,
        spinner = '⠇⠋⠙⠸⠴⠦',
        lineTransform = (line: string, outStream: Transform): void => {
            outStream.write(line);
        },
        timeout = 0,
    }: SystemOptions = {},
): Promise<number> {
    const { promise, resolve, reject } = Promise.withResolvers<number>();

    const spin = (function* () {
        // we get here only when spinner is a string
        const str = String(spinner),
            length = str.length;
        let i = 0;
        while (++i && length > 0) yield str[i % length];
    })();

    // console.log(">", command);
    const child = exec(command);
    // use an output stream to batch output and speed-up response
    const pt = new PassThrough();
    pt.on('data', (chunk) => process.stdout.write(chunk));

    const rl = readline.createInterface({ input: child.stdout as NodeJS.ReadableStream });
    rl.on('line', (line) => lineTransform(line, pt));

    const intervals: NodeJS.Timeout[] = [];
    if (spinner && batchTimeout) {
        intervals.push(
            setInterval(() => {
                const txt = typeof spinner === 'function' ? String(spinner()) : (spin.next().value ?? '');
                process.stderr.write(txt + '\b'.repeat(txt.length));
            }, batchTimeout),
        );
    }
    if (batchTimeout) {
        intervals.push(setInterval(() => (pt.isPaused() ? pt.resume() : pt.pause()), batchTimeout / 2));
    }

    let timedOut = false;
    if (timeout > 0) {
        intervals.push(
            setTimeout(() => {
                console.warn(`Timed out after ${timeout}ms, sending SIGINT to process...`);
                timedOut = true;
                child.kill('SIGINT');
            }, timeout),
        );
    }

    child.stderr?.on('data', (data) => {
        process.stderr.write(data);
    });

    function flush() {
        intervals.forEach(clearInterval);
        pt.resume();
        pt.end();
        rl.close();
    }

    child.addListener('error', (err) => {
        flush();
        reject(err.message);
    });

    child.addListener('exit', (code: number) => {
        flush();
        if (code === 0) {
            resolve(code);
        } else if (throwOnError) {
            // Replaced CustomError with standard Error
            class SystemError extends Error {
                constructor(
                    message: string,
                    public readonly errno?: number,
                    public readonly code?: string,
                ) {
                    super(message);
                    this.name = 'SystemError';
                }
            }
            reject(new SystemError(`Failed with exit code ${getErrorName(code)}`, code));
        } else {
            resolve(code ?? (timedOut ? errno.ETIMEDOUT : errno.EPERM));
        }
    });

    return promise;
}

/*

  });

/**
 * Prompt stdout for one-line input on stdin with default value.
 *
 * Usage:
 * ```typescript
 * const answer = await prompt("Continue?", "y");
 * ```
 */
export async function prompt(ask: string, defVal: string): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const rl = readline.createInterface(process.stdin, process.stdout);
    rl.question(`${ask} [${defVal}]: `, (answer) => {
        answer = answer || defVal;
        rl.close();
        resolve(answer);
    });
    rl.on('SIGINT', reject);
    return promise;
}
