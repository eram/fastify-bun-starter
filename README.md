# Deepkit Starter Project

A Deepkit Framework project template with TypeScript, runtime type validation, and production-ready infrastructure powered by Bun.

## Features

- **Deepkit Framework** - Runtime type system with decorators and dependency injection.
- **TypeScript** - ES2020 target with strict mode and experimental decorators.
- **Bun Runtime** - Fast native TypeScript execution with Deepkit type compiler integration.
- **Test Infrastructure** - Unit and integration tests using Node.js native test APIs (`node:test`) executed via Bun runtime.
- **Docker Build** - Multi-stage Dockerfile with Wolfi OS, automated testing, and vulnerability scanning.
- **Release Management** - Semantic versioning with automatic changelog generation.
- **Code Quality** - Biome linter with an opinionated configuration.

## Quick Start

```bash
# Install dependencies
bun install

# Run application with hot-reload
bun run dev

# Run all tests (unit + integration)
bun test

# Run only unit tests
bun run test:unit

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
