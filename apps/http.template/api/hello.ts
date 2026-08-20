import { apm } from '@libs/utils/apm';
import { zod } from '@libs/zody';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteSchema, WithBody, WithQuerystring } from '../route-types';

/**
 * IETF BCP 47 locale pattern
 * Matches language-COUNTRY format (e.g., en-US, de-DE, fr-FR)
 */
const IETF_BCP47_PATTERN = /^[a-z]{2,3}(-[A-Z]{2})?$/;

/**
 * List of commonly supported locales
 * This is a subset - Node.js Intl supports many more
 */
const COMMON_LOCALES = [
    'en-US',
    'en-GB',
    'de-DE',
    'fr',
    'es',
    'it',
    'ja-JP',
    'zh-CN',
    'ko-KR',
    'pt-BR',
    'ru',
    'ar-SA',
    'ar-EG',
    'he-IL',
    'hi-IN',
];

/**
 * Number formatting request schema
 * Validates:
 * - number: 1-15 digits, positive or negative
 * - locale: IETF BCP 47 format (e.g., en-US)
 */
const numberFormatRequest = zod.object({
    number: zod.number().describe('Number to format (1-15 digits)').min(1),
    locale: zod.string().regex(IETF_BCP47_PATTERN, 'Locale must be in IETF BCP 47 format (e.g., en-US)'),
});

type NumberFormatRequestType = { number: number; locale: string };

/**
 * Custom validator to check if number has max 15 digits
 */
function hasMaxDigits(num: number, max: number): boolean {
    const abs = Math.abs(num);
    const digits = abs === 0 ? 1 : Math.floor(Math.log10(abs)) + 1;
    return digits <= max;
}

/**
 * Check if a locale is supported by testing Intl.NumberFormat
 */
function isLocaleSupported(locale: string): boolean {
    try {
        const fmt = new Intl.NumberFormat(locale);
        const resolved = fmt.resolvedOptions().locale;
        // If the resolved locale is different, the requested locale might not be fully supported
        return resolved.toLowerCase().startsWith(locale.toLowerCase().split('-')[0] ?? '');
    } catch {
        return false;
    }
}

/**
 * Shared handler logic for formatting numbers
 */
async function formatNumber(number: number, locale: string, reply: FastifyReply) {
    apm.cInc('views.hello.calls');

    // Validate number has max 15 digits
    if (!hasMaxDigits(number, 15)) {
        return reply.status(400).send({
            message: 'Number must have at most 15 digits',
        });
    }

    // Check if locale is supported
    if (!isLocaleSupported(locale)) {
        return reply.status(400).send({
            message: `Unsupported locale: ${locale}`,
            availableLocales: COMMON_LOCALES,
        });
    }

    // Format the number using Intl.NumberFormat
    try {
        const loc = new Intl.NumberFormat(locale);
        const formatted = loc.format(number);

        return {
            formatted,
        };
    } catch (error) {
        return reply.status(400).send({
            message: `Failed to format number: ${error instanceof Error ? error.message : 'Unknown error'}`,
            availableLocales: COMMON_LOCALES,
        });
    }
}

const formattedNumberResponse = zod.object({
    formatted: zod.string().describe('Formatted number string'),
});

// Use functional schema for ErrorResponse due to complex array type
const errorResponseSchema = zod.object({
    message: zod.string().describe('Error message'),
    availableLocales: zod.array(zod.string()).optional().describe('List of commonly available locales'),
});

/**
 * Register number formatting endpoints
 *
 * GET /hello?number=123456789&locale=en-US
 * POST /hello
 * {
 *   "number": 123456789,
 *   "locale": "en-US"
 * }
 *
 * Response 200:
 * {
 *   "formatted": "123,456,789"
 * }
 *
 * Response 400 (unsupported locale):
 * {
 *   "message": "Unsupported locale: xx-XX",
 *   "availableLocales": ["en-US", "de-DE", ...]
 * }
 */
export function registerHello(app: FastifyInstance) {
    // GET endpoint with query parameters
    const getSchema: RouteSchema = {
        summary: 'Format a number according to locale',
        description: 'Formats a number using Intl.NumberFormat with the specified locale',
        tags: ['API Example'],
        querystring: numberFormatRequest,
        response: {
            200: formattedNumberResponse,
            400: errorResponseSchema,
        },
    };

    app.get<WithQuerystring<NumberFormatRequestType>>(
        '/api/v1/hello',
        {
            schema: getSchema,
        },
        async (request: FastifyRequest<WithQuerystring<NumberFormatRequestType>>, reply: FastifyReply) => {
            const { number, locale } = request.query;
            return formatNumber(number, locale, reply);
        },
    );

    // POST endpoint with JSON body
    const postSchema: RouteSchema = {
        summary: 'Format a number according to locale',
        description: 'Formats a number using Intl.NumberFormat with the specified locale',
        tags: ['API Example'],
        body: numberFormatRequest,
        response: {
            200: formattedNumberResponse,
            400: errorResponseSchema,
        },
    };

    app.post<WithBody<NumberFormatRequestType>>(
        '/api/v1/hello',
        {
            schema: postSchema,
        },
        async (request: FastifyRequest<WithBody<NumberFormatRequestType>>, reply: FastifyReply) => {
            const { number, locale } = request.body;
            return formatNumber(number, locale, reply);
        },
    );
}
