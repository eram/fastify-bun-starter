/*
 * JSON Web Token encode and decode module for node.js.
 * The 'jsonwebtoken' library is bloated and infested with vulnerabilities,
 * so I re-implemented a part of it from scratch, with near-zero dependencies.
 * Code adapted from https://github.com/hokaccha/node-jwt-simple
 */

import * as crypto from 'node:crypto';
import { ErrorEx } from './error';
import { b64urlDecode, b64urlEncode, urlEscape, urlUnescape } from './text';
import { DateEx, type DurationString } from './time';

export type { DurationString };

class JwtError extends ErrorEx {}

// Algorithm value mappings (single source of truth)
const ALG_MAP = {
    HS256: 'sha256',
    HS384: 'sha384',
    HS512: 'sha512',
    RS256: 'RSA-SHA256',
} as const;

// Type-safe algorithm type derived from const object
export type Algorithm = (typeof ALG_MAP)[keyof typeof ALG_MAP];

// Sign type mapping
const SIGN_TYPE_MAP = {
    sha256: 'hmac',
    sha384: 'hmac',
    sha512: 'hmac',
    'RSA-SHA256': 'sign',
} as const;

type SignType = (typeof SIGN_TYPE_MAP)[keyof typeof SIGN_TYPE_MAP];
const JWT = 'JWT';

export class JwtPayload {
    // basic claims
    readonly exp?: number; // expires at is always required on verification
    readonly sub?: string; // subject aka user-name
    readonly iat?: number; // issued at
    readonly nbf?: number; // not before

    // additional claims
    readonly [key: string]: boolean | number | string | undefined;

    // error claim is used to indicate a problem with the token, e.g. expired, invalid, etc.
    readonly error?: string;

    constructor(claims: Readonly<Partial<JwtPayload>>) {
        Object.assign(this, claims);
    }

    static error(claims: JwtPayload): string | undefined {
        const now = Math.floor(Date.now() / 1000);
        return typeof claims.error === 'string'
            ? claims.error
            : typeof claims.exp !== 'number'
              ? 'Missing expiration claim'
              : claims.exp < now
                ? 'Token expired'
                : typeof claims.nbf === 'number' && claims.nbf > now
                  ? 'Token not yet active'
                  : typeof claims.iat === 'number' && claims.iat > now
                    ? 'Token issued in the future'
                    : undefined;
    }

    static isValid = (claims: JwtPayload) => claims.error === undefined;
}

interface JwtHeader {
    typ: string;
    alg: Algorithm;
    [key: string]: string;
}

type JwtOptions = Readonly<Partial<JwtHeader>>;

/*
 * private funcs
 */

function sign(input: string, key: string | Buffer, method: string, type: SignType): string {
    let base64str: string;

    try {
        if (type === 'hmac') {
            base64str = crypto.createHmac(method, key).update(input).digest('base64');
        } else if (type === 'sign') {
            base64str = crypto.createSign(method).update(input).sign(key, 'base64');
        } else {
            throw new JwtError('Algorithm type not recognized');
        }
    } catch (err) {
        if (err instanceof JwtError) throw err;
        throw new JwtError(`unsupported key format: ${Object(err).message || err}`);
    }

    return urlEscape(base64str);
}

function calcExp(diff: DurationString | number, iat?: number): number {
    iat ??= Math.floor(Date.now() / 1000);
    if (typeof diff === 'string') {
        const msec = DateEx.ms(diff);
        if (typeof msec === 'undefined') {
            return 0;
        }
        return Math.floor(iat + msec / 1000);
    } else if (typeof diff === 'number') {
        return iat + diff;
    } else {
        return 0;
    }
}

/**
 * Create a signed JWT token
 * @param claims - jwt claims
 * @param expiresIn - expiration time, e.g. "1d", "20h", "15m", "10s", or number of seconds
 *                    default is from process.env.JWT_SECRET_EXPIRES or "1d"
 * @param key - jwt secret or a PEM private key for RS256. default is from process.env.JWT_SECRET
 * @param options - jwt header options. Algorithm default is "sha256".
 * @returns signed token
 */
