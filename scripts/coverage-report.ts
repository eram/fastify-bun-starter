#!/usr/bin/env bun
/**
 * Check code coverage against minimum thresholds.
 * - Reads lcov.info and validates against 80% line coverage and 50% function coverage.
 * - Adds zero-coverage entries for files not in lcov report.
 * - Removes files with * istanbul ignore file * comments from coverage.
 * - Removes lines with * istanbul ignore next * comments from coverage calculations.
 * - Removes lines with * istanbul ignore start/stop * comments from coverage calculations.
 * - Generates a report showing coverage per file and folder.
 */

import { readFileSync } from 'node:fs';
import path, { join, normalize, sep } from 'node:path';
import { glob } from 'glob';
import { ErrorEx } from '@libs/utils/error';
import { Env } from '@libs/utils/env';
import { green, grey, red, yellow } from '@libs/utils/shell';

// Configuration
const TEST_LINE_THRESH = Env.get('TEST_LINE_THRESH', 80); // Line coverage threshold percentage
const TEST_FUNC_THRESH = Env.get('TEST_FUNC_THRESH', 50); // Function coverage threshold percentage
const FILE_WIDTH = 35; // File name column width
const PERCENT_WIDTH = 7; // Percentage column width
const UNCOVERED_WIDTH = 30; // Uncovered line numbers column width

const TEST_COVERAGE_INCLUDE = Env.get('TEST_COVERAGE_INCLUDE', ['src/**/*.{ts,js,tsx,jsx}']);
const TEST_COVERAGE_IGNORE = Env.get('TEST_COVERAGE_IGNORE', [
    '**/index.ts',
    '**/*.d.ts',
    '**/*types.ts',
    '**/*.{test,spec}.*',
    '**/__mocks__/**',
    'script/**',
    '**/*cluster*.ts',
]);

interface FileCoverage {
    name: string; // file name only used for sorting
    path: string; // normalized full path
    lines: number;
    linesCov: number;
    funcs: number;
    branches: number;
    branchesCov: number;
    funcsCov: number;
    uncovered: number[];
    ignored: boolean; // Has Istanbul ignore comment for entire file
    ignoredLines: Set<number>; // Line numbers of ignored executable lines
    ignoredFuncs: Set<number>; // Line numbers of ignored function declarations
    hasIgnoredLines: boolean; // Has some (but not all) lines ignored
}

interface FolderCoverage {
    funcs: number;
    funcsCov: number;
    lines: number;
    linesCov: number;
    files: Array<FileCoverage>;
}

// Console shortcuts
const { log, error } = console;

/** Normalize path to use forward slashes and lowercase for consistent comparison */
function normalizePath(pathStr: string, root = ''): string {
    return normalize(pathStr)
        .replace(new RegExp(`\\${sep}`, 'g'), '/')
        .toLowerCase()
        .replace(root, '');
}

