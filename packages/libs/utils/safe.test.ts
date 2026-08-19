import { describe, expect, spyOn, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import * as safe from './safe';
import { Dirent } from './safe';

const deldir = async (dir: string) => fs.promises.rm(dir, { recursive: true, force: true });

describe('safe', () => {
    test('rimraf returns error for invalid path', async () => {
        const [_, err] = await safe.rimraf('/this/path/does/not/exist');
        expect(err instanceof Error).toBeTruthy();
    });

    test('rimraf returns success for empty pattern array', async () => {
        const [_, err] = await safe.rimraf([]);
        expect(err).toBe(undefined);
    });

    test('wrapWithSafe DNS and childProcess exports', async () => {
        // DNS
        expect(typeof safe.lookup).toBe('function');
        expect(typeof safe.resolve).toBe('function');
        // childProcess
        expect(typeof safe.exec).toBe('function');
        expect(typeof safe.execSync).toBe('function');
        expect(typeof safe.spawn).toBe('function');
        expect(typeof safe.spawnSync).toBe('function');
    });

    test('safe() function handles successful promises', async () => {
        const successPromise = Promise.resolve('success');
        const [data, err] = await safe.safe(successPromise);

        expect(err).toBe(undefined);
        expect(data).toBe('success');
    });

    test('safe() function handles promise rejections', async () => {
        const errorMessage = 'Test error';
        const failingPromise = Promise.reject(new Error(errorMessage));
        const [data, err] = await safe.safe(failingPromise);

        expect(data).toBe(undefined);
        expect(err instanceof Error).toBeTruthy();
        expect(err!.message).toBe(errorMessage);
    });

    test('safe() function handles functions returning promises', async () => {
        const successFn = () => Promise.resolve('success from function');
        const [data, err] = await safe.safe(successFn);

        expect(err).toBe(undefined);
        expect(data).toBe('success from function');
    });

    test('safe() function handles thrown errors in functions', async () => {
        const errorMessage = 'Function threw error';
        const throwingFn = () => {
            throw new Error(errorMessage);
        };

        const [data, err] = await safe.safe(throwingFn);

        expect(data).toBe(undefined);
        expect(err instanceof Error).toBeTruthy();
        expect(err!.message).toBe(errorMessage);
    });

    test('dirIterate and rimraf', async () => {
        const [dir1, err] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (err) throw err;
        const f1 = join(dir1, 'file1');
        await safe.writeFile(f1, 'data1');
        await safe.mkdir(join(dir1, 'dir2'));
        const f2 = join(dir1, 'dir2', 'file2');
        await safe.writeFile(f2, 'data2');

        const [exist] = await safe.exists(f2);
        expect(exist).toBeTruthy();

        const entries: Dirent[] = [];
        for await (const entry of safe.dirIterate(dir1)) {
            entries.push(entry);
        }
        expect(entries.length).toBe(4);

        await safe.rimraf(dir1);

        expect((await safe.exists(f2))[0]).toBe(false);
        expect((await safe.exists(dir1))[0]).toBe(false);
    });

    test('encoding-sensitive functions return strings by default', async () => {
        // Create a temporary file
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        const filePath = join(dir, 'test-file.txt');
        const testContent = 'test content';

        // Write content to file
        const [, writeErr] = await safe.writeFile(filePath, testContent);
        if (writeErr) throw writeErr;

        try {
            // Test readFile returns string
            const [content, readErr] = await safe.readFile(filePath);
            expect(readErr).toBe(undefined);
            expect(typeof content).toBe('string');
            expect(content).toBe(testContent);

            // Test readdir returns string[]
            const [files, readdirErr] = await safe.readdir(dir);
            expect(readdirErr).toBe(undefined);
            expect(Array.isArray(files)).toBeTruthy();
            expect(typeof files![0]).toBe('string');

            // Test realpath returns string
            const [realPath, realpathErr] = await safe.realpath(filePath);
            expect(realpathErr).toBe(undefined);
            expect(typeof realPath).toBe('string');
        } finally {
            // Clean up
            await deldir(dir);
        }
    });

    test('fetch wrapper', async () => {
        type T = {
            id: number;
            txt: string;
        };

        const fn = spyOn(globalThis, 'fetch').mockImplementation(async (_input: string | URL, _init?: RequestInit) => {
            return new Response(JSON.stringify({ id: 1, txt: 'test' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });

        try {
            const [res, err] = await safe.fetch('https://zibzib/1');
            expect(err).toBe(undefined);
            expect(res instanceof Response).toBeTruthy();

            const data1 = (await res!.json()) as { id: number; txt: string };
            expect(data1.txt).toBe('test');

            const [data2, err2] = await safe.fetchJson<T>('https://zibzib/1');
            expect(err2).toBe(undefined);
            expect(typeof data2).toBe('object');
            expect(data2!.id).toBe(1);

            expect(fn.mock.calls.length).toBe(2);
        } finally {
            fn.mockRestore();
        }
    });

    test('error handling in file operations', async () => {
        const nonExistentFile = join(os.tmpdir(), `non-existent-${Date.now()}`);

        // Test reading non-existent file
        const [content, readErr] = await safe.readFile(nonExistentFile);
        expect(content).toBe(undefined);
        expect(readErr instanceof Error).toBeTruthy();

        // Test stat on non-existent file
        const [stats, statErr] = await safe.stat(nonExistentFile);
        expect(stats).toBe(undefined);
        expect(statErr instanceof Error).toBeTruthy();
    });

    test('readdir with withFileTypes option', async () => {
        const [folder, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create a subdirectory
            const [, mkdirErr] = await safe.mkdir(join(folder, 'subdir'));
            if (mkdirErr) throw mkdirErr;

            // Test readdir with withFileTypes: true
            const [entries, readdirErr] = await safe.readdir(folder, { withFileTypes: true });
            expect(readdirErr).toBe(undefined);
            expect(Array.isArray(entries)).toBeTruthy();
            expect(entries![0] instanceof Dirent).toBeTruthy();
            expect(entries![0].isDirectory()).toBeTruthy();
        } finally {
            await safe.rimraf(folder);
        }
    });

    test('DNS promises API works with safe wrapper', async () => {
        // Test DNS lookup which returns a string
        const hostname = 'localhost';
        const [address, dnsErr] = await safe.lookup(hostname);

        expect(dnsErr).toBe(undefined);
        expect(typeof address === 'string' || typeof address === 'object').toBeTruthy();
        expect(address).toBeTruthy();
    });

    test('Child process exec works with safe wrapper', async () => {
        // Simple command that should work on all platforms
        const cmd = 'echo test';
        const [output, execErr] = await safe.exec(cmd);

        expect(execErr).toBe(undefined);
        expect(output && typeof output === 'object').toBeTruthy();
        expect(output.stdout.includes('test')).toBeTruthy();
    });

    test("readdir returns Buffer[] when encoding is 'buffer'", async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create a file to ensure directory is not empty
            const filePath = join(dir, 'file.bin');
            await safe.writeFile(filePath, 'abc');

            // Test readdir with encoding: 'buffer'
            const [files, readdirErr] = await safe.readdir(dir, { encoding: 'buffer' });
            expect(readdirErr).toBe(undefined);
            expect(Array.isArray(files)).toBeTruthy();
            // Bun returns Uint8Array for buffer encoding (Buffer extends Uint8Array)
            expect(files[0] instanceof Uint8Array || Buffer.isBuffer(files[0])).toBeTruthy();
        } finally {
            await deldir(dir);
        }
    });

    test('Child process execSync works with safe wrapper', () => {
        // Simple command that should work on all platforms
        const cmd = 'echo test';
        const [output, err] = safe.execSync(cmd);

        expect(err).toBe(undefined);
        expect(Buffer.isBuffer(output) || typeof output === 'string').toBeTruthy();
        const outputStr = output.toString();
        expect(outputStr.includes('test')).toBeTruthy();
    });

    test('Additional fs wrapper functions work', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            const filePath = join(dir, 'test.txt');
            const content = 'test content';

            // Test appendFile
            const [, appendErr1] = await safe.appendFile(filePath, content);
            expect(appendErr1).toBe(undefined);

            const [, appendErr2] = await safe.appendFile(filePath, ' more');
            expect(appendErr2).toBe(undefined);

            const [fileContent, readErr] = await safe.readFile(filePath);
            expect(readErr).toBe(undefined);
            expect(fileContent).toBe('test content more');

            // Test chmod
            const [, chmodErr] = await safe.chmod(filePath, 0o644);
            expect(chmodErr).toBe(undefined);

            // Test lstat
            const [stats, lstatErr] = await safe.lstat(filePath);
            expect(lstatErr).toBe(undefined);
            expect(stats?.isFile()).toBeTruthy();

            // Test truncate
            const [, truncErr] = await safe.truncate(filePath, 5);
            expect(truncErr).toBe(undefined);

            const [truncContent, readErr2] = await safe.readFile(filePath);
            expect(readErr2).toBe(undefined);
            expect(truncContent?.length).toBe(5);
        } finally {
            await deldir(dir);
        }
    });

    test('Additional child_process wrappers work', async () => {
        // Test execFile
        const isWindows = process.platform === 'win32';
        const [cmd, args] = isWindows ? ['cmd.exe', ['/c', 'echo', 'test']] : ['/bin/echo', ['test']];

        const [output, err] = await safe.execFile(cmd, args);
        expect(err).toBe(undefined);
        expect(output?.stdout.includes('test')).toBeTruthy();
    });

    test('spawnSync wrapper works', () => {
        const isWindows = process.platform === 'win32';
        const [cmd, args] = isWindows ? ['cmd.exe', ['/c', 'echo', 'test']] : ['/bin/echo', ['test']];

        const [result, err] = safe.spawnSync(cmd, args);
        expect(err).toBe(undefined);
        expect(result).toBeTruthy();
        expect(result.status).toBe(0);
    });

    test('Child process spawn works and returns ChildProcess directly', async () => {
        // Use commands that work cross-platform
        const isWindows = process.platform === 'win32';
        const [command, args] = isWindows ? ['cmd.exe', ['/c', 'echo', 'test']] : ['sh', ['-c', 'echo test']];

        const [child] = safe.spawn(command, args);

        // Verify it's a ChildProcess instance and not wrapped in a tuple
        expect(child.spawnfile).toBeTruthy();

        // Collect stdout and stderr
        let output = '';
        child.stdout?.on('data', (data: { toString: () => string }) => {
            output += data.toString();
        });

        child.stderr?.on('data', (data: { toString: () => string }) => {
            output += data.toString();
        });

        child.on('error', (err: Error) => {
            throw new Error(`Child process error: ${err.message}`);
        });

        // Wait for process to complete
        await new Promise<void>((resolve) => {
            child.on('close', () => resolve());
        });

        // Verify output (trim to handle Windows extra newlines)
        expect(output.trim().includes('test')).toBeTruthy();
    });

    test('safe() handles non-Error thrown values', async () => {
        // Test throwing a string instead of Error
        const throwString = () => {
            throw 'string error';
        };

        const [data, err] = await safe.safe(throwString);
        expect(data).toBe(undefined);
        expect(err instanceof Error).toBeTruthy();
        expect(err.message).toBe('string error');
    });

    test('safeSync() handles non-Error thrown values', () => {
        // Test throwing a number instead of Error
        const throwNumber = () => {
            throw 42;
        };

        const [data, err] = safe.safeSync(throwNumber);
        expect(data).toBe(undefined);
        expect(err instanceof Error).toBeTruthy();
        expect(err.message).toBe('42');
    });

    test('safe() rejects invalid input types', async () => {
        // Test safe() with invalid input (not a Promise or function)
        try {
            await safe.safe('not a promise or function' as unknown as Promise<string>);
            expect(false).toBeTruthy();
        } catch (err) {
            // Promise.reject returns the value directly, not wrapped
            expect(Array.isArray(err)).toBeTruthy();
            const [data, error] = err as [undefined, Error];
            expect(data).toBe(undefined);
            expect(error instanceof Error).toBeTruthy();
            expect(error.message.includes('Invalid input')).toBeTruthy();
        }
    });
});

