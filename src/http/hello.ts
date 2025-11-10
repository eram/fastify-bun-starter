import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Infer, z } from '../lib/validator';
import type { WithBody } from './route-types';

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
    'fr-FR',
    'es-ES',
    'it-IT',
    'ja-JP',
    'zh-CN',
    'ko-KR',
    'pt-BR',
    'ru-RU',
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
const numberFormatSchema = {
    number: z.number().describe('Number to format (1-15 digits, can be positive or negative)'),
    locale: z
        .string()
        .regex(IETF_BCP47_PATTERN, 'Locale must be in IETF BCP 47 format (e.g., en-US)')
        .describe('Locale in IETF BCP 47 format (e.g., en-US, de-DE)'),
};

type NumberFormatRequest = Infer<typeof numberFormatSchema>;

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
        return resolved.toLowerCase().startsWith(locale.toLowerCase().split('-')[0]);
    } catch {
        return false;
    }
}

/**
 * Register number formatting endpoint
 *
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
    app.post<WithBody<NumberFormatRequest>>(
        '/api/v1/hello',
        {
            schema: {
                body: numberFormatSchema,
                response: {
                    200: {
                        formatted: z.string().describe('Formatted number string'),
                    },
                    400: {
                        message: z.string().describe('Error message'),
                        availableLocales: z.array(z.string()).optional().describe('List of commonly available locales'),
                    },
                },
            },
        },
        async (request: FastifyRequest<WithBody<NumberFormatRequest>>, reply: FastifyReply) => {
            const { number, locale } = request.body;

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
        },
    );
}