/** Parse lcov.info file format */
function parseLcov(lcovData: string): FileCoverage[] {
    const cwd = process.cwd();
    const files: FileCoverage[] = [];
    const lines = lcovData.split('\n');
    const empty: FileCoverage = {
        name: '',
        path: '',
        uncovered: [],
        funcs: 0,
        lines: 0,
        linesCov: 0,
        branches: 0,
        branchesCov: 0,
        funcsCov: 0,
        ignored: false,
        ignoredLines: new Set(),
        ignoredFuncs: new Set(),
        hasIgnoredLines: false,
    } as const;
    let file = empty;

    for (const line of lines) {
        if (line.startsWith('SF:')) {
            // Start of new file
            file = {
                ...empty,
                uncovered: [],
                ignoredLines: new Set(),
                ignoredFuncs: new Set(),
                hasIgnoredLines: false,
            }; // Create new array and set for each file
            file.path = normalizePath(line.substring(3));
            file.name = path.basename(file.path);

            // Load istanbul ignore comments for this file
            const absolutePath = join(cwd, file.path);
            const [currentIgnoredLines, currentIgnoredFuncs] = getIstanbulIgnored(absolutePath);
            file.ignoredLines = currentIgnoredLines;
            file.ignoredFuncs = currentIgnoredFuncs;
            // Set ignored property for this file (entire file ignored)
            file.ignored = currentIgnoredLines.has(-1);
            // Set hasIgnoredLines if there are some (but not all) lines ignored
            file.hasIgnoredLines = !file.ignored && currentIgnoredLines.size > 0;
        } else if (line.startsWith('DA:')) {
            // Data about a line: DA:line,hitCount
            const parts = line.substring(3).split(',');
            const lineNum = Number.parseInt(parts[0] ?? '', 10);
            const hits = Number.parseInt(parts[1] ?? '', 10);

            // Skip istanbul ignored lines entirely
            if (file.ignored || file.ignoredLines.has(lineNum)) {
                continue;
            }

            file.lines++; // Count this as an executable line
            if (hits === 0) {
                file.uncovered.push(lineNum);
            } else {
                file.linesCov++; // Count as covered
            }
        } else if (line.startsWith('LF:')) {
            // Lines found - IGNORE buggy LF value, use DA count instead
            // file.lines = Number.parseInt(line.substring(3), 10);
        } else if (line.startsWith('LH:')) {
            // Lines hit - IGNORE buggy LH value, use DA hit count instead
            // file.linesCov = Number.parseInt(line.substring(3), 10);
        } else if (line.startsWith('FNF:')) {
            // Functions found - use lcov value, will handle ignored functions in display
            if (!file.ignored) {
                file.funcs = Number.parseInt(line.substring(4), 10);
            }
        } else if (line.startsWith('FNH:')) {
            // Functions hit - use lcov value directly
            if (!file.ignored) {
                file.funcsCov = Number.parseInt(line.substring(4), 10);
            }
        } else if (line.startsWith('BRF:')) {
            // Branches found - skip if file is ignored
            if (!file.ignored) {
                file.branches = Number.parseInt(line.substring(4), 10);
            }
        } else if (line.startsWith('BRH:')) {
            // Branches hit - skip if file is ignored
            if (!file.ignored) {
                file.branchesCov = Number.parseInt(line.substring(4), 10);
            }
        } else if (line === 'end_of_record') {
            // End of current file - only include files with actual lines (skip ignored files)
            if (file.lines > 0) {
                files.push(file);
            }
        }
    }

    return files;
}

/**
 * Find the next non-empty, non-comment line after the given index
 * Returns 1-indexed line number, or -1 if not found
 */
function findNextExecutableLine(lines: string[], startIdx: number): number {
    for (let i = startIdx + 1; i < lines.length; i++) {
        const trimmed = (lines[i] ?? '').trim();
        // Skip empty lines, single-line comments, and continuation of block comments
        if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*') && trimmed !== '*/') {
            return i + 1; // Return 1-indexed line number
        }
    }
    return -1;
}

/**
 * Find the end of a code block starting at the given line
 * Returns 0-indexed line index of closing brace, or -1 if not a block
 */
