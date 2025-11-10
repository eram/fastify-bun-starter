import type { FastifyInstance } from 'fastify';
import { Env } from '../util';

/**
 * Register Swagger documentation
 * Swagger UI will be available at /api/v1/swagger
 * OpenAPI spec will be available at /api/v1/openapi.json
 */
export function registerSwagger(app: FastifyInstance) {
    // Manual Swagger/OpenAPI spec builder
    const openApiSpec = {
        openapi: '3.0.0',
        info: {
            title: Env.appName,
            description: 'API documentation',
            version: Env.appVersion,
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
    app.get('/api/v1/openapi.json', async () => {
        // Build paths dynamically from registered routes
        const paths: Record<string, unknown> = {};

        for (const route of app.printRoutes({ commonPrefix: false }).split('\n')) {
            // Match Fastify tree format: "├── /path (METHOD)" or "└── /path (METHOD)"
            const match = route.match(/[├└─│]\s*(.+?)\s+\(([A-Z]+)\)/);
            if (match) {
                const [, path, method] = match;
                if (path.startsWith('/api/v1/swagger') || path.startsWith('/api/v1/openapi')) continue; // Skip documentation routes

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
    app.get('/api/v1/swagger', async (_request, reply) => {
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Aggregator API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
    <script>
        SwaggerUIBundle({
            url: '/api/v1/openapi.json',
            dom_id: '#swagger-ui',
            presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
            ],
            layout: 'StandaloneLayout'
        });
    </script>
</body>
</html>
        `;

        reply.type('text/html').send(html);
    });

    console.log('Swagger UI registered at /api/v1/swagger');
    console.log('OpenAPI spec available at /api/v1/openapi.json');
}
