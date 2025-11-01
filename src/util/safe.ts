/** biome-ignore-all lint/style/useNamingConvention: re-exporting types */
import * as childProcess from 'node:child_process';
import * as dns from 'node:dns';
import * as fs from 'node:fs';
import { FileHandle, type FileReadOptions, type FileReadResult } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

/**
 * based on safe-await library code.
 * makes it easier to use async/await with error-first callbacks
 * every function is run thru this returns a [data, err] or Promise<[data, err]>
 * @param promiseOrFn Promise or function returning a Promise
 * @returns Promise resolving to [data, undefined] on success or [undefined, error] on failure
 */
function safe<T>(promiseOrFn: Promise<T> | (() => Promise<T>)): Promise<[T, undefined] | [undefined, Error]> {
    if (promiseOrFn instanceof Promise) {
        return promiseOrFn
            .then((data) => [data, undefined] as [T, undefined])
            .catch((err) => [undefined, err] as [undefined, Error]);
    } else if (typeof promiseOrFn === 'function') {
        try {
            return safe(promiseOrFn());
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            return Promise.resolve([undefined, error]);
        }
    }

    // This will ensure the function always has a return statement
    return Promise.reject([undefined, new Error('Invalid input: promiseOrFn must be a Promise or a function')]);
}

/**
 * Provides error handling for synchronous functions similar to safe() for async functions.
 * Instead of try/catch blocks, this returns a tuple with result and error.
 *
 * @param fn A synchronous function that might throw
 * @returns [data, undefined] on success or [undefined, error] on failure
 *
 * @example
 * const [data, err] = safeSync(() => JSON.parse(jsonString));
 * if (err) console.error("Error parsing JSON:", err);
 * else console.log("Parsed data:", data);
 */
function safeSync<T>(fn: () => T): [T, undefined] | [undefined, Error] {
    try {
        return [fn(), undefined];
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        return [undefined, error];
    }
}

// this is a hack to allow me to create a Dirent object directly as the
// fs.Dirent implementation is not a real class (it does not have a ctor).
class Dirent<Name extends string | Buffer = string> extends fs.Dirent<Name> {
    constructor(
        public readonly name: Name,
        public readonly path: fs.PathLike = '',
    ) {
        super();
    }
    isDirectory = () => true;
    isFile = () => false;
    isSocket = () => false;
    isBlockDevice = () => false;
    isCharacterDevice = () => false;
    isSymbolicLink = () => false;
    isFIFO = () => false;
    parentPath = '';
}

// recursive iterate directory, files first
type DirIterate = (folder: string) => AsyncGenerator<Dirent, void, unknown>;

const dirIterate: DirIterate = async function* (folder) {
    //TODO: is this name exists?
    const files = await promisify(fs.readdir)(folder, { withFileTypes: true });
    for (const entry of files) {
        if (entry.isDirectory()) {
            yield* dirIterate(path.join(folder, entry.name));
        } else {
            yield new Dirent(entry.name, folder);
        }
    }
    yield new Dirent(folder);
};

/**
 * Recursive remove directory (aka 'rm -rf') or a file (aka 'unlink').
 * Supports glob patterns like '*.cpuprofile', 'file.*', '**\f*.*', 'file?.txt', 'file.{ts,js}'
 * Also supports literal paths, retries, force etc.
 *
 * @param pattern - Path(s) or glob pattern(s) to remove
 * @param options - Options for fs.rm
 * @returns Promise resolving to [number, undefined] on success or [undefined, Error] on failure:
 * - If the input is a direct path (not a glob) and the path does not exist, returns [undefined, Error].
 * - If any matched file/directory fails to be removed, returns [undefined, Error] (first error encountered).
 * - on success, the number of files/directories removed.
 *
 * @example
 * // Remove a single file or directory. Errors if path does not exist.
 * await rimraf('/path/to/folder');
 *
 * // Remove all files matching pattern. No error.
 * await rimraf('/path/*.{ts,js}');
 *
 * // Remove multiple patterns. No Error.
 * await rimraf(['*.log', '*.tmp']);
 */
