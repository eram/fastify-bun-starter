/// <reference lib="dom" />
import { strict as assert } from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { icon } from './index';

describe('Icon Component (DOM Rendering)', () => {
    const mockSvg = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" class="icon-bg"/><text x="12" y="16" text-anchor="middle" class="icon-text">i</text></svg>`;

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    test('should render icon with SVG and proper accessibility attributes', () => {
        const element = icon({ image: mockSvg, ariaLabel: 'Test icon' });
        document.body.appendChild(element);

        assert.equal(element.getAttribute('aria-label'), 'Test icon');
        assert.equal(element.getAttribute('title'), 'Test icon');

        // Non-interactive icon should not have button role
        assert.equal(element.getAttribute('role'), null);
        assert.equal(element.getAttribute('tabindex'), null);

        // Verify SVG is rendered
        const svg = element.querySelector('svg');
        assert.ok(svg, 'SVG should exist');
        assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');

        // Verify SVG children
        const circle = svg.querySelector('circle.icon-bg');
        assert.ok(circle, 'Icon background circle should exist');
        const text = svg.querySelector('text.icon-text');
        assert.ok(text, 'Icon text should exist');
    });

    test('should render interactive icon with button role and handle click/keyboard events', () => {
        let clickCount = 0;
        const handleClick = () => {
            clickCount++;
        };

        const element = icon({ image: mockSvg, ariaLabel: 'Interactive icon', title: 'Custom Title', onClick: handleClick });
        document.body.appendChild(element);

        // Interactive icon should have button role and tabindex
        assert.equal(element.getAttribute('role'), 'button');
        assert.equal(element.getAttribute('tabindex'), '0');
        assert.equal(element.getAttribute('title'), 'Custom Title');

        // Test click event
        element.click();
        assert.equal(clickCount, 1, 'Click handler should be called');

        // Test Enter key
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        element.dispatchEvent(enterEvent);
        assert.equal(clickCount, 2, 'Enter key should trigger click');

        // Test Space key
        const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
        element.dispatchEvent(spaceEvent);
        assert.equal(clickCount, 3, 'Space key should trigger click');

        // Test other key (should not trigger click)
        const otherEvent = new KeyboardEvent('keydown', { key: 'A', bubbles: true });
        element.dispatchEvent(otherEvent);
        assert.equal(clickCount, 3, 'Other keys should not trigger click');
    });

    test('should handle hover events and render with proper cursor style', () => {
        let hoverCount = 0;
        const handleHover = () => {
            hoverCount++;
        };

        const element = icon({ image: mockSvg, ariaLabel: 'Hover icon', onClick: () => {}, onHover: handleHover });
        document.body.appendChild(element);

        // Interactive icon should have pointer cursor
        assert.ok(
            element.style.cursor === 'pointer' || element.style.cursor.includes('pointer'),
            'Interactive icon should have pointer cursor',
        );

        // Test hover event
        const hoverEvent = new MouseEvent('mouseenter', { bubbles: true });
        element.dispatchEvent(hoverEvent);
        assert.equal(hoverCount, 1, 'Hover handler should be called');
    });
});
