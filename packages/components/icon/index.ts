/**
 * icon Component
 * Plain DOM/TS implementation (no framework) — builds a real HTMLElement.
 */

export interface IconProps {
    image: string;
    onClick?: (event: MouseEvent | KeyboardEvent) => void;
    onHover?: (event: MouseEvent) => void;
    ariaLabel: string;
    title?: string;
}

/**
 * icon Component
 * Renders SVG markup inside an accessible container div.
 * Companion styles live in ./index.html.
 */
export function icon(props: IconProps): HTMLElement {
    const { image, onClick, onHover, ariaLabel, title } = props;
    const hasInteraction = onClick !== undefined || onHover !== undefined;

    const div = document.createElement('div');
    div.className = 'icon';
    div.setAttribute('aria-label', ariaLabel);
    div.setAttribute('title', title || ariaLabel);
    div.style.cursor = hasInteraction ? 'pointer' : 'default';

    if (hasInteraction) {
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
    }

    div.innerHTML = image;

    if (onClick) {
        div.addEventListener('click', onClick);
        div.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick(e);
            }
        });
    }

    if (onHover) {
        div.addEventListener('mouseenter', onHover);
    }

    return div;
}

export * from './svg';
