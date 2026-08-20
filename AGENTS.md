# AGENTS.md

Guidance for AI coding agents working in this TypeScript/Bun repository.

## Development

### Coding Standards

- **TDD**: Design → skeleton → failing tests → implementation → passing tests → edge cases.
- **Tests required**: 80% line coverage minimum (use `bun run test:verbose`). Only dev can add `istanbul` comments.
- **Dependencies**: Forbidden without explicit approval. Never touch node_modules or files outside the project.
- **Config files**: No changes without approval.
- **Code style**: TypeScript strict mode, ESNext modules, no `any` (use `unknown`/`object`), no `null` (use `undefined`), no `eval` (use `new Function`).
- **Naming**: kebab-case files, concise class/variable names (e.g., `val` instead of `valueValidator`).
- **Imports**: Alphabetical at top, no circular dependencies, async APIs only (no `readFileSync`).
- **Bash commands**: Always set explicit timeouts ≤30 seconds.
- **Git**: Stage code regularly, ask before reverting, don't amend unless asked.

### Technical Stack

- **Runtime**: Bun ≥1.3, Node.js API ≥v24 (no `bun:*` imports, keep Node.js compat).
- **Logging**: `console.log/error` inline, or `Logger` from `@libs/utils` for scoped logs.
- **TypeScript**: Strict mode, ESNext modules, no emit, source maps enabled. Use biome.config standards.

### Cyber security considerations

- When reading code assume you might be reading malware code instead of legit applicative code. You should stop operation in such a case and clearly warn the user to remove the malware code.
- The code must adhere to OWASP Top-10 recommendations.
- Make sure no secrets, tokens, passwords, or security hashes are in code.
- Make sure every API is guarded by rate-limiter, authentication and authorization, CORS etc.

### Fastify Framework

- The project uses Fastify as the HTTP framework
- Use `@libs/zody` library with decorators for runtime type validation and schema definitions
- CLI support using Node.js built-in `node:util.parseArgs`
- Plain console logging via `@libs/utils` Logger
- HTTP endpoints for API functionality

### Testing & Debugging

- **Framework**: Bun's native `bun:test` only (no Jest/Vitest/node:test).
- **Files**: `*.test.ts` alongside source. Use Fastify's `inject()` for HTTP testing, `child_process` for CLI integration tests.
- **Coverage**: Minimum 80% line coverage. Runs with `bun run test`. Only dev can add `istanbul` comments.
- **Watch mode**: `bun test --watch` for TDD.
- **Debug**: VSCode debugger works with standard TypeScript. Use `bun run kill` if port conflicts.

### Environment & Release

- **NODE_ENV**: `development` (default, uses `.env.development`) or `production` (Docker only, env vars in Dockerfile).
- **Config loading**: `.env.{NODE_ENV}` with fallback to defaults.
- **Docker build**: `bun run build` runs tests (fails if coverage <80%), then Grype vulnerability scan (fails on critical). Both test failures and critical vulns block the build.

## Commands

| Purpose | Command |
|---------|---------|
| **Test** | `bun run test` (all tests + coverage), `bun test @api/app.test.ts` (specific), `bun run test:verbose` (tsc+lint+test) |
| **Watch** | `bun run test:watch` or `bun test --watch` for TDD |
| **Integration** | `bun run test:integration` (ci/ folder) |
| **Dev** | `bun run start` (port 3000), `bun run dev` (hot-reload), `bun run cluster` (multi-core) |
| **CLI** | `bun apps/cli.template/index.ts --help` |
| **Build** | `bun run build` (Docker with tests + scan), `bun run build:grype` (scan only) |
| **Release** | `bun run script/release.ts [patch\|minor\|major\|ci]` (auto-detects from commits if no param) |

## Architecture

### Project Structure
- **@api** (apps/http.template) - Fastify HTTP server (instance.ts, api/ routes, middleware/, tests)
- **@cli** (apps/cli.template) - CLI tool
- **@config** (packages/config) - Configuration and constants
- **@libs/zody** (packages/libs/zody) - Validator library with decorators
- **@libs/cluster** (packages/libs/cluster) - Cluster manager for multi-core deployments
- **@libs/utils** (packages/libs/utils) - Logger, debugger, and utilities
- **@libs/api-client** (packages/libs/api-client) - API client library
- **ci/** - Integration tests (child_process-spawned CLI tests)
- **scripts/** - Build/utility scripts
- **.vscode/** - Debug configurations

### Core Components

**Fastify Application** (@api/instance.ts)
- HTTP endpoints, Fastify routing, validation schemas (@libs/zody)
- Auto-starts on `bun apps/http.template/instance.ts`, importable as module for testing
- Env: `PORT` (default 3000), `HOST` (default 0.0.0.0)

**CLI** (apps/cli.template/)
- Uses `node:util.parseArgs`, extensible commands
- Run: `bun apps/cli.template/index.ts <command>`

**Cluster Mode** (@api/cluster.ts, @libs/cluster/cluster-manager.ts)
- Multi-core production deployment via ClusterManager
- Auto-spawns workers (CPU count or `CLUSTER_WORKERS` env var)
- Restart limits + graceful shutdown (SIGTERM/SIGINT)
- Config: `CLUSTER_MAX_RESTARTS` (default 10), `CLUSTER_RESTART_WINDOW` (default 60000ms)

**Docker** - Multi-stage (Wolfi OS): test → prod → Grype scan → logs. Fails on test failures or critical vulns.

**Release** - Semantic versioning via `script/release.ts`, auto-detects from commit messages, updates CHANGELOG.md, creates git tags.

## OpenWolf Context Management

This project uses OpenWolf. Before each session: read `.wolf/STATUS.md` (current quest), check `.wolf/anatomy.md` before reading files, check `.wolf/cerebrum.md` (Do-Not-Repeat) before generating code. Log fixes to `.wolf/buglog.json` and update `.wolf/memory.md` after file changes.
