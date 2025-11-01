#!/usr/bin/env node

/**
 * Create script for scaffolding new Fastify + Bun projects
 * This script can be used as:
 * - node script/create.js [project-name]
 * - npx create-fastify-bun-starter [project-name]
 */

import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { promisify, styleText } from 'node:util';

const execAsync = promisify(exec);

const REPO_URL = 'https://github.com/eram/fastify-bun-starter.git';

// Color helpers using styleText
function success(...args) {
    console.log(styleText('green', args.join(' ')));
}

function error(...args) {
    console.error(styleText('red', args.join(' ')));
}

function info(...args) {
    console.log(styleText('cyan', args.join(' ')));
}

function warning(...args) {
    console.log(styleText('yellow', args.join(' ')));
}

function dim(...args) {
    console.log(styleText('gray', args.join(' ')));
}

/**
 * Prompt user for input with a default value
 */
async function prompt(question, defaultValue = '') {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const displayDefault = defaultValue ? styleText('gray', `(${defaultValue})`) : '';
    const questionText = `${question} ${displayDefault}: `;

    return new Promise((resolve) => {
        rl.question(questionText, (answer) => {
            rl.close();
            resolve(answer.trim() || defaultValue);
        });
    });
}

/**
 * Check if directory exists and is not empty
 */
function isDirectoryEmpty(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return true;
    }
    const files = fs.readdirSync(dirPath);
    return files.length === 0;
}

async function main() {
    console.log('');
    info('='.repeat(60));
    info('  Fastify + Bun Starter - Project Scaffolding Tool');
    info('='.repeat(60));
    console.log('');

    // Get project name from command line or prompt
    const args = process.argv.slice(2);
    let projectName = args[0];

    if (!projectName) {
        projectName = await prompt('Project name', 'my-fastify-app');
    }

    const targetDir = path.resolve(process.cwd(), projectName);

    // Check if directory exists and is not empty
    if (!isDirectoryEmpty(targetDir)) {
        error('Error: Target directory exists and is not empty.');
        error(`Please choose a different name or remove the directory: ${targetDir}`);
        process.exit(1);
    }

    // Prompt for project metadata
    console.log('');
    dim('Configure your project (press Enter to use defaults):');
    console.log('');

    const version = await prompt('Version', '0.1.0');
    const description = await prompt('Description', 'A Fastify + Bun application');
    const author = await prompt('Author', '');
    const license = await prompt('License', 'Apache-2.0');

    console.log('');
    info('Creating project with the following settings:');
    console.log(`  Name:        ${projectName}`);
    console.log(`  Version:     ${version}`);
    console.log(`  Description: ${description}`);
    console.log(`  Author:      ${author || '(none)'}`);
    console.log(`  License:     ${license}`);
    console.log('');

    try {
        // Clone the template repository
        info('Cloning template from GitHub...');
        await execAsync(`git clone --depth 1 ${REPO_URL} "${targetDir}"`, {
            stdio: 'inherit',
        });
        dim('  Template cloned successfully');

        // Remove .git directory
        info('Cleaning up template metadata...');
        const gitDir = path.join(targetDir, '.git');
        if (fs.existsSync(gitDir)) {
            fs.rmSync(gitDir, { recursive: true, force: true });
        }
        dim('  Removed .git directory');

        // Update package.json with user's configuration
        info('Configuring package.json...');
        const packageJsonPath = path.join(targetDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            packageJson.name = projectName;
            packageJson.version = version;
            packageJson.description = description;
            if (author) {
                packageJson.author = author;
            }
            packageJson.license = license;

            // Remove template repository information
            delete packageJson.repository;
            delete packageJson.bugs;
            delete packageJson.homepage;

            // Remove the bin and files fields (not needed in cloned projects)
            delete packageJson.bin;
            delete packageJson.files;

            fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
        }
        dim('  Updated package.json with your settings');

        // Update LICENSE file if needed
        if (license !== 'Apache-2.0') {
            const licensePath = path.join(targetDir, 'LICENSE');
            if (fs.existsSync(licensePath)) {
                fs.unlinkSync(licensePath);
                dim(`  Removed Apache-2.0 LICENSE file (you selected ${license})`);
            }
        }

        // Success message
        console.log('');
        success('='.repeat(60));
        success(`  Project created successfully: ${projectName}`);
        success('='.repeat(60));
        console.log('');

        info('Next steps:');
        console.log('');
        console.log(`  ${styleText('cyan', 'cd')} ${projectName}`);
        console.log(`  ${styleText('cyan', 'bun install')}`);
        console.log(`  ${styleText('cyan', 'bun run dev')}`);
        console.log('');

        dim('Documentation:');
        console.log('  https://github.com/eram/fastify-bun-starter#readme');
        console.log('');

        success('Happy coding!');
        console.log('');
    } catch (err) {
        console.log('');
        error('Error creating project:');
        error(err.message);

        // Clean up on failure
        if (fs.existsSync(targetDir)) {
            warning('Cleaning up failed installation...');
            try {
                fs.rmSync(targetDir, { recursive: true, force: true });
                dim('  Removed incomplete project directory');
            } catch (_cleanupErr) {
                warning('  Could not remove directory automatically');
                warning(`  Please remove manually: ${targetDir}`);
            }
        }

        console.log('');
        process.exit(1);
    }
}

main().catch((err) => {
    console.log('');
    error('Unexpected error:');
    error(err.message);
    console.log('');
    process.exit(1);
});
