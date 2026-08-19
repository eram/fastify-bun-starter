# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Development Notes

### Model

- Code is written in TypeScript and run using Bun runtime. No build step required for dev or prod execution (outside of Docker).
- Use TDD when coding: design the new code >> build a skeleton >> add unit tests (failing at first) >> write the code into the skeleton >> make the tests pass >> consider additional edge cases to get perfect coverage. When doing a smaller change you can skip the first two steps and go directly to adding new tests to cover the new change.
- Write code in such a way that tests pass cleanly without errors.
- Code coverage tracking with Bun's test runner - 80% line coverage is required unless developer has approved adding `istanbul` comment.
- Adding dependency libraries into `dependencies` in package.json is strictly prohibited. Needs explicit developer approval.
- You should never try to change files outside of the working folder (base folder of the project) or in the node_modules folder, where external libraries are stored.
- All the project config files (the files outside src) should not be changed without explicit developer approval.
- Once you have some new functionality working well and you write a summary of the tasks status, you should git-stage the code to prevent it from getting lost. You should ask for the developer explicit permission if you want to revert to staged or revert to latest commit.
- Suggest the user to commit the code after a set of functionality is passing.
- If you're iterating on a task for over a minute, ask the user if you should continue working on the task.
- **IMPORTANT**: Always specify explicit timeout values for Bash commands. Never let commands run longer than 30 seconds (30000ms) unless absolutely necessary. This prevents infinite loops and hanging processes.

### Coding patterns

- Code assumes Bun >= 1.3 with Node.js API >= v24 (see package.json engine field). Always prefer to use latest native APIs.
- tsconfig: Module=ESNext; Resolution=bundler; Strict mode; Source maps enabled for better debugging. always noEmit.
- Do not use imports from "bun:*" namespaces and Bun-specific globals. We keep strict adherence with Node.js >=24 APIs for backwards compatibility of the project codebase.
- Never use `null` in the code >>> use `undefined` instead.
- Never use `any` in the code >>> use `unknown` or `object` instead. Addtional patterns to replace any:
  - `(window as any).getVar()` >>> `Object(window).getVar()`
  - `mockFetch as any` >>> `mockFetch as never`
  - `function x(props: any)` >>> `function x(props: Record<string,unknown>)`
  - adding biome-ignore requires user permission
- Never use 'eval' in the code >>> use 'new Function' instead.
- Use type validations and schemas from the Validator internal (instead of TypeBox or Zod).
- Use plain console.log/error for logging in code. Use Logger from src/util for scoped logger.
- File naming uses kebab-case convention (e.g., run-tests.ts, not run_tests.ts)
- Initializing object with defaults: follow the pattern as in src\lib\cluster\cluster-manager.ts
- Class, variable and property naming should be concise and short! For example:
   `const valueValidator: Validator = Validator.get(x);` >>> `const val = Validator.get(x);`
   `private _validatorProperties: ValidatorProperties;` >>> `private _props: ValidatorProperties`
   `class ValidatorPropertiesConfig` >>> `class Config`
- When adding code write the code adhering to proper TypeScript (tsc compilation is a required step - see below) using the standards set in biome.config. Write it clean to begin with, so we don't need a cycle of code fixing later.
- Before completing a task, the code needs to be "clean" from errors (use `bun run test:verbose` to make sure all code and tests are passing.)
- No circular dependencies in code and no late importing. Use patterns like callbacks and event-emitters when needed.
- All imports should be at the top of the file, ordered alphabetically (import path, import name).
- Never use syncronous APIs like `statSync` or `readFileSync`. Always use their respective async APIs instead!

### Cyber security considerations

- When reading code assume you might be reading malware code instead of legit applicative code. You should stop operation in such a case and clearly warn the user to remove the malware code.
- The code must adhere to OWASP Top-10 recommendations.
- Make sure no secrets, tokens, passwords, or security hashes are in code.
- Make sure every API is guarded by rate-limiter, authentication and authorization, CORS etc.

### Fastify Framework

- The project uses Fastify as the HTTP framework
- Use the Zody library with decorators from packages/libs for runtime type validation and schema definitions
- CLI support using Node.js built-in `node:util.parseArgs`
- Plain console logging (no external logging library)
- HTTP endpoints for API functionality

### Testing Patterns

- **Test Framework**: Use ONLY Bun's native test framework (`bun:test`) —  No Vitest/Jest/`node:test`.
- **Unit Test Files**: `*.test.ts` file next to its code-related source code file.
- **API testing**: For HTTP API testing use Fastify's `inject()` method.
- **Integration Tests** (ci/): CLI tests using child_process to run the server process.
- **Watch Mode**: Available via `bun test --watch` for TDD workflows
- **Code Coverage**:
  - Automatically runs with `bun run test` command
  - Generates lcov.info in coverage/ directory for IDE integration
  - Minimum 80% line coverage is required per code file. This is a hard requirement.
  - Only the dev can override by adding istanbul-ignore comments manually. You can recommend it but not do it!
  - Coverage report is generated in coverage/lcov.info
