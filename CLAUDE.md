# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Notes

### Model

- Code is written in TypeScript and run using Bun runtime.
- Code is run directly from TypeScript source files using Bun - no build step required.
- In non-local environment, including prod, code is run on a docker image. Use npm run build to build the image. This also runs the unit tests as first stage and a vulnerability scan as last stage. Failing test should fail the build.
- Use TDD when coding: always write test before fixing or changing the code and re-run the tests after changes.
- Write code in such a way that tests pass cleanly without errors.
- Code coverage tracking with Bun's test runner (if enabled, coverage behavior may differ from Vitest).
- Adding dependency libraries into `dependencies` in package.json is strictly prohibited. Needs explicit developer approval.
- Code assumes Bun >= 1.03 (see package.json engine field).
- You should never try to change files outside of the working folder (base folder of the project) or in the node_modules folder, where external libraries are stored.
- All the project config files (the files outside src) should not be changed without explicit developer approval.
- Do not use imports from "bun:*" namespaces and Bun-specific globals. We keep strict adherence with nodejs >=24 APIs for backwards compatibility of the project codebase.

### TypeScript Configuration

- Target: es2020
- Module: ESNext
- Module Resolution: bundler (allows extensionless imports for Bun's native TS execution)
- Lib: ["es2020"]
- Strict mode enabled
- Source maps enabled for better debugging

### Fastify Framework

- Uses Fastify as the HTTP framework
- TypeBox for runtime type validation and schema definitions
- CLI support using Node.js built-in `node:util.parseArgs`
- Plain console logging (no external logging library)
- TypeBox schemas replace runtime type checking
- HTTP endpoints for API functionality
- CLI mode for command-line operations

### Testing Patterns

- **Test Framework**: Node.js native test APIs (`node:test`) executed via Bun runtime
- **Test Executor**: Bun's Node.js-compatible test runner (implements Node.js test runner APIs)
- **Assertions**: Node.js strict assertions (`node:assert/strict`)
- **Test Files**: `*.test.ts` files in src/ and ci/ folders
- **Unit Tests** (src/): Direct imports with Fastify's `inject()` method for HTTP testing (fast, run via `bun test src`)
- **Integration Tests** (ci/): CLI tests using child_process spawn (run via `bun test ci`)
- **Test Imports**: Always import from `node:test` and `node:assert/strict` - no globals
- **Watch Mode**: Available via `bun test --watch` for TDD workflows
- **Test Organization**: Use `describe` and `test`, `beforeEach`/`afterEach` for setup/teardown
- **No External Test Dependencies**: Uses Node.js built-in testing APIs (no Vitest/Jest needed)
- **Debugging**: VSCode debugger works perfectly with standard TypeScript - no runtime transformations
  - Source maps enabled in tsconfig.json (`sourceMap: true`)
  - Debug configurations include `smartStep` and `skipFiles` for better stepping
  - Full debugging support with accurate stepping and breakpoints

### Coding patterns

- Never use `null` >> use `undefined` instead
- Never use `any` >> use `unknown` instead
- Do not use imports from "bun:*" namespaces - Bun globals are automatically available
- Use TypeBox schemas for type validation (Type.String, Type.Number, Type.Object, etc.)
- Export app instance for testing
- Use plain console.log/error for logging
- File naming uses kebab-case convention (e.g., run-tests.ts, not run_tests.ts)
- Set `FASTIFY_TEST_MODE=true` environment variable in tests to prevent auto-run

## Commands

### Testing

- `bun test` - Run all tests (unit + integration)
- `bun run test` - Run linter and all tests
- `bun run test:integration` - Run integration tests only (ci/)
- `bun run test:watch` - Run tests in watch mode for TDD
- `bun test src/app.test.ts` - Run specific test file
- VSCode debugger can be used to debug tests (see .vscode/launch.json)

### Development

- `npm run dev` - Run application with hot-reload on file changes (using Bun's --hot flag)
- `npm run app` - Run application using Bun (shows help by default)
- `bun run src/app.ts test` - Run test command via CLI
- `bun run src/app.ts test "John" 5 --verbose` - Run test command with parameters
- `bun run src/app.ts server` - Start HTTP server on port 3000
- `bun run src/app.ts --help` - Show help message

### Building

- `npm run build` - Docker build with tests and vulnerability scan, outputs logs
- `npm run build:grype` - Build with Grype vulnerability scan only
- `npm run release` - Full release: version bump, changelog, git tag, push

### Release Management

- `bun run script/release.ts [patch|minor|major|ci]` - Version bump and release
  - No params: auto-detect based on commit messages (feat = minor, else patch)
  - `ci`: creates timestamped version without git tag
  - `patch|minor|major`: explicit version bump
  - Automatically updates CHANGELOG.md with commits since last tag
  - Creates git tag and pushes (except for ci builds)

## Architecture

### Project Structure

This is a Fastify Framework application organized into:

- **src/** - Application source code (app.ts, test files)
- **ci/** - Continuous integration tests (integration tests)
- **script/** - Build, test, and utility scripts
- **.vscode/** - VSCode debug configurations

### Key Architectural Components

#### 1. Fastify Application (src/app.ts)

Main application file with:

- HTTP endpoints using Fastify routing
- TypeBox schemas for request/response validation
- CLI support using `node:util.parseArgs`
- Plain console logging (no external logger)
- Both HTTP server mode and CLI command mode
- Environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0)

#### 2. Test Infrastructure

- **Unit Tests** (src/): Fast tests using Fastify's `inject()` method for HTTP endpoint testing
- **Integration Tests** (ci/): CLI behavior tests using child_process spawn to execute app commands
- **Test APIs**: Node.js native test APIs (`node:test`, `node:assert/strict`)
- **Test Executor**: Bun runtime with Node.js test runner compatibility
- **Coverage**: Bun's built-in test coverage (if enabled)
- **No External Dependencies**: Pure Node.js testing APIs, no Vitest/Jest required
- **Test Mode**: Set `FASTIFY_TEST_MODE=true` to prevent auto-run when importing app

#### 3. Docker Build Strategy

Multi-stage Dockerfile with Wolfi OS base:

1. **test** - Runs tests, fails build if tests fail
2. **prod** - Production image with HTTP server (only if tests pass)
3. **scan** - Grype vulnerability scan (fails on critical vulns)
4. **logs** - Exports test and scan logs

Docker container runs `bun run src/app.ts server` to start HTTP server on port 3000.

#### 4. Development Workflow

- Bun runtime for native TypeScript execution
- No runtime type transformation - standard TypeScript debugging works perfectly
- VSCode debug configurations for debugging app and tests with Bun
- Git-based version management with conventional commits
- Hot-reload during development using Bun's --hot flag

### VSCode Debug Configurations

Available debug configurations in .vscode/launch.json:

1. **Debug Current File with Bun** - Debug any .ts file with Bun runtime
2. **Debug Current Test File with Bun** - Debug test files with Bun test runner
3. **Debug app.ts with Bun** - Dedicated application debugging with Bun

### Version Management

Release process using script/release.ts:

- Follows semantic versioning (semver)
- Auto-detects version bump from commit messages
- Supports conventional commits (feat = minor, fix = patch)
- Updates CHANGELOG.md automatically
- Creates git tags and pushes to remote (main branch)
- Supports CI builds with timestamped versions

### Environment

- Bun 1.0+ required
- Windows development environment
- Git repository on main branch
- Uses bun for package management (bun install, bun test, etc.)

## API Endpoints

### GET /health

Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-31T12:00:00.000Z"
}
```

### POST /test

Test endpoint to verify type system and validation.

**Request Body:**
```json
{
  "name": "World",     // string, minLength: 3, default: "World"
  "count": 1,          // number, minimum: 1, default: 1
  "verbose": false     // boolean, default: false
}
```

**Response:**
```json
{
  "message": "Test completed successfully",
  "data": {
    "name": "World",
    "count": 1,
    "verbose": false,
    "user": {          // only included when verbose=true
      "name": "John Doe",
      "age": 30,
      "email": "john@example.com"
    }
  }
}
```

## CLI Commands

### test [name] [count] [--verbose]

Test command to verify type system.

**Examples:**
```bash
bun run src/app.ts test
bun run src/app.ts test "John" 5
bun run src/app.ts test "John" 5 --verbose
```

### server

Start HTTP server (default port 3000).

**Examples:**
```bash
bun run src/app.ts server
PORT=8080 bun run src/app.ts server
```

### --help

Show help message with available commands and options.

**Example:**
```bash
bun run src/app.ts --help
```
