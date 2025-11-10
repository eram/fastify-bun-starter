/**
 * Capitalizes the first letter of a string.
 * @param str - The string to capitalize.
 * @returns The capitalized string.
 */
export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Capitalizes the first letter of each word in a string.
 * @param str - The string to capitalize.
 * @returns The string with each word capitalized.
 */
export function capitalizeAll(str: string): string {
    return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Escapes enough characters to make an HTML string not render as code should you be
 * forced to innerHTML or otherwise slop it into the document.
 * if DOM exists, we use the lightweight element, template, to provide the function internals.
 *
 * @param str - The string to escape.
 * @returns The escaped string.
 */
export function htmlSpecialChars(str: string): string {
    // This should work in both browser and Node.js environments:
    const doc = (globalThis as { document?: { createElement?: (tag: string) => { textContent?: string; innerHTML?: string } } })
        .document;
    /* istanbul ignore next -- browser-only code path */
    if (typeof doc?.createElement === 'function') {
        const template = doc.createElement('template');
        template.textContent = str;
        return template.innerHTML || str;
    }
    return str.replace(/[&<>"']/g, (m) => `&#38;#38;#${m.charCodeAt(0)};`);
}

/**
 *  string to base64url: escape, encode, unescape and decode
 * @param str
 * @returns str
 */
export function urlEscape(str: string) {
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function urlUnescape(str: string) {
    return (str += new Array(5 - (str.length % 4)).join('=')).replace(/-/g, '+').replace(/_/g, '/');
}

export function b64urlEncode(str: string) {
    return urlEscape(Buffer.from(str).toString('base64'));
}

export function b64urlDecode(str: string) {
    return Buffer.from(urlUnescape(str), 'base64').toString();
}

/**
 * Slugifies a string by converting it to lowercase and replacing spaces with hyphens.
 * @param str - The string to slugify.
 * @returns The slugified string.
 */
export function slugify(str: string): string {
    return str
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

/**
 * Serializes an object into a URL query string.
 * Usage: const url = "/search?" + serializeParams({ q: "js tricks", page: 2 });
 * @param params - The key-val object to serialize.
 * @returns The serialized query string.
 */
export function serializeParams(params: Record<string, string | number | boolean>): string {
    return Object.entries(params)
        .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
        .join('&');
}

/**
 * Deserializes a URL query string into an object.
 * @param query - The query string to deserialize.
 * @returns The deserialized key-val object.
 */
export function deserializeParams(query: string): Record<string, string | number | boolean> {
    if (typeof query !== 'string') return {};
    return query.split('&').reduce(
        (acc, pair) => {
            if (!pair) return acc;
            const [key, val = ''] = pair.split('=');
            const decoded = decodeURIComponent(val);
            let parsed: string | number | boolean = decoded;
            if (decoded.toLocaleLowerCase() === 'true') parsed = true;
            else if (decoded.toLocaleLowerCase() === 'false') parsed = false;
            else if (decoded !== '' && !Number.isNaN(Number(decoded))) {
                // Only treat as number if not empty and is a valid number
                parsed = Number(decoded);
            }
            acc[decodeURIComponent(key)] = parsed;
            return acc;
        },
        {} as Record<string, string | number | boolean>,
    );
}

/**
 * Stack for locale settings to support push/pop behavior.
 */
type NumTransform = (s: string) => string;

const localeStack: [
    Intl.LocalesArgument,
    { groupCode: number; decimalCode: number; c0: number; minusCode: number },
    (Intl.NumberFormatOptions & Intl.DateTimeFormatOptions)?,
    NumTransform?,
][] = [];

/**
 * Pushes custom locale settings onto the stack for use by the `locale` template tag.
 * @param locale - The locale(s) to use (e.g., 'en-GB', 'de-DE', ['en-US', 'en-GB']).
 * @param options - Formatting options for numbers and dates.
 * @example
 * localePush('de-DE', { style: 'currency', currency: 'EUR' });
 * console.log(locale`Price: ${1234.56}`); // "Price: 1.234,56 €"
 * localePop();
 */
export function localePush(locale?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions & Intl.DateTimeFormatOptions): void {
    const formatter = new Intl.NumberFormat(locale ?? 'en-US');
    const parts = formatter.formatToParts(-1000.1);
    const seps = parts.reduce(
        (acc, part) => {
            if (part.type === 'group') acc.groupCode = part.value.charCodeAt(0);
            else if (part.type === 'decimal') acc.decimalCode = part.value.charCodeAt(0);
            else if (part.type === 'minusSign') acc.minusCode = part.value.charCodeAt(0);
            else if (part.type === 'fraction') acc.c0 = part.value.charCodeAt(0) - 1; // char code for zero
            return acc;
        },
        { groupCode: 0, decimalCode: 0, c0: 0, minusCode: 0 },
    );

    localeStack.push([locale ?? 'en-US', seps, options]);
}

localePush('en-US'); // Initialize with default locale settings

/**
 * Pops the most recent locale settings from the stack, reverting to the previous settings
 * or system defaults if the stack is empty.
 * @example
 * localePush('de-DE');
 * console.log(locale`Number: ${1234.56}`); // "Number: 1.234,56"
 * localePop();
 * console.log(locale`Number: ${1234.56}`); // back to en-US
 */
export function localePop(): void {
    // keep the 'en-US' default.
    if (localeStack.length > 1) localeStack.pop();
}

/**
 * Template tag to localize numbers and dates in a template string.
 * Uses locale settings from localePush() if available, otherwise uses system defaults.
 * Usage: console.log( locale`number is ${1000000} and date is ${new Date()}.` );
 * @param strings - The template strings.
 * @param values - The values to localize.
 * @returns The localized string.
 */
export function locale<T extends Array<Date | string | number>>(strings: TemplateStringsArray, ...values: T) {
    const [locale, _, options] = localeStack[localeStack.length - 1];

    const arr = values.map((value, index) => {
        let formattedValue: string;

        if (typeof value === 'number') {
            formattedValue = value.toLocaleString(locale, options);
        } else if (value instanceof Date) {
            formattedValue = value.toLocaleDateString(locale, options);
        } else {
            formattedValue = String(value);
        }

        return `${strings[index]}${formattedValue}`;
    });
    return arr.join('') + strings[strings.length - 1];
}

/**
 * Parses a locale-formatted number string into a JavaScript number.
 *
 * This function replaces locale-specific minus, group, and decimal separators
 * with standard ones before parsing. If a different locale is specified,
 * it temporarily switches to that locale for parsing.
 *
 * @param str - The locale-formatted number string to parse.
 * @param _locale - Optional. The locale to use for parsing. If not provided, the current locale is used.
 * @returns The parsed number, or NaN if parsing fails.
 */
export function parseLocaleNumber(str: string, _locale?: Intl.LocalesArgument): number {
    const [locale, seps, _] = localeStack[localeStack.length - 1];

    if (!!_locale && _locale !== locale) {
        localePush(_locale);
        const rc = parseLocaleNumber(str, _locale);
        localePop();
        return rc;
    }

    // Convert non-Latin digits (Arabic-Indic, Persian) to Western digits
    // Only convert if the locale actually uses these digits (detected by formatting a test number)
    let num = 0;
    let digits = 0; // we need to find at least one digit for this to be a valid number
    let decimals = -1;
    let minus = false;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code >= seps.c0 && code <= seps.c0 + 9) {
            if (decimals >= 0) decimals++;
            num = num * 10 + (code - seps.c0);
            digits++;
        } else if (code === seps.minusCode) {
            if (minus) return Number.NaN; // multiple minus signs
            minus = true;
        } else if (code === seps.decimalCode) {
            if (decimals >= 0) return Number.NaN; // multiple decimal points
            decimals = 0;
        } else if (code === seps.groupCode || code === 32 || code === 8239) {
            // just skip spaces and narrow no-break space.
        } else {
            return Number.NaN; // invalid character
        }
    }

    num = digits ? (decimals > 0 ? num / 10 ** decimals : num) * (minus ? -1 : 1) : Number.NaN;
    return num;
}

/**
 * Converts a byte value to a human-readable string (e.g., 1.23 MB).
 *
 * @param bytes - The number of bytes.
 * @param bin - If true, use binary units (powers of 1024, KiB/MiB/etc). If false, use SI
 *  units (powers of 1000, KB/MB/etc). Default: true (binary units).
 * @returns The formatted string with appropriate unit.
 */
export function humanBytes(bytes: number, bin = true): string {
    const thresh = bin ? 1024 : 1000;
    let abs = Math.abs(bytes);

    if (abs < thresh) {
        return `${bytes} B`;
    }
    const units = bin
        ? (['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'] as const)
        : (['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] as const);
    let u = -1;
    do {
        abs /= thresh;
        ++u;
    } while (abs >= thresh && u < units.length - 1);

    // add precision two decimal places, only if needed, then add sign back
    abs = abs % 100 ? Math.round(abs * 100) / 100 : abs;
    return locale`${abs * (bytes < 0 ? -1 : 1)} ${units[u]}`;
}

// Unit mappings with correct values - multi-letter units first, then 'b' last
const BYTE_UNITS = [
    // Binary units (base 1024) - check these first
    ['kib', 1024],
    ['mib', 1024 ** 2],
    ['gib', 1024 ** 3],
    ['tib', 1024 ** 4],
    ['pib', 1024 ** 5],
    ['eib', 1024 ** 6],
    ['zib', 1024 ** 7],
    ['yib', 1024 ** 8],
    // SI units (decimal, base 1000)
    ['kb', 1000],
    ['mb', 1000 ** 2],
    ['gb', 1000 ** 3],
    ['tb', 1000 ** 4],
    ['pb', 1000 ** 5],
    ['eb', 1000 ** 6],
    ['zb', 1000 ** 7],
    ['yb', 1000 ** 8],
    // Single-letter 'b' for bytes
    ['b', 1],
] as const;

/**
 * Converts a human-readable byte string back to a numeric value (e.g., "1.23 MB" => 1230000).
 * Supports both binary units (KiB, MiB, GiB, etc.) and SI units (KB, MB, GB, etc.).
 * Handles locale-formatted numbers with thousands separators.
 *
 * @param str - The human-readable byte string (e.g., "1.5 MB", "2 KiB").
 * @param locale - Optional locale for number parsing (e.g., "en-US", "de-DE"). If not provided, uses the local stack.
 * @returns The numeric byte value, or NaN if the input is invalid.
 */
export function fromHumanBytes(str: string, locale?: string): number {
    let numStr = str.trim();
    if (!numStr) return Number.NaN;

    let multiplier = 1;
    const last3 = numStr.slice(-3).toLowerCase();

    // Quick check: if doesn't end with 'b', skip unit matching
    if (last3.endsWith('b')) {
        for (const [unit, value] of BYTE_UNITS) {
            if (last3.endsWith(unit)) {
                multiplier = value;
                numStr = numStr.slice(0, -unit.length).trim();
                break;
            }
        }
    }

    const num = parseLocaleNumber(numStr, locale) * multiplier;
    return num;
}
