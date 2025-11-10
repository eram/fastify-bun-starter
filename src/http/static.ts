import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Register static file serving plugin
 * Serves files from src/public directory using streaming
 */
export async function registerStatic(app: FastifyInstance) {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const publicPath = join(currentDir, '..', 'public');

    await app.register(fastifyStatic, {
        root: publicPath,
        prefix: '/',
        index: ['index.html'],
    });

    console.log('Static files registered from:', publicPath);
}
