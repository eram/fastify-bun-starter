import { watch as watchFile } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join, matchesGlob, normalize, resolve } from 'node:path';
import { atExit } from '@libs/utils/at-exit';
import { Env } from '@libs/utils/env';
import { stat } from '@libs/utils/safe';
import { debounce } from '@libs/utils/time';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WithParams, WithQuerystring } from '../route-types';

type FileType = 'ts' | 'js' | 'cjs' | 'mjs' | 'css' | 'json';

/**
 * In-memory cache for transpiled files
 */
interface CacheEntry {
    content: string;
    mtime: number | bigint;
    minified: boolean;
    mimeType: string;
}

const cache = new Map<string, CacheEntry>();

/**
 * Test file glob patterns to exclude from serving
 */
const TEST_FILE_GLOBS = ['**/*.{test,spec}.*', '**/{test,spec}/**', '**/__mock__/**'];

/**
 * Check if file path matches test file patterns using glob
 */
function isTestFile(filePath: string): boolean {
    return TEST_FILE_GLOBS.some((pattern) => matchesGlob(filePath, pattern));
}

/**
 * Detect file type and MIME type from filename
 * Returns [fileType, mimeType] tuple
 */
function getFileTypeAndMime(filename: string): [FileType | undefined, string] {
    const ext = filename.split('.').pop()?.toLowerCase();

    switch (ext) {
        case 'ts':
        case 'js':
        case 'cjs':
        case 'mjs':
            return [ext, 'application/javascript; charset=utf-8'];
        case 'css':
            return [ext, 'text/css; charset=utf-8'];
        case 'json':
            return [ext, 'application/json; charset=utf-8'];
        default:
            return [undefined, ''];
    }
}

/**
 * Add .ts extension to relative imports in transpiled JavaScript code
 * Transforms: from './foo' or from "../../bar" → from "./foo.ts" or from "../../bar.ts"
 * Handles directory imports: from '../libs/validator' → from '../libs/validator/index.ts'
 */
async function addTsExtensions(code: string, filePath: string) {
    const fileDir = resolve(filePath, '..');
    const importRegex = /(from\s*["'])(\.\.?[/\\][^"']+?)(["'])/g;

    // Collect all matches first
    const matches: Array<{ match: string; prefix: string; path: string; suffix: string; index: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(code)) !== null) {
        matches.push({
            match: match[0],
            prefix: match[1] ?? '',
            path: match[2] ?? '',
            suffix: match[3] ?? '',
            index: match.index,
        });
    }

    // Process matches in reverse to maintain correct indices
    let result = code;
    for (let i = matches.length - 1; i >= 0; i--) {
        const entry = matches[i];
        if (!entry) continue;
        const { match, prefix, path, suffix, index } = entry;

        let replacement: string | undefined;

        // Check if the path already has an extension >> leave as it
        if (/\.[a-zA-Z0-9]+$/.test(path)) {
            continue;
        }

        // Try to resolve the given path first
        const resolvedPath = resolve(fileDir, path);
        const [stats, _err] = await stat(resolvedPath);

        if (stats?.isDirectory()) {
            // Directory import - add /index.ts
            replacement = `${prefix}${path}/index.ts${suffix}`;
        } else {
            // Check if there's a .ts file that matches path
            const resolvedPathWithTs = resolve(fileDir, `${path}.ts`);
            const [statsTs, _errTs] = await stat(resolvedPathWithTs);

            if (statsTs) {
                // .ts file exists - add .ts extension
                replacement = `${prefix}${path}.ts${suffix}`;
            } else {
                // Neither exists, assume .ts anyway
                replacement = `${prefix}${path}.ts${suffix}`;
            }
        }

        result = result.substring(0, index) + replacement + result.substring(index + match.length);
    }

    return result;
}

/**
 * Process file: read, transpile/minify if needed, and cache
 * Returns [content, mimeType] tuple
 */
async function processFile(filePath: string, minify: boolean) {
    const [fileStats] = await stat(filePath);
    const mtime = fileStats?.mtimeMs ?? 0;
    const cacheKey = `${filePath}:${minify}`;

    const cached = cache.get(cacheKey);
    if (cached && cached.mtime === mtime && cached.minified === minify) {
        return [cached.content, cached.mimeType];
    }

    const [fileType, mimeType] = getFileTypeAndMime(filePath.split('/').pop() || '');

    const code = await readFile(filePath, 'utf-8');
    let content: string;

    // TypeScript transpilation
    if (fileType === 'ts') {
        const transpiler = new Bun.Transpiler({
            loader: 'ts',
            target: 'browser',
            minifyWhitespace: minify,
        });
        content = await transpiler.transform(code);
        // Add .ts extensions to relative imports
        content = await addTsExtensions(content, filePath);
    }
    // JavaScript minification
    else if ((fileType === 'js' || fileType === 'cjs' || fileType === 'mjs') && minify) {
        const transpiler = new Bun.Transpiler({
            loader: 'js',
            target: 'browser',
            minifyWhitespace: true,
        });
        content = await transpiler.transform(code);
    }
    // CSS minification
    else if (fileType === 'css' && minify) {
        content = code
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s+/g, ' ')
            .replace(/\s*([{}:;,])\s*/g, '$1')
            .trim();
    }
    // JSON minification
    else if (fileType === 'json' && minify) {
        content = JSON.stringify(JSON.parse(code));
    }
    // No processing needed
    else {
        content = code;
    }

    cache.set(cacheKey, { content, mtime, minified: minify, mimeType });
    return [content, mimeType || ''];
}

type FileServe = WithParams<{ '*': string }> & WithQuerystring<{ minify?: string }>;

