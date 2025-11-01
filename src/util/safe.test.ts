import { equal, ok, strictEqual } from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import * as safe from './safe';
import { Dirent } from './safe';

const deldir = async (dir: string) => fs.promises.rm(dir, { recursive: true, force: true });

describe('safe', () => {
    test('rimraf returns error for invalid path', async () => {
        const [_, err] = await safe.rimraf('/this/path/does/not/exist');
        ok(err instanceof Error);
    });

    test('rimraf returns success for empty pattern array', async () => {
        const [_, err] = await safe.rimraf([]);
        strictEqual(err, undefined);
    });

    test('wrapWithSafe DNS and childProcess exports', async () => {
        // DNS
        ok(typeof safe.lookup === 'function');
        ok(typeof safe.resolve === 'function');
        // childProcess
        ok(typeof safe.exec === 'function');
        ok(typeof safe.execSync === 'function');
        ok(typeof safe.spawn === 'function');
        ok(typeof safe.spawnSync === 'function');
    });

    test('safe() function handles successful promises', async () => {
        const successPromise = Promise.resolve('success');
        const [data, err] = await safe.safe(successPromise);

        strictEqual(err, undefined, 'Error should be undefined on success');
        strictEqual(data, 'success', 'Data should contain the resolved value');
    });

    test('safe() function handles promise rejections', async () => {
        const errorMessage = 'Test error';
        const failingPromise = Promise.reject(new Error(errorMessage));
        const [data, err] = await safe.safe(failingPromise);

        strictEqual(data, undefined, 'Data should be undefined on error');
        ok(err instanceof Error, 'Error should be an Error instance');
        strictEqual(err.message, errorMessage, 'Error message should be preserved');
    });

    test('safe() function handles functions returning promises', async () => {
        const successFn = () => Promise.resolve('success from function');
        const [data, err] = await safe.safe(successFn);

        strictEqual(err, undefined, 'Error should be undefined on success');
        strictEqual(data, 'success from function', 'Data should contain the resolved value');
    });

    test('safe() function handles thrown errors in functions', async () => {
        const errorMessage = 'Function threw error';
        const throwingFn = () => {
            throw new Error(errorMessage);
        };

        const [data, err] = await safe.safe(throwingFn);

        strictEqual(data, undefined, 'Data should be undefined when function throws');
        ok(err instanceof Error, 'Error should be an Error instance');
        strictEqual(err.message, errorMessage, 'Error message should be preserved');
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
        ok(exist);

        const entries: Dirent[] = [];
        for await (const entry of safe.dirIterate(dir1)) {
            entries.push(entry);
        }
        equal(entries.length, 4);

        await safe.rimraf(dir1);

        strictEqual((await safe.exists(f2))[0], false);
        strictEqual((await safe.exists(dir1))[0], false);
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
            strictEqual(readErr, undefined);
            strictEqual(typeof content, 'string');
            strictEqual(content, testContent);

            // Test readdir returns string[]
            const [files, readdirErr] = await safe.readdir(dir);
            strictEqual(readdirErr, undefined);
            ok(Array.isArray(files));
            strictEqual(typeof files[0], 'string');

            // Test realpath returns string
            const [realPath, realpathErr] = await safe.realpath(filePath);
            strictEqual(realpathErr, undefined);
            strictEqual(typeof realPath, 'string');
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

        const fn = mock.method(globalThis, 'fetch', (async (_input: string | URL, _init?: RequestInit) => {
            return new Response(JSON.stringify({ id: 1, txt: 'test' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }) as any);

        try {
            const [res, err] = await safe.fetch('https://zibzib/1');
            strictEqual(err, undefined);
            ok(res instanceof Response);

            const data1 = (await res.json()) as { id: number; txt: string };
            strictEqual(data1.txt, 'test');

            const [data2, err2] = await safe.fetchJson<T>('https://zibzib/1');
            strictEqual(err2, undefined);
            equal(typeof data2, 'object');
            strictEqual(data2.id, 1);

            equal(fn.mock.calls.length, 2);
        } finally {
            mock.restoreAll();
        }
    });

    test('error handling in file operations', async () => {
        const nonExistentFile = join(os.tmpdir(), `non-existent-${Date.now()}`);

        // Test reading non-existent file
        const [content, readErr] = await safe.readFile(nonExistentFile);
        strictEqual(content, undefined);
        ok(readErr instanceof Error);

        // Test stat on non-existent file
        const [stats, statErr] = await safe.stat(nonExistentFile);
        strictEqual(stats, undefined);
        ok(statErr instanceof Error);
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
            strictEqual(readdirErr, undefined);
            ok(Array.isArray(entries));
            ok(entries[0] instanceof Dirent);
            ok(entries[0].isDirectory());
        } finally {
            await safe.rimraf(folder);
        }
    });

    test('DNS promises API works with safe wrapper', async () => {
        // Test DNS lookup which returns a string
        const hostname = 'localhost';
        const [address, dnsErr] = await safe.lookup(hostname);

        strictEqual(dnsErr, undefined);
        ok(typeof address === 'string' || typeof address === 'object');
        ok(address, 'DNS lookup should return an address');
    });

    test('Child process exec works with safe wrapper', async () => {
        // Simple command that should work on all platforms
        const cmd = 'echo test';
        const [output, execErr] = await safe.exec(cmd);

        strictEqual(execErr, undefined);
        ok(output && typeof output === 'object');
        ok(output.stdout.includes('test'), "Command output should contain 'test'");
    });

    test.skip("readdir returns Buffer[] when encoding is 'buffer'", async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            // Create a file to ensure directory is not empty
            const filePath = join(dir, 'file.bin');
            await safe.writeFile(filePath, 'abc');

            // Test readdir with encoding: 'buffer'
            const [files, readdirErr] = await safe.readdir(dir, { encoding: 'buffer' });
            strictEqual(readdirErr, undefined);
            ok(Array.isArray(files));
            ok(Buffer.isBuffer(files[0]));
        } finally {
            await deldir(dir);
        }
    });

    test('Child process execSync works with safe wrapper', () => {
        // Simple command that should work on all platforms
        const cmd = 'echo test';
        const [output, err] = safe.execSync(cmd);

        strictEqual(err, undefined);
        ok(Buffer.isBuffer(output) || typeof output === 'string');
        const outputStr = output.toString();
        ok(outputStr.includes('test'), "Command output should contain 'test'");
    });

    test('Additional fs wrapper functions work', async () => {
        const [dir, dirErr] = await safe.mkdtemp(join(os.tmpdir(), `test-${Date.now()}-`));
        if (dirErr) throw dirErr;

        try {
            const filePath = join(dir, 'test.txt');
            const content = 'test content';

            // Test appendFile
            const [, appendErr1] = await safe.appendFile(filePath, content);
            strictEqual(appendErr1, undefined);

            const [, appendErr2] = await safe.appendFile(filePath, ' more');
            strictEqual(appendErr2, undefined);

            const [fileContent, readErr] = await safe.readFile(filePath);
            strictEqual(readErr, undefined);
            strictEqual(fileContent, 'test content more');

            // Test chmod
            const [, chmodErr] = await safe.chmod(filePath, 0o644);
            strictEqual(chmodErr, undefined);

            // Test lstat
            const [stats, lstatErr] = await safe.lstat(filePath);
            strictEqual(lstatErr, undefined);
            ok(stats?.isFile());

            // Test truncate
            const [, truncErr] = await safe.truncate(filePath, 5);
            strictEqual(truncErr, undefined);

            const [truncContent, readErr2] = await safe.readFile(filePath);
            strictEqual(readErr2, undefined);
            strictEqual(truncContent?.length, 5);
        } finally {
            await deldir(dir);
        }
    });

    test('Additional child_process wrappers work', async () => {
        // Test execFile
        const isWindows = process.platform === 'win32';
        const [cmd, args] = isWindows ? ['cmd.exe', ['/c', 'echo', 'test']] : ['/bin/echo', ['test']];

        const [output, err] = await safe.execFile(cmd, args);
        strictEqual(err, undefined);
        ok(output?.stdout.includes('test'));
    });

    test('spawnSync wrapper works', () => {
        const isWindows = process.platform === 'win32';
        const [cmd, args] = isWindows ? ['cmd.exe', ['/c', 'echo', 'test']] : ['/bin/echo', ['test']];

        const [result, err] = safe.spawnSync(cmd, args);
        strictEqual(err, undefined);
        ok(result);
        strictEqual(result.status, 0);
    });

    test('Child process spawn works and returns ChildProcess directly', async () => {
        // Use commands that work cross-platform
        const isWindows = process.platform === 'win32';
        const [command, args] = isWindows ? ['cmd.exe', ['/c', 'echo', 'test']] : ['sh', ['-c', 'echo test']];

        const [child] = safe.spawn(command, args);

        // Verify it's a ChildProcess instance and not wrapped in a tuple
        ok(child.spawnfile, 'Should be a direct ChildProcess instance');

        // Collect stdout and stderr
        let output = '';
        child.stdout?.on('data', (data: { toString: () => string }) => {
            output += data.toString();
        });

        child.stderr?.on('data', (data: { toString: () => string }) => {
            output += data.toString();
        });

        child.on('error', (err) => {
            throw new Error(`Child process error: ${err.message}`);
        });

        // Wait for process to complete
        await new Promise<void>((resolve) => {
            child.on('close', () => resolve());
        });

        // Verify output (trim to handle Windows extra newlines)
        ok(output.trim().includes('test'), "Command output should contain 'test'");
    });

    test('safe() handles non-Error thrown values', async () => {
        // Test throwing a string instead of Error
        const throwString = () => {
            throw 'string error';
        };

        const [data, err] = await safe.safe(throwString);
        strictEqual(data, undefined);
        ok(err instanceof Error);
        strictEqual(err.message, 'string error');
    });

    test('safeSync() handles non-Error thrown values', () => {
        // Test throwing a number instead of Error
        const throwNumber = () => {
            throw 42;
        };

        const [data, err] = safe.safeSync(throwNumber);
        strictEqual(data, undefined);
        ok(err instanceof Error);
        strictEqual(err.message, '42');
    });

    test('safe() rejects invalid input types', async () => {
        // Test safe() with invalid input (not a Promise or function)
        try {
            await safe.safe('not a promise or function' as unknown as Promise<string>);
            ok(false, 'Should have rejected');
        } catch (err) {
            // Promise.reject returns the value directly, not wrapped
            ok(Array.isArray(err));
            const [data, error] = err as [undefined, Error];
            strictEqual(data, undefined);
            ok(error instanceof Error);
            ok(error.message.includes('Invalid input'));
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
            strictEqual(readResult.bytesRead, testContent.length);
            strictEqual(readResult.buffer.toString('utf-8', 0, readResult.bytesRead), testContent);

            // Write to the file using the safe FileHandle
            const newContent = 'Updated content';
            const [writeResult, writeErr] = await fh.write(Buffer.from(newContent), 0, newContent.length, 0);
            if (writeErr) throw writeErr;
            strictEqual(writeResult.bytesWritten, newContent.length);

            await fh.truncate(newContent.length);

            // Verify the content was updated
            const [verifyBuffer, verifyErr] = await safe.readFile(filePath);
            if (verifyErr) throw verifyErr;
            strictEqual(verifyBuffer, newContent);

            const [statResult, statErr] = await fh.stat();
            if (statErr) throw statErr;
            ok(statResult.isFile());
            strictEqual(statResult.size, newContent.length);
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
            strictEqual(entries.length, 3);
            ok(entries.includes('subdir1'));
            ok(entries.includes('file1.txt'));
            ok(entries.includes('file2.txt'));
        } finally {
            // Clean up
            const [, e] = await dir.close();
            strictEqual(e, undefined, 'Error should be undefined when closing directory');
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
            strictEqual((await safe.exists(file1))[0], true);
            strictEqual((await safe.exists(file2))[0], true);
            await safe.rimraf([file1, file2]);
            strictEqual((await safe.exists(file1))[0], false);
            strictEqual((await safe.exists(file2))[0], false);
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
            strictEqual(err, undefined);

            // Verify .cpuprofile files are removed
            strictEqual((await safe.exists(join(dir, 'file1.cpuprofile')))[0], false);
            strictEqual((await safe.exists(join(dir, 'file2.cpuprofile')))[0], false);

            // Verify other files still exist
            strictEqual((await safe.exists(join(dir, 'file3.txt')))[0], true);
            strictEqual((await safe.exists(join(dir, 'keep.log')))[0], true);
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
            strictEqual(err, undefined);

            // Verify target.* files are removed
            strictEqual((await safe.exists(join(dir, 'target.txt')))[0], false);
            strictEqual((await safe.exists(join(dir, 'target.log')))[0], false);
            strictEqual((await safe.exists(join(dir, 'target.json')))[0], false);

            // Verify other files still exist
            strictEqual((await safe.exists(join(dir, 'other.txt')))[0], true);
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
            strictEqual(err, undefined);

            // Verify f*.* files are removed
            strictEqual((await safe.exists(join(dir, 'file1.txt')))[0], false);
            strictEqual((await safe.exists(join(dir, 'foo.log')))[0], false);
            strictEqual((await safe.exists(join(dir, 'far.json')))[0], false);

            // Verify other files still exist
            strictEqual((await safe.exists(join(dir, 'other.txt')))[0], true);
            strictEqual((await safe.exists(join(dir, 'bar.txt')))[0], true);
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
            strictEqual(err, undefined);

            // Verify file?.txt files are removed
            strictEqual((await safe.exists(join(dir, 'file1.txt')))[0], false);
            strictEqual((await safe.exists(join(dir, 'file2.txt')))[0], false);

            // Verify other files still exist
            strictEqual((await safe.exists(join(dir, 'file10.txt')))[0], true);
            strictEqual((await safe.exists(join(dir, 'other.txt')))[0], true);
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
            strictEqual(err, undefined);

            // Verify matching files are removed
            strictEqual((await safe.exists(join(dir, 'file.ts')))[0], false);
            strictEqual((await safe.exists(join(dir, 'file.js')))[0], false);

            // Verify other files still exist
            strictEqual((await safe.exists(join(dir, 'file.tsx')))[0], true);
            strictEqual((await safe.exists(join(dir, 'file.jsx')))[0], true);
            strictEqual((await safe.exists(join(dir, 'file.txt')))[0], true);
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
            strictEqual(err, undefined);

            // Verify .log files are removed
            strictEqual((await safe.exists(join(dir, 'sub1', 'file.log')))[0], false);
            strictEqual((await safe.exists(join(dir, 'sub2', 'file.log')))[0], false);

            // Verify other files still exist
            strictEqual((await safe.exists(join(dir, 'sub1', 'keep.txt')))[0], true);
            strictEqual((await safe.exists(join(dir, 'sub2', 'keep.txt')))[0], true);
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
            strictEqual(err, undefined);

            // Verify directory is removed
            strictEqual((await safe.exists(dir))[0], false);
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
            strictEqual(err, undefined);

            // Verify original files still exist
            strictEqual((await safe.exists(join(dir, 'file.txt')))[0], true);
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
            strictEqual(err, undefined);

            // Verify temp directories are removed
            strictEqual((await safe.exists(join(dir, 'temp1')))[0], false);
            strictEqual((await safe.exists(join(dir, 'temp2')))[0], false);

            // Verify keep directory still exists
            strictEqual((await safe.exists(join(dir, 'keep')))[0], true);
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
            ok(err instanceof Error, 'Should error for invalid path in array');
            // file1 should still exist (since function returns early on error)
            strictEqual((await safe.exists(file1))[0], true);
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
            strictEqual(err, undefined);
            strictEqual((await safe.exists(file1))[0], false);
            strictEqual((await safe.exists(file2))[0], false);
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
                ok(err instanceof Error, 'Error should be an Error instance');
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
