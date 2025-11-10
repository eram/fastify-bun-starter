#!/usr/bin/env bun
/**
 * Check code coverage against minimum thresholds
 * Reads lcov.info and validates against 80% line coverage and 50% function coverage
 * Adds zero-coverage entries for files not in lcov report
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { glob } from 'glob';
import { Env, ErrorEx, red, yellow } from '../src/util';

// Configuration
const TEST_LINE_THRESH = Env.get('TEST_LINE_THRESH', 80); // Line coverage threshold percentage
const TEST_FUNC_THRESH = Env.get('TEST_FUNC_THRESH', 50); // Function coverage threshold percentage
const FILE_WIDTH = 30; // File name column width
const PERCENT_WIDTH = 7; // Percentage column width
const UNCOVERED_WIDTH = 30; // Uncovered line numbers column width

// Coverage ignore patterns (from bunfig.toml)
const TEST_COVERAGE_INCLUDE = JSON.parse(Env.get('TEST_COVERAGE_INCLUDE', `["src/**/*.{ts,js,tsx,jsx}"]`));
const TEST_COVERAGE_IGNORE = JSON.parse(
    Env.get(
        'TEST_COVERAGE_IGNORE',
        `[
     "**/index.ts", "**/*.d.ts", "**/*types.ts",
    "**/*.{test,spec}.*", "**/__mocks__/**",
    "script/**",
    "**/*cluster*.ts"
    ]`,
    ),
);

interface Coverage {
    file: string;
    lines: number;
    linesCov: number;
    funcs: number;
    funcsCov: number;
    branches: number;
    branchesCov: number;
    uncovered: number[];
}

interface FolderCoverage {
    funcs: number;
    funcsCov: number;
    lines: number;
    linesCov: number;
    uncovered: number[];
    files: Array<{
        name: string;
        path: string; // relative path (stored but not displayed)
        funcs: number;
        funcsCov: number;
        lines: number;
        linesCov: number;
        uncovered: number[];
        ignored: boolean; // Has Istanbul ignore comment
    }>;
}

// Console shortcuts
const { log, error } = console;

/** Normalize path to use forward slashes and lowercase for consistent comparison */
function normalizePath(path: string): string {
    return normalize(path)
        .replace(new RegExp(`\\${sep}`, 'g'), '/')
        .toLowerCase();
}

/** Parse lcov.info file format */
function parseLcov(lcovData: string): Coverage[] {
    const files: Coverage[] = [];
    const lines = lcovData.split('\n');
    let file: Partial<Coverage> = {};
    const uncovered: number[] = [];
    let daCount = 0; // Count actual DA lines
    let daHitCount = 0; // Count DA lines with hits > 0

    for (const line of lines) {
        if (line.startsWith('SF:')) {
            // Start of new file
            file = { file: line.substring(3), uncovered: [] };
            daCount = 0;
            daHitCount = 0;
        } else if (line.startsWith('DA:')) {
            // Data about a line: DA:line,hitCount
            const parts = line.substring(3).split(',');
            const lineNum = Number.parseInt(parts[0], 10);
            const hits = Number.parseInt(parts[1], 10);
            daCount++; // Count this as an executable line
            if (hits === 0) {
                uncovered.push(lineNum);
            } else {
                daHitCount++; // Count as covered
            }
        } else if (line.startsWith('LF:')) {
            // Lines found - IGNORE buggy LF value, use DA count instead
            // file.lines = Number.parseInt(line.substring(3), 10);
        } else if (line.startsWith('LH:')) {
            // Lines hit - IGNORE buggy LH value, use DA hit count instead
            // file.linesCov = Number.parseInt(line.substring(3), 10);
        } else if (line.startsWith('FNF:')) {
            // Functions found
            file.funcs = Number.parseInt(line.substring(4), 10);
        } else if (line.startsWith('FNH:')) {
            // Functions hit
            file.funcsCov = Number.parseInt(line.substring(4), 10);
        } else if (line.startsWith('BRF:')) {
            // Branches found
            file.branches = Number.parseInt(line.substring(4), 10);
        } else if (line.startsWith('BRH:')) {
            // Branches hit
            file.branchesCov = Number.parseInt(line.substring(4), 10);
        } else if (line === 'end_of_record') {
            // End of current file
            if (file.file) {
                files.push({
                    file: file.file,
                    lines: daCount, // Use actual DA count instead of buggy LF
                    linesCov: daHitCount, // Use actual hit count instead of buggy LH
                    funcs: file.funcs ?? 0,
                    funcsCov: file.funcsCov ?? 0,
                    branches: file.branches ?? 0,
                    branchesCov: file.branchesCov ?? 0,
                    uncovered: [...uncovered],
                });
            }
            uncovered.length = 0;
        }
    }

    return files;
}

