import { setTimeout } from 'node:timers/promises';

/**
 * shorthand to timer's setTimeout.
 * Usage: await sleep(1000);
 *
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the delay.
 */
export const sleep = setTimeout;

/**
 * Creates a debounced version of a function that delays its execution until after a specified delay.
 * Call the returned function to start debouncing.
 * Usage: const onKeyUp = debounce((val) => searchUsers(val), 400);
 *
 * @param func - The function to debounce.
 * @param delay - The delay in milliseconds (default: 300).
 * @returns A debounced function.
 */
export function debounce<T extends (...args: unknown[]) => void>(func: T, delay: number = 300): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = globalThis.setTimeout(() => func(...args), delay).unref();
    };
}
