/**
 * Promise-based setTimeout wrapper (browser and Node.js compatible).
 * Usage: await sleep(1000);
 *
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the delay.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Creates a debounced version of a function that delays its execution until after a specified delay.
 * Call the returned function to start debouncing.
 * Usage: const onKeyUp = debounce((val) => searchUsers(val), 400);
 *
 * @param func - The function to debounce.
 * @param delay - The delay in milliseconds (default: 300).
 * @returns A debounced function.
 */
// biome-ignore lint/suspicious/noExplicitAny: Generic function wrapper requires any for flexibility
export function debounce<T extends (...args: any[]) => void>(func: T, delay: number = 300): T {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // biome-ignore lint/suspicious/noExplicitAny: Context binding requires any type
    return function (this: any, ...args: Parameters<T>) {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => func.apply(this, args), delay);

        // call unref() in Node.js environment (returns NodeJS.Timeout which has unref())
        if (timeout && typeof Object(timeout).unref === 'function') {
            Object(timeout).unref();
        }
    } as T;
}

// --- Extended DateEx and timeLocal from ts-utils/dom/time.ts ---
type Dtf = Intl.DateTimeFormatOptions;

class DefOptions implements Dtf {
    readonly timeStyle: Dtf['timeStyle'] = 'short';
    readonly dateStyle: Dtf['dateStyle'] = 'short';
    readonly timeZoneName: Dtf['timeZoneName'] = 'short';
    readonly dayPeriod: Dtf['dayPeriod'] = 'short';
    readonly locale: Intl.LocalesArgument = 'en-US';
    readonly timeZone: string = 'GMT';
    readonly hour12: boolean = false;
}

export type Options = Partial<DefOptions>;

type DurationUnit =
    | 'ms'
    | 'msec'
    | 'msecs'
    | 'millisecond'
    | 'milliseconds'
    | 's'
    | 'sec'
    | 'secs'
    | 'second'
    | 'seconds'
    | 'm'
    | 'min'
    | 'mins'
    | 'minute'
    | 'minutes'
    | 'h'
    | 'hr'
    | 'hrs'
    | 'hour'
    | 'hours'
    | 'd'
    | 'day'
    | 'days'
    | 'w'
    | 'week'
    | 'weeks'
    | 'y'
    | 'yr'
    | 'yrs'
    | 'year'
    | 'years';
export type DurationString = `${number}${DurationUnit | ''}`;

export class DateEx extends Date {
    readonly options: Options;

    constructor(value?: string | number | Date | DateEx, options?: Options) {
        super(value ?? Date.now());
        const { locale, timeZone, hour12 } = Intl.DateTimeFormat().resolvedOptions();
        const navLocale: string = (() => {
            if (typeof navigator?.language === 'string') return navigator.language;
            if (Array.isArray(navigator?.languages)) {
                if (Array.isArray(navigator?.languages[0])) return navigator.languages[0][0];
                return navigator?.languages[0];
            }
            return locale;
        })();

        this.options = {
            ...new DefOptions(),
            ...(!!navLocale && { locale: navLocale }),
            ...(!!timeZone && { timeZone }),
            ...(!!hour12 && { hour12 }),
            ...(value instanceof DateEx ? value.options : {}),
            ...options,
        };
    }

    override toTimeString() {
        const { locale, timeStyle, timeZone, hour12 } = this.options;
        const options = { timeStyle, timeZone, hour12 };
        return this.toLocaleTimeString(locale, options);
    }

    override toDateString() {
        const { locale, dateStyle, timeZone } = this.options;
        const options = { dateStyle, timeZone };
        return this.toLocaleDateString(locale, options);
    }

    toDateTimeString() {
        const { locale, timeStyle, dateStyle, timeZone, hour12 } = this.options;
        const options = { timeStyle, dateStyle, timeZone, hour12 };
        return this.toLocaleString(locale, options);
    }

