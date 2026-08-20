/**
 * Error handler for HTTP errors
 * Provides user-friendly error pages for 4xx and 5xx errors
 */

import { ErrorEx } from '@libs/utils/error';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Get HTTP status text for error responses
 */
const STATUS_TEXT: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
} as const;

function getStatusText(code: number): string {
    return STATUS_TEXT[code] || 'Error';
}

/**
 * Generate HTML error page using classless CSS
 */
function generateErrorPage(statusCode: number, error?: Error): string {
    const isDev = process.env.NODE_ENV === 'development';
    const message = error?.message ?? getStatusText(statusCode);
    const title = getStatusText(statusCode);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${statusCode} - ${title}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/digitallytailored/classless@latest/classless.min.css">
</head>
<body>
    <main>
        <header>
            <h1>${statusCode} - ${title}</h1>
        </header>
        <section>
            <p>${message}</p>
        </section>
        ${isDev && error?.stack ? `<section><h2>Stack Trace (Development Only)</h2><pre>${error.stack}</pre></section>` : ''}
        <footer>
            <a href="/">Go to Homepage</a>
        </footer>
    </main>
</body>
</html>`;
}

/**
 * Register error handlers with Fastify
 * @param app Fastify instance
 */
export function registerErrorHandler(app: FastifyInstance): void {
    function handler(request: FastifyRequest, reply: FastifyReply, error: FastifyError) {
        console.log(error.statusCode, request.originalUrl);
        const statusCode = error.statusCode || 500;

        // If this is a browser request to a page we return a generated error page.
        // All other cases JSON error response.
        if (request.headers.accept?.includes('text/html')) {
            reply.status(statusCode).type('text/html').send(generateErrorPage(statusCode, error));
            return;
        }

        reply
            .status(statusCode)
            .type('application/json')
            .send({
                statusCode,
                error: error?.message || getStatusText(statusCode),
            });
    }

    // Main error handler
    app.setErrorHandler<FastifyError>((err, req, rep) => handler(req, rep, err));

    // Not found handler for undefined routes
    app.setNotFoundHandler((req, rep) => {
        const notFoundError = new ErrorEx('Not Found');
        Object(notFoundError).statusCode = 404;
        handler(req, rep, notFoundError as FastifyError);
    });
}
