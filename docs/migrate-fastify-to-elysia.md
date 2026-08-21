# Migration Plan: Fastify → Elysia

**Decisions**: (1) HTTP/2 + TLS retained via `node:http2` bridge · (2) extend zody with Standard Schema, decorators everywhere · (3) read the two community packages, then implement ours · (4) rename to elysia repo-wide.

**Invariant across all phases**: `bun run test:verbose` (lint → `tsc --noEmit` → tests → ≥80% coverage) green at every phase boundary. One commit per phase.

* * *

## Phase 0 — Spike & pin

Add `elysia@1.4.29`, `@elysiajs/cors@1.4.2`, `@elysiajs/static@1.4.10`, `@elysiajs/openapi@1.4.15`, `@elysiajs/opentelemetry@1.4.11`. Drop the five `@fastify/*`, `fastify`, `@opentelemetry/instrumentation-fastify`. Note `@elysiajs/swagger` is superseded by `@elysiajs/openapi` — use the latter.

Throwaway spike must prove **four** things before any real code:

1. A zody validator with a `~standard` property is accepted in Elysia's `query`/`body`/`response` position.
2. `@elysiajs/openapi`'s `mapJsonSchema` hook can turn a zody validator into JSON Schema via `defs(false)`.
3. Elysia macros support the `resolve` shape needed for auth (return value merges into context, `status(401)` short-circuits).
4. A `node:http2.createSecureServer` can bridge a request into `app.handle(new Request(...))` and stream the response back over an h2 stream.

**Exit**: 4/4 demonstrated. If #4 fails, HTTP/2 becomes the one open question again — I'd stop and tell you rather than silently drop it.

* * *

## Phase 1 — Extend zody with Standard Schema

`packages/libs/zody/validator.ts` — add to the `TypeV` base:

