import type { FastifyInstance } from 'fastify';
import { type Infer, z } from '../lib/validator';

/**
 * User schema - Example of a nested object type
 * Demonstrates validation with multiple constraints
 */
const userSchema = {
    name: z.string().min(3).max(50).describe('User full name (3-50 characters)'),
    age: z.number().min(1).describe('User age in years (must be positive)'),
    email: z.string().email().optional().describe('Optional email address (validated format)'),
};

/**
 * Hello request schema - Example REST API request body
 * Demonstrates default values, constraints, and validation
 */
const helloRequestSchema = {
    name: z.string().min(3).default('World').describe('Name to greet (minimum 3 characters, default: "World")'),
    count: z.number().min(1).default(1).describe('Number of times to repeat greeting (minimum 1, default: 1)'),
    verbose: z.boolean().default(false).describe('Include detailed user object in response (default: false)'),
};

type User = Infer<typeof userSchema>;
type HelloRequest = Infer<typeof helloRequestSchema>;

/**
 * Register hello endpoint - Example REST API endpoint
 *
 * This endpoint serves as a comprehensive example demonstrating:
 * - Request body validation with type safety
 * - Default values and constraints
 * - Nested object types
 * - Conditional response fields
 * - Swagger/OpenAPI documentation
 *
 * @example
 * POST /hello
 * {
 *   "name": "Alice",
 *   "count": 5,
 *   "verbose": true
 * }
 */
export async function registerHelloRoute(app: FastifyInstance) {
    // biome-ignore lint/style/useNamingConvention: Fastify generic type parameter
    app.post<{ Body: HelloRequest }>(
        '/hello',
        {
            schema: {
                body: helloRequestSchema,
                response: {
                    200: {
                        message: z.string().describe('Success message'),
                        data: z.object({
                            name: z.string().describe('Echoed name from request'),
                            count: z.number().describe('Echoed count from request'),
                            verbose: z.boolean().describe('Echoed verbose flag from request'),
                            user: z
                                .object(userSchema)
                                .optional()
                                .describe('Detailed user object (only included when verbose=true)'),
                        }),
                    },
                },
            },
        },
        async (request) => {
            // Request body is automatically validated by Fastify using the schema above
            const { name, count, verbose } = request.body;

            // Log request details (for development/debugging)
            console.log('=== Fastify Type System Test ===');
            console.log(`Hello ${name}!`);
            console.log(`Count: ${count}`);
            console.log(`Verbose mode: ${verbose}`);

            // Example: Create a typed user object demonstrating nested validation
            // In a real API, this would come from a database or external service
            const user: User = {
                name: 'John Doe',
                age: 30,
                email: 'john@example.com',
            };

            // Conditionally include detailed user data based on verbose flag
            if (verbose) {
                console.log('\nUser object with JSON Validator types:');
                console.log(JSON.stringify(user, null, 2));
            }

            // Success indicators for example/test purposes
            console.log('\n✓ Type compiler is working!');
            console.log('✓ JSON Validator validation is working!');
            console.log('✓ HTTP server is working!');

            // Return structured response matching the schema
            // Note: 'user' field only included when verbose=true
            return {
                message: 'Test completed successfully',
                data: {
                    name,
                    count,
                    verbose,
                    ...(verbose && { user }), // Conditional field based on request
                },
            };
        },
    );
}