/**
 * Register transpile route for serving TypeScript and other frontend files
 * @param app - Fastify instance
 * @param localPath - Local filesystem path to serve files from
 * @param remotePath - Remote URL path to serve files at
 */
export function registerTranspile(app: FastifyInstance, localPath: string, remotePath: string): void {
    const cacheMaxAge = Env.get('TRANSPILE_CACHE_MAX_AGE', 3600);
    const normalizedLocalPath = resolve(localPath);

    app.get<FileServe>(
        `${remotePath}/*`,
        {
            config: {
                rateLimit: {
                    max: 1000,
                    timeWindow: '1 minute',
                },
            },
            schema: {
                hide: true, // Exclude from Swagger documentation
            },
        },
        async (req: FastifyRequest<FileServe>, reply: FastifyReply) => {
            let filename = req.params['*'];
            const { minify: minifyParam } = req.query;

            try {
                // If no extension provided, try adding .ts
                if (!/\.[a-zA-Z0-9]+$/.test(filename)) {
                    const tsPath = resolve(normalize(join(localPath, `${filename}.ts`)));
                    // Security check before attempting to access
                    if (tsPath.startsWith(normalizedLocalPath)) {
                        const [stats] = await stat(tsPath);
                        if (stats) {
                            filename = `${filename}.ts`;
                        }
                    }
                }

                // Build and normalize the full path
                const requestedPath = resolve(normalize(join(localPath, filename)));

                // Security: ensure the resolved path is within the allowed directory
                if (!requestedPath.startsWith(normalizedLocalPath)) {
                    return reply.code(404).type('text/plain').send('File not found');
                }

                // Security: prevent serving test files
                if (isTestFile(requestedPath)) {
                    return reply.code(404).type('text/plain').send('File not found');
                }
                // Determine if should minify: query param overrides NODE_ENV
                const shouldMinify = minifyParam !== undefined ? minifyParam === 'true' : !Env.isDevelopment;

                // Get file content (transpiled/minified as needed) with MIME type
                const [content, mimeType] = await processFile(requestedPath, shouldMinify);

                return reply
                    .code(200)
                    .header('Content-Type', mimeType)
                    .header('Cache-Control', `public, max-age=${cacheMaxAge}`)
                    .send(content);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                    return reply.code(404).type('text/plain').send('File not found');
                }
                console.error('Error serving file:', err);
                return reply.code(500).type('text/plain').send('Internal server error');
            }
        },
    );

    // In development mode, watch for file changes and clear cache
    if (Env.isDevelopment) {
        const onFileChange = debounce(() => {
            cache.clear();
            console.log(`[transpile] Cache cleared: ${new Date().toISOString()}`);
        }, 1000);

        const watcher = watchFile(normalizedLocalPath, { recursive: true }, (eventType: string, filename: string | null) => {
            if (filename && (eventType === 'change' || eventType === 'rename')) {
                onFileChange();
            }
        });

        // Clean up watcher on process exit
        atExit(() => watcher.close());
    }

    console.log(`Transpile route registered: ${remotePath}/* -> ${normalizedLocalPath}`);
}

/**
 * Registers custom HTML routes that inject env vars into <head> for specified files, using shared cache.
 * @param app Fastify instance
 * @param filesToInject Array of public HTML filenames (e.g. ['index.html'])
 * @param publicDir Absolute path to public directory
 */
export async function registerEnvInject(app: FastifyInstance, filesToInject: string[], publicDir: string) {
    for (const file of filesToInject) {
        const filePath = join(publicDir, file);
        // Check file existence at registration time
        await access(filePath).catch(() => {
            throw new Error(`[env-inject] File not found: ${filePath}`);
        });

        // Create handler function to be reused for multiple routes
        const handler = async (_request: FastifyRequest, reply: FastifyReply) => {
            try {
                const cacheKey = `html:${filePath}`;
                let html: string;
                const cached = cache.get(cacheKey);
                const [fileStats] = await stat(filePath);
                const mtime = fileStats?.mtimeMs ?? 0;
                if (cached && cached.mtime === mtime) {
                    html = cached.content;
                    reply.header('X-Cache', 'HIT');
                } else {
                    // Inject env script - copy only "C_" variables
                    const envVars: NodeJS.ProcessEnv = {};
                    envVars['APP_NAME'] = Env.vars['APP_NAME'];
                    envVars['APP_VERSION'] = Env.vars['APP_VERSION'];
                    envVars['NODE_ENV'] = Env.vars['NODE_ENV'];
                    for (const key in Env.vars) {
                        if (key.startsWith('C_')) {
                            envVars[key] = Env.vars[key];
                        }
                    }
                    const envScript = `<script>window.env = ${JSON.stringify(envVars)};</script>`;

                    html = await readFile(filePath, 'utf8');
                    const headRegex = /<\/head>/i;
                    html = html.replace(headRegex, (match) => `${envScript}\n${match}`);
                    console.log(`[env-inject] Injected ${Object.keys(envVars).length} env vars into ${file}`);
                    cache.set(cacheKey, { content: html, mtime, minified: false, mimeType: 'text/html' });
                    reply.header('X-Cache', 'MISS');
                }
                return reply.type('text/html').send(html);
            } catch (err) {
                console.error(`[env-inject] Error reading ${file}:`, err);
                return reply.code(500).send('Internal server error');
            }
        };

        const registerRoute = (path: string) => {
            app.get(
                path,
                {
                    config: {
                        rateLimit: {
                            max: 100,
                            timeWindow: '1 minute',
                        },
                    },
                },
                handler,
            );
        };

        // Register handler for the file path
        registerRoute(`/${file}`);

        // If this is index.html, also register for root path
        if (file === 'index.html') {
            registerRoute('/');
        }
    }
}