function findBlockEnd(lines: string[], startIdx: number): number {
    const line = (lines[startIdx] ?? '').trim();

    // Check if line indicates a block start (has opening brace or arrow function)
    // Common patterns: function foo() {, if (...) {, class Foo {, () => {, etc.
    const hasOpenBrace = line.includes('{');
    const isBlockStart = /\{|function\s|class\s|if\s*\(|for\s*\(|while\s*\(|do\s*\{|switch\s*\(|try\s*\{|=>\s*\{/.test(line);

    if (!hasOpenBrace && !isBlockStart) {
        return -1; // Not a block start
    }

    // Find matching closing brace
    let braceCount = 0;
    let foundOpen = false;

    for (let i = startIdx; i < lines.length; i++) {
        for (const char of lines[i] ?? '') {
            if (char === '{') {
                braceCount++;
                foundOpen = true;
            } else if (char === '}') {
                braceCount--;
                if (foundOpen && braceCount === 0) {
                    return i; // Return 0-indexed line index
                }
            }
        }
    }

    return -1; // No matching closing brace found
}

/**
 * Parse istanbul ignore comments and return ignored lines and function declarations
 * Supports istanbul ignore next (ignores next statement/block)
 * and istanbul ignore start/stop (ignores range)
 * Returns tuple: [ignoredLines, ignoredFunction]
 */
function getIstanbulIgnored(filePath: string): [Set<number>, Set<number>] {
    const ignoredLines = new Set<number>();
    const ignoredFuncs = new Set<number>();

    try {
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Check first 10 lines for istanbul or c8 ignore comment.
        // if found return all lines numbers of this file.
        const firstLines = lines.slice(0, 10).join('\n');
        if (/\/\*\s*(istanbul|c8)\s+ignore\s+file\b/.test(firstLines)) {
            ignoredLines.add(-1);
            return [ignoredLines, ignoredFuncs];
        }

        // Function pattern to detect function declarations and arrow functions
        // Matches: function foo(), const/let/var x = () =>, x = () =>, () =>, callbacks, etc.
        const funcPattern = /(?:function\s+\w+|\w+\s*=\s*(?:async\s*)?\(.*\)\s*=>|\(\s*.*?\s*\)\s*=>|=>\s*\{)/;

        // search for other ignore comments
        let inIgnoreBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1; // 1-indexed for coverage reports
            const line = lines[i] ?? '';

            // Check for ignore start/stop
            if (/\/\*\s*(istanbul|c8)\s+ignore\s+start\b/.test(line)) {
                inIgnoreBlock = true;
                ignoredLines.add(lineNum); // Include the start comment line itself
                continue;
            }
            if (/\/\*\s*(istanbul|c8)\s+ignore\s+(stop|end)\b/.test(line)) {
                ignoredLines.add(lineNum); // Include the stop comment line itself
                inIgnoreBlock = false;
                continue;
            }

            // If in ignore block, mark this line
            if (inIgnoreBlock) {
                ignoredLines.add(lineNum);
                // Check if this line has a function declaration
                if (funcPattern.test(line)) {
                    ignoredFuncs.add(lineNum);
                }
                continue;
            }

            // Check for ignore next
            if (/\/\*\s*(istanbul|c8)\s+ignore\s+next\b/.test(line)) {
                ignoredLines.add(lineNum); // Include the comment line itself

                // Find next non-empty, non-comment line
                const nextLineNum = findNextExecutableLine(lines, i);
                if (nextLineNum !== -1) {
                    const nextLineIdx = nextLineNum - 1; // Convert to 0-indexed

                    // Check if it's a block start
                    const blockEnd = findBlockEnd(lines, nextLineIdx);
                    if (blockEnd !== -1) {
                        // Mark entire block (from next line to closing brace, inclusive)
                        for (let j = nextLineNum; j <= blockEnd + 1; j++) {
                            ignoredLines.add(j);
                            // Check if this line has a function declaration
                            if (funcPattern.test(lines[j - 1] ?? '')) {
                                ignoredFuncs.add(j);
                            }
                        }
                    } else {
                        // Just mark the next line
                        ignoredLines.add(nextLineNum);
                        // Check if this line has a function declaration
                        if (funcPattern.test(lines[nextLineIdx] ?? '')) {
                            ignoredFuncs.add(nextLineNum);
                        }
                    }
                }
            }
        }
    } catch {
        // If file can't be read, return empty sets
    }

    return [ignoredLines, ignoredFuncs];
}

/**
 * Add entries for files not in lcov report.
 * This ensures all source files appear in the coverage report
 */
function addMissingFilesToCoverage(coverageFiles: FileCoverage[]): FileCoverage[] {
    const cwd = process.cwd();
    const coveredFiles = new Set(coverageFiles.map((f) => normalizePath(join(cwd, f.path))));

    const allSourceFiles = glob.sync(TEST_COVERAGE_INCLUDE, {
        cwd,
        absolute: true,
        ignore: TEST_COVERAGE_IGNORE,
    });

    const missingFiles: FileCoverage[] = [];
    for (const file of allSourceFiles) {
        const normalizedPath = join(cwd, normalizePath(file));
        if (coveredFiles.has(normalizedPath)) continue;

        const [ignoredLines, ignoredFuncs] = getIstanbulIgnored(normalizedPath);
        const isFullyIgnored = ignoredLines.has(-1);
        // add the missing file. and mark if it should be ignored.
        missingFiles.push({
            name: path.basename(file),
            path: normalizedPath,
            lines: 1,
            linesCov: 0,
            funcs: 0,
            funcsCov: 0,
            branches: 0,
            branchesCov: 0,
            uncovered: [1],
            ignored: isFullyIgnored,
            ignoredLines: ignoredLines,
            ignoredFuncs: ignoredFuncs,
            hasIgnoredLines: !isFullyIgnored && ignoredLines.size > 0,
        });
    }
    if (missingFiles.length > 0) {
        log(`📝 Added ${missingFiles.length} files with zero coverage to coverageFiles`);
    }
    return [...coverageFiles, ...missingFiles];
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

/** Format uncovered lines for display, using ranges for consecutive lines */
function formatUncovered(uncovered: number[]): string {
    if (uncovered.length === 0) return ''.padEnd(UNCOVERED_WIDTH);

    // Convert consecutive numbers to ranges (e.g., "196,197,198,199" -> "196-199")
    const ranges: string[] = [];
    let rangeStart = uncovered[0] as number;
    let rangeEnd = uncovered[0] as number;

    for (let i = 1; i <= uncovered.length; i++) {
        if (i < uncovered.length && uncovered[i] === rangeEnd + 1) {
            // Continue the range
            rangeEnd = uncovered[i] as number;
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
                rangeStart = uncovered[i] as number;
                rangeEnd = uncovered[i] as number;
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

    return grey`${formatted.padEnd(UNCOVERED_WIDTH)}`;
}

//
// main
//
try {
    const coveragePath = join(process.cwd(), 'coverage', 'lcov.info');

    const lcovData = readFileSync(coveragePath, 'utf-8');
    let coverageFiles = parseLcov(lcovData);
    coverageFiles = addMissingFilesToCoverage(coverageFiles);

    // Calculate overall coverage
    let totalLines = 0;
    let coveredLines = 0;
    let totalFunctions = 0;
    let coveredFunctions = 0;
    let uncoveredFiles = 0;

    // Group files by folder and calculate folder coverage
    const folders = new Map<string, FolderCoverage>();

    for (const file of coverageFiles) {
        // Skip files that match ignore patterns
        const matches = glob.sync([file.path], { ignore: TEST_COVERAGE_IGNORE });
        if (matches.length === 0) {
            continue;
        }

        const { dir } = path.parse(file.path);
        if (!folders.has(dir)) {
            folders.set(dir, {
                funcs: 0,
                funcsCov: 0,
                lines: 0,
                linesCov: 0,
                files: [],
            });
        }

        const folderData = folders.get(dir)!;
        folderData.funcs += file.funcs;
        folderData.funcsCov += file.funcsCov;
        folderData.lines += file.lines;
        folderData.linesCov += file.linesCov;

        file.uncovered = file.uncovered.sort((a, b) => a - b);
        folderData.files.push(file);

        totalLines += file.lines;
        coveredLines += file.linesCov;
        totalFunctions += file.funcs;
        coveredFunctions += file.funcsCov;
    }

    // Build output table with formatting
    const tableData: Record<string, string>[] = [];

    // Add "All files" summary first
    const allFilesLines = Math.round((coveredLines / totalLines) * 100);
    const allFilesFuncs = totalFunctions > 0 ? Math.round((coveredFunctions / totalFunctions) * 100) : 100;
    tableData.push({
        name: indentPad('All files'),
        lines: formatPercent(allFilesLines, allFilesLines < TEST_LINE_THRESH),
        funcs: totalFunctions > 0 ? formatPercent(allFilesFuncs, allFilesFuncs < TEST_FUNC_THRESH) : '-'.padStart(7),
        uncov: formatUncovered([]),
    });

    // Sort folders alphabetically
    const sortedFolders = Array.from(folders.entries()).sort(([a], [b]) => a.localeCompare(b));

    // Add each folder and its files
    for (const [folder, folderData] of sortedFolders) {
        const folderFuncsPct = folderData.funcs > 0 ? Math.round((folderData.funcsCov / folderData.funcs) * 100) : 0;
        const folderLinesPct = folderData.lines > 0 ? Math.round((folderData.linesCov / folderData.lines) * 100) : 0;
        const folderFuncsFail = folderFuncsPct < TEST_FUNC_THRESH;
        const folderLinesFail = folderLinesPct < TEST_LINE_THRESH;
        const folderFail = folderLinesFail || folderFuncsFail;

        let folderName = indentPad(`${folder}/`, 1);
        // Truncate folder name from the left until it fits FILE_WIDTH
        if (folderName.length > FILE_WIDTH) {
            const parts = folder.split('/');
            while (folderName.length > FILE_WIDTH - 5 && parts.length > 1) {
                parts.shift();
                folderName = parts.join('/');
            }
            folderName = indentPad(`.../${folderName}/`, 1);
        }
        const funcsDisplay = folderData.funcs > 0 ? formatPercent(folderFuncsPct, folderFuncsFail) : '-'.padStart(PERCENT_WIDTH);
        const linesDisplay = folderData.lines > 0 ? formatPercent(folderLinesPct, folderLinesFail) : '-'.padStart(PERCENT_WIDTH);

        tableData.push({
            name: folderFail ? red`${folderName}` : folderName,
            funcs: funcsDisplay,
            lines: linesDisplay,
            uncov: formatUncovered([]),
        });

        // Add files in this folder
        for (const file of folderData.files.sort((a, b) => a.name.localeCompare(b.name))) {
            const fileLinesPct = file.lines > 0 ? Math.round((file.linesCov / file.lines) * 100) : 0;
            const fileLinesFail = file.lines > 0 && !file.hasIgnoredLines && fileLinesPct < TEST_LINE_THRESH;
            const linesDisplay =
                file.lines > 0
                    ? formatPercent(fileLinesPct, fileLinesFail, file.ignored || file.hasIgnoredLines)
                    : '    -'.padStart(PERCENT_WIDTH);

            const fileFuncsPct = file.funcs > 0 ? Math.round((file.funcsCov / file.funcs) * 100) : 0;
            const hasIgnoredFuncs = file.ignoredFuncs.size > 0;
            const fileFuncsFail = file.funcs > 0 && !hasIgnoredFuncs && fileFuncsPct < TEST_FUNC_THRESH;
            const funcsDisplay = formatPercent(fileFuncsPct, fileFuncsFail, file.ignored || hasIgnoredFuncs);

            let fileDisplay = `   ${file.name.substring(0, FILE_WIDTH - 3)}`.padEnd(FILE_WIDTH);
            fileDisplay =
                fileFuncsFail || fileLinesFail
                    ? red`${fileDisplay.replace(' ', '•')}`
                    : green`·` + grey`${fileDisplay.substring(1)}`;

            tableData.push({
                name: fileDisplay,
                lines: linesDisplay,
                funcs: funcsDisplay,
                uncov: formatUncovered(file.uncovered),
            });

            uncoveredFiles += fileFuncsFail || fileLinesFail ? 1 : 0;
        }
    }

    // Print custom table (console.table escapes ANSI codes, so we build manually)
    log('Coverage Report:');
    log('┌─────────────────────────────────────┬─────────┬─────────┬────────────────────────────────┐');
    log('│ File                                │ % Lines │ % Funcs │ Uncovered Line #s              │');
    log('├─────────────────────────────────────┼─────────┼─────────┼────────────────────────────────┤');

    for (const row of tableData) {
        log(`│ ${row['name']} │ ${row['lines']} │ ${row['funcs']} │ ${row['uncov']} │`);
    }

    log('└─────────────────────────────────────┴─────────┴─────────┴────────────────────────────────┘');

    // Check thresholds and exit
    if (uncoveredFiles) {
        error(red`✗ ${uncoveredFiles} files are below coverage thresholds`);
        process.exit(1);
    } else {
        log(green`✓ All files meet thresholds`);
        process.exit(0);
    }
} catch (err) {
    error('Error reading coverage data:', new ErrorEx(err));
    error('Run "bun test" first to generate coverage data');
    process.exit(1);
}
