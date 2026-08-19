function getBrowserVersion() {
    const ua = navigator.userAgent;
    let browserName = 'Unknown';
    let fullVersion = 'Unknown';

    if (/OPR\/(\S+)/.test(ua)) {
        browserName = 'Opera';
        const match = ua.match(/OPR\/(\S+)/);
        fullVersion = match ? (match[1] ?? 'Unknown') : 'Unknown';
    } else if (/Edg\/(\S+)/.test(ua)) {
        browserName = 'Edge';
        const match = ua.match(/Edg\/(\S+)/);
        fullVersion = match ? (match[1] ?? 'Unknown') : 'Unknown';
    } else if (/Chrome\/(\S+)/.test(ua)) {
        browserName = 'Chrome';
        const match = ua.match(/Chrome\/(\S+)/);
        fullVersion = match ? (match[1] ?? 'Unknown') : 'Unknown';
    } else if (/Firefox\/(\S+)/.test(ua)) {
        browserName = 'Firefox';
        const match = ua.match(/Firefox\/(\S+)/);
        fullVersion = match ? (match[1] ?? 'Unknown') : 'Unknown';
    } else if (/Safari\/(\S+)/.test(ua) && /Version\/(\S+)/.test(ua)) {
        browserName = 'Safari';
        const match = ua.match(/Version\/(\S+)/);
        fullVersion = match ? (match[1] ?? 'Unknown') : 'Unknown';
    }
    return { browserName, fullVersion };
}

export class Env {
    private static _initialized = false;

    // Client-side defaults (will be overridden on server)
    static runtime: string = 'not initialized';
    static runtimeVer: string = 'not initialized';
    private static _out = 'not initialized';

    static isPrimary = true;
    static isMainThread = true;
    static isTestMode = false;
    static threadId = 0;
    static __dirname = '/';
    static workerId = '';
    static uvThreadpool = 4;
    static appName = 'fastify-bun-starter';
    static appVersion = '0.0.0';
    static podName = '';
    static podNamespace = '';
    static hostname = '';
    static nodeEnv = 'production';
    static hasDOM =
        typeof Object(globalThis).window !== 'undefined' &&
        typeof Object(globalThis).document !== 'undefined' &&
        typeof Object(globalThis).document.querySelector === 'function';
    static isDevelopment = process.env.NODE_ENV === 'development';

    /**
     * Server-side initialization helper method.
     * Loads environment variables, package.json, and initializes runtime-specific properties.
     */
    private static async _initServer(env: Record<string, string>, silent: boolean) {
        let isDebugging = () => false;
        try {
            // Server-side initialization (Node.js/Bun)
            const [cluster, fs, os, path, url, util, worker, debuggerMod] = await Promise.all([
                import('node:cluster'),
                import('node:fs'),
                import('node:os'),
                import('node:path'),
                import('node:url'),
                import('node:util'),
                import('node:worker_threads'),
                import('./debugger'),
            ]);

            isDebugging = debuggerMod.isDebugging;

            // Load .env.{NODE_ENV} file if it exists, otherwise use defaults
            const dotenv = env.DOT_ENV_FILE ? path.resolve(env.DOT_ENV_FILE) : path.resolve(`.env.${env.NODE_ENV}`);
            env.DOT_ENV_FILE ??= dotenv;

            try {
                const buff = fs.readFileSync(dotenv);
                const parsed = util.parseEnv(buff.toString('utf8')) || {};
                // Only set values that are NOT already in the environment
                // This ensures process.env variables take precedence over .env file
                for (const [key, value] of Object.entries(parsed)) {
                    if (env[key] === undefined && value !== undefined) {
                        env[key] = value;
                    }
                }
                // Suppress message if --json or --help flag is present (for clean output)
                if (!silent) console.log(`Loaded .env file: ${dotenv} with ${Object.keys(parsed).length} vars`);
            } catch (_err) {
                // Only warn if not in JSON or help mode
                if (!silent) console.warn(`Failed to load .env file: ${dotenv}`);
            }

            // Calculate __dirname first (needed for package.json loading)
            Env.__dirname = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../..');

            // Load package.json synchronously
            let pkg: Record<string, string> = {};
            pkg = JSON.parse(fs.readFileSync(path.resolve(Env.__dirname, 'package.json'), 'utf8'));

            // must have env vars
            env.APP_NAME ??= pkg.name ?? path.basename(process.execPath);
            Env.appName = env.APP_NAME;

            env.APP_VERSION ??= pkg.version ?? '0.0.0';
            Env.appVersion = env.APP_VERSION;

            env.HOSTNAME ??= os.hostname();
            Env.hostname = env.HOSTNAME;

            env.LOG_ADD_TIME ??= 'false';
            env.LOG_LEVEL ??= 'INFO';
            env.LOG_FORMAT ??= ['-json', '--json', '-raw', '--raw'].some((arg) => process.argv.includes(arg)) ? 'json' : 'line';

            env.POD_NAME ??= '';
            Env.podName = env.POD_NAME;

            env.POD_NAMESPACE ??= '';
            Env.podNamespace = env.POD_NAMESPACE;

            // Initialize static members
            Env.runtime = process.versions.bun ? 'bun' : 'node';
            Env.runtimeVer = String(process.versions.bun?.substring(0) ?? process.versions.node?.substring(0) ?? '0');
            Env.isPrimary = cluster.default.isPrimary;
            Env.isMainThread = worker.isMainThread;
            Env.isTestMode = process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT === 'true';
            Env.threadId = worker.threadId;
            Env.workerId = cluster.default.isWorker ? cluster.default.worker!.id.toString() : '';
            Env.uvThreadpool = Number(process.env.UV_THREADPOOL_SIZE) || 4;

            process.title = Env.appName;
        } catch (_err) {
            // Only warn if not in JSON or help mode
            if (!silent) console.error(`Failed to load Env`, Object(_err).message || _err);
        }
        return isDebugging;
    }

