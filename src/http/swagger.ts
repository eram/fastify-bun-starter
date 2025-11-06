import type { FastifyInstance } from 'fastify';

/**
 * Register Swagger documentation
 * Swagger UI will be available at /docs
 * OpenAPI spec will be available at /docs/json
 */
export async function registerSwagger(app: FastifyInstance) {
    // Manual Swagger/OpenAPI spec builder
    const openApiSpec = {
        openapi: '3.0.0',
        info: {
            title: 'Fastify Bun Starter API',
            description: 'API documentation for Fastify Bun Starter application',
            version: '0.1.0',
        },
        servers: [
            {
                url: `http://${process.env.HOST ?? 'localhost'}:${process.env.PORT ?? 3000}`,
                description: 'Local development server',
            },
        ],
        tags: [
            {
                name: 'monitoring',
                description: 'Monitoring and health check endpoints',
            },
            {
                name: 'testing',
                description: 'Testing and validation endpoints',
            },
        ],
        paths: {},
        components: {
            schemas: {},
        },
    };

    // Serve OpenAPI JSON spec
    app.get('/docs/json', async () => {
        // Build paths dynamically from registered routes
        const paths: Record<string, unknown> = {};

        for (const route of app.printRoutes({ commonPrefix: false }).split('\n')) {
            // Match Fastify tree format: "├── /path (METHOD)" or "└── /path (METHOD)"
            const match = route.match(/[├└─│]\s*(.+?)\s+\(([A-Z]+)\)/);
            if (match) {
                const [, path, method] = match;
                if (path.startsWith('/docs')) continue; // Skip documentation routes

                // For now, create basic path entries
                if (!paths[path]) {
                    paths[path] = {};
                }

                Object(paths[path])[method.toLowerCase()] = {
                    summary: `${method} ${path}`,
                    tags: path.includes('health') ? ['monitoring'] : ['testing'],
                    responses: {
                        200: {
                            description: 'Successful response',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                    },
                                },
                            },
                        },
                    },
                };
            }
        }

        return {
            ...openApiSpec,
            paths,
        };
    });

    // Serve Swagger UI HTML
    app.get('/docs', async (_request, reply) => {
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fastify Bun Starter API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = () => {
            window.ui = SwaggerUIBundle({
                url: '/docs/json',
                dom_id: '#swagger-ui',
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                layout: 'StandaloneLayout',
                deepLinking: true,
                displayRequestDuration: true,
                filter: true,
                showExtensions: true,
                showCommonExtensions: true,
                tryItOutEnabled: true
            });
        };
    </script>
</body>
</html>
        `;

        reply.type('text/html').send(html);
    });

    console.log('Swagger UI registered at /docs');
    console.log('OpenAPI spec available at /docs/json');
}
