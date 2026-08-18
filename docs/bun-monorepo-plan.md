# Bun Monorepo Plan

This document outlines a practical monorepo structure for a Bun-first TypeScript codebase with multiple independently releasable components, shared libraries, and no compile step. The plan is based on Bun workspace behavior, Bun’s root lockfile model, filtered workspace operations, and common monorepo release patterns using path-based GitHub Actions and Changesets.[cite:8][cite:36][cite:54][cite:18]

## Goals

The repository should support multiple apps and packages in one codebase while keeping release, test, and CI boundaries per component. Bun workspaces are a good fit because they support a single workspace graph, internal `workspace:*` dependencies, filtered commands, and a shared root lockfile.[cite:8][cite:10][cite:36]

Primary goals:

- TypeScript-first code, executed directly with Bun rather than compiled with Vite or a separate TypeScript build step.
- Multiple releasable components, where each component can have its own CI and test cycle.
- Mixed release targets, including npm packages and Docker images.
- Shared internal libraries and utilities without cross-app imports.
- Fast local workflows with root installs and filtered runs.[cite:28][cite:54][cite:29]

## Recommended Repository Layout

A release-unit-oriented structure works better than grouping code only by technical role. Each deployable unit should own its runtime code, tests, package metadata, and release configuration.[cite:8][cite:29]

```txt
repo/
├─ package.json
├─ bun.lock
├─ tsconfig.base.json
├─ biome.json
├─ .changeset/
├─ .github/
│  └─ workflows/
├─ apps/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ src/
│  │  ├─ test/
│  │  └─ Dockerfile
│  └─ worker-sync/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ src/
│     ├─ test/
│     └─ Dockerfile
├─ packages/
│  ├─ sdk/
│  │  ├─ package.json
│  │  ├─ src/
│  │  └─ test/
│  ├─ shared/
│  │  ├─ package.json
│  │  ├─ src/
│  │  └─ test/
│  ├─ domain/
│  │  ├─ package.json
│  │  └─ src/
│  └─ config/
│     ├─ package.json
│     ├─ tsconfig/
│     └─ biome/
└─ tooling/
   └─ scripts/
```

Suggested boundaries:

- `apps/*`: runnable services, workers, APIs, CLIs, or schedulers.
- `packages/*`: reusable importable code.
- `packages/config`: shared TypeScript, lint, and test presets.
- `tooling/*`: repo automation and release helper scripts.[cite:8][cite:48]

## Root Workspace Design

The root should be the package-manager control point for the repo. Bun’s docs state that workspace installs write a `bun.lock` at the project root, and adding dependencies inside a workspace updates that root lockfile.[cite:36][cite:10]

A minimal root `package.json` should remain private and only orchestrate workspace-wide commands:

```json
{
  "name": "@acme/root",
  "private": true,
  "packageManager": "bun@1.x",
  "workspaces": ["apps/*", "packages/*", "tooling/*"],
  "scripts": {
    "lint": "bun run --workspaces lint",
    "typecheck": "bun run --workspaces typecheck",
    "test": "bun run --workspaces test",
    "ci": "bun run lint && bun run typecheck && bun run test"
  }
}
```

Key rules:

- Keep `bun.lock` only at the root.
- Run `bun install` from the root by default.
- Use `workspace:*` or `workspace:^` for internal package dependencies.
- Do not import one app from another app; shared code must live in `packages/*`.[cite:36][cite:10][cite:54]

## Dependency and Runtime Model

This monorepo should be optimized for Bun-native execution. Services and workers can run directly from TypeScript via `bun run`, and Docker containers can use the same runtime model instead of introducing a separate compile step.[cite:28][cite:34]

Recommended package types:

| Package kind | Typical path | Runtime model | Release target |
|---|---|---|---|
| Service | `apps/api` | `bun run src/index.ts` | Docker image [cite:28] |
| Worker | `apps/worker-sync` | `bun run src/worker.ts` | Docker image [cite:28] |
| SDK | `packages/sdk` | Imported via workspace dependency | npm package [cite:18] |
| Shared internal lib | `packages/shared` | Imported via workspace dependency | Internal only [cite:8] |
| Config package | `packages/config` | Imported by other workspaces | Internal only or private npm [cite:48] |

Recommended script contract for every workspace:

- `dev`
- `test`
- `typecheck`
- `lint`
- `release:check`

This keeps local development, CI, and release automation consistent across apps and libraries.[cite:29][cite:48]

## Install and Command Workflow

Bun’s workspace model is centered on a root install. By default, `bun install` installs dependencies for every package in the monorepo, while `--filter` can restrict installs or commands to selected workspaces.[cite:54][cite:8]