    toRelativeString() {
        const now = new Date();
        const diffMs = now.valueOf() - this.valueOf();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 10) return 'just now';
        if (diffSecs < 60) return `${diffSecs} seconds ago`;
        if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        return this.toDateString();
    }

    isSameDay(otherDate: Date | DateEx | string) {
        const other = new DateEx(otherDate);
        return this.toDateString() === other.toDateString();
    }

    isToday() {
        return this.isSameDay(new Date());
    }

    override valueOf() {
        return this.getTime();
    }

    get timeZone() {
        return this.options.timeZone;
    }

    getTimeZoneOffsetString() {
        const timezoneOffset = this.getTimezoneOffset();
        const offset = Math.abs(timezoneOffset);
        const offsetOperator = timezoneOffset <= 0 ? '+' : '-';
        const offsetHours = Math.floor(offset / 60)
            .toString()
            .padStart(2, '0');
        const offsetMinutes = Math.floor(offset % 60)
            .toString()
            .padStart(2, '0');

        return `${offsetOperator}${offsetHours}:${offsetMinutes}`;
    }
    addDays(days: number) {
        const newDate = new DateEx(this);
        newDate.setDate(newDate.getDate() + days);
        return newDate;
    }

    addMonths(months: number) {
        const newDate = new DateEx(this);
        newDate.setMonth(this.getMonth() + months);
        return newDate;
    }

    startOfDay() {
        const newDate = new DateEx(this);
        newDate.setHours(0, 0, 0, 0);
        return newDate;
    }

    endOfDay() {
        const newDate = new DateEx(this);
        newDate.setHours(23, 59, 59, 999);
        return newDate;
    }

    startOfUTCDay() {
        const newDate = new DateEx(this);
        newDate.setUTCHours(0, 0, 0, 0);
        return newDate;
    }

    endOfUTCDay() {
        const newDate = new DateEx(this);
        newDate.setUTCHours(23, 59, 59, 999);
        return newDate;
    }

    static ms(duration: DurationString): number {
        const match =
            /^(-?(?:\d+)?\.?\d+)\s*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
                duration.trim().toLocaleLowerCase(),
            );
        if (!match) throw new Error(`Invalid duration format: "${duration}"`);

        const value = parseFloat(match[1] ?? '');
        const unit = match[2]?.toLowerCase() ?? 'ms';

        let multiplier: number;

        switch (unit) {
            case 'years':
            case 'year':
            case 'yrs':
            case 'yr':
            case 'y':
                multiplier = 365 * 24 * 60 * 60 * 1000;
                break;
            case 'weeks':
            case 'week':
            case 'w':
                multiplier = 7 * 24 * 60 * 60 * 1000;
                break;
            case 'days':
            case 'day':
            case 'd':
                multiplier = 24 * 60 * 60 * 1000;
                break;
            case 'hours':
            case 'hour':
            case 'hrs':
            case 'hr':
            case 'h':
                multiplier = 60 * 60 * 1000;
                break;
            case 'minutes':
            case 'minute':
            case 'mins':
            case 'min':
            case 'm':
                multiplier = 60 * 1000;
                break;
            case 'seconds':
            case 'second':
            case 'secs':
            case 'sec':
            case 's':
                multiplier = 1000;
                break;
            case 'milliseconds':
            case 'millisecond':
            case 'msecs':
            case 'msec':
            case 'ms':
                multiplier = 1;
                break;
            default:
                throw new Error(`Unrecognized time unit: "${unit}"`);
        }

        return value * multiplier;
    }

    add(duration: DurationString | number): DateEx {
        const milliseconds = typeof duration === 'number' ? duration : DateEx.ms(duration);
        const newDate = new DateEx(this.getTime() + milliseconds);
        return newDate;
    }
}

export function timeLocal(doc: Document | DocumentFragment = document): void {
    const times = 'getElementsByTagName' in doc ? doc.getElementsByTagName('time') : doc.querySelectorAll('time');
    Array.from(times).forEach((time) => {
        const dt = time.getAttribute('datetime');
        if (dt) {
            const date = new Date(dt);
            time.textContent = Number.isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleString();
        }
    });
}