/** Format file/folder name with proper padding and indentation */
function indentPad(name: string, indent: number = 0): string {
    const indentedName = ' '.repeat(indent) + name;
    return indentedName.padEnd(FILE_WIDTH);
}

/** Format percentage value with color based on status */
function formatPercent(value: number, isFailing: boolean, isIgnored: boolean = false): string {
    const formatted = value.toString().padStart(PERCENT_WIDTH);
    if (isIgnored) return yellow`${formatted}`;
    return isFailing ? red`${formatted}` : formatted;
}

/** Check if a file matches coverage ignore patterns */
function shouldIgnoreFile(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    // Use glob's sync with ignore patterns to check if file would be ignored
    // This is less efficient but avoids minimatch dependency
    const matches = glob.sync([normalizedPath], { ignore: TEST_COVERAGE_IGNORE });
    // If matches is empty, file is ignored
    return matches.length === 0;
}

/** Check if a file has Istanbul ignore comment */
function hasIstanbulIgnore(filePath: string): boolean {
    try {
        const content = readFileSync(filePath, 'utf-8');
        // Check first few lines for istanbul ignore comment
        const firstLines = content.split('\n').slice(0, 5).join('\n');
        return /\/\*\s*istanbul\s+ignore\s+file\s*\*\//.test(firstLines);
    } catch {
        return false;
    }
}

/**
 * Add entries for files not in lcov report.
 * This ensures all source files appear in the coverage report
 */
function addMissingFilesToLcov(lcovPath: string): void {
    // Read existing lcov data
    const lcovData = readFileSync(lcovPath, 'utf-8');

    // Get list of files already in lcov
    const coveredFiles = new Set<string>();
    const lines = lcovData.split('\n');
    const cwd = process.cwd();
    for (const line of lines) {
        if (line.startsWith('SF:')) {
            const relativePath = line.substring(3);
            // Convert to absolute path before normalizing for consistent comparison
            const absolutePath = join(cwd, relativePath);
            const filePath = normalizePath(absolutePath);
            coveredFiles.add(filePath);
        }
    }

    // Find all TypeScript source files (using ignore patterns to exclude non-relevant files)
    const allSourceFiles = glob.sync(TEST_COVERAGE_INCLUDE, {
        cwd,
        absolute: true,
        ignore: TEST_COVERAGE_IGNORE,
    });

    // Find files missing from coverage
    const missingFiles: string[] = [];
    for (const file of allSourceFiles) {
        const normalizedPath = normalizePath(file);

        // Skip if already covered
        if (coveredFiles.has(normalizedPath)) continue;

        // Skip if has Istanbul ignore
        if (hasIstanbulIgnore(file)) continue;

        missingFiles.push(normalizedPath);
    }

    // Add zero-coverage entries for missing files
    if (missingFiles.length > 0) {
        let append = '';

        for (const file of missingFiles) {
            // Convert absolute path back to relative path (lcov uses relative paths)
            const relativePath = relative(cwd, file);

            // Add minimal lcov entry for zero coverage
            append += `TN:\nSF:${relativePath}\nFNF:0\nFNH:0\nDA:1,0\nLF:1\nLH:0\nBRF:0\nBRH:0\nend_of_record\n`;
        }

        appendFileSync(lcovPath, append, 'utf-8');
        log(`📝 Added ${missingFiles.length} files with zero coverage to lcov report`);
    }
}

/** Format uncovered lines for display, using ranges for consecutive lines */
function formatUncovered(uncovered: number[]): string {
    if (uncovered.length === 0) return ''.padEnd(UNCOVERED_WIDTH);

    // Convert consecutive numbers to ranges (e.g., "196,197,198,199" -> "196-199")
    const ranges: string[] = [];
    let rangeStart = uncovered[0];
    let rangeEnd = uncovered[0];

    for (let i = 1; i <= uncovered.length; i++) {
        if (i < uncovered.length && uncovered[i] === rangeEnd + 1) {
            // Continue the range
            rangeEnd = uncovered[i];
        } else {
            // End the range
            if (rangeStart === rangeEnd) {
                ranges.push(rangeStart.toString());
            } else if (rangeEnd === rangeStart + 1) {
                // Only 2 consecutive numbers, use comma instead of range
                ranges.push(`${rangeStart},${rangeEnd}`);
            } else {
                // 3+ consecutive numbers, use range
                ranges.push(`${rangeStart}-${rangeEnd}`);
            }
            if (i < uncovered.length) {
                rangeStart = uncovered[i];
                rangeEnd = uncovered[i];
            }
        }
    }

    let formatted = ranges.join(',');

    // If too long, truncate with ellipsis
    if (formatted.length > UNCOVERED_WIDTH) {
        // Try progressively fewer ranges until we can fit
        let count = ranges.length;
        while (count > 1) {
            const suffix = `...+${uncovered.length - uncovered.slice(0, count).length}`;
            const prefix = ranges.slice(0, count).join(',');
            const candidate = prefix + suffix;

            if (candidate.length <= UNCOVERED_WIDTH) {
                formatted = candidate;
                break;
            }
            count--;
        }
    }

    return formatted.padEnd(UNCOVERED_WIDTH);
}