<button class="copyButton_CEmTFw copyButton_-a7MRw" title="Copy code" aria-label="Copy code to clipboard"><svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon" class="copyIcon_CEmTFw"><path fill-rule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5v-3.379a3 3 0 0 0-.879-2.121l-3.12-3.121a3 3 0 0 0-1.402-.791 2.252 2.252 0 0 1 1.913-1.576A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z" clip-rule="evenodd"></path><path d="M3.5 6A1.5 1.5 0 0 0 2 7.5v9A1.5 1.5 0 0 0 3.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L8.44 6.439A1.5 1.5 0 0 0 7.378 6H3.5Z"></path></svg></button>

    get '~standard'() { return { version: 1, vendor: 'zody', validate: (value: unknown) => { const r = this.safeParse(value); return r.success ? { value: r.data } : { issues: toIssues(r.error) }; // {message, path[]} }, };}

Same as a static on `ZodySchema` (`zody.ts`) so decorator classes bind natively. `toIssues` maps zody's error into Standard Schema's `{ message, path: (string|number)[] }`, preserving nested-object keys and array indices.

New file `packages/libs/zody/standard-schema.ts` + `standard-schema.test.ts`.

**Unit tests (~14)**: valid → `{value}` · invalid → `issues[]` · nested-object `path` correctness · array-index `path` correctness · optional/default fields · BigInt & Date coercion parity with `safeParse` · decorator-class static path · `~standard` present on every primitive factory · vendor/version fields · no mutation of the source validator.

⚠️ This touches a shared lib. `packages/shared/`, `apps/cli.template`, and `@libs/utils` consume zody — the addition is purely additive (new getter, no signature change), and the full zody suite (657 tests) must stay green.

* * *

## Phase 2a — Server core: `server.ts`, `instance.ts`

| Fastify | Elysia |
| --- | --- |
| `Fastify({ bodyLimit })` | `new Elysia({ serve: { maxRequestBodySize } })` |
| `routerOptions.maxParamLength` | no equivalent — enforce in the DNS/guard `onRequest` hook (keeps `MAX_URL_LENGTH` behaviour) |
| `addContentTypeParser('application/json', …reviverFn)` | `.onParse(({ request, contentType }) => …)` |
| `setReplySerializer(…replacerFn)` | `.mapResponse()` → `new Response(JSON.stringify(x, replacerFn, 0))` |
| `withTypeProvider` + 2 compilers | **deleted** (Phase 1 supersedes) |

**Structural change — the real "best practice" ask**: Elysia's types accumulate along the chain, so `registerX(app)` mutate-and-return helpers throw away type inference. Every `registerX` becomes an exported **plugin instance** composed with `.use()`:

<button class="copyButton_CEmTFw copyButton_-a7MRw" title="Copy code" aria-label="Copy code to clipboard"><svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon" class="copyIcon_CEmTFw"><path fill-rule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5v-3.379a3 3 0 0 0-.879-2.121l-3.12-3.121a3 3 0 0 0-1.402-.791 2.252 2.252 0 0 1 1.913-1.576A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z" clip-rule="evenodd"></path><path d="M3.5 6A1.5 1.5 0 0 0 2 7.5v9A1.5 1.5 0 0 0 3.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L8.44 6.439A1.5 1.5 0 0 0 7.378 6H3.5Z"></path></svg></button>

    export const health = new Elysia({ name: 'health' }).get('/health', …);// server.tsapp.use(security).use(auth).use(openapi).use(health).use(hello).use(admin)…

`AppInstance` becomes the inferred type of the composed app, not a hand-written alias. `getErrorMessage()` (the `EADDRINUSE`/`EACCES` mapper) survives unchanged — still correct for `listen` failures.

* * *

## Phase 2b — HTTP/2 + TLS (new file `http2-server.ts`)

Three listen modes, selected by env, all in one `startServer`:

| Condition | Mode | Mechanism |
| --- | --- | --- |
| no `TLS_CERT_PATH` | HTTP/1.1 | `app.listen({ port, hostname })` |
| TLS certs, `HTTP2=false` | HTTPS/1.1 | `app.listen({ port, hostname, tls: { cert: Bun.file(…), key: Bun.file(…) } })` |
| TLS certs (default) | **HTTP/2 + h1 fallback** | `http2.createSecureServer({ cert, key, allowHTTP1: true })`, bridged to `app.handle()` |

The bridge (`node:http2` `'request'` event → `Request` → `app.handle()` → write back):

- build `Request` from `:method`/`:path`/`:authority`/`:scheme` pseudo-headers + body stream
- write `res.writeHead(status, headers)` then pipe the `Response.body` reader into the h2 stream
- `allowHTTP1: true` means legacy clients land on the same handler via the same `'request'` event — one code path

**Retained from today**: `getHttp2Settings()` (`initialWindowSize`, `headerTableSize`, `maxConcurrentStreams`, `enablePush:false`) passed as `settings` to `createSecureServer`; `http2SessionTimeout` via `server.setTimeout`; the ALPN/cipher handshake logging hook (now on the `'secureConnection'` event, where it's actually *more* accurate than the current per-request socket sniff).

**Risk**: this is the highest-risk file in the migration — a hand-written protocol bridge. It gets its own E2E test (Phase 5) hitting a real h2 client.

* * *

## Phase 3 — Middleware

**`type-provider.ts` → delete.** **`route-types.ts` → delete** (`WithQuerystring`/`WithParams`/`WithBody`/`RouteSchema` all superseded by Elysia's inference; nothing outside http.template imports them).

**`security.ts` — read-then-implement, per your instruction.** Order of work: clone/inspect `elysia-helmet@3.1.0` and `elysia-rate-limit@5.1.1` source first, then decide per-concern:

- **Helmet**: our CSP config is a static directive map (jsdelivr, Scalar fonts, blob: frames, dev-mode localhost `connectSrc`). Expect to lift their header-serialization approach and inline it (~50 LOC) rather than depend — but that's contingent on what the source shows.
- **Rate limit**: `transpile.ts` needs *per-route* overrides (`max: 1000` for `/app/*`, `max: 100` for env-inject routes) on top of the global limit. If `elysia-rate-limit` supports scoped instances cleanly, use it; if not, implement (its core is a keyed sliding-window map — ~40 LOC).
- **CORS**: `@elysiajs/cors`, config maps 1:1.
- **DNS-rebind guard**: `.onRequest` with the same `ALLOWED_HOSTS` logic.

Hard constraint you set: **`security.test.ts`'s 13 existing tests must pass unmodified.** They assert on actual response headers, so they're a genuine behavioural contract, not an implementation detail — that's the right gate.

**`auth.ts` → Elysia macro.** This is the biggest quality win:

<button class="copyButton_CEmTFw copyButton_-a7MRw" title="Copy code" aria-label="Copy code to clipboard"><svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon" class="copyIcon_CEmTFw"><path fill-rule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5v-3.379a3 3 0 0 0-.879-2.121l-3.12-3.121a3 3 0 0 0-1.402-.791 2.252 2.252 0 0 1 1.913-1.576A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z" clip-rule="evenodd"></path><path d="M3.5 6A1.5 1.5 0 0 0 2 7.5v9A1.5 1.5 0 0 0 3.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L8.44 6.439A1.5 1.5 0 0 0 7.378 6H3.5Z"></path></svg></button>

    .macro({ requireAuth: { async resolve({ headers, status }) { const token = headers.authorization?.startsWith('Bearer ') ? … : undefined; if (!token) return status(401, { message: 'Authentication required.' }); try { return { user: verifyToken(token, secret) }; } catch { return status(401, { message: 'Authentication required.' }); }}}})

Routes opt in with `{ requireAuth: true }`. `resolve` runs *before* the handler and short-circuits properly — **the documented `reply.sent` race disappears**, and `api/admin.ts`'s defensive `if (!request.user) return;` bail-out is deleted. `user` is typed on the handler context, so `declare module 'fastify'` augmentation goes too. Keep the startup guard that rejects a missing/default `JWT_SECRET`.

**`error-handler.ts`**: `setErrorHandler` + `setNotFoundHandler` → one `.onError(({ code, error, set, request }))`, `code === 'NOT_FOUND'` as a case. HTML-vs-JSON content negotiation and the classless error page carry over verbatim.

**`static.ts`**: `@elysiajs/static` (`assets` / `prefix` / `indexHTML`). Must stay registered last.

**`swagger.ts`**: `@elysiajs/openapi` ships Scalar natively → **the 130-line hand-written `getScalarPageHtml()` is deleted**, including its localStorage theme-sync script. `transformSchema` → `mapJsonSchema: { zody: (s) => s.defs(false) }`. Paths `/api/v1/swagger` + `/api/v1/openapi.json`, the `bearerAuth` security scheme, tag descriptions, and server URL all preserved. ⚠️ Verify the built-in Scalar page respects our CSP (it's same-origin bundled, likely *simpler* than the CDN version — may let us tighten `scriptSrc`).

**`transpile.ts`**: ~40 of 353 lines touched — the route shell only. `req.params['*']` → Elysia wildcard, `reply.code().header().send()` → `set.status`/`set.headers` + return, per-route rate-limit config. All file I/O, `Bun.Transpiler`, caching, `addTsExtensions`, path-traversal guards, test-file blocking, and the dev watcher are framework-agnostic and untouched.

* * *

## Phase 4 — Routes, decorators, OTel

**Per your instruction, all remaining functional schemas convert to `z` decorator classes.** `api/hello.ts` currently uses `zod.object({...})` ×3 — these become:

<button class="copyButton_CEmTFw copyButton_-a7MRw" title="Copy code" aria-label="Copy code to clipboard"><svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 20 20" fill="currentColor" aria-hidden="true" data-slot="icon" class="copyIcon_CEmTFw"><path fill-rule="evenodd" d="M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5v-3.379a3 3 0 0 0-.879-2.121l-3.12-3.121a3 3 0 0 0-1.402-.791 2.252 2.252 0 0 1 1.913-1.576A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z" clip-rule="evenodd"></path><path d="M3.5 6A1.5 1.5 0 0 0 2 7.5v9A1.5 1.5 0 0 0 3.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L8.44 6.439A1.5 1.5 0 0 0 7.378 6H3.5Z"></path></svg></button>

    @z.Schema() class NumberFormatRequest extends ZodySchema { @z.number.min(1).describe('Number to format (1-15 digits)') number!: number; @(z.string.regex(IETF_BCP47_PATTERN, '…')) locale!: string;}@z.Schema() class FormattedNumberResponse extends ZodySchema { … }@z.Schema() class ErrorResponse extends ZodySchema { @z.string.describe('Error message') message!: string; @(z.array(z.string).optional.describe('…')) availableLocales?: string[];}

⚠️ Two known zody decorator traps apply here (both in your Do-Not-Repeat list): chains starting with a **call form** (`array()`, `regex()`) need wrapping parens `@(...)`; and `nullable`/`nullish` are wrapping functions, not chain methods. The `errorResponseSchema` array field was originally left functional *because* of the array type — this is exactly the case that needs `@(z.array(z.string).optional…)`. If it won't express cleanly, that's a zody gap worth fixing in Phase 1 rather than working around here.

Routes: `{ schema: { querystring, response } }` → `{ query, response: { 200, 400 }, detail: { summary, tags, security } }`. `reply.status(400).send(x)` → `status(400, x)`.

**`otel.ts`**: `FastifyInstrumentation` → `@elysiajs/opentelemetry`. Note the shape change — it's a `.use()` plugin, not a `registerInstrumentations` entry, so the Elysia half moves into `createServer` while `HttpInstrumentation` stays in the pre-import `initOtel()`. The "must await before http is imported" comment in `instance.ts`/`otel.ts` remains valid for the http half.

**`cluster.ts`**: comments only.

* * *

## Phase 5 — Tests

**Mechanical core**: `app.inject({method,url,headers,payload})` → `app.handle(new Request(url, {...}))`; `res.statusCode`/`res.json()`/`res.body` → `res.status`/`await res.json()`/`await res.text()`. I'll add a small `inject(app, {...})` helper in a shared test util so the ~120 call sites stay one-liners and diffs stay readable.

| Suite | Tests | Action |
| --- | --- | --- |
| `server.test.ts` | 17 | port/listen/error-path tests mostly survive; HTTP/2 mode selection tests added |
| `transpile.test.ts` | 26 | route-shell assertions only; file logic untouched |
| `security.test.ts` | 13 | **must pass unmodified** — the contract for Phase 3 |
| `type-provider.test.ts` | 9 | **deleted**, folded into zody's `standard-schema.test.ts` |
| `instance/cluster/otel/health/hello/admin/auth/error/static/swagger` | ~47 | inject-shape churn |

**Net-new unit tests**: Phase 1 standard-schema (~14) · auth-macro 401-short-circuits-before-handler (impossible to assert cleanly under the old race) · `onError` NOT\_FOUND vs thrown-error vs HTML-vs-JSON negotiation · HTTP/2 listen-mode selection by env.

**E2E (`ci/http-server.ci.test.ts`, `ci/app.ci.test.ts`)** — the real regression net, real `listen()` on port 4321. Existing tests pass with accessor churn only. **New E2E, all gating**:

- **h2 round-trip**: `node:http2` client → `connect()` → real request/response over the bridge, asserting `:status` and body
- **h1 fallback over the same TLS listener** (`allowHTTP1`), asserting ALPN negotiated `http/1.1`
- TLS boot when `TLS_CERT_PATH`/`TLS_KEY_PATH` set; plain-HTTP boot when not
- security headers present on a real (non-injected) response
- rate-limit 429 after burst, and per-route override on `/app/*`
- `/api/v1/openapi.json` contains all four route schemas with zody-derived JSON Schema

* * *

## Phase 6 — Rename to elysia + docs

`fastify` → `elysia` across: root `package.json` (`name`, `keywords`, `bin`, `repository`/`bugs`/`homepage` URLs), `apps/http.template/package.json`, `Dockerfile` (header comment, `GIT_REPO_URL` ARG, three SBOM/grype filename templates), `README.md`, `AGENTS.md`, `docs/`, `packages/libs/utils/env.ts`, `scripts/bench_json_parse.ts`, `scripts/bin.js`.

⚠️ **Outside my reach**: the actual GitHub repo rename (`eram/fastify-bun-starter` → `eram/elysia-bun-starter`) and the git remote URL. I'll update every in-repo *reference* to the new name; you do the GitHub-side rename and `git remote set-url`, or tell me to leave the URLs pointing at the old repo. Flag me either way.

Then: re-run `openwolf scan` (anatomy.md is already stale per session start), update `.wolf/STATUS.md` + `.wolf/memory.md` + `.wolf/cerebrum.md`, and log every bug hit to `.wolf/buglog.json` per repo convention.

* * *

## Risk register

| Risk | Sev | Mitigation |
| --- | --- | --- |
| `node:http2` ↔ `app.handle()` bridge — hand-written protocol glue, streaming/trailers/backpressure edge cases | **High** | Gated by Phase 0 spike #4; dedicated h2 + h1-fallback E2E tests; isolated in one file so it's revertable to HTTPS/1.1 without touching routes |
| Elysia chained generics break `registerX(app)` | **High** | Plugin-instance conversion in Phase 2a — not optional |
| `@elysiajs/openapi` mapping may not cover zody's full `defs()` output | Med | Phase 0 spike #2 gates; fallback is manual `detail.responses` |
| `security.test.ts` ×13 must pass against a hand-rolled helmet | Med | Read both packages *first* (your instruction); tests are the contract, never weakened |
| Per-route rate-limit overrides in `transpile.ts` | Med | Verify in Phase 3; fallback is a scoped plugin instance |
| zody decorators can't express the `availableLocales?: string[]` array chain | Med | Fix in zody (Phase 1) rather than fall back to functional — surfaces early |
| 120 test rewrites → silent assertion drift | Med | File-by-file migration, run after each; assertions never weakened to pass |
| Two single-maintainer community deps | Low | Reading source first; likely inline rather than depend |
| Coverage dips below 80% as files split | Low | Coverage checked per phase |

**Sequencing**: 0 → 1 → 2a → 2b → 3 → 4 → 5 → 6. Phases 3 and 4 parallelizable; everything else is serial.

* * *

Two things I need from you before Phase 0: **(a)** the GitHub repo rename question above, and **(b)** confirmation you want me to start executing rather than refine the plan further. Say go and I'll begin with the Phase 0 spike — it's cheap and it de-risks the four load-bearing assumptions before any real code lands.