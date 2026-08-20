// Optional OpenTelemetry tracing for this service. Disabled by default: no-ops
// (and never imports the @opentelemetry packages) unless OTEL_EXPORTER_OTLP_ENDPOINT
// is set and OTEL_SDK_DISABLED is not true.
//
// Must be awaited before Fastify/http are imported anywhere in the module graph -
// OTel instrumentation patches those modules at import time, and Bun (unlike Node's
// --require flag) needs that done programmatically, before the fact. See instance.ts.
import { atExit } from '@libs/utils/at-exit';
import { Env } from '@libs/utils/env';

export function isOtelEnabled(): boolean {
    return !Env.get('OTEL_SDK_DISABLED', false) && Env.get('OTEL_EXPORTER_OTLP_ENDPOINT', '') !== '';
}

export async function initOtel() {
    if (!isOtelEnabled()) return;

    /* istanbul ignore start -- enabled path is exercised by the E2E test against a local OTLP collector stub, not unit tests (see otel.test.ts) */
    const [
        { NodeTracerProvider },
        { BatchSpanProcessor },
        { OTLPTraceExporter },
        { Resource },
        { ATTR_SERVICE_NAME },
        { registerInstrumentations },
        { HttpInstrumentation },
        { FastifyInstrumentation },
    ] = await Promise.all([
        import('@opentelemetry/sdk-trace-node'),
        import('@opentelemetry/sdk-trace-base'),
        import('@opentelemetry/exporter-trace-otlp-http'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/semantic-conventions'),
        import('@opentelemetry/instrumentation'),
        import('@opentelemetry/instrumentation-http'),
        import('@opentelemetry/instrumentation-fastify'),
    ]);

    const serviceName = Env.get('OTEL_SERVICE_NAME', Env.appName);

    // OTLPTraceExporter reads OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS
    // from process.env itself per the OTel spec - no need to pass them explicitly.
    const exporter = new OTLPTraceExporter();

    const provider = new NodeTracerProvider({
        resource: new Resource({ [ATTR_SERVICE_NAME]: serviceName }),
        spanProcessors: [new BatchSpanProcessor(exporter)],
    });
    provider.register();

    registerInstrumentations({
        instrumentations: [new HttpInstrumentation(), new FastifyInstrumentation()],
    });

    atExit(async () => {
        await provider.shutdown();
    });
    /* istanbul ignore stop */
}
