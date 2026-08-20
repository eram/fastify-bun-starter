import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { initOtel, isOtelEnabled } from './otel';

const OTEL_KEYS = ['OTEL_SDK_DISABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SERVICE_NAME'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
    saved = Object.fromEntries(OTEL_KEYS.map((k) => [k, process.env[k]]));
    for (const k of OTEL_KEYS) delete process.env[k];
});

afterEach(() => {
    for (const k of OTEL_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('isOtelEnabled', () => {
    test('is disabled when OTEL_EXPORTER_OTLP_ENDPOINT is unset', () => {
        expect(isOtelEnabled()).toBe(false);
    });

    test('is disabled when OTEL_SDK_DISABLED=true, even with an endpoint set', () => {
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://localhost:4318';
        process.env['OTEL_SDK_DISABLED'] = 'true';
        expect(isOtelEnabled()).toBe(false);
    });

    test('is enabled when an endpoint is set and the SDK is not disabled', () => {
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://localhost:4318';
        expect(isOtelEnabled()).toBe(true);
    });
});

// initOtel()'s enabled path registers a process-wide global tracer provider and a
// periodic BatchSpanProcessor export timer - not safe to exercise from a unit test
// (would leak state/timers across the suite). It's covered by the E2E test against
// a local OTLP collector stub instead; here we only verify the disabled no-op path.
describe('initOtel', () => {
    test('resolves without initializing anything when disabled (default)', async () => {
        await expect(initOtel()).resolves.toBeUndefined();
    });
});
