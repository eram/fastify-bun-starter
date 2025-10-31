# Fastify Bun Starter

A Fastify Framework starter template with Bun runtime, TypeScript, custom validation library, HTTP API, CLI support, and production-ready infrastructure.

## Features

- **Fastify Framework** - Fast and low overhead web framework for Node.js
- **Bun Runtime** - Fast all-in-one JavaScript runtime with native TypeScript execution
- **TypeScript** - ES2020 target with strict mode for type safety
- **Custom Validator** - Lightweight Zod-like validation library with no heavy dependencies
- **HTTP API** - RESTful endpoints with type-safe request/response validation
- **CLI Support** - Command-line interface using Node.js built-in `parseArgs`
- **Test Infrastructure** - Unit and integration tests using Node.js native test APIs (`node:test`) executed via Bun runtime
- **Docker Build** - Multi-stage Dockerfile with Wolfi OS, automated testing, and vulnerability scanning
- **Release Management** - Semantic versioning with automatic changelog generation
- **Code Quality** - Biome linter with opinionated configuration

## Quick Start

```bash
# Install dependencies
bun install

# Run application with hot-reload
bun run dev

# Run server
bun run src/app.ts server

# Run CLI test command
bun run src/app.ts test "World" 1 --verbose

# Run all tests (unit + integration)
bun test

# Run only integration tests
bun run test:integration

# Build Docker image
npm run build

# Create release
npm run release
```

## Project Structure

```
src/              - Application source code
ci/               - Integration tests
script/          - Build and release scripts
.vscode/          - VSCode debug configurations
```

## Requirements

- Bun >= 1.0
- Docker (for builds)