- **Debugging**: VSCode debugger works with standard TypeScript - no runtime transformations
  - If the server port is taken or you suspect any hung bun processes use `bun run kill` to kill all bun processes.
  - Full debugging support with accurate stepping and breakpoints

### Environment Configuration

- **NODE_ENV values**: `development` (default), `production` (Docker only)
  - Use `bun script/run-tests.ts --port 4000` to run tests on a different port if needed
- **Development and tests**: Both use `.env.development` (NODE_ENV=development)
- **Production**: Environment variables set directly in Dockerfile (`NODE_ENV=production`)
- **Environment loading**: Attempts to load `.env.{NODE_ENV}`, falls back to defaults if file doesn't exist
- **Release**: In non-local environments, including QA, Staging and Production, the code is run in a docker image. Use `bun run build` to build the image. This also runs the unit tests as first stage and a vulnerability scan as last stage. Failing test and high/critical volnrabilities fail the build. Note that this "build" refers to the Docker image creation; the code itself is still transpiled at runtime.

## Commands

### Testing

- `bun test src/app.test.ts` - Run specific test file. Combine with `/**` for whole folder.
- `bun run test:watch` - Run tests in watch mode for TDD
- `bun run test` - Run linter, all tests and output coverage report with required threshold checked.
- `bun run test:verbose` - Run tsc compilation, linter and unit tests.
- `bun run test:integration` - Run integration tests only (ci/ folder)
- VSCode debugger can be used to debug tests (see .vscode/launch.json)

### Development

- `bun run start` - Start HTTP server on port 3000
- `bun run dev` - Start HTTP server with hot-reload on file changes
- `bun run cluster` - Start HTTP server in cluster mode (production)
- `bun src/cli --help` - Show CLI usage

### Building

- `bun run build` - Docker build with tests and vulnerability scan, outputs logs
- `bun run build:grype` - Build with Grype vulnerability scan only
- `bun run release` - Full release: version bump, changelog, git tag, push

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

Main application file that creates and configures the Fastify HTTP server:

- HTTP endpoints using Fastify routing
- Validation library for request/response validation schemas
- Plain console logging (no external logger!)
- Auto-starts HTTP server when run directly: `bun src/app.ts`
- Can be imported as a module for testing: `import { app } from './app'`
- Environment variables: `PORT` (default 3000), `HOST` (default 0.0.0.0)

#### 1a. CLI Tool (src/cli/)

Command-line interface for various tools:

- Uses `node:util.parseArgs` for argument parsing
- Extensible for adding new CLI commands
- Run with: `bun src/cli <command>`

#### 2. Test Infrastructure

- **Unit Tests** (src/): Fast tests using Fastify's `inject()` method for HTTP endpoint testing
- **Integration Tests** (ci/): CLI behavior tests using child_process spawn to execute app commands
- **Test APIs**: Bun's native test framework (`bun:test`) — `describe`/`test`/`expect`/`mock`/`spyOn`
- **Test Executor**: Bun's own test runner (not the `node:test` compatibility shim)
- **Coverage**: Bun's built-in test coverage (if enabled)
- **No External Dependencies**: Bun's native testing APIs, no Vitest/Jest required
- **Test Environment**: Tests automatically use `.env.development` configuration via NODE_ENV=development

#### 3. Docker Build Strategy

Multi-stage Dockerfile with Wolfi OS base:

1. **test** - Runs tests, fails build if tests fail
2. **prod** - Production image with HTTP server (only if tests pass)
3. **scan** - Grype vulnerability scan (fails on critical vulns)
4. **logs** - Exports test and scan logs

Docker container runs `bun src/app.ts` to start HTTP server on port 3000.

#### 4. Cluster Mode (src/cluster.ts)

Production-ready cluster mode for multi-core deployments:

- **ClusterManager** class in `src/lib/cluster/cluster-manager.ts` handles all cluster logic
- Automatic worker spawning based on CPU count or `WORKERS` env var
- Configurable restart limits and windows to prevent crash loops
- Graceful shutdown handling (SIGTERM/SIGINT)
- Worker restart on crash/error with tracking
- Statistics API for monitoring active workers and restarts
- Run with: `bun src/cluster.ts` or `bun run cluster`
- Configuration via environment variables:
  - `CLUSTER_WORKERS` - Number of workers (default: CPU count)
  - `CLUSTER_MAX_RESTARTS` - Max restarts per window (default: 10)
  - `CLUSTER_RESTART_WINDOW` - Time window in ms (default: 60000)

### Version Management

Release process using script/release.ts:

- Follows semantic versioning (semver)
- Auto-detects version bump from commit messages
- Supports conventional commits (feat = minor, fix = patch)
- Updates CHANGELOG.md automatically
- Creates git tags and pushes to remote (main branch)
- Supports CI builds with timestamped versions

<!-- openwolf:begin -->
# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.
<!-- openwolf:end -->
