// Preload: Ensure Bun meets the minimum version required by package.json's engines field.

import { Version } from '@libs/utils/version';

if (typeof Bun !== 'undefined' && Bun.version) {
    const bunVer = new Version(Bun.version);
    const minVer = new Version('1.3.0');
    if (bunVer.lt(minVer)) {
        throw new Error(`Bun ${minVer.value}+ is required (found ${bunVer.value})`);
    }
}
