import { describe, expect, test } from 'bun:test';
import { Version } from './version';

describe('Version', () => {
    test('parses major.minor.patch', () => {
        const v = new Version('1.2.3');
        expect(v.major).toBe(1);
        expect(v.minor).toBe(2);
        expect(v.patch).toBe(3);
        expect(v.value).toBe('1.2.3');
    });

    test('parses with build number', () => {
        const v = new Version('1.2.3.456');
        expect(v.major).toBe(1);
        expect(v.minor).toBe(2);
        expect(v.patch).toBe(3);
        expect(v.build).toBe(456);
    });

    test('handles extra parts', () => {
        const v = new Version('1.2.3.4.5.6');
        expect(v.build).toBe(4);
        expect(Object(v)._parts[4]).toBe(5);
        expect(Object(v)._parts[5]).toBe(6);
    });

    test('parses pre-release with dash', () => {
        const v = new Version('1.2.3-beta');
        expect(v.major).toBe(1);
        expect(v.minor).toBe(2);
        expect(v.patch).toBe(3);
        expect(v.preRelease).toBe('beta');
    });

    test('parses pre-release with plus', () => {
        const v = new Version('1.2.3+rc1');
        expect(v.major).toBe(1);
        expect(v.minor).toBe(2);
        expect(v.patch).toBe(3);
        expect(v.preRelease).toBe('rc1');
    });

    test('parses pre-release in middle parts', () => {
        const v = new Version('1.2-alpha.3.4');
        expect(v.major).toBe(1);
        expect(v.minor).toBe(2);
        expect(v.preRelease).toBe('alpha');
    });

    test('handles empty string', () => {
        const v = new Version('');
        expect(v.value).toBe('');
        expect(v.major).toBe(0);
    });

    test('handles whitespace', () => {
        const v = new Version('  1.2.3  ');
        expect(v.value).toBe('1.2.3');
        expect(v.major).toBe(1);
    });

    test('handles string parts', () => {
        const v = new Version('1.abc.3');
        expect(v.major).toBe(1);
        expect(v.minor).toBe('abc');
        expect(v.patch).toBe(3);
    });

    test('copy constructor', () => {
        const v1 = new Version('1.2.3-beta');
        const v2 = new Version(v1);
        expect(v2.major).toBe(1);
        expect(v2.minor).toBe(2);
        expect(v2.patch).toBe(3);
        expect(v2.preRelease).toBe('beta');
        expect(v2.value).toBe('1.2.3-beta');
    });

    test('truncates to 100 characters', () => {
        const longVersion = `1.2.3.${'x'.repeat(100)}`;
        const v = new Version(longVersion);
        expect(v.value.length).toBe(100);
    });

    test('eq - equal versions', () => {
        expect(new Version('1.2.3').eq('1.2.3')).toBeTruthy();
        expect(new Version('1.2.3').eq(new Version('1.2.3'))).toBeTruthy();
        expect(new Version('1.2.3-beta').eq('1.2.3-beta')).toBeTruthy();
        expect(new Version('1.2.3.4.5.6').eq('1.2.3.4.5.6')).toBeTruthy();
    });

    test('eq - not equal versions', () => {
        expect(new Version('1.2.3').eq('1.2.4')).toBe(false);
        expect(new Version('1.2.3').eq('1.3.3')).toBe(false);
        expect(new Version('1.2.3').eq('2.2.3')).toBe(false);
        expect(new Version('1.2.3-beta').eq('1.2.3-alpha')).toBe(false);
        expect(new Version('1.2.3-beta').eq('1.2.3')).toBe(false);
        expect(new Version('1.2.3.4.5.6').eq('1.2.3.4.5.7')).toBe(false);
    });

    test('gt - greater major version', () => {
        expect(new Version('2.0.0').gt('1.9.9')).toBeTruthy();
        expect(new Version('1.0.0').gt('2.0.0')).toBe(false);
    });

    test('gt - greater minor version', () => {
        expect(new Version('1.3.0').gt('1.2.9')).toBeTruthy();
        expect(new Version('1.2.0').gt('1.3.0')).toBe(false);
    });

    test('gt - greater patch version', () => {
        expect(new Version('1.2.4').gt('1.2.3')).toBeTruthy();
        expect(new Version('1.2.3').gt('1.2.4')).toBe(false);
    });

    test('gt - greater build version', () => {
        expect(new Version('1.2.3.5').gt('1.2.3.4')).toBeTruthy();
        expect(new Version('1.2.3.4').gt('1.2.3.5')).toBe(false);
    });

    test('gt - greater extra parts', () => {
        expect(new Version('1.2.3.4.6.0').gt('1.2.3.4.5.9')).toBeTruthy();
        expect(new Version('1.2.3.4.5.7').gt('1.2.3.4.5.6')).toBeTruthy();
    });

    test('gt - with pre-release', () => {
        expect(new Version('1.2.3').gt('1.2.3-beta')).toBeTruthy();
        expect(new Version('1.2.3-beta').gt('1.2.3')).toBe(false);
        expect(new Version('1.2.3-rc2').gt('1.2.3-rc1')).toBeTruthy();
        expect(new Version('1.2.3-rc1').gt('1.2.3-rc2')).toBe(false);
    });

    test('gt - equal versions', () => {
        expect(new Version('1.2.3').gt('1.2.3')).toBe(false);
    });

    test('gt - string parts comparison', () => {
        expect(new Version('1.b.0').gt('1.a.0')).toBeTruthy();
        expect(new Version('1.a.0').gt('1.b.0')).toBe(false);
    });

    test('lt - less than major version', () => {
        expect(new Version('1.0.0').lt('2.0.0')).toBeTruthy();
        expect(new Version('2.0.0').lt('1.0.0')).toBe(false);
    });

    test('lt - less than minor version', () => {
        expect(new Version('1.2.0').lt('1.3.0')).toBeTruthy();
        expect(new Version('1.3.0').lt('1.2.0')).toBe(false);
    });

    test('lt - less than patch version', () => {
        expect(new Version('1.2.2').lt('1.2.3')).toBeTruthy();
        expect(new Version('1.2.3').lt('1.2.2')).toBe(false);
    });

    test('lt - equal versions', () => {
        expect(new Version('1.2.3').lt('1.2.3')).toBe(false);
    });

    test('lt - with pre-release', () => {
        expect(new Version('1.2.3-beta').lt('1.2.3')).toBeTruthy();
        expect(new Version('1.2.3').lt('1.2.3-beta')).toBe(false);
        expect(new Version('1.2.3-rc1').lt('1.2.3-rc2')).toBeTruthy();
        expect(new Version('1.2.3-rc2').lt('1.2.3-rc1')).toBe(false);
    });
});
