# Dockerfile for deepkit-starter based on Wolfi OS with Bun

# ---- Base image ----
FROM cgr.dev/chainguard/wolfi-base:latest AS base
WORKDIR /app
RUN apk add --no-cache bun \
  && adduser -D appuser \
  && mkdir -p /app/node_modules \
  && chown -R appuser:appuser /app


# ---- Test stage (fails build if tests fail) ----
ARG BUILD_TS
FROM base AS test
WORKDIR /app
COPY package.json bun.lock* ./
COPY . /app
RUN mkdir -p /log && chown -R appuser:appuser /app /log
USER appuser
RUN bun install --frozen-lockfile
# Run tests with Bun, add build timestamp to log, and fail build if tests fail
RUN rm -f /log/test.log && echo "Build timestamp: $BUILD_TS" > /log/test.log && /bin/sh -c 'set -o pipefail && bun test 2>&1 | tee -a /log/test.log'

# ---- Production stage (only builds if tests pass) ----
FROM base AS prod
WORKDIR /app
COPY --from=test /app /app
ENV NODE_ENV=production
RUN bun install --production --frozen-lockfile
# Remove unnecessary files to minimize image size
RUN rm -rf \
  /app/src/**/*.test.* \
  /app/ci/ \
  /app/script/*test* \
  /app/docs/ \
  /app/*.cpuprofile \
  /app/lcov.info \
  /app/.vscode
# Make /app readonly
RUN chmod -R a-w /app
USER appuser
WORKDIR /app
EXPOSE 80 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun run -e "fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "run", "src/app.ts"]


# ---- Vulnerability scan stage (does not produce final image) ----
ARG BUILD_TS
FROM cgr.dev/chainguard/wolfi-base:latest AS scan
RUN apk add --no-cache curl
# Install grype
RUN curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin
# Copy the production image filesystem
COPY --from=prod / /
# Create /log and set permissions
RUN mkdir -p /log && chown -R root:root /log && chmod 777 /log
# Copy test log from test stage
COPY --from=test /log/test.log /log/test.log
# Run grype scan, add build timestamp to log, and fail on critical vulns
RUN echo "Build timestamp: $BUILD_TS" > /log/grype-scan.log && grype dir:/ --fail-on critical --only-fixed --scope all-layers --verbose | tee -a /log/grype-scan.log

# ---- Logs export stage (always export logs) ----
FROM scratch AS logs
COPY --from=scan /log/grype-scan.log /
COPY --from=scan /log/test.log /

# Note: The final image is always the prod stage. The scan stage is for validation only and is not used for deployment.