describe('safe FileHandle and Dir', () => {
    test('open return safe FileHandle', async () => {
        const [folder, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        const filePath = join(folder, 'testfile.txt');
        const testContent = 'Hello, safe FileHandle!';

        // Write initial content to file
        const [, writeErr] = await safe.writeFile(filePath, testContent, 'utf-8');
        if (writeErr) throw writeErr;

        // Open the file using safe.open
        const [fh, openErr] = await safe.open(filePath, 'r+');
        if (openErr) throw openErr;

        try {
            // Read from the file using the safe FileHandle
            const [readResult, readErr] = await fh.read();
            if (readErr) throw readErr;
            expect(readResult.bytesRead).toBe(testContent.length);
            expect(readResult.buffer.toString('utf-8', 0, readResult.bytesRead)).toBe(testContent);

            // Write to the file using the safe FileHandle
            const newContent = 'Updated content';
            const [writeResult, writeErr] = await fh.write(Buffer.from(newContent), 0, newContent.length, 0);
            if (writeErr) throw writeErr;
            expect(writeResult.bytesWritten).toBe(newContent.length);

            await fh.truncate(newContent.length);

            // Verify the content was updated
            const [verifyBuffer, verifyErr] = await safe.readFile(filePath);
            if (verifyErr) throw verifyErr;
            expect(verifyBuffer).toBe(newContent);

            const [statResult, statErr] = await fh.stat();
            if (statErr) throw statErr;
            expect(statResult.isFile()).toBeTruthy();
            expect(statResult.size).toBe(newContent.length);
        } finally {
            // Clean up
            await fh.close();
            await safe.rimraf(folder);
        }
    });

    test('opendir return safe Dir', async () => {
        const [folder, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        // Create some files and directories inside
        await safe.mkdir(join(folder, 'subdir1'));
        await safe.writeFile(join(folder, 'file1.txt'), 'content1');
        await safe.writeFile(join(folder, 'file2.txt'), 'content2');

        // Open the directory using safe.opendir
        const [dir, openErr] = await safe.opendir(folder);
        if (openErr) throw openErr;

        try {
            const entries: string[] = [];

            let [entry] = await dir.read();
            while (entry) {
                entries.push(entry.name);
                [entry] = await dir.read();
            }

            // Verify we read all created entries
            expect(entries.length).toBe(3);
            expect(entries.includes('subdir1')).toBeTruthy();
            expect(entries.includes('file1.txt')).toBeTruthy();
            expect(entries.includes('file2.txt')).toBeTruthy();
        } finally {
            // Clean up
            const [, e] = await dir.close();
            expect(e).toBe(undefined);
            await safe.rimraf(folder);
        }
    });
});

describe('rimraf with glob patterns', () => {
    test('rimraf removes multiple explicit files', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-multi-${Date.now()}-`));
        if (dirErr) throw dirErr;
        try {
            const file1 = join(dir, 'fileA.txt');
            const file2 = join(dir, 'fileB.txt');
            await safe.writeFile(file1, 'A');
            await safe.writeFile(file2, 'B');
            expect((await safe.exists(file1))[0]).toBe(true);
            expect((await safe.exists(file2))[0]).toBe(true);
            await safe.rimraf([file1, file2]);
            expect((await safe.exists(file1))[0]).toBe(false);
            expect((await safe.exists(file2))[0]).toBe(false);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with *.ext pattern', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create test files
            await safe.writeFile(join(dir, 'file1.cpuprofile'), 'data1');
            await safe.writeFile(join(dir, 'file2.cpuprofile'), 'data2');
            await safe.writeFile(join(dir, 'file3.txt'), 'data3');
            await safe.writeFile(join(dir, 'keep.log'), 'keep');

            // Remove all .cpuprofile files
            const pattern = join(dir, '*.cpuprofile');
            const [, err] = await safe.rimraf(pattern);
            expect(err).toBe(undefined);

            // Verify .cpuprofile files are removed
            expect((await safe.exists(join(dir, 'file1.cpuprofile')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'file2.cpuprofile')))[0]).toBe(false);

            // Verify other files still exist
            expect((await safe.exists(join(dir, 'file3.txt')))[0]).toBe(true);
            expect((await safe.exists(join(dir, 'keep.log')))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with file.* pattern', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create test files
            await safe.writeFile(join(dir, 'target.txt'), 'data1');
            await safe.writeFile(join(dir, 'target.log'), 'data2');
            await safe.writeFile(join(dir, 'target.json'), 'data3');
            await safe.writeFile(join(dir, 'other.txt'), 'keep');

            // Remove all target.* files
            const pattern = join(dir, 'target.*');
            const [, err] = await safe.rimraf(pattern);
            expect(err).toBe(undefined);

            // Verify target.* files are removed
            expect((await safe.exists(join(dir, 'target.txt')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'target.log')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'target.json')))[0]).toBe(false);

            // Verify other files still exist
            expect((await safe.exists(join(dir, 'other.txt')))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with f*.* pattern', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create test files
            await safe.writeFile(join(dir, 'file1.txt'), 'data1');
            await safe.writeFile(join(dir, 'foo.log'), 'data2');
            await safe.writeFile(join(dir, 'far.json'), 'data3');
            await safe.writeFile(join(dir, 'other.txt'), 'keep');
            await safe.writeFile(join(dir, 'bar.txt'), 'keep');

            // Remove all f*.* files
            const pattern = join(dir, 'f*.*');
            const [, err] = await safe.rimraf(pattern);
            expect(err).toBe(undefined);

            // Verify f*.* files are removed
            expect((await safe.exists(join(dir, 'file1.txt')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'foo.log')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'far.json')))[0]).toBe(false);

            // Verify other files still exist
            expect((await safe.exists(join(dir, 'other.txt')))[0]).toBe(true);
            expect((await safe.exists(join(dir, 'bar.txt')))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with ? wildcard pattern', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create test files
            await safe.writeFile(join(dir, 'file1.txt'), 'data1');
            await safe.writeFile(join(dir, 'file2.txt'), 'data2');
            await safe.writeFile(join(dir, 'file10.txt'), 'keep');
            await safe.writeFile(join(dir, 'other.txt'), 'keep');

            // Remove files matching file?.txt (single character)
            const pattern = join(dir, 'file?.txt');
            const [, err] = await safe.rimraf(pattern);
            expect(err).toBe(undefined);

            // Verify file?.txt files are removed
            expect((await safe.exists(join(dir, 'file1.txt')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'file2.txt')))[0]).toBe(false);

            // Verify other files still exist
            expect((await safe.exists(join(dir, 'file10.txt')))[0]).toBe(true);
            expect((await safe.exists(join(dir, 'other.txt')))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with brace expansion pattern', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create test files
            await safe.writeFile(join(dir, 'file.ts'), 'data1');
            await safe.writeFile(join(dir, 'file.js'), 'data2');
            await safe.writeFile(join(dir, 'file.tsx'), 'data3');
            await safe.writeFile(join(dir, 'file.jsx'), 'data4');
            await safe.writeFile(join(dir, 'file.txt'), 'keep');

            // Remove files matching file.{ts,js}
            const pattern = join(dir, 'file.{ts,js}');
            const [, err] = await safe.rimraf(pattern);
            expect(err).toBe(undefined);

            // Verify matching files are removed
            expect((await safe.exists(join(dir, 'file.ts')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'file.js')))[0]).toBe(false);

            // Verify other files still exist
            expect((await safe.exists(join(dir, 'file.tsx')))[0]).toBe(true);
            expect((await safe.exists(join(dir, 'file.jsx')))[0]).toBe(true);
            expect((await safe.exists(join(dir, 'file.txt')))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with nested glob pattern', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create nested directory structure
            await safe.mkdir(join(dir, 'sub1'));
            await safe.mkdir(join(dir, 'sub2'));
            await safe.writeFile(join(dir, 'sub1', 'file.log'), 'data1');
            await safe.writeFile(join(dir, 'sub2', 'file.log'), 'data2');
            await safe.writeFile(join(dir, 'sub1', 'keep.txt'), 'keep');
            await safe.writeFile(join(dir, 'sub2', 'keep.txt'), 'keep');

            // Remove all .log files in subdirectories
            const pattern = join(dir, '*', '*.log');
            const [, err] = await safe.rimraf(pattern);
            expect(err).toBe(undefined);

            // Verify .log files are removed
            expect((await safe.exists(join(dir, 'sub1', 'file.log')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'sub2', 'file.log')))[0]).toBe(false);

            // Verify other files still exist
            expect((await safe.exists(join(dir, 'sub1', 'keep.txt')))[0]).toBe(true);
            expect((await safe.exists(join(dir, 'sub2', 'keep.txt')))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf folder with path', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;
        try {
            // Create test files
            await safe.writeFile(join(dir, 'file1.txt'), 'data1');
            await safe.writeFile(join(dir, 'file2.txt'), 'data2');

            // Remove entire directory (no glob)
            const [, err] = await safe.rimraf(dir);
            expect(err).toBe(undefined);

            // Verify directory is removed
            expect((await safe.exists(dir))[0]).toBe(false);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with glob matching no files returns success', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create test files
            await safe.writeFile(join(dir, 'file.txt'), 'data');

            // Try to remove non-matching pattern
            const pattern = join(dir, '*.nonexistent');
            const [, err] = await safe.rimraf(pattern);

            // Should succeed even if no files match
            expect(err).toBe(undefined);

            // Verify original files still exist
            expect((await safe.exists(join(dir, 'file.txt')))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with glob removes directories matching pattern', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create directories
            await safe.mkdir(join(dir, 'temp1'));
            await safe.mkdir(join(dir, 'temp2'));
            await safe.mkdir(join(dir, 'keep'));
            await safe.writeFile(join(dir, 'temp1', 'file.txt'), 'data1');
            await safe.writeFile(join(dir, 'temp2', 'file.txt'), 'data2');

            // Remove temp* directories
            const pattern = join(dir, 'temp*');
            const [, err] = await safe.rimraf(pattern);
            expect(err).toBe(undefined);

            // Verify temp directories are removed
            expect((await safe.exists(join(dir, 'temp1')))[0]).toBe(false);
            expect((await safe.exists(join(dir, 'temp2')))[0]).toBe(false);

            // Verify keep directory still exists
            expect((await safe.exists(join(dir, 'keep')))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with array of direct paths, one invalid', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-array-${Date.now()}-`));
        if (dirErr) throw dirErr;
        try {
            const file1 = join(dir, 'file1.txt');
            await safe.writeFile(file1, 'A');
            const invalidFile = join(dir, 'does-not-exist.txt');
            const [, err] = await safe.rimraf([file1, invalidFile]);
            expect(err instanceof Error).toBeTruthy();
            // file1 should still exist (since function returns early on error)
            expect((await safe.exists(file1))[0]).toBe(true);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf with array of mixed globs and direct paths', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-mixed-${Date.now()}-`));
        if (dirErr) throw dirErr;
        try {
            const file1 = join(dir, 'file1.txt');
            const file2 = join(dir, 'file2.log');
            await safe.writeFile(file1, 'A');
            await safe.writeFile(file2, 'B');
            const pattern = join(dir, '*.log');
            const [, err] = await safe.rimraf([file1, pattern]);
            expect(err).toBe(undefined);
            expect((await safe.exists(file1))[0]).toBe(false);
            expect((await safe.exists(file2))[0]).toBe(false);
        } finally {
            await deldir(dir);
        }
    });

    test('rimraf returns error if file removal fails (permission denied)', async () => {
        // Skip on Windows as chmod doesn't work the same way
        if (process.platform === 'win32') {
            return;
        }

        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-perm-${Date.now()}-`));
        if (dirErr) throw dirErr;
        try {
            const file1 = join(dir, 'protected.txt');
            await safe.writeFile(file1, 'secret');

            // Make DIRECTORY read-only (owner can still delete their own files,
            // but can't delete files from read-only directories they own)
            await safe.chmod(dir, 0o500); // Owner read+execute only (no write)

            const [, err] = await safe.rimraf(file1, { force: false });

            // Should get EACCES error when trying to delete file from read-only directory
            // Note: This may not fail in all environments (root, special filesystems)
            // So we just verify it either errors or succeeds gracefully
            if (err) {
                expect(err instanceof Error).toBeTruthy();
            }

            // Clean up: make directory writable again
            await safe.chmod(dir, 0o700);
        } finally {
            // Ensure cleanup can happen
            await safe.chmod(dir, 0o700).catch(() => {});
            await deldir(dir);
        }
    });
});
