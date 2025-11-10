// script/release.ts
// Usage: bun run script/release.ts [patch|minor|major|ci]
//   ci >> takes current tag and adds timestamp; does not tag the repo.
//   no-params >> auto-detect bump type based on commits since last tag
//   minor|major|patch >> explicit version bump type
// Bumps version using npm version, tags git, and appends to CHANGELOG.md

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = console.log;
const error = (msg: string): never => {
    console.error(msg);
    process.exit(1);
};

const now = new Date().toISOString();

let oldVersion: string;
let newVersion: string;

try {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const changelogPath = path.resolve(__dirname, '../CHANGELOG.md');

    // Determine bump type
    type BumpType = 'patch' | 'minor' | 'major' | 'ci' | undefined;
    let bumpType = process.argv[2] as BumpType;
    if (![undefined, 'patch', 'minor', 'major', 'ci'].includes(bumpType)) {
        error('Usage: bun run script/release.ts [patch|minor|major|ci]');
    }

    // Get all clean semver tags and pick the latest (cross-platform)
    const tagListRaw = execSync('git tag --list "v[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname').toString();
    const tagList = tagListRaw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    const lastTag = tagList.length > 0 ? tagList[0] : '';
    oldVersion = lastTag.startsWith('v') ? lastTag.slice(1) : lastTag;
    if (!oldVersion) error('Could not get latest tag.');

    if (!bumpType) {
        // Get commits since last clean tag
        const commitRange = lastTag ? `${lastTag}..HEAD` : '';
        const commitLog = execSync(`git log ${commitRange} --pretty=format:%s----%b----END`).toString();
        const commits = commitLog
            .split('----END')
            .map((s) => s.trim())
            .filter(Boolean);
        let hasFeat = false;
        for (const entry of commits) {
            const [subject, body] = entry.split('----');
            if (body?.includes('BREAKING CHANGE')) {
                error('BREAKING CHANGE detected. Please run the release script with "major" as a parameter to confirm.');
            }
            if (subject?.trim().startsWith('feat')) {
                hasFeat = true;
            }
        }

        bumpType = hasFeat ? 'minor' : ('patch' as BumpType);
    }

    const nonRelease = bumpType === 'ci';

    if (nonRelease) {
        newVersion = `${oldVersion}-ci-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    } else {
        // Use npm version to bump package.json, create commit and tag
        execSync(`npm version ${bumpType} -m "chore: release v%s"`);
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        newVersion = pkg.version;
    }

    const tagName = `v${newVersion}`;
    log(`Bumping version: ${nonRelease ? 'ci' : bumpType} ${oldVersion} -> ${newVersion}`);

    // Build change log: one line per commit since last tag, with hash, time, and description
    const commitRange = lastTag ? `${lastTag}..HEAD` : 'HEAD';
    const commitLogRaw = execSync(`git log ${commitRange} --pretty=format:"%h|%ad|%s" --date=iso`).toString().trim();

    let commitLines = '';
    if (commitLogRaw) {
        commitLines = commitLogRaw
            .split(/\r?\n/)
            .map((line) => {
                const parts = line.split('|');
                if (parts.length < 3) return null;
                const hash = parts[0];
                const date = parts[1];
                const desc = parts.slice(2).join('|').trim();
                return hash && date && desc ? `- ${hash} ${date} ${desc}` : null;
            })
            .filter(Boolean)
            .join('\n');
    }

    // Ensure CHANGELOG.md exists
    if (!fs.existsSync(changelogPath)) {
        fs.writeFileSync(changelogPath, '# Changelog\n\n');
    }

    const changelogEntry = commitLines
        ? `\n## ${newVersion} - ${now}\n${commitLines}\n`
        : `\n## ${newVersion} - ${now}\n(No commits since last release)\n`;

    fs.appendFileSync(changelogPath, changelogEntry);

    log(`CHANGELOG.md updated with ${commitLines.split('\n').length} commits.`);

    // Amend the npm version commit to include CHANGELOG.md and push (only if not CI)
    if (!nonRelease) {
        execSync(`git add CHANGELOG.md`);
        execSync(`git commit --amend --no-edit`);
        execSync(`git push origin master`);
        execSync(`git push origin ${tagName}`);
        log(`Git tag ${tagName} created and pushed.`);
    } else {
        log(`CI build - no git tag created.`);
    }

    // Output new version for Docker build (do not write to package.json)
    log(`Bumped version: ${oldVersion} -> ${newVersion}`);
} catch (e) {
    const err = e as Error;
    error(err.message);
}