    /**
     * Load environment variables from .env file and set defaults if not set.
     * Initializes all static members.
     * Subsequent calls will skip initialization unless force = true.
     *
     * @param force - Force re-initialization even if already initialized (useful for tests).
     */
    static async init(force = false) {
        // Skip if already initialized and not forcing
        if (Env._initialized && !force) {
            return Env;
        }

        Env._initialized = true;

        const isServer = typeof process !== 'undefined' && !!process.versions;
        const env: Record<string, string> = isServer ? process.env : Object(window).env || {};
        const silent =
            isServer && (process.argv.includes('--json') || process.argv.includes('--help') || process.argv.includes('-h'));
        let isDebugging = () => false;

        env.NODE_ENV ??= 'development';
        Env.nodeEnv = env.NODE_ENV;

        // Client-side initialization (browser)
        if (!isServer) {
            Env.hostname = window.location?.hostname ?? '';
            Env.appName = (env.APP_NAME ?? Env.hostname) || 'app';
            Env.appVersion = env.APP_VERSION ?? '0.0.0';
            const info = getBrowserVersion();
            Env.runtime = info.browserName;
            Env.runtimeVer = String(info.fullVersion);
        } else {
            isDebugging = await Env._initServer(env, silent);
        }

        // the rest of the props are client side too
        Env.hasDOM =
            typeof Object(globalThis).window !== 'undefined' &&
            typeof Object(globalThis).document !== 'undefined' &&
            typeof Object(globalThis).document.querySelector === 'function';

        const serverInfo = isServer
            ? `, uv_threads: ${Env.uvThreadpool}
cwd: ${process.cwd()}, dirname: ${Env.__dirname},
namespace: ${Env.podNamespace || '-'}, pod: ${Env.podName || '-'},
pid: ${process.pid}, workerId: ${Env.workerId || '-'}, threadId: ${Env.threadId || '-'},
euid: ${process.geteuid?.() ?? '-'} egid: ${process.getegid?.() ?? '-'},
args: "${process.execArgv.join(' ')}",
logLevel: ${env.LOG_LEVEL}, isDebugging: ${isDebugging()}, test: ${process.env.NODE_TEST_CONTEXT}`
            : '';

        Env._out = `
-----------------
app: ${Env.appName}, version: ${Env.appVersion},
host: ${Env.hostname}, ${Env.runtime}: ${Env.runtimeVer},
NODE_ENV: ${Env.nodeEnv}${serverInfo}
-----------------
`;
        return Env;
    }
    /**
     * Get environment variable with type casting and validation.
     * Only available on server-side.
     *
     * @param key - The environment variable key.
     * @param def - The default value if the key is not found.
     * @param min - The minimum value for numeric keys.
     * @param max - The maximum value for numeric keys.
     * @returns The value of the environment variable or the default value.
     */
    static get(key: string, def: number, min?: number, max?: number): number;
    static get(key: string, def: boolean): boolean;
    static get<T extends object>(key: string, def: T): T;
    static get(key: string, def: string, min?: string, max?: string): string;
    static get<T = unknown>(key: string, def: T, min?: T, max?: T): T {
        const raw = Env.vars[key];
        let rc: unknown;
        switch (typeof def) {
            case 'boolean':
                if (raw === undefined) {
                    rc = false;
                } else {
                    const val = String(raw).toLowerCase();
                    rc = val === 'true' || val === '1';
                }
                break;
            case 'number':
                if (raw === undefined) {
                    rc = Number(def);
                } else {
                    rc = Number(raw);
                }
                if (typeof min === 'number' && (rc as number) < (min as number)) rc = min;
                if (typeof max === 'number' && (rc as number) > (max as number)) rc = max;
                rc = Number.isNaN(rc) ? 0 : rc;
                break;
            case 'string': {
                rc = String(raw ?? def ?? '');
                const minStr = min !== undefined ? String(min) : '';
                const maxStr = max !== undefined ? String(max) : '';
                if (minStr && (rc as string) < minStr) rc = minStr;
                if (maxStr && (rc as string) > maxStr) rc = maxStr;
                break;
            }
            case 'object':
                // If default is object, parse JSON from env var
                if (raw !== undefined && def !== undefined) {
                    try {
                        rc = JSON.parse(raw);
                    } catch {
                        console.error(`Failed to parse JSON from env var ${key}`);
                    }
                }
                break;
        }
        rc ??= def;
        return rc as T;
    }

    static print(logger?: Console) {
        if (logger) logger.log(Env._out);
        else if (typeof process !== 'undefined') process.stdout.write(Env._out);
        else console.log(Env._out);
    }

    static get vars() {
        return (typeof process !== 'undefined' ? process.env : Object(window).env) ?? {};
    }

    // just to keep the linter happy
    private constructor() {}
}

// Initialize at module load
export const env = await Env.init();
