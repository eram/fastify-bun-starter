#!/usr/bin/env bun
/**
 * Check code coverage against minimum threshold
 * Reads lcov.info and validates against 80% threshold
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { red, yellow } from '../src/util/shell';

// Console shortcuts
const { log, error } = console;

// Configuration
const THRESH = 80; // Coverage threshold percentage
const FILE_WIDTH = 30; // File name column width
const UNCOVERED_WIDTH = 30; // Uncovered line numbers column width
const PERCENT_WIDTH = 7; // Percentage column width

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
        path: string; // Full relative path (stored but not displayed)
        funcs: number;
        funcsCov: number;
        lines: number;
        linesCov: number;
        uncovered: number[];
        ignored: boolean; // Has Istanbul ignore comment
    }>;
}

/**
 * Parse lcov.info file format
 * Note: Bun's coverage config in bunfig.toml already filters out files via
 * coverageSkipTestFiles and coveragePathIgnorePatterns, so no need to filter here
 */
function parseLcov(lcovData: string): Coverage[] {
    const files: Coverage[] = [];
    const lines = lcovData.split('\n');
    let file: Partial<Coverage> = {};
    const uncovered: number[] = [];

    for (const line of lines) {
        if (line.startsWith('SF:')) {
            // Start of new file
            file = { file: line.substring(3), uncovered: [] };
        } else if (line.startsWith('DA:')) {
            // Data about a line: DA:line,hitCount
            const parts = line.substring(3).split(',');
            const lineNum = Number.parseInt(parts[0], 10);
            const hits = Number.parseInt(parts[1], 10);
            if (hits === 0) {
                uncovered.push(lineNum);
            }
        } else if (line.startsWith('LF:')) {
            // Lines found
            file.lines = Number.parseInt(line.substring(3), 10);
        } else if (line.startsWith('LH:')) {
            // Lines hit
            file.linesCov = Number.parseInt(line.substring(3), 10);
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
                    lines: file.lines ?? 0,
                    linesCov: file.linesCov ?? 0,
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
function formatName(name: string, indent: number = 0): string {
    const indentedName = ' '.repeat(indent) + name;
    return indentedName.padEnd(FILE_WIDTH);
}

/** Format percentage value with color based on status */
function formatPercent(value: number, isFailing: boolean, isIgnored: boolean = false): string {
    const formatted = value.toString().padStart(PERCENT_WIDTH);
    if (isIgnored) return yellow`${formatted}`;
    return isFailing ? red`${formatted}` : formatted;
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
        // Check if file has Istanbul ignore comment
        const hasIgnore = hasIstanbulIgnore(fileCov.file);

        // Only count files without Istanbul ignore in overall coverage
        if (!hasIgnore) {
            totalLines += fileCov.lines;
            coveredLines += fileCov.linesCov;
            totalFunctions += fileCov.funcs;
            coveredFunctions += fileCov.funcsCov;
        }

        // Normalize path
        let displayPath = fileCov.file.replace(process.cwd(), '').replace(/\\/g, '/');
        displayPath = displayPath.replace(/^[/\\]+/, '');

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
    const allFilesFuncsFail = allFilesFuncs < THRESH;
    const allFilesLinesFail = allFilesLines < THRESH;

    tableData[formatName('All files')] = {
        funcs: formatPercent(allFilesFuncs, allFilesFuncsFail),
        lines: formatPercent(allFilesLines, allFilesLinesFail),
        uncov: formatUncovered([]),
    };

    // Sort folders alphabetically
    const sortedFolders = Array.from(folders.entries()).sort(([a], [b]) => a.localeCompare(b));

    // Add each folder and its files
    for (const [folder, folderData] of sortedFolders) {
        const folderFuncsPct = Math.round((folderData.funcsCov / folderData.funcs) * 100);
        const folderLinesPct = Math.round((folderData.linesCov / folderData.lines) * 100);
        const folderFuncsFail = folderFuncsPct < THRESH;
        const folderLinesFail = folderLinesPct < THRESH;
        const folderFail = folderLinesFail || folderFuncsFail;

        const folderName = formatName(folder, 1);
        tableData[folderFail ? red`${folderName}` : folderName] = {
            funcs: formatPercent(folderFuncsPct, folderFuncsFail),
            lines: formatPercent(folderLinesPct, folderLinesFail),
            uncov: formatUncovered(folderData.uncovered.sort((a, b) => a - b)),
        };

        // Add files in this folder
        for (const file of folderData.files.sort((a, b) => a.name.localeCompare(b.name))) {
            const fileFuncsPct = file.funcs > 0 ? Math.round((file.funcsCov / file.funcs) * 100) : 100;
            const fileLinesPct = file.lines > 0 ? Math.round((file.linesCov / file.lines) * 100) : 100;
            const fileFuncsFail = fileFuncsPct < THRESH;
            const fileLinesFail = fileLinesPct < THRESH;
            // Files with Istanbul ignore don't fail the build
            const fileFail = !file.ignored && (fileLinesFail || fileFuncsFail);

            // Show filename only (not clickable, but clean display)
            // Ignored files: white name, yellow percentages
            // Failing files: red name and percentages
            const indent = '   '; // 3 spaces for file indentation
            const displayName = fileFail ? red`${file.name}` : file.name;
            const clickableFile = indent + displayName;

            tableData[clickableFile] = {
                funcs: formatPercent(fileFuncsPct, fileFuncsFail, file.ignored),
                lines: formatPercent(fileLinesPct, fileLinesFail, file.ignored),
                uncov: formatUncovered(file.uncovered),
            };
        }
    }

    // Print custom table (console.table escapes ANSI codes, so we build manually)
    log('📊 Coverage Report:');
    log('┌────────────────────────────────┬─────────┬─────────┬────────────────────────────────┐');
    log('│ File                           │ % Funcs │ % Lines │ Uncovered Line #s              │');
    log('├────────────────────────────────┼─────────┼─────────┼────────────────────────────────┤');

    for (const [filename, data] of Object.entries(tableData)) {
        // Calculate visible length (excluding ANSI codes) for proper padding
        // biome-ignore lint/suspicious/noControlCharactersInRegex: need to strip ANSI escape codes for length calculation
        const visibleLength = filename.replace(/\x1b\[[0-9;]*m/g, '').length;
        const paddedFilename = filename + ' '.repeat(Math.max(0, FILE_WIDTH - visibleLength));

        log(`│ ${paddedFilename} │ ${data.funcs} │ ${data.lines} │ ${data.uncov} │`);
    }

    log('└────────────────────────────────┴─────────┴─────────┴────────────────────────────────┘');

    // Check thresholds and exit
    if (lineCoverage < THRESH || functionCoverage < THRESH) {
        if (lineCoverage < THRESH) {
            error(red`❌ Line coverage ${Math.round(lineCoverage)} is below threshold ${THRESH}`);
        }
        if (functionCoverage < THRESH) {
            error(red`❌ Function coverage ${Math.round(functionCoverage)} is below threshold ${THRESH}`);
        }
        process.exit(1);
    }

    log(`✅ Coverage meets threshold of ${THRESH}%\n`);
    process.exit(0);
} catch (err) {
    error('Error reading coverage data:', err);
    error('Run "bun test" first to generate coverage data');
    process.exit(1);
}
