# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Notes

### Model

- Code is written in TypeScript and run using Bun runtime with Deepkit type compiler support.
- Code is run directly from TypeScript source files using Bun - no build step required.
- In non-local environment, including prod, code is run on a docker image. Use npm run build to build the image. This also runs the unit tests as first stage and a vulnerability scan as last stage. Failing test should fail the build.
- Use TDD when coding: always write test before fixing or changing the code and re-run the tests after changes.
- Write code in such a way that tests pass cleanly without errors.
- Code coverage tracking with Bun's test runner (if enabled, coverage behavior may differ from Vitest).
- Adding dependency libraries into `dependencies` in package.json is strictly prohibited. Needs explicit developer approval.
- Code assumes Bun >= 1.0 (see package.json engine field).
- You should never try to change files outside of the working folder (base folder of the project).
- All the project config files (the files outside src) should not be changed without explicit developer approval.
- Do not use imports from "bun:*" namespaces and Bun-specific globals. We keep strict adherence with nodejs >=24 APIs for backwards competability of the project codebase.

### TypeScript Configuration

- Target: es2020
- Module: ESNext
- Module Resolution: bundler (allows extensionless imports for Bun's native TS execution)
- Lib: ["es2020"]
- Strict mode enabled
- Deepkit reflection enabled (`"reflection": true` in tsconfig.json)
- Use Deepkit type annotations (MinLength, MaxLength, Positive, Email, Flag, etc.)

### Deepkit Framework

- Uses @deepkit/app for application structure and dependency injection
- Type compiler enabled via @deepkit/bun preload in bunfig.toml
- CLI commands implemented with @cli.controller decorator
- Runtime type validation using Deepkit's type system
- Commands must implement the Command interface from @deepkit/app

### Testing Patterns

- **Test Framework**: Node.js native test APIs (`node:test`) executed via Bun runtime
- **Test Executor**: Bun's Node.js-compatible test runner (implements Node.js test runner APIs)
- **Assertions**: Node.js strict assertions (`node:assert/strict`)
- **Test Files**: `*.test.ts` files in src/ and ci/ folders
- **Unit Tests** (src/): Direct imports with mock dependencies (fast, run via `bun test src`)
- **Integration Tests** (ci/): CLI tests using child_process spawn (run via `bun test ci`)
- **Test Imports**: Always import from `node:test` and `node:assert/strict` - no globals
- **Watch Mode**: Available via `bun test --watch` for TDD workflows
- **Test Organization**: Use `describe` and `test`, `beforeEach`/`afterEach` for setup/teardown
- **No External Test Dependencies**: Uses Node.js built-in testing APIs (no Vitest/Jest needed)
- **Debugging**: VSCode debugger available but stepping may be imprecise due to Deepkit's runtime type transformation
  - Source maps enabled in tsconfig.json (`sourceMap: true`)
  - Debug configurations include `smartStep` and `skipFiles` for better stepping
  - For precise debugging, use console.log() or test-driven development approach
  - Known limitation: Deepkit type compiler transforms code at runtime, affecting debugger accuracy

### Coding patterns

- Never use `null` >> use `undefined` instead
- Never use `any` >> use `unknown` instead
- Do not use imports from "bun:*" namespaces - Bun globals are automatically available
- Use Deepkit type annotations for type validation
- Export app and command classes for testing
- File naming uses kebab-case convention (e.g., run-tests.js, not run_tests.js) following Deepkit standards.

## Commands

### Testing

- `bun test` - Run all tests (unit + integration)
- `bun run test` - Run linter and all tests
- `bun run test:unit` - Run unit tests only (src/)
- `bun run test:integration` - Run integration tests only (ci/)
- `bun run test:watch` - Run tests in watch mode for TDD
- `bun test src/app.test.ts` - Run specific test file
- VSCode debugger can be used to debug tests (see .vscode/launch.json)

### Development

- `npm run dev` - Run application with hot-reload on file changes (using Bun's --hot flag)
- `npm run app` - Run application using Bun

### Building

- `npm run build` - Docker build with tests and vulnerability scan, outputs logs
- `npm run build:grype` - Build with Grype vulnerability scan only
- `npm run release` - Full release: version bump, changelog, git tag, push

### Release Management

- `node script/release.js [patch|minor|major|ci]` - Version bump and release
  - No params: auto-detect based on commit messages (feat = minor, else patch)
  - `ci`: creates timestamped version without git tag
  - `patch|minor|major`: explicit version bump
  - Automatically updates CHANGELOG.md with commits since last tag
  - Creates git tag and pushes (except for ci builds)

## Architecture

### Project Structure

This is a Deepkit Framework application organized into:

- **src/** - Application source code (app.ts, test files)
- **ci/** - Continuous integration tests (integration tests)
- **script/** - Build, test, and utility scripts
- **.vscode/** - VSCode debug configurations

### Key Architectural Components

#### 1. Deepkit Application (src/app.ts)

Main application file with:

- CLI command controllers using @cli.controller decorator
- Dependency injection via @deepkit/app
- Type validation using Deepkit type system (MinLength, MaxLength, Positive, Flag, etc.)
- Logger injection for structured logging

#### 2. Test Infrastructure

- **Unit Tests** (src/): Fast tests using direct imports with mock dependencies
- **Integration Tests** (ci/): CLI behavior tests using child_process spawn to execute app commands
- **Test APIs**: Node.js native test APIs (`node:test`, `node:assert/strict`)
- **Test Executor**: Bun runtime with Node.js test runner compatibility
- **Coverage**: Bun's built-in test coverage (if enabled)
- **No External Dependencies**: Pure Node.js testing APIs, no Vitest/Jest required

#### 3. Docker Build Strategy

Multi-stage Dockerfile with Wolfi OS base:

1. **test** - Runs tests, fails build if tests fail
2. **prod** - Production image (only if tests pass)
3. **scan** - Grype vulnerability scan (fails on critical vulns)
4. **logs** - Exports test and scan logs

#### 4. Development Workflow

- Bun runtime for native TypeScript execution with Deepkit type compiler
- Deepkit Bun preload (@deepkit/bun) configured in bunfig.toml for runtime type transformation
- VSCode debug configurations for debugging app and tests with Bun
- Git-based version management with conventional commits

### VSCode Debug Configurations

Available debug configurations in .vscode/launch.json:

1. **Debug Current File with Bun** - Debug any .ts file with Bun runtime
2. **Debug Current Test File with Bun** - Debug test files with Bun test runner
3. **Debug app.ts with Bun** - Dedicated application debugging with Bun

### Version Management

Release process using script/release.js:

- Follows semantic versioning (semver)
- Auto-detects version bump from commit messages
- Supports conventional commits (feat = minor, fix = patch)
- Updates CHANGELOG.md automatically
- Creates git tags and pushes to remote (master branch)
- Supports CI builds with timestamped versions

### Environment

- Bun 1.0+ required
- Windows development environment
- Git repository on main branch
- Uses bun for package management (bun install, bun test, etc.)
