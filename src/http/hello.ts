import type { FastifyInstance } from 'fastify';
import { type Infer, z } from '../lib/validator';

// JSON Validator schemas for validation
const userSchema = {
    name: z.string().min(3).max(50),
    age: z.number().min(1),
    email: z.string().email().optional(),
};

const helloRequestSchema = {
    name: z.string().min(3).default('World'),
    count: z.number().min(1).default(1),
    verbose: z.boolean().default(false),
};

type User = Infer<typeof userSchema>;
type HelloRequest = Infer<typeof helloRequestSchema>;

/**
 * Register hello endpoint
 * POST /hello - Hello endpoint to verify type system and validation
 */
export async function registerHelloRoute(app: FastifyInstance) {
    // biome-ignore lint/style/useNamingConvention: Fastify generic type parameter
    app.post<{ Body: HelloRequest }>(
        '/hello',
        {
            schema: {
                description: 'Hello endpoint to verify type system and validation',
                tags: ['testing'],
                body: helloRequestSchema,
                response: {
                    200: {
                        message: z.string(),
                        data: z.object({
                            name: z.string(),
                            count: z.number(),
                            verbose: z.boolean(),
                            user: z.object(userSchema).optional(),
                        }),
                    },
                },
            },
        },
        async (request) => {
            const { name, count, verbose } = request.body;

            console.log('=== Fastify Type System Test ===');
            console.log(`Hello ${name}!`);
            console.log(`Count: ${count}`);
            console.log(`Verbose mode: ${verbose}`);

            // Test interface with type annotations
            const user: User = {
                name: 'John Doe',
                age: 30,
                email: 'john@example.com',
            };

            if (verbose) {
                console.log('\nUser object with JSON Validator types:');
                console.log(JSON.stringify(user, null, 2));
            }

            console.log('\n✓ Type compiler is working!');
            console.log('✓ JSON Validator validation is working!');
            console.log('✓ HTTP server is working!');

            return {
                message: 'Test completed successfully',
                data: {
                    name,
                    count,
                    verbose,
                    ...(verbose && { user }),
                },
            };
        },
    );
}
