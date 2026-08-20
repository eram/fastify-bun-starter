# Dockerfile for fastify-bun-starter based on Chainguard Wolfi
# Two phases: build (clone + test + source SBOM) -> final (runtime + shipped-tree SBOM + vuln scan)

# ---- Base image: tooling shared by build and final ----
FROM cgr.dev/chainguard/wolfi-base:latest AS base
RUN apk add --no-cache bun git syft grype cyclonedx-cli \
  && adduser -D appuser

# ---- Build stage: fresh clone, install, test, prune, source SBOM ----
# WORKDIR matches the final stage (/app) so workspace symlinks in node_modules
# (bun links @libs/*, @components/* etc. to packages/... by absolute path)
# still resolve correctly after the COPY into `final` below.
FROM base AS build
ARG BUILD_TS
ARG GIT_REPO_URL=https://github.com/eram/fastify-bun-starter.git
ARG GIT_COMMIT
WORKDIR /app
RUN git clone "$GIT_REPO_URL" . \
  && git checkout "$GIT_COMMIT"

# SBOM of the raw cloned source, before install/build
RUN mkdir -p /out \
  && echo "Build timestamp: $BUILD_TS" \
  && syft dir:/app --config /app/packages/config/syft.conf -o cyclonedx-json > /out/sbom-src.cdx.json

RUN bun install --frozen-lockfile

# Fails the build if lint, typecheck, tests, or coverage fail
RUN bun run test:verbose

# Prune to production deps only, then strip tests/mocks/dev-only dirs.
# packages/libs/* and packages/components must stay: node_modules workspace
# symlinks point at them by path. apps/cli.template is never imported by
# apps/http.template, so it's safe to drop after install.
RUN bun install --production --frozen-lockfile \
  && find /app -type f \( -name '*.test.ts' -o -name '*.test.js' \) -delete \
  && find /app -type d \( -name '__mock__' -o -name '__mocks__' \) -exec rm -rf {} + \
  && rm -rf \
    /app/.git \
    /app/apps/cli.template \
    /app/ci \
    /app/docs \
    /app/audits \
    /app/coverage \
    /app/scripts/bench_json_parse.ts \
    /app/scripts/bench_logger.js \
    /app/scripts/bench_zody.ts

# ---- Final stage: minimal runtime, shipped-tree SBOM, vuln scan ----
FROM base AS final
ARG GIT_COMMIT
WORKDIR /app

COPY --from=build --chown=appuser:appuser /app /app
COPY --from=build /out/sbom-src.cdx.json /tmp/sbom-src.cdx.json

# CycloneDX SBOM of the whole image filesystem at this point (OS packages + bun +
# app), not just /app. --config excludes apk cache/tmp/scan-output scratch dirs
# (see packages/config/syft.conf) so removed-package leftovers don't pollute it.
# Note: since this runs before the cleanup step below, it still includes
# syft/grype/cyclonedx-cli themselves as installed packages.
RUN syft dir:/ --config /app/packages/config/syft.conf -o cyclonedx-json > /tmp/sbom-img.cdx.json

# Merge sbom-src + sbom-img into one CycloneDX doc via cyclonedx-cli, and scan
# the merged SBOM with grype — fails the build on high/critical, fixed vulns only.
RUN mkdir -p /sbom /grype \
  && cyclonedx-cli merge \
    --input-files /tmp/sbom-src.cdx.json /tmp/sbom-img.cdx.json \
    --output-format json \
    --output-file "/sbom/fastify-bun-starter.sbom.${GIT_COMMIT}.json" \
  && grype "sbom:/sbom/fastify-bun-starter.sbom.${GIT_COMMIT}.json" \
    --fail-on high --only-fixed \
    -o table | tee "/grype/fastify-bun-starter.grype.${GIT_COMMIT}.txt"

# Remove scanning tools and temp files; keep the runtime minimal
RUN apk del syft grype cyclonedx-cli \
  && rm -rf /tmp/* /out /var/cache/apk/* /root/.cache \
  && chmod -R a-w /app \
  && mkdir -p /log && chown -R appuser:appuser /log /sbom /grype

USER appuser:appuser
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun run -e "fetch('http://localhost:3000/health').then(r => r.json()).then(d => process.exit(d.status === 'ok' && d.workers >= 0 ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "apps/http.template/cluster.ts"]