export function createToken(
    claims: JwtPayload,
    expiresIn?: DurationString | number,
    key?: string | Buffer,
    options?: JwtOptions,
): string {
    if (!key && !process.env['JWT_SECRET']) throw new JwtError('JWT_SECRET is not set');
    const JWT_SECRET = String(process.env['JWT_SECRET'] || '');

    const { JWT_SECRET_EXPIRES = '1d' } = process.env;
    expiresIn ??= Number(JWT_SECRET_EXPIRES) || (String(JWT_SECRET_EXPIRES) as DurationString);
    const iat = claims.iat || Math.floor(Date.now() / 1000);
    options ??= {};

    claims = new JwtPayload({
        ...claims,
        iat,
        exp: calcExp(expiresIn, iat),
        nbf: claims.nbf ?? iat,
    });

    if (!claims.exp || claims.exp < iat) throw new JwtError('Invalid expiration');

    key ??= JWT_SECRET;
    if (!key || (typeof key !== 'string' && !(key instanceof Buffer))) {
        throw new JwtError('No key supplied');
    }

    // Determine algorithm and signing method
    const alg: Algorithm = options?.alg || (key instanceof Buffer ? 'RSA-SHA256' : 'sha256');
    const signingType = SIGN_TYPE_MAP[alg];
    if (!signingType) {
        throw new JwtError('Algorithm not supported');
    }

    // Create header, segments and signature
    const header = Object.assign<JwtHeader, JwtOptions>({ typ: JWT, alg }, options);
    const segments = [b64urlEncode(JSON.stringify(header)), b64urlEncode(JSON.stringify(claims))];
    segments.push(sign(segments.join('.'), key, alg, signingType));
    return segments.join('.');
}

/**
 * Verify and decode a JWT token
 * @param token - jwt token
 * @param key - optional jwt secret or a CER. defaults to JWT_SECRET
 * @returns decoded jwt payload. Function throws a bunch of JwtError on any error.
 */
export function verifyToken(token: string, key?: string | Buffer, alg?: Algorithm, noVerify = false): JwtPayload {
    if (!key && !process.env['JWT_SECRET']) throw new JwtError('JWT_SECRET is not set');
    const JWT_SECRET = String(process.env['JWT_SECRET'] || '');
    const JWT_SECRET_OLD = String(process.env['JWT_SECRET_OLD'] || '');
    key ??= JWT_SECRET;

    // Check key validity
    if (!key || (typeof key !== 'string' && !(key instanceof Buffer))) {
        throw new JwtError('No key supplied');
    }

    // Check token
    if (!token || typeof token !== 'string') {
        throw new JwtError('No token supplied');
    }

    // Check segments
    const segments = token.split('.');
    if (segments.length !== 3) {
        throw new JwtError('Token must have 3 segrments');
    }

    // All segments should be base64
    const [headerSeg, payloadSeg, signatureSeg] = segments as [string, string, string];
    const headerStr = b64urlDecode(headerSeg);
    const payloadStr = b64urlDecode(payloadSeg);
    let header: JwtHeader;
    let payload: JwtPayload;
    try {
        header = JSON.parse(headerStr) as JwtHeader;
        payload = JSON.parse(payloadStr) as JwtPayload;
    } catch {
        throw new JwtError('Invalid token encoding');
    }
    if (!header || !payload) {
        throw new JwtError('Invalid segment encoding');
    }

    if (Object.keys(header).length < 2) throw new JwtError('Invalid header');
    if (Object.keys(payload).length < 1) throw new JwtError('Invalid payload');

    if (!noVerify)
        try {
            alg ??= header.alg;

            // Auto-detect RSA
            if (!alg && typeof key === 'string' && /BEGIN( RSA)? PUBLIC KEY/.test(key)) {
                alg = 'RSA-SHA256';
            }

            // Check algorithm support
            const signingMethod = alg;
            const signingType = SIGN_TYPE_MAP[signingMethod];
            if (!signingMethod || !signingType) {
                throw new JwtError('Algorithm not supported');
            }

            // Verify signature
            const signingInput = `${headerSeg}.${payloadSeg}`;
            if (signingType === 'hmac') {
                if (signatureSeg !== sign(signingInput, key, signingMethod, signingType)) {
                    throw new JwtError('Invalid key');
                }
            } else if (signingType === 'sign') {
                if (!crypto.createVerify(signingMethod).update(signingInput).verify(key, urlUnescape(signatureSeg), 'base64')) {
                    throw new JwtError('Invalid key');
                }
            } else {
                throw new JwtError('Algorithm type not recognized');
            }

            // Verify the payload is ok (exp, iat, nbf)
            const err = JwtPayload.error(payload);
            if (err) {
                throw new JwtError(err);
            }
        } catch (err) {
            const { message } = err as JwtError;
            if (message === 'Invalid key' && JWT_SECRET_OLD && key === JWT_SECRET) {
                // try again with old secret
                return verifyToken(token, JWT_SECRET_OLD, alg, noVerify);
            }
            throw err;
        }

    return payload;
}
