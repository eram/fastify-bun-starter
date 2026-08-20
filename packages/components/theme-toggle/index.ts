/**
 * Theme Toggle Component
 * A beautiful animated theme switch inspired by Scalar's dashboard.
 * Plain DOM/TS implementation (no framework). Companion styles live in ./index.html.
 */

import { themeSunMoonIcon } from '../icon';

const THEME_KEY = 'theme';

/**
 * Get the current theme preference
 */
function getThemePreference(): 'dark' | 'light' {
    try {
        const savedTheme = localStorage.getItem(THEME_KEY);
        if (savedTheme === 'dark' || savedTheme === 'light') {
            return savedTheme;
        }
    } catch {
        // localStorage not available
    }

    // Fall back to system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
}

/**
 * Apply theme to document and save preference
 */
function applyAndSaveTheme(theme: 'dark' | 'light'): void {
    document.documentElement.setAttribute('color-scheme', theme);
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
        // localStorage not available
    }
}

/**
 * Toggle between dark and light themes
 */
function toggleTheme(): 'dark' | 'light' {
    const current = getThemePreference();
    const newTheme = current === 'dark' ? 'light' : 'dark';
    applyAndSaveTheme(newTheme);
    return newTheme;
}

/**
 * Theme Switch Component
 */
export function themeToggle(): HTMLElement {
    const currentTheme = getThemePreference();
    applyAndSaveTheme(currentTheme);

    const container = document.createElement('div');
    container.className = 'theme-switch-container';

    const button = document.createElement('div');
    button.className = 'theme-switch-button';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');

    const track = document.createElement('div');
    track.className = 'track';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.innerHTML = themeSunMoonIcon;

    button.append(track, thumb);
    container.appendChild(button);

    const updateButtonState = (theme: 'dark' | 'light') => {
        const isDark = theme === 'dark';
        button.setAttribute('aria-pressed', isDark.toString());
        button.setAttribute('aria-label', isDark ? 'Set light mode' : 'Set dark mode');
        button.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    };
    updateButtonState(currentTheme);

    const handleToggle = () => updateButtonState(toggleTheme());

    button.addEventListener('click', handleToggle);
    button.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
        }
    });

    return container;
}
