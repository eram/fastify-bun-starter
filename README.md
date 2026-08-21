# Fastify Bun Starter

**Production-ready Fastify template with zero dependencies** (except official Fastify packages). Faster JSON parsing than Fastify defaults, faster validation than TypeBox. Modern tooling with just Bun + Biome.

## Why This Template?

- ⚡ **Faster** - Custom JSON parser with BigInt support, and **zody**, a validation library that compiles schemas to specialized JS (2-10x faster than TypeBox)
- 🔒 **Secure** - Prototype pollution prevention, rate limiting, CORS, Helmet, vulnerability scanning, no secrets in code
- 🎯 **Zero deps** - Only official Fastify packages, custom validator/immutable/utilities
- 🛠️ **Modern tools** - Bun runtime (test/build/dev), Biome linter, native Node test APIs
- 🔑 **Auth built in** - JWT middleware with per-route `requireAuth`, plus OpenTelemetry tracing
- 📦 **Complete** - HTTP + CLI + clustering + Docker + CI/CD + OpenAPI/Swagger
- 🤖 **Claude-ready** - Full CLAUDE.md with coding standards and workflows

## Prerequisites

- **Bun** >= 1.3.0 ([Install Bun](https://bun.sh))

That's it! No other global tools needed.

## Quick Start

### Create a New Project

Use the scaffolding tool to create a new project from this template:

```bash
# Using npx (after publishing to npm)
npx create-fastify-bun-starter my-app

# Or clone directly from GitHub
git clone https://github.com/eram/fastify-bun-starter.git my-app
cd my-app
bun install
```

### Using the Template

The `create-fastify-bun-starter` tool will:
1. Clone this repository
2. Remove git history
3. Customize `package.json` with your project details
4. Set up a clean project ready to develop

Simply run:

```bash
npx create-fastify-bun-starter my-awesome-app
cd my-awesome-app
bun install
bun run dev
```

## Features

### Performance
- **Custom JSON Parser** - BigInt support, prototype pollution prevention, SharedArrayBuffer handling
- **zody Validation** - compiles schemas to specialized closures/generated JS; see below
- **Immutable Objects** - Frozen data structures with runtime safety

### zody — the validation layer

`packages/libs/zody` is the piece that makes this template different. One schema definition
drives request validation, response serialization, and the OpenAPI document — with no
runtime dependency.

Two equivalent authoring styles, both producing the same validator:

```ts
// Functional — a plain value, inferred types
const ErrorResponse = zod.object({
    message: zod.string().describe('Error message'),
    availableLocales: zod.array(zod.string()).optional().describe('Supported locales'),
});
type ErrorResponse = zod.Infer<typeof ErrorResponse>;

// Decorator — class-based, same engine
@z.Schema()
class NumberFormatRequest extends ZodySchema {
    @z.number number!: number;
    @z.string.regex(IETF_BCP47_PATTERN) locale!: string;
}
```

- **Compiles, doesn't interpret** - `validate()` replaces itself with generated code on first
  call, so the hot path is specialized to the schema rather than walking a node tree
- **JSON Schema both ways** - `defs()` emits draft-07 for Swagger; `fromJsonSchema()` reads it back
- **Fastify type provider** - schemas flow into route generics, so handlers get typed
  `request.body` / `request.query` with no casts
- **Zod-compatible surface** - the `zod` namespace mirrors the familiar API for easy migration

### Security
- **Built-in Protection** - Rate limiting, CORS, Helmet, CSRF, prototype pollution prevention
- **Vulnerability Scanning** - Grype scanner in Docker builds, fails on critical CVEs
- **Secret Detection** - Biome linter catches tokens/passwords in code
- **80% Code Coverage** - Required threshold enforced in CI

### Developer Experience
- **Bun All-in-One** - Runtime, package manager, test runner, bundler (no separate tools)
- **Biome Linter** - Fast linting + formatting (no ESLint/Prettier needed)
- **Native Tests** - Bun's `bun:test` framework, no Vitest/Jest (fast, no config)
- **TypeScript Native** - No build step in dev, source maps work perfectly
- **Claude-Optimized** - CLAUDE.md with full context for AI pair programming

### Production Ready
- **Clustering** - Multi-core support with graceful restart, configurable limits
- **Docker** - Multi-stage Wolfi-based build with test + scan stages
- **OpenAPI/Swagger** - Auto-generated docs at `/docs`
- **CI/CD** - Semantic versioning, changelog generation, git-based releases

## Environment Configuration

The project uses `NODE_ENV` to determine the runtime environment:

- **`development`** (default) - Local development and testing with debug output and env.print()
- **`production`** - Production deployment (set in Dockerfile, optimized, minimal logging)

### Environment Files

Only `.env.development` is tracked in git:

- **`.env.development`** - Development/test configuration (tracked in git, loaded by default)
- **`.env.local`** - Local overrides (gitignored, optional)
- **`.env`** - Alternative local overrides (gitignored, optional)

**Production**: Environment variables set directly in Dockerfile/deployment platform (NODE_ENV=production)

### Environment Variables

```bash
# Server Configuration
HOST=0.0.0.0              # Server host (default: 0.0.0.0)
PORT=3000                 # Server port (default: 3000)

# Cluster Configuration
CLUSTER_WORKERS=4         # Number of workers (defaults to CPU count, max 32)
CLUSTER_RESTART_MAX=10    # Max restarts per window (default: 10)
CLUSTER_RESTART_WINDOW=60000  # Restart window in ms (default: 60000)
CLUSTER_SHUTDOWN_TIMEOUT=5000 # Shutdown timeout in ms (default: 5000)
```

### Running in Different Modes

```bash
# Development (default) - loads .env.development
bun run dev

# Testing - uses same .env.development
bun test

# Production - NODE_ENV=production set in Dockerfile
docker build -t my-app .
docker run -p 3000:3000 my-app
```

### Development Commands

```bash
# Run application with hot-reload
bun run dev

# Run HTTP server
npm run start
# or: bun apps/http.template/instance.ts

# Run with hot reload
npm run dev

# Run cluster mode (production)
npm run cluster

# Run all tests (unit + integration)
bun test

# Run tests in watch mode
bun run test:watch

# Build Docker image
npm run build

# Create release
npm run release

# Publish to NPM (maintainers only)
npm run publish:npm
```

## Project Structure

```
apps/
  http.template/  - Fastify server: api/, middleware/, frontend/
  cli.template/   - CLI entry point and commands
packages/
  libs/zody/      - Validation + JSON Schema (no dependencies)
  libs/utils/     - JSON parse, immutable, logger, jwt, apm, shell
  libs/cluster/   - Multi-core clustering
  libs/api-client/- Typed client generated from route schemas
  components/     - Shared UI components
  config/         - Shared configuration
ci/               - Integration tests
scripts/          - Build, test and release scripts
docs/             - Project documentation
```

## Requirements

- Bun >= 1.3.0
- Docker (for builds)
