import { ok, strictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Version } from './version';

describe('Version', () => {
    test('parses major.minor.patch', () => {
        const v = new Version('1.2.3');
        strictEqual(v.major, 1);
        strictEqual(v.minor, 2);
        strictEqual(v.patch, 3);
        strictEqual(v.value, '1.2.3');
    });

    test('parses with build number', () => {
        const v = new Version('1.2.3.456');
        strictEqual(v.major, 1);
        strictEqual(v.minor, 2);
        strictEqual(v.patch, 3);
        strictEqual(v.build, 456);
    });

    test('handles extra parts', () => {
        const v = new Version('1.2.3.4.5.6');
        strictEqual(v.build, 4);
        strictEqual(Object(v)._parts[4], 5);
        strictEqual(Object(v)._parts[5], 6);
    });

    test('parses pre-release with dash', () => {
        const v = new Version('1.2.3-beta');
        strictEqual(v.major, 1);
        strictEqual(v.minor, 2);
        strictEqual(v.patch, 3);
        strictEqual(v.preRelease, 'beta');
    });

    test('parses pre-release with plus', () => {
        const v = new Version('1.2.3+rc1');
        strictEqual(v.major, 1);
        strictEqual(v.minor, 2);
        strictEqual(v.patch, 3);
        strictEqual(v.preRelease, 'rc1');
    });

    test('parses pre-release in middle parts', () => {
        const v = new Version('1.2-alpha.3.4');
        strictEqual(v.major, 1);
        strictEqual(v.minor, 2);
        strictEqual(v.preRelease, 'alpha');
    });

    test('handles empty string', () => {
        const v = new Version('');
        strictEqual(v.value, '');
        strictEqual(v.major, 0);
    });

    test('handles whitespace', () => {
        const v = new Version('  1.2.3  ');
        strictEqual(v.value, '1.2.3');
        strictEqual(v.major, 1);
    });

    test('handles string parts', () => {
        const v = new Version('1.abc.3');
        strictEqual(v.major, 1);
        strictEqual(v.minor, 'abc');
        strictEqual(v.patch, 3);
    });

    test('copy constructor', () => {
        const v1 = new Version('1.2.3-beta');
        const v2 = new Version(v1);
        strictEqual(v2.major, 1);
        strictEqual(v2.minor, 2);
        strictEqual(v2.patch, 3);
        strictEqual(v2.preRelease, 'beta');
        strictEqual(v2.value, '1.2.3-beta');
    });

    test('truncates to 100 characters', () => {
        const longVersion = `1.2.3.${'x'.repeat(100)}`;
        const v = new Version(longVersion);
        strictEqual(v.value.length, 100);
    });

    test('eq - equal versions', () => {
        ok(new Version('1.2.3').eq('1.2.3'));
        ok(new Version('1.2.3').eq(new Version('1.2.3')));
        ok(new Version('1.2.3-beta').eq('1.2.3-beta'));
        ok(new Version('1.2.3.4.5.6').eq('1.2.3.4.5.6'));
    });

    test('eq - not equal versions', () => {
        strictEqual(new Version('1.2.3').eq('1.2.4'), false);
        strictEqual(new Version('1.2.3').eq('1.3.3'), false);
        strictEqual(new Version('1.2.3').eq('2.2.3'), false);
        strictEqual(new Version('1.2.3-beta').eq('1.2.3-alpha'), false);
        strictEqual(new Version('1.2.3-beta').eq('1.2.3'), false);
        strictEqual(new Version('1.2.3.4.5.6').eq('1.2.3.4.5.7'), false);
    });

    test('gt - greater major version', () => {
        ok(new Version('2.0.0').gt('1.9.9'));
        strictEqual(new Version('1.0.0').gt('2.0.0'), false);
    });

    test('gt - greater minor version', () => {
        ok(new Version('1.3.0').gt('1.2.9'));
        strictEqual(new Version('1.2.0').gt('1.3.0'), false);
    });

    test('gt - greater patch version', () => {
        ok(new Version('1.2.4').gt('1.2.3'));
        strictEqual(new Version('1.2.3').gt('1.2.4'), false);
    });

    test('gt - greater build version', () => {
        ok(new Version('1.2.3.5').gt('1.2.3.4'));
        strictEqual(new Version('1.2.3.4').gt('1.2.3.5'), false);
    });

    test('gt - greater extra parts', () => {
        ok(new Version('1.2.3.4.6.0').gt('1.2.3.4.5.9'));
        ok(new Version('1.2.3.4.5.7').gt('1.2.3.4.5.6'));
    });

    test('gt - with pre-release', () => {
        ok(new Version('1.2.3').gt('1.2.3-beta'));
        strictEqual(new Version('1.2.3-beta').gt('1.2.3'), false);
        ok(new Version('1.2.3-rc2').gt('1.2.3-rc1'));
        strictEqual(new Version('1.2.3-rc1').gt('1.2.3-rc2'), false);
    });

    test('gt - equal versions', () => {
        strictEqual(new Version('1.2.3').gt('1.2.3'), false);
    });

    test('gt - string parts comparison', () => {
        ok(new Version('1.b.0').gt('1.a.0'));
        strictEqual(new Version('1.a.0').gt('1.b.0'), false);
    });

    test('lt - less than major version', () => {
        ok(new Version('1.0.0').lt('2.0.0'));
        strictEqual(new Version('2.0.0').lt('1.0.0'), false);
    });

    test('lt - less than minor version', () => {
        ok(new Version('1.2.0').lt('1.3.0'));
        strictEqual(new Version('1.3.0').lt('1.2.0'), false);
    });

    test('lt - less than patch version', () => {
        ok(new Version('1.2.2').lt('1.2.3'));
        strictEqual(new Version('1.2.3').lt('1.2.2'), false);
    });

    test('lt - equal versions', () => {
        strictEqual(new Version('1.2.3').lt('1.2.3'), false);
    });

    test('lt - with pre-release', () => {
        ok(new Version('1.2.3-beta').lt('1.2.3'));
        strictEqual(new Version('1.2.3').lt('1.2.3-beta'), false);
        ok(new Version('1.2.3-rc1').lt('1.2.3-rc2'));
        strictEqual(new Version('1.2.3-rc2').lt('1.2.3-rc1'), false);
    });
});