try {
    const coveragePath = join(process.cwd(), 'coverage', 'lcov.info');

    // Add missing files with zero coverage to lcov report
    addMissingFilesToLcov(coveragePath);

    const lcovData = readFileSync(coveragePath, 'utf-8');
    const coverageFiles = parseLcov(lcovData);

    // Calculate overall coverage
    let totalLines = 0;
    let coveredLines = 0;
    let totalFunctions = 0;
    let coveredFunctions = 0;

    // Group files by folder
    const folders = new Map<string, FolderCoverage>();

    for (const fileCov of coverageFiles) {
        // Skip files that match ignore patterns
        if (shouldIgnoreFile(fileCov.file)) {
            continue;
        }

        // Check if file has Istanbul ignore comment - skip entirely from report
        const hasIgnore = hasIstanbulIgnore(fileCov.file);
        if (hasIgnore) {
            continue;
        }

        // Count towards overall coverage
        totalLines += fileCov.lines;
        coveredLines += fileCov.linesCov;
        totalFunctions += fileCov.funcs;
        coveredFunctions += fileCov.funcsCov;

        // Normalize path and make it relative to cwd
        const normalizedFile = normalizePath(fileCov.file);
        const normalizedCwd = normalizePath(process.cwd());
        let displayPath = normalizedFile.replace(normalizedCwd, '');
        displayPath = displayPath.replace(/^\/+/, '');

        // Extract folder and filename
        const lastSlash = displayPath.lastIndexOf('/');
        const folder = lastSlash > 0 ? displayPath.substring(0, lastSlash) : '.';
        const filename = lastSlash > 0 ? displayPath.substring(lastSlash + 1) : displayPath;

        if (!folders.has(folder)) {
            folders.set(folder, {
                funcs: 0,
                funcsCov: 0,
                lines: 0,
                linesCov: 0,
                uncovered: [],
                files: [],
            });
        }

        const folderData = folders.get(folder)!;
        folderData.funcs += fileCov.funcs;
        folderData.funcsCov += fileCov.funcsCov;
        folderData.lines += fileCov.lines;
        folderData.linesCov += fileCov.linesCov;
        folderData.uncovered.push(...fileCov.uncovered);

        folderData.files.push({
            name: filename,
            path: displayPath, // Store full path for clickable links
            funcs: fileCov.funcs,
            funcsCov: fileCov.funcsCov,
            lines: fileCov.lines,
            linesCov: fileCov.linesCov,
            uncovered: fileCov.uncovered.sort((a, b) => a - b),
            ignored: hasIgnore,
        });
    }

    const lineCoverage = (coveredLines / totalLines) * 100;
    const functionCoverage = (coveredFunctions / totalFunctions) * 100;

    // Build table data as object with keys (File column becomes the key)
    const tableData: Record<string, Record<string, string>> = {};

    // Add "All files" summary first
    const allFilesFuncs = Math.round(functionCoverage);
    const allFilesLines = Math.round(lineCoverage);
    const allFilesFuncsFail = allFilesFuncs < TEST_FUNC_THRESH;
    const allFilesLinesFail = allFilesLines < TEST_LINE_THRESH;

    tableData[indentPad('All files')] = {
        funcs: formatPercent(allFilesFuncs, allFilesFuncsFail),
        lines: formatPercent(allFilesLines, allFilesLinesFail),
        uncov: formatUncovered([]),
    };

    // Sort folders alphabetically
    const sortedFolders = Array.from(folders.entries()).sort(([a], [b]) => a.localeCompare(b));

    // Add each folder and its files
    for (const [folder, folderData] of sortedFolders) {
        const folderFuncsPct = folderData.funcs > 0 ? Math.round((folderData.funcsCov / folderData.funcs) * 100) : 0;
        const folderLinesPct = folderData.lines > 0 ? Math.round((folderData.linesCov / folderData.lines) * 100) : 0;
        const folderFuncsFail = folderFuncsPct < TEST_FUNC_THRESH;
        const folderLinesFail = folderLinesPct < TEST_LINE_THRESH;
        const folderFail = folderLinesFail || folderFuncsFail;

        const folderName = indentPad(folder, 1);
        const funcsDisplay =
            folderData.funcs > 0 ? formatPercent(folderFuncsPct, folderFuncsFail) : '    N/A'.padStart(PERCENT_WIDTH);
        const linesDisplay =
            folderData.lines > 0 ? formatPercent(folderLinesPct, folderLinesFail) : '    N/A'.padStart(PERCENT_WIDTH);

        tableData[folderFail ? red`${folderName}` : folderName] = {
            funcs: funcsDisplay,
            lines: linesDisplay,
            uncov: formatUncovered(folderData.uncovered.sort((a, b) => a - b)),
        };

        // Add files in this folder
        for (const file of folderData.files.sort((a, b) => a.name.localeCompare(b.name))) {
            const fileFuncsPct = file.funcs > 0 ? Math.round((file.funcsCov / file.funcs) * 100) : 0;
            const fileLinesPct = file.lines > 0 ? Math.round((file.linesCov / file.lines) * 100) : 0;
            const fileFuncsFail = file.funcs > 0 && fileFuncsPct < TEST_FUNC_THRESH;
            const fileLinesFail = file.lines > 0 && fileLinesPct < TEST_LINE_THRESH;
            // Files with Istanbul ignore don't fail the build
            const fileFail = !file.ignored && (fileLinesFail || fileFuncsFail);

            // Show filename only (not clickable, but clean display)
            // Ignored files: white name, yellow percentages
            // Failing files: red name and percentages
            const indent = '   '; // 3 spaces for file indentation
            const displayName = fileFail ? red`${file.name}` : file.name;
            const clickableFile = indent + displayName;

            const funcsDisplay =
                file.funcs > 0 ? formatPercent(fileFuncsPct, fileFuncsFail, file.ignored) : '    N/A'.padStart(PERCENT_WIDTH);
            const linesDisplay =
                file.lines > 0 ? formatPercent(fileLinesPct, fileLinesFail, file.ignored) : '    N/A'.padStart(PERCENT_WIDTH);

            tableData[clickableFile] = {
                funcs: funcsDisplay,
                lines: linesDisplay,
                uncov: formatUncovered(file.uncovered),
            };
        }
    }

    // Print custom table (console.table escapes ANSI codes, so we build manually)
    log('📊 Coverage Report:');
    log('┌────────────────────────────────┬─────────┬─────────┬────────────────────────────────┐');
    log('│ File                           │ % Lines │ % Funcs │ Uncovered Line #s              │');
    log('├────────────────────────────────┼─────────┼─────────┼────────────────────────────────┤');

    for (const [filename, data] of Object.entries(tableData)) {
        // Calculate visible length (excluding ANSI codes) for proper padding
        // biome-ignore lint/suspicious/noControlCharactersInRegex: need to strip ANSI escape codes for length calculation
        const visibleLength = filename.replace(/\x1b\[[0-9;]*m/g, '').length;
        const paddedFilename = filename + ' '.repeat(Math.max(0, FILE_WIDTH - visibleLength));

        log(`│ ${paddedFilename} │ ${data.lines} │ ${data.funcs} │ ${data.uncov} │`);
    }

    log('└────────────────────────────────┴─────────┴─────────┴────────────────────────────────┘');

    // Check thresholds and exit
    if (lineCoverage < TEST_LINE_THRESH || functionCoverage < TEST_FUNC_THRESH) {
        if (lineCoverage < TEST_LINE_THRESH) {
            error(red`❌ Line coverage ${Math.round(lineCoverage)} is below threshold ${TEST_LINE_THRESH}`);
        }
        if (functionCoverage < TEST_FUNC_THRESH) {
            error(red`❌ Function coverage ${Math.round(functionCoverage)} is below threshold ${TEST_FUNC_THRESH}`);
        }
        process.exit(1);
    }

    log(`✅ Coverage meets thresholds: ${TEST_LINE_THRESH}% lines, ${TEST_FUNC_THRESH}% functions\n`);
    process.exit(0);
} catch (err) {
    error('Error reading coverage data:', new ErrorEx(err));
    error('Run "bun test" first to generate coverage data');
    process.exit(1);
}
