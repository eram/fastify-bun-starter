/// <reference lib="dom" />
import { strict as assert } from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { themeToggle } from '.';

describe('ThemeSwitch Component (DOM Rendering)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        document.documentElement.removeAttribute('color-scheme');
    });

    test('should render complete theme switch structure with button, track, thumb, and SVG icon', () => {
        const element = themeToggle();
        document.body.appendChild(element);

        // Verify container
        assert.ok(element.classList.contains('theme-switch-container'), 'Container should exist');

        // Verify button with proper accessibility attributes
        const button = element.querySelector('.theme-switch-button');
        assert.ok(button, 'Button should exist');
        assert.equal(button.getAttribute('role'), 'button');
        assert.equal(button.getAttribute('tabindex'), '0');
        assert.ok(button.hasAttribute('aria-pressed'), 'Should have aria-pressed');
        assert.ok(button.hasAttribute('aria-label'), 'Should have aria-label');

        // Verify track
        const track = button.querySelector('.track');
        assert.ok(track, 'Track should exist');

        // Verify thumb
        const thumb = button.querySelector('.thumb');
        assert.ok(thumb, 'Thumb should exist');

        // Verify SVG icon
        const svg = thumb?.querySelector('svg.theme-icon');
        assert.ok(svg, 'SVG icon should exist');

        // Verify sun rays (4 lines)
        const sunRays = svg?.querySelectorAll('line.sun-ray');
        assert.equal(sunRays?.length, 4, 'Should have 4 sun rays');

        // Verify moon path
        const moon = svg?.querySelector('path.moon');
        assert.ok(moon, 'Moon path should exist');
        assert.ok(moon.getAttribute('d'), 'Moon should have path data');
    });

    test('should handle theme switching with localStorage and DOM updates', () => {
        // Start with light theme
        localStorage.setItem('theme', 'light');

        const element = themeToggle();
        document.body.appendChild(element);

        // Verify initial state (light mode)
        const button = element.querySelector('.theme-switch-button');
        assert.equal(button?.getAttribute('aria-pressed'), 'false');
        assert.equal(button?.getAttribute('aria-label'), 'Set dark mode');
        assert.equal(document.documentElement.getAttribute('color-scheme'), 'light');

        // Click to toggle to dark mode
        (button as HTMLElement)?.click();

        // Verify dark mode state
        assert.equal(localStorage.getItem('theme'), 'dark');
        assert.equal(document.documentElement.getAttribute('color-scheme'), 'dark');
        assert.equal(button?.getAttribute('aria-pressed'), 'true');
        assert.equal(button?.getAttribute('aria-label'), 'Set light mode');

        // Click again to toggle back to light mode
        (button as HTMLElement)?.click();

        // Verify light mode state
        assert.equal(localStorage.getItem('theme'), 'light');
        assert.equal(document.documentElement.getAttribute('color-scheme'), 'light');
        assert.equal(button?.getAttribute('aria-pressed'), 'false');
        assert.equal(button?.getAttribute('aria-label'), 'Set dark mode');
    });

    test('should default to light theme and handle keyboard interaction', () => {
        const element = themeToggle();
        document.body.appendChild(element);

        const button = element.querySelector('.theme-switch-button');
        assert.ok(button, 'Button should exist');

        // Verify default light theme (no localStorage)
        assert.equal(button.getAttribute('aria-pressed'), 'false');
        assert.equal(button.getAttribute('aria-label'), 'Set dark mode');

        // Simulate Enter key press
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        button.dispatchEvent(enterEvent);

        // Verify theme toggled to dark
        assert.equal(localStorage.getItem('theme'), 'dark');
        assert.equal(document.documentElement.getAttribute('color-scheme'), 'dark');
        assert.equal(button.getAttribute('aria-pressed'), 'true');

        // Simulate Space key press
        const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
        button.dispatchEvent(spaceEvent);

        // Verify theme toggled back to light
        assert.equal(localStorage.getItem('theme'), 'light');
        assert.equal(button.getAttribute('aria-pressed'), 'false');
    });
});