Recommended workflow:

1. Edit `package.json` in the relevant workspace.
2. Run `bun install` once at the repo root.
3. Run commands with `bun run --filter <workspace> <script>` when only one target is needed.[cite:54][cite:8]

Examples:

```bash
# install everything
bun install

# run one service
bun run --filter @acme/api dev

# test one package
bun run --filter @acme/sdk test

# partial install in CI or Docker
bun install --filter ./apps/api...
```

The default team convention should not be “install separately inside each app.” Bun documentation centers the root-install model, and workspace issue threads have documented lockfile confusion when installs are treated as package-local by habit.[cite:52][cite:55][cite:54]

## CI Structure

Each releasable component should have its own workflow trigger, but the heavy lifting should live in a reusable shared workflow. GitHub Actions path filtering is a standard way to avoid running unrelated jobs in monorepos, especially when component-specific workflows need to react to both local changes and changes in shared packages.[cite:29][cite:27][cite:32]

Suggested workflow layout:

- `ci-shared.yml`: reusable workflow for checkout, Bun setup, install, lint, typecheck, test, and optional Docker build.
- `service-api.yml`: triggers on `apps/api/**`, shared packages, root lockfile, and config changes.
- `worker-sync.yml`: same pattern for the worker.
- `package-sdk.yml`: tests and release checks for the npm package.
- `release-npm.yml`: Changesets-driven npm release pipeline.
- `release-docker.yml`: Docker image build and push for releasable apps.[cite:18][cite:27][cite:29]

Paths to include for each component workflow:

- The component’s own directory.
- Any shared package directories it depends on.
- `bun.lock`.
- `tsconfig.base.json`.
- shared config packages.
- relevant workflow files.[cite:29][cite:33]

## Release Strategy

A mixed release model works well when release logic is based on package type instead of forcing one publishing flow across the whole monorepo. Changesets is well suited for npm-published packages in monorepos because it versions and publishes only changed packages while maintaining changelogs and release PRs.[cite:18][cite:20]

Recommended release model:

- npm libraries: managed with Changesets.
- Docker apps: released per app with app-owned Dockerfiles and app-specific image tags.
- internal-only packages: version optionally, but do not publish externally.

Suggested custom metadata in each workspace `package.json`:

```json
{
  "name": "@acme/api",
  "release": {
    "type": "docker"
  }
}
```

and

```json
{
  "name": "@acme/sdk",
  "release": {
    "type": "npm"
  }
}
```

That metadata makes it easier for CI scripts to decide which workflow logic applies to a given workspace.[cite:18][cite:29]

## Docker Approach

For Docker-released services, each app should own its own Dockerfile and be runnable through Bun inside the container. Bun’s Docker documentation supports containerizing Bun applications directly, which matches the goal of avoiding a separate compile stage.[cite:28][cite:34]

Practical rules:

- Keep one Dockerfile per deployable app.
- Build from the monorepo root context when shared packages are needed.
- Use filtered install patterns in Docker stages when image build time matters.
- Keep runtime entrypoints simple, such as `bun run src/index.ts` or a named script from the app’s `package.json`.[cite:28][cite:53][cite:54]

## Guardrails and Conventions

These conventions keep the repository scalable:

- One workspace equals one independently testable unit.
- Root scripts orchestrate; business logic never lives at root.
- All shared code belongs in `packages/*`.
- Every workspace defines the same core scripts.
- Apps are runnable directly with Bun, locally and in Docker.
- `bun install` is run at the root by default.
- `bun.lock` is committed and treated as the single source of truth for dependency resolution.[cite:36][cite:54][cite:44]

## Initial Implementation Sequence

A practical rollout order keeps complexity under control:

1. Create the root workspace with `package.json`, `bun.lock`, and `tsconfig.base.json`.[cite:36][cite:8]
2. Add two example apps, one service and one worker, each with its own test and Docker contract.[cite:28]
3. Add `packages/shared`, `packages/domain`, and `packages/config` for all reusable logic.[cite:48]
4. Standardize workspace scripts for lint, typecheck, test, and dev.[cite:48]
5. Add path-based GitHub Actions workflows for each releasable unit.[cite:27][cite:29]
6. Add Changesets for npm libraries.[cite:18]
7. Add Docker release flows for apps.[cite:28][cite:17]

## Decision Summary

The recommended design is a Bun-native workspace monorepo with one root install, one root lockfile, filtered workspace commands, per-component CI triggers, shared packages for common code, Changesets for npm releases, and app-local Dockerfiles for service releases. This structure stays close to Bun’s documented workspace model while preserving independent release and test boundaries for each component.[cite:8][cite:10][cite:36][cite:54]
