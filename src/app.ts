import { parseArgs } from 'node:util';
import Fastify from 'fastify';
import { type Infer, type JsonSchemaTypeProvider, JsonSchemaValidatorCompiler, z } from './lib/validator';

// JSON Validator schemas for validation
const userSchema = {
    name: z.string().min(3).max(50),
    age: z.number().min(1),
    email: z.string().email().optional(),
};

const testRequestSchema = {
    name: z.string().min(3).default('World'),
    count: z.number().min(1).default(1),
    verbose: z.boolean().default(false),
};

type User = Infer<typeof userSchema>;
type TestRequest = Infer<typeof testRequestSchema>;

// Create Fastify instance with type provider
export const app = Fastify({
    logger: false, // Using plain console instead of pino
})
    .withTypeProvider<JsonSchemaTypeProvider>()
    .setValidatorCompiler(JsonSchemaValidatorCompiler);

// POST /test endpoint - equivalent to the old CLI test command
// biome-ignore lint/style/useNamingConvention: Fastify generic type parameter
app.post<{ Body: TestRequest }>(
    '/test',
    {
        schema: {
            body: testRequestSchema,
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

// Health check endpoint
app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});

// CLI mode using node:util.parseArgs
async function runCLI() {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            verbose: {
                type: 'boolean',
                short: 'v',
                default: false,
            },
            help: {
                type: 'boolean',
                short: 'h',
                default: false,
            },
        },
        allowPositionals: true,
    });

    const command = positionals[0];

    if (values.help || !command) {
        console.log(`
USAGE:
  bun run src/app.ts <command> [options]

COMMANDS:
  test [name] [count]   Test command to verify type system
  server                Start HTTP server (default port 3000)

OPTIONS:
  --verbose, -v         Enable verbose output
  --help, -h            Show this help message

EXAMPLES:
  bun run src/app.ts test
  bun run src/app.ts test "John" 5 --verbose
  bun run src/app.ts server
`);
        return;
    }

    if (command === 'server') {
        const port = Number.parseInt(process.env.PORT ?? '3000', 10);
        const host = process.env.HOST ?? '0.0.0.0';

        try {
            await app.listen({ port, host });
            console.log(`Server listening on http://${host}:${port}`);
            console.log(`Health check: http://${host}:${port}/health`);
            console.log(`Test endpoint: POST http://${host}:${port}/test`);
        } catch (err) {
            console.error('Error starting server:', err);
            process.exit(1);
        }
    } else if (command === 'test') {
        const name = positionals[1] ?? 'World';
        const count = positionals[2] ? Number.parseInt(positionals[2], 10) : 1;
        const verbose = values.verbose ?? false;

        // Validate inputs manually for CLI
        if (name.length < 3) {
            console.error('Error: name must have at least 3 characters (Min length is 3)');
            process.exit(1);
        }

        if (count < 1) {
            console.error('Error: count must be positive');
            process.exit(1);
        }

        console.log('=== Fastify Type System Test ===');
        console.log(`Hello ${name}!`);
        console.log(`Count: ${count}`);
        console.log(`Verbose mode: ${verbose}`);

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
        console.log('✓ CLI is working!');
    } else {
        console.error(`Unknown command: ${command}`);
        console.error('Run with --help to see available commands');
        process.exit(1);
    }
}

// Auto-run CLI when not being imported by tests
if (!process.env.FASTIFY_TEST_MODE) {
    runCLI().catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
