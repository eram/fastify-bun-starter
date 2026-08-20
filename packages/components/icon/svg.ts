/**
 * Icon definitions as raw SVG markup strings.
 * Centralized location for all SVG icons used in the application.
 * Icons sourced from https://lucide.dev/icons/
 */

/**
 * Info icon - circle with "i" character
 */
export const infoIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="svg">
    <circle cx="12" cy="12" r="11.5" class="icon-bg"/>
    <path d="M11 7h2v2h-2zm0 4h2v6h-2z" class="icon-text" fill="currentColor"/>
</svg>`;

/**
 * Close icon - X for closing modals/dialogs
 */
export const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="svg">
    <path d="M6 6l12 12M18 6L6 18" class="icon-text" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

/**
 * Three dots menu icon - vertical ellipsis
 */
export const menuIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="svg">
    <circle cx="12" cy="12" r="11.5" class="icon-bg"/>
    <circle cx="12" cy="7" r="1.5" class="icon-text" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.5" class="icon-text" fill="currentColor"/>
    <circle cx="12" cy="17" r="1.5" class="icon-text" fill="currentColor"/>
</svg>`;

/**
 * Moon icon - for dark mode toggle
 */
export const moonIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="svg">
    <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" class="icon-text"/>
</svg>`;

/**
 * Edit icon - pencil
 */
export const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="svg">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" class="icon-text" fill="currentColor"/>
</svg>`;

/**
 * Delete icon - trash can
 */
export const deleteIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="svg">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" class="icon-text" fill="currentColor"/>
</svg>`;

/**
 * Duplicate icon - two overlapping squares
 */
export const duplicateIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="svg">
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" class="icon-text" fill="currentColor"/>
</svg>`;

/**
 * Sun and moon theme toggle icon
 * Contains sun rays (light mode) and moon crescent path (dark mode)
 */
export const themeSunMoonIcon = `<svg class="theme-icon" viewBox="0 0 12 12">
    <line class="sun-ray" x1="6" y1="0" x2="6" y2="12" stroke="currentColor" stroke-width="1"/>
    <line class="sun-ray" x1="0" y1="6" x2="12" y2="6" stroke="currentColor" stroke-width="1"/>
    <line class="sun-ray" x1="1.76" y1="1.76" x2="10.24" y2="10.24" stroke="currentColor" stroke-width="1"/>
    <line class="sun-ray" x1="10.24" y1="1.76" x2="1.76" y2="10.24" stroke="currentColor" stroke-width="1"/>
    <path class="moon" d="M10.493 6.243a4.5 4.5 0 1 1-4.736-4.736c.202-.011.308.23.201.401a3 3 0 0 0 4.134 4.134c.172-.107.412-.002.401.201" stroke="currentColor" stroke-width="0.5" fill="none"/>
</svg>`;
