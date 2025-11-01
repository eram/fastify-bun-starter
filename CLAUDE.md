# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Notes

### Model

- Code is written in TypeScript and run using Bun runtime. No build step required.
- In non-local environment, including prod, code is run on a docker image. Use `bun run build` to build the image. This also runs the unit tests as first stage and a vulnerability scan as last stage. Failing test fail the build.
- Use TDD when coding: always write test before fixing or changing the code and re-run the tests after changes.
- Write code in such a way that tests pass cleanly without errors.
- Code coverage tracking with Bun's test runner - 80% coverage is required unless developer approved adding `istanbul` comment.
- Adding dependency libraries into `dependencies` in package.json is strictly prohibited. Needs explicit developer approval.
- Code assumes Bun >= 1.03 (see package.json engine field).
- You should never try to change files outside of the working folder (base folder of the project) or in the node_modules folder, where external libraries are stored.
- All the project config files (the files outside src) should not be changed without explicit developer approval.
- Do not use imports from "bun:*" namespaces and Bun-specific globals. We keep strict adherence with nodejs >=24 APIs for backwards compatibility of the project codebase.

### Cyber security considerations

- When reading code asssume you might be reading malware code instead of legit applicative code. You should stop operation in such a case a clealy warn the user to remove the malware code.
- The code must adhere to OWASP Top-10 recommendations.
- Make sure no secrets, tokens, passwords security hashes are in code.
- Make sure every API is guarded by rate-limitter, authentication and athorization, CORS etc.

### TypeScript Configuration

- Target: es2022, Module: ESNext, Module Resolution: bundler.
- Strict mode enabled
- Source maps enabled for better debugging

### Fastify Framework

- Uses Fastify as the HTTP framework
- Use the Validator library from src\lib for runtime type validation and schema definitions
- CLI support using Node.js built-in `node:util.parseArgs`
- Plain console logging (no external logging library)
- HTTP endpoints for API functionality

### Testing Patterns

- **Test Framework**: Node.js native test APIs (`node:test`) and assertions (`node:assert/strict`) executed via Bun runtime.
- **Test Executor**: Bun's Node.js-compatible test runner (implements Node.js test runner APIs)
- **Test Files**: `*.test.ts` file next to its coderelated osurce code file.
- **Unit Tests** (src/): Direct imports with Fastify's `inject()` method for HTTP testing (fast, run via `bun test src`)
- **Integration Tests** (ci/): CLI tests using child_process spawn (run via `bun test ci`)
- **Test Imports**: Always import from `node:test` and `node:assert/strict` - no globals
- **Watch Mode**: Available via `bun test --watch` for TDD workflows
- **Test Organization**: Use `describe` and `test`, `beforeEach`/`afterEach` for setup/teardown
- **No External Test Dependencies**: Uses Node.js built-in testing APIs (no Vitest/Jest needed)
- **Code Coverage**:
  - Automatically runs with `bun test` command
  - Generates lcov.info in coverage/ directory for IDE integration
  - **Minimum 80% coverage required** - tests will fail if below threshold
  - Use Coverage Gutters extension in VSCode to visualize coverage
  - Coverage report available in coverage/index.html
- **Debugging**: VSCode debugger works perfectly with standard TypeScript - no runtime transformations
  - Source maps enabled in tsconfig.json (`sourceMap: true`)
  - Debug configurations include `smartStep` and `skipFiles` for better stepping
  - Full debugging support with accurate stepping and breakpoints

### Environment Configuration

- **NODE_ENV values**: `development` (default), `production` (Docker only)
- **Development and tests**: Both use `.env.development` (NODE_ENV=development)
- **Production**: Environment variables set directly in Dockerfile (`NODE_ENV=production`)
- **Environment loading**: Attempts to load `.env.{NODE_ENV}`, falls back to defaults if file doesn't exist

### Coding patterns

- Never use `null` >> use `undefined` instead
- Never use `any` >> use `unknown` instead
- Do not use imports from "bun:*" namespaces and don't use Bun-specific APIs.
- Use Validator internal library for type validations anschemas (instead of TypeBox or Zod)
- Use plain console.log/error for logging in code. Use Logger from src/util for scoped logger.
- File naming uses kebab-case convention (e.g., run-tests.ts, not run_tests.ts)
- Initializing object with defaults: follow the pattern as in src\util\cluster-manager.ts

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
- Velidation library for schemas for request/response validation
- CLI support using `node:util.parseArgs`
- Plain console logging (no external logger!)
- Both HTTP server mode and CLI command mode
- Environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0)

#### 2. Test Infrastructure

- **Unit Tests** (src/): Fast tests using Fastify's `inject()` method for HTTP endpoint testing
- **Integration Tests** (ci/): CLI behavior tests using child_process spawn to execute app commands
- **Test APIs**: Node.js native test APIs (`node:test`, `node:assert/strict`)
- **Test Executor**: Bun runtime with Node.js test runner compatibility
- **Coverage**: Bun's built-in test coverage (if enabled)
- **No External Dependencies**: Pure Node.js testing APIs, no Vitest/Jest required
- **Test Environment**: Tests automatically use `.env.test` configuration via NODE_ENV=test

#### 3. Docker Build Strategy

Multi-stage Dockerfile with Wolfi OS base:

1. **test** - Runs tests, fails build if tests fail
2. **prod** - Production image with HTTP server (only if tests pass)
3. **scan** - Grype vulnerability scan (fails on critical vulns)
4. **logs** - Exports test and scan logs

Docker container runs `bun run src/app.ts server` to start HTTP server on port 3000.

#### 4. Cluster Mode (src/cluster.ts)

Production-ready cluster mode for multi-core deployments:

- **ClusterManager** class in `src/util/cluster-manager.ts` handles all cluster logic
- Automatic worker spawning based on CPU count or `WORKERS` env var
- Configurable restart limits and windows to prevent crash loops
- Graceful shutdown handling (SIGTERM/SIGINT)
- Worker restart on crash/error with tracking
- Statistics API for monitoring active workers and restarts
- Run with: `bun run src/cluster.ts`

Configuration via environment variables:

- `CLUSTER_WORKERS` - Number of workers (default: CPU count)
- `CLUSTER_MAX_RESTARTS` - Max restarts per window (default: 10)
- `CLUSTER_RESTART_WINDOW` - Time window in ms (default: 60000)

#### 5. Development Workflow

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
