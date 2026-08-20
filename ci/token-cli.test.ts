import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';

const CLI = 'bun apps/cli.template/index.ts token';

const envWithSecret: NodeJS.ProcessEnv = { ...process.env, JWT_SECRET: 'ci-test-secret' };
const envWithoutSecret: NodeJS.ProcessEnv = { ...process.env };
delete envWithoutSecret['JWT_SECRET'];

interface RunResult {
    stdout: string;
    stderr: string;
    exit: number;
}

function run(cmd: string, input: string = '', env: NodeJS.ProcessEnv = envWithSecret): RunResult {
    try {
        const stdout = execSync(cmd, {
            input,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env,
        });
        return { stdout, stderr: '', exit: 0 };
    } catch (err) {
        const error = err as { stdout?: string; stderr?: string; status?: number };
        return {
            stdout: error.stdout || '',
            stderr: error.stderr || '',
            exit: error.status || 1,
        };
    }
}

describe('CLI: token create', () => {
    test('creates token with default 30d expiry', () => {
        const result = run(`${CLI} create`, '30d\n');
        expect(result.exit).toBe(0);
        expect(result.stdout).toContain('Token created successfully');
        expect(result.stdout).toMatch(/Token: eyJ/);
    });

    test('creates token with custom duration', () => {
        const result = run(`${CLI} create`, '7d\n');
        expect(result.exit).toBe(0);
        expect(result.stdout).toContain('Expires in: 7d');
    });

    test('warns about default JWT_SECRET before failing', () => {
        const result = run(`${CLI} create`, '1d\n', envWithoutSecret);
        expect(result.stdout).toContain('WARNING: JWT_SECRET is using default value');
    });

    test('fails when JWT_SECRET is unset', () => {
        const result = run(`${CLI} create`, '1d\n', envWithoutSecret);
        expect(result.exit).toBe(1);
        expect(result.stdout).toContain('JWT_SECRET is not set');
    });

    test('rejects invalid duration', () => {
        const result = run(`${CLI} create`, 'invalid\n');
        expect(result.exit).toBe(1);
        expect(result.stdout).toContain('Invalid duration');
    });

    test('handles empty duration input', () => {
        const result = run(`${CLI} create`, '\n');
        expect(result.exit).toBe(0); // accepts default
        expect(result.stdout).toContain('Token created successfully');
    });
});

describe('CLI: token validate', () => {
    test('validates correct token from parameter', () => {
        // Create a token first
        const createResult = run(`${CLI} create`, '30d\n');
        const tokenMatch = createResult.stdout.match(/Token: (eyJ[^\s]+)/);
        const token = tokenMatch?.[1];

        if (!token) {
            throw new Error('Failed to create test token');
        }

        // Validate it
        const validateResult = run(`${CLI} validate ${token}`);
        expect(validateResult.exit).toBe(0);
        expect(validateResult.stdout).toContain('Token is VALID');
        expect(validateResult.stdout).toContain('Expires');
    });

    test('shows expiry in compact format', () => {
        const createResult = run(`${CLI} create`, '1d\n');
        const tokenMatch = createResult.stdout.match(/Token: (eyJ[^\s]+)/);
        const token = tokenMatch?.[1];

        if (!token) throw new Error('Failed to create test token');

        const validateResult = run(`${CLI} validate ${token}`);
        expect(validateResult.stdout).toMatch(/Expires \d{8}:\d{6}z/);
    });

    test('rejects invalid token', () => {
        const result = run(`${CLI} validate invalid.token.here`);
        expect(result.exit).toBe(1);
        expect(result.stdout).toContain('Token is INVALID');
    });

    test('rejects malformed token', () => {
        const result = run(`${CLI} validate notavalidjwt`);
        expect(result.exit).toBe(1);
        expect(result.stdout).toContain('Token is INVALID');
    });

    test('handles token with wrong signature', () => {
        const result = run(`${CLI} validate eyJ0eXAiOiJKV1QiLCJhbGciOiJzaGEyNTYifQ.eyJleHAiOjE4MDAwMDAwMDB9.invalidsignature`);
        expect(result.exit).toBe(1);
        expect(result.stdout).toContain('Token is INVALID');
    });

    test('handles empty token parameter', () => {
        const result = run(`${CLI} validate`, '\n');
        expect(result.exit).toBe(1);
        expect(result.stdout).toContain('No token provided');
    });
});

describe('CLI: edge cases', () => {
    test('token create with 1h duration', () => {
        const result = run(`${CLI} create`, '1h\n');
        expect(result.exit).toBe(0);
        expect(result.stdout).toContain('Token created successfully');
    });

    test('token create with 1y duration', () => {
        const result = run(`${CLI} create`, '1y\n');
        expect(result.exit).toBe(0);
        expect(result.stdout).toContain('Token created successfully');
    });

    test('token payload contains correct claims', () => {
        const createResult = run(`${CLI} create`, '1d\n');
        const tokenMatch = createResult.stdout.match(/Token: (eyJ[^\s]+)/);
        const token = tokenMatch?.[1];

        if (!token) throw new Error('Failed to create test token');

        const validateResult = run(`${CLI} validate ${token}`);
        expect(validateResult.stdout).toContain('"sub": "cli"');
        expect(validateResult.stdout).toContain('"exp":');
        expect(validateResult.stdout).toContain('"iat":');
    });

    test('shows success in green', () => {
        const result = run(`${CLI} create`, '1d\n');
        expect(result.stdout).toContain('\x1b[32m'); // ANSI green code
    });

    test('shows warnings in red', () => {
        const result = run(`${CLI} create`, '1d\n', envWithoutSecret);
        expect(result.stdout).toContain('\x1b[31m'); // ANSI red code
    });
});

describe('CLI: token create --claim', () => {
    test('registers a single custom claim on the token', () => {
        const createResult = run(`${CLI} create --claim role=admin`, '1h\n');
        expect(createResult.exit).toBe(0);
        expect(createResult.stdout).toContain('Claims: {"role":"admin"}');

        const tokenMatch = createResult.stdout.match(/Token: (eyJ[^\s]+)/);
        const token = tokenMatch?.[1];
        if (!token) throw new Error('Failed to create test token');

        const validateResult = run(`${CLI} validate ${token}`);
        expect(validateResult.stdout).toContain('"role": "admin"');
    });

    test('registers multiple custom claims on the token', () => {
        const createResult = run(`${CLI} create --claim role=admin --claim scope=read:all`, '1h\n');
        expect(createResult.exit).toBe(0);

        const tokenMatch = createResult.stdout.match(/Token: (eyJ[^\s]+)/);
        const token = tokenMatch?.[1];
        if (!token) throw new Error('Failed to create test token');

        const validateResult = run(`${CLI} validate ${token}`);
        expect(validateResult.stdout).toContain('"role": "admin"');
        expect(validateResult.stdout).toContain('"scope": "read:all"');
    });

    test('rejects a malformed claim (missing =)', () => {
        const result = run(`${CLI} create --claim badclaim`, '1h\n');
        expect(result.exit).toBe(1);
        expect(result.stdout).toContain('Invalid claim');
    });
});
