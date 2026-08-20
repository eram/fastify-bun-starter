import { styleText } from 'node:util';
import { createToken, type DurationString, verifyToken } from '@libs/utils';
import { prompt } from '@libs/utils/shell';
import { DateEx } from '@libs/utils/time';

async function checkDefaultSecret(): Promise<boolean> {
    const secret = process.env['JWT_SECRET'];
    if (secret === 'secret' || !secret) {
        console.log(styleText('red', '⚠️  WARNING: JWT_SECRET is using default value "secret"'));
        return true;
    }
    return false;
}

/**
 * Parse "key=value" claim strings into a claims object.
 * Exits the process with an error message if a claim is malformed.
 */
function parseClaims(claims?: string[]): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const entry of claims ?? []) {
        const idx = entry.indexOf('=');
        if (idx <= 0) {
            console.log(styleText('red', `✗ Invalid claim: "${entry}" (expected format key=value)`));
            process.exit(1);
        }
        parsed[entry.slice(0, idx)] = entry.slice(idx + 1);
    }
    return parsed;
}

export async function handleTokenCreate(duration?: string, claims?: string[]): Promise<void> {
    const isInteractive = !duration;

    if (isInteractive) {
        await checkDefaultSecret();
        console.log('Creating JWT token...\n');
    }

    let durationInput: DurationString = (duration ?? '') as DurationString;
    if (!durationInput) {
        durationInput = (await prompt('Token expiry duration (default: 30d): ', '30d')) as DurationString;
    }

    const extraClaims = parseClaims(claims);

    try {
        const ms = DateEx.ms(durationInput);
        if (!ms || ms <= 0) {
            console.log(styleText('red', `✗ Invalid duration: "${durationInput}"`));
            console.log('  Examples: 1h, 7d, 30d, 1w, 2y');
            process.exit(1);
        }

        const token = createToken({ sub: 'cli', iat: Math.floor(Date.now() / 1000), ...extraClaims }, durationInput);

        if (isInteractive) {
            console.log(styleText('green', '✓ Token created successfully'));
            console.log('Token:', token);
            console.log('Expires in:', durationInput);
            if (Object.keys(extraClaims).length > 0) {
                console.log('Claims:', JSON.stringify(extraClaims));
            }
        } else {
            console.log(token);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(styleText('red', `✗ Error: ${msg}`));
        process.exit(1);
    }
}

export async function handleTokenValidate(token?: string): Promise<void> {
    await checkDefaultSecret();

    console.log('Validating JWT token...\n');

    let tokenToValidate = token;
    if (!tokenToValidate) {
        tokenToValidate = await prompt('Enter JWT token: ', '');
        if (!tokenToValidate) {
            console.log(styleText('red', '✗ No token provided'));
            process.exit(1);
        }
    }

    try {
        const payload = verifyToken(tokenToValidate);

        const expireDate = payload.exp ? new Date(payload.exp * 1000) : null;
        const expireStr = expireDate
            ? expireDate
                  .toISOString()
                  .replace(/[-:]/g, '')
                  .replace(/\.\d{3}/, '')
                  .replace('T', ':')
                  .toLowerCase()
            : 'unknown';

        console.log(styleText('green', `\n✓ Token is VALID — Expires ${expireStr}\n`));
        console.log('Payload:');
        console.log(JSON.stringify(payload, null, 2));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(styleText('red', `\n✗ Token is INVALID: ${msg}`));
        process.exit(1);
    }
}