async function rimraf(
    pattern: fs.PathLike | readonly fs.PathLike[],
    options: fs.RmOptions = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 },
): Promise<[number, undefined] | [undefined, Error]> {
    pattern = Array.isArray(pattern) ? pattern : [pattern];
    try {
        const matches: string[] = [];

        for (const p of pattern) {
            if (typeof p !== 'string') {
                throw `Invalid pattern type: ${typeof p}`;
            }

            // use glob to find matching files. Do not fail if none exist.
            // Direct path: fail if does not exist
            if (/[*?[{]/.test(p)) {
                for await (const file of fs.promises.glob(p)) {
                    matches.push(file);
                }
            } else {
                try {
                    await fs.promises.access(p);
                    matches.push(p);
                } catch {
                    throw `Path not found: ${p}`;
                }
            }
        }

        // Remove all matched files/directories (throws on error)
        for (const match of matches) {
            await fs.promises.rm(match, options);
        }

        return [matches.length, undefined];
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        return [undefined, error];
    }
}

/**
 * Wraps all methods of an object that return Promises with the `safe` function
 * to use the [data, error] return pattern. This provides consistent error handling
 * across all asynchronous file system operations.
 *
 * For encoding-sensitive functions (readFile, readlink, readdir, realpath, mkdtemp),
 * it automatically applies 'utf8' encoding when no encoding is specified to ensure
 * string returns rather than Buffers.
 *
 * @template T The type of the object containing Promise-returning methods to wrap
 * @param obj The object (typically fs.promises) whose methods should be wrapped
 * @returns A new object with the same properties but with Promise-returning methods wrapped
 *          to return [data, undefined] on success or [undefined, error] on failure
 *
 * @example
 * const [data, err] = await safe.readFile("config.json");
 * if (err) console.error("Error reading file:", err);
 * else console.log("File content:", data); // data is string, not Buffer
 */
const wrapWithSafe = <T extends Record<string, unknown>>(
    obj: T,
): {
    [K in keyof T]: T[K] extends (...args: infer Args) => Promise<infer R>
        ? K extends 'mkdtemp'
            ? (...args: Args) => Promise<[string, undefined] | [undefined, Error]>
            : K extends 'readFile' | 'readlink' | 'realpath'
              ? (...args: Args) => Promise<[string, undefined] | [undefined, Error]>
              : K extends 'readdir'
                ? // Support: readdir(path)
                  ((path: fs.PathLike) => Promise<[string[], undefined] | [undefined, Error]>) &
                      // Support: readdir(path, options: { withFileTypes: true } & { encoding?: BufferEncoding | null })
                      ((
                          path: fs.PathLike,
                          options: { withFileTypes: true } & { encoding?: BufferEncoding | null },
                      ) => Promise<[fs.Dirent[], undefined] | [undefined, Error]>) &
                      // Support: readdir(path, options: { encoding: "buffer" })
                      ((
                          path: fs.PathLike,
                          options: { encoding: 'buffer'; withFileTypes?: false },
                      ) => Promise<[Buffer[], undefined] | [undefined, Error]>) &
                      // Support: readdir(path, options?: { encoding?: BufferEncoding | null } & fs.ObjectEncodingOptions)
                      ((
                          path: fs.PathLike,
                          options?: { encoding?: BufferEncoding | null } & fs.ObjectEncodingOptions,
                      ) => Promise<[string[], undefined] | [undefined, Error]>)
                : (...args: Args) => Promise<[R, undefined] | [undefined, Error]>
        : T[K];
} => {
    const result = {} as Record<string, unknown>;

    for (const key in obj) {
        const value = obj[key];
        if (typeof value === 'function') {
            switch (key) {
                case 'readdir':
                    // Always require both arguments for correct overload resolution
                    result[key] = (path: fs.PathLike, options?: fs.ObjectEncodingOptions & { withFileTypes?: boolean }) => {
                        const opts = options ?? { encoding: 'utf8' };
                        if (opts.withFileTypes) {
                            return safe(() => value.apply(obj, [path, opts]));
                        }
                        // Preserve 'buffer' encoding if explicitly set, otherwise add utf8
                        // @ts-expect-error TypeScript overload resolution issue
                        const finalOptions = opts.encoding === 'buffer' ? opts : addUtf8Encoding(opts);
                        return safe(() => value.apply(obj, [path, finalOptions]));
                    };
                    break;

                // Functions that can return Buffer/string based on encoding
                case 'readFile':
                case 'readlink':
                case 'realpath':
                    result[key] = (path: fs.PathLike, options?: fs.ObjectEncodingOptions | string) => {
                        const finalOptions = addUtf8Encoding(options);
                        return safe(() => value.apply(obj, [path, finalOptions]));
                    };
                    break;

                case 'mkdtemp':
                    result[key] = (prefix: string, options?: fs.ObjectEncodingOptions | string) => {
                        const finalOptions = addUtf8Encoding(options);
                        return safe(() => value.apply(obj, [prefix, finalOptions]));
                    };
                    break;

                // Default case for regular functions
                default:
                    result[key] = (...args: unknown[]) => safe(() => value.apply(obj, args));
                    break;
            }
        } else {
            result[key] = value;
        }
    }

    return result as ReturnType<typeof wrapWithSafe<T>>;
};

/**
 * Helper function to add UTF-8 encoding to options if not already specified
 * @param options The original options object or string
 * @returns A new options object or the original options with utf8 encoding added if needed
 */
function addUtf8Encoding(options?: fs.ObjectEncodingOptions | string): fs.ObjectEncodingOptions {
    if (typeof options === 'string') options = { encoding: options as fs.ObjectEncodingOptions['encoding'] };
    return { ...options, encoding: 'utf8' };
}

/**
 * Wraps all methods of a class instance so that each returns a safe tuple.
 * Usage: const safeHandle = safe.wrapFileHandleSafe(fileHandle);
 */

type SafeClass<T> = {
    [K in keyof T]: T[K] extends (...args: infer Args) => Promise<infer R>
        ? (...args: Args) => Promise<[R, undefined] | [undefined, Error]>
        : T[K] extends (...args: infer Args) => unknown
          ? (...args: Args) => [ReturnType<T[K]>, undefined] | [undefined, Error]
          : T[K];
};

function makeSafeInstance<T extends object>(obj: T): SafeClass<T> {
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(obj))) {
        const value = obj[key as keyof T];
        if (typeof value === 'function') {
            obj[key as keyof T] = ((...args: unknown[]) => {
                try {
                    const result = value.apply(obj, args);
                    if (result instanceof Promise) {
                        return safe(() => result);
                    } else {
                        return safeSync(() => result);
                    }
                } catch (err) {
                    return safeSync(() => {
                        throw err;
                    });
                }
            }) as unknown as T[keyof T];
        }
    }
    return obj as SafeClass<T>;
}

