/**
 * Ambient module declarations for "@components/..." specifiers, resolved at
 * runtime via the import map in apps/http/public/index.html (-> /app/components/,
 * served live by the transpile route in apps/http/transpile.ts). packages/components
 * isn't reachable via a disk-relative import from here, so tsc needs these
 * shapes declared by hand.
 */
declare module '@components/icon/index.ts' {
    export interface IconProps {
        image: string;
        onClick?: (event: MouseEvent | KeyboardEvent) => void;
        onHover?: (event: MouseEvent) => void;
        ariaLabel: string;
        title?: string;
    }
    export function icon(props: IconProps): HTMLElement;
    export const infoIcon: string;
}

declare module '@components/theme-toggle/index.ts' {
    export function themeToggle(): HTMLElement;
}
