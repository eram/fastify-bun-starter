#!/usr/bin/env bun
/**
 * Check code coverage against minimum threshold
 * Reads lcov.info and validates against 80% threshold
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { red } from '../src/util/shell';

// COVERAGE_THRESHOLD
const THRESH = 80;

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
		funcs: number;
		funcsCov: number;
		lines: number;
		linesCov: number;
		uncovered: number[];
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

/**
 * Format uncovered lines for display
 */
function formatUncovered(uncovered: number[]): string {
	if (uncovered.length === 0) return ''.padEnd(20);

	const formatted = uncovered.length <= 3
		? uncovered.join(',')
		: `${uncovered.slice(0, 3).join(',')}...+${uncovered.length - 3}`;

	return formatted.padEnd(20);
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
		totalLines += fileCov.lines;
		coveredLines += fileCov.linesCov;
		totalFunctions += fileCov.funcs;
		coveredFunctions += fileCov.funcsCov;

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
			funcs: fileCov.funcs,
			funcsCov: fileCov.funcsCov,
			lines: fileCov.lines,
			linesCov: fileCov.linesCov,
			uncovered: fileCov.uncovered.sort((a, b) => a - b),
		});
	}

	const lineCoverage = (coveredLines / totalLines) * 100;
	const functionCoverage = (coveredFunctions / totalFunctions) * 100;

	// Build table data as object with keys (File column becomes the key)
	const tableData: Record<string, Record<string, string>> = {};
	const FILE_WIDTH = 25; // Fixed width for file column to ensure left alignment

	// Add "All files" summary first
	const allFilesFuncs = Math.round(functionCoverage);
	const allFilesLines = Math.round(lineCoverage);
	const allFilesFail = allFilesFuncs < THRESH || allFilesLines < THRESH;

	tableData['All files'.padEnd(FILE_WIDTH)] = {
		'% Funcs': allFilesFail ? red(allFilesFuncs.toString().padStart(7)) : allFilesFuncs.toString().padStart(7),
		'% Lines': allFilesFail ? red(allFilesLines.toString().padStart(7)) : allFilesLines.toString().padStart(7),
		'Uncovered Line #s': '',
	};

	// Sort folders alphabetically
	const sortedFolders = Array.from(folders.entries()).sort(([a], [b]) => a.localeCompare(b));

	// Add each folder and its files
	for (const [folder, folderData] of sortedFolders) {
		const folderFuncsPct = Math.round((folderData.funcsCov / folderData.funcs) * 100);
		const folderLinesPct = Math.round((folderData.linesCov / folderData.lines) * 100);
		const folderUncovered = formatUncovered(folderData.uncovered.sort((a, b) => a - b));

		const folderLinesFail = folderLinesPct < THRESH;
		const folderFuncsFail = folderFuncsPct < THRESH;
		const folderFail = folderLinesFail || folderFuncsFail;

		const folderName = ` ${folder}`.padEnd(FILE_WIDTH);
		tableData[folderFail ? red(folderName) : folderName] = {
			'% Funcs': folderFuncsFail
				? red(folderFuncsPct.toString().padStart(7))
				: folderFuncsPct.toString().padStart(7),
			'% Lines': folderLinesFail
				? red(folderLinesPct.toString().padStart(7))
				: folderLinesPct.toString().padStart(7),
			'Uncovered Line #s': folderUncovered,
		};

		// Add files in this folder
		for (const file of folderData.files.sort((a, b) => a.name.localeCompare(b.name))) {
			const fileFuncsPct = file.funcs > 0 ? Math.round((file.funcsCov / file.funcs) * 100) : 100;
			const fileLinesPct = file.lines > 0 ? Math.round((file.linesCov / file.lines) * 100) : 100;
			const fileUncovered = formatUncovered(file.uncovered);

			const fileLinesFail = fileLinesPct < THRESH;
			const fileFuncsFail = fileFuncsPct < THRESH;
			const fileFail = fileLinesFail || fileFuncsFail;

			const fileName = `   ${file.name}`.padEnd(FILE_WIDTH);
			tableData[fileFail ? red(fileName) : fileName] = {
				'% Funcs': fileFuncsFail
					? red(fileFuncsPct.toString().padStart(7))
					: fileFuncsPct.toString().padStart(7),
				'% Lines': fileLinesFail
					? red(fileLinesPct.toString().padStart(7))
					: fileLinesPct.toString().padStart(7),
				'Uncovered Line #s': fileUncovered,
			};
		}
	}

	// Print table using object (keys become File column with proper alignment)
	console.log('📊 Coverage Report:');
	console.table(tableData);

	// Check thresholds and exit
	if (lineCoverage < THRESH || functionCoverage < THRESH) {
		if (lineCoverage < THRESH) {
			console.error(red(`❌ Line coverage ${Math.round(lineCoverage)} is below threshold ${THRESH}`));
		}
		if (functionCoverage < THRESH) {
			console.error(
				red(`❌ Function coverage ${Math.round(functionCoverage)} is below threshold ${THRESH}`),
			);
		}
		process.exit(1);
	}

	console.log(`✅ Coverage meets threshold of ${THRESH}%\n`);
	process.exit(0);
} catch (error) {
	console.error('Error reading coverage data:', error);
	console.error('Run "bun test" first to generate coverage data');
	process.exit(1);
}