// Extract a common helper `makeReturnSafeInstance` for wrapping fs.promises functions that return class instances
function makeReturnSafeInstance<T extends object, Args extends unknown[]>(
    fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<[SafeClass<T>, undefined] | [undefined, Error]> {
    return async (...args: Args) => {
        const [obj, err] = await safe(() => fn(...args));
        if (obj) {
            return [makeSafeInstance(obj), undefined];
        }
        // Ensure err is always an Error
        return [undefined, err instanceof Error ? err : new Error('Unknown error')];
    };
}

interface FileHandleSafe extends SafeClass<FileHandle> {
    read: {
        <T extends NodeJS.ArrayBufferView>(
            buffer: T,
            offset?: number | null,
            length?: number | null,
            position?: fs.ReadPosition | null,
        ): Promise<[undefined, Error] | [FileReadResult<T>, undefined]>;
        <T extends NodeJS.ArrayBufferView = Buffer>(
            buffer: T,
            options?: FileReadOptions<T>,
        ): Promise<[undefined, Error] | [FileReadResult<T>, undefined]>;
        <T extends NodeJS.ArrayBufferView = Buffer>(
            options?: FileReadOptions<T>,
        ): Promise<[undefined, Error] | [FileReadResult<T>, undefined]>;
    };
    write: {
        <TBuffer extends NodeJS.ArrayBufferView>(
            buffer: TBuffer,
            offset?: number | null,
            length?: number | null,
            position?: number | null,
        ): Promise<[{ bytesWritten: number; buffer: TBuffer }, undefined] | [undefined, Error]>;
        (
            data: string,
            position?: number | null,
            encoding?: BufferEncoding | null,
        ): Promise<[{ bytesWritten: number; buffer: string }, undefined] | [undefined, Error]>;
    };
}

interface DirSafe extends SafeClass<fs.Dir> {
    read: () => Promise<[Dirent | undefined, undefined] | [undefined, Error]>;
    close(): Promise<[unknown, undefined] | [undefined, Error]>;
}

// ============================================================================
// File system operations (wrapped with safe)
// ============================================================================

// Export all wrapped fs.promises functions
export const {
    access,
    appendFile,
    chmod,
    chown,
    copyFile,
    cp,
    lchmod,
    lchown,
    link,
    lstat,
    lutimes,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    readlink,
    realpath,
    rename,
    rmdir,
    rm,
    stat,
    symlink,
    truncate,
    unlink,
    utimes,
    watch,
    writeFile,
} = wrapWithSafe(fs.promises);

// Custom fs operations
export const exists = (path: fs.PathLike) => safe(promisify(fs.exists)(path));
export { dirIterate, rimraf };

// fs functions that return class instances wrapped to return safe instances
// FileHandleSafe type is used for annotation only; no class implementation needed
export const open = makeReturnSafeInstance(fs.promises.open) as (
    ...args: Parameters<typeof fs.promises.open>
) => Promise<[FileHandleSafe, undefined] | [undefined, Error]>;

// DirSafe type is used for annotation only; no class implementation needed
export const opendir = makeReturnSafeInstance(fs.promises.opendir) as (
    ...args: Parameters<typeof fs.promises.opendir>
) => Promise<[DirSafe, undefined] | [undefined, Error]>;

// ============================================================================
// Fetch wrappers
// ============================================================================

export async function fetch(
    input: string | URL | Request,
    init?: RequestInit,
): Promise<[Response, undefined] | [undefined, Error]> {
    return safe(() => globalThis.fetch(input, init));
}

// mini-wrapper around fetch
export async function fetchJson<T>(
    input: string | URL | Request,
    init: RequestInit = { headers: { 'Content-Type': 'application/json' } },
): Promise<[T, undefined] | [undefined, Error]> {
    return safe<T>(() => globalThis.fetch(input, init).then((r) => r.json()));
}

// ============================================================================
// DNS functions (wrapped with safe)
// ============================================================================

export const {
    lookup,
    lookupService,
    resolve,
    resolve4,
    resolve6,
    resolveAny,
    resolveCname,
    resolveMx,
    resolveNaptr,
    resolveNs,
    resolvePtr,
    resolveSoa,
    resolveSrv,
    resolveTxt,
    reverse,
    setDefaultResultOrder,
    setServers,
} = wrapWithSafe(dns.promises);

// ============================================================================
// Child process methods wrapped with safe.
// We declare types for all function overloads with their safe return types.
// ============================================================================

type Exec = (
    command: string,
    options?: childProcess.ExecOptions | (childProcess.ExecOptions & { encoding: 'buffer' }),
) => Promise<[{ stdout: Buffer; stderr: Buffer }, undefined] | [undefined, Error]>;

export const exec = ((...args: Parameters<typeof childProcess.exec>) =>
    // @ts-expect-error
    safe(() => promisify(childProcess.exec)(...args))) as Exec;

type ExecSync = (
    command: string,
    options?:
        | childProcess.ExecSyncOptions
        | childProcess.ExecSyncOptionsWithBufferEncoding
        | childProcess.ExecSyncOptionsWithStringEncoding,
) => [string, undefined] | [undefined, Error];

export const execSync = ((...args: Parameters<typeof childProcess.execSync>) =>
    safeSync(() => childProcess.execSync(...args))) as ExecSync;

interface ExecFile {
    (
        file: string,
        options?: childProcess.ExecFileOptions | childProcess.ExecFileOptionsWithBufferEncoding,
    ): Promise<[{ stdout: string; stderr: string }, undefined] | [undefined, Error]>;
    (
        file: string,
        args: readonly string[] | null,
        options?: childProcess.ExecFileOptions | childProcess.ExecFileOptionsWithBufferEncoding,
    ): Promise<[{ stdout: string; stderr: string }, undefined] | [undefined, Error]>;
}

export const execFile = ((...args: Parameters<typeof childProcess.execFile>) =>
    // @ts-expect-error
    safe(() => promisify(childProcess.execFile)(...args))) as ExecFile;

interface ExecFileSync {
    (file: string, args?: readonly string[] | undefined): [string | Buffer, undefined] | [undefined, Error];
    (
        file: string,
        options:
            | childProcess.ExecFileSyncOptions
            | childProcess.ExecFileSyncOptionsWithBufferEncoding
            | childProcess.ExecFileSyncOptionsWithStringEncoding,
    ): [string | Buffer, undefined] | [undefined, Error];
    (
        file: string,
        args: readonly string[] | undefined,
        options:
            | childProcess.ExecFileSyncOptions
            | childProcess.ExecFileSyncOptionsWithBufferEncoding
            | childProcess.ExecFileSyncOptionsWithStringEncoding,
    ): [string | Buffer, undefined] | [undefined, Error];
}

export const execFileSync = ((...args: Parameters<typeof childProcess.execFileSync>) =>
    safeSync(() => childProcess.execFileSync(...args))) as ExecFileSync;

interface Spawn {
    (command: string, options?: childProcess.SpawnOptions): [childProcess.ChildProcess, undefined];
    (command: string, args?: readonly string[], options?: childProcess.SpawnOptions): [childProcess.ChildProcess, undefined];
}

export const spawn = ((...args: Parameters<typeof childProcess.spawn>) => [childProcess.spawn(...args), undefined]) as Spawn;

interface SpawnSync {
    (
        command: string,
        options?: childProcess.SpawnSyncOptions,
    ): [childProcess.SpawnSyncReturns<string | Buffer>, undefined] | [undefined, Error];
    (
        command: string,
        args?: readonly string[],
        options?:
            | childProcess.SpawnSyncOptions
            | childProcess.SpawnSyncOptionsWithBufferEncoding
            | childProcess.SpawnSyncOptionsWithStringEncoding,
    ): [childProcess.SpawnSyncReturns<string | Buffer>, undefined] | [undefined, Error];
}

export const spawnSync = ((...args: Parameters<typeof childProcess.spawnSync>) =>
    safeSync(() => childProcess.spawnSync(...args))) as SpawnSync;

// ============================================================================
// Re-export all major interfaces/types from fs and fs.promises to make
// importing life easier.
// ============================================================================

export {
    constants,
    Dirent,
    ReadStream,
    Stats,
    WriteStream,
} from 'node:fs';

export type {
    CreateReadStreamOptions,
    CreateWriteStreamOptions,
    FileChangeInfo,
    FileHandle,
    FileReadOptions,
    FileReadResult,
    FlagAndOpenMode,
    ReadableWebStreamOptions,
    WatchOptions,
    WatchOptionsWithBufferEncoding,
    WatchOptionsWithStringEncoding,
} from 'node:fs/promises';

// ============================================================================
// Core safe functions
// ============================================================================

export { safe, safeSync };
