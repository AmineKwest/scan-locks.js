#!/usr/bin/env node
/**
 * scan-locks.js
 * Recursively search for package-lock.json, yarn.lock (Yarn v1), and package.json
 * and report occurrences of specific packages (Markdown table).
 */

const fs = require('fs');
const path = require('path');

const TARGETS = new Set([
  'eslint-config-prettier',
  'eslint-plugin-prettier',
  'synckit',
  '@pkgr/core',
  'napi-postinstall',
  'got-fetch',
  'is',
]);

// 👉 List of directories to scan (relative or absolute paths)
const ROOTS = [
  'src',
  // add more paths here
];

const LOCK_FILENAMES = ['package-lock.json', 'package.lock.json', 'yarn.lock', 'package.json'];

async function main() {
  const files = [];
  for (const root of ROOTS) {
    const abs = path.resolve(root);
    if (!fs.existsSync(abs)) {
      console.error(`Path not found: ${abs}`);
      continue;
    }
    await collectFiles(abs, files);
  }

  const rows = [];
  for (const filePath of files) {
    try {
      if (filePath.endsWith('package-lock.json') || filePath.endsWith('package.lock.json')) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(raw);
        rows.push(...extractFromNpmLock(json, filePath));
      } else if (filePath.endsWith('yarn.lock')) {
        const raw = fs.readFileSync(filePath, 'utf8');
        rows.push(...extractFromYarnLockV1(raw, filePath));
      } else if (filePath.endsWith('package.json')) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(raw);
        rows.push(...extractFromPackageJson(json, filePath));
      }
    } catch (e) {
      console.error(`Skipped read/parse: ${filePath} -> ${e.message}`);
      // Continue, don't stop scanning because of one file
    }
  }

  // Sort by package name then file path
  rows.sort((a, b) =>
    a.package === b.package
      ? a.lockfilePath.localeCompare(b.lockfilePath)
      : a.package.localeCompare(b.package)
  );

  printMarkdownTable(dedupeRows(rows));
}

/**
 * Recursive directory scan with some heavy directories excluded.
 */
async function collectFiles(dir, out) {
  const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.turbo', '.cache']);
  let dirents;
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const de of dirents) {
    const full = path.join(dir, de.name);

    if (de.isDirectory()) {
      if (SKIP_DIRS.has(de.name)) continue;
      await collectFiles(full, out);
    } else if (de.isFile()) {
      if (LOCK_FILENAMES.includes(de.name)) {
        out.push(full);
      }
    }
  }
}

/**
 * npm v2/v3: { packages: { "node_modules/name": { version, dev, optional } } }
 * npm v1: { dependencies: { name: { version, dev, optional, dependencies } } }
 */
function extractFromNpmLock(lockJson, lockfilePath) {
  const results = [];

  // npm v2/v3
  if (lockJson && lockJson.packages && typeof lockJson.packages === 'object') {
    for (const pkgPath of Object.keys(lockJson.packages)) {
      const info = lockJson.packages[pkgPath] || {};
      let name = info.name;
      if (!name) {
        const segs = pkgPath.split('node_modules/').filter(Boolean);
        if (segs.length > 0) name = segs[segs.length - 1].replace(/\/$/, '');
      }
      if (name && TARGETS.has(name)) {
        results.push({
          package: name,
          version: info.version || '',
          dev: info.dev === true,
          optional: info.optional === true,
          source: 'npm-lock',
          lockfilePath,
        });
      }
    }
  }

  // npm v1 (fallback)
  if (lockJson && lockJson.dependencies && typeof lockJson.dependencies === 'object') {
    const stack = [lockJson.dependencies];
    while (stack.length) {
      const deps = stack.pop();
      for (const [name, meta] of Object.entries(deps)) {
        if (!meta) continue;
        if (TARGETS.has(name)) {
          results.push({
            package: name,
            version: meta.version || '',
            dev: meta.dev === true,
            optional: meta.optional === true,
            source: 'npm-lock',
            lockfilePath,
          });
        }
        if (meta.dependencies) stack.push(meta.dependencies);
      }
    }
  }

  return results;
}

/**
 * Minimal parser for Yarn v1 lockfile.
 * Assumptions:
 *  - Blocks are separated by blank lines.
 *  - First line: "name@range:" (can have multiple selectors separated by ", ")
 *  - Version line:   version "x.y.z"
 *
 * ⚠️ Yarn Berry (v2/v3) uses YAML — not supported here.
 */
function extractFromYarnLockV1(text, lockfilePath) {
  const results = [];
  const blocks = text.split(/\n{2,}/);

  for (const blockRaw of blocks) {
    const block = blockRaw.trim();
    if (!block) continue;
    const lines = block.split('\n').map(l => l.trim());
    const header = lines[0];
    if (!header || header.startsWith('#')) continue; // comment or empty

    // Example header:
    // "eslint-config-prettier@^8.8.0":  (quoted or not)
    // eslint-config-prettier@^8.8.0:
    const headerSelectors = header
      .replace(/^"/, '')
      .replace(/":?$/, ':') // normalize line end
      .replace(/:$/, '')
      .split(/,\s*/);

    // Look for version line
    const versionLine = lines.find(l => l.startsWith('version '));
    const versionMatch = versionLine ? versionLine.match(/^version\s+"([^"]+)"/) : null;
    const version = versionMatch ? versionMatch[1] : '';

    for (const sel of headerSelectors) {
      const name = selectorToPkgName(sel);
      if (!name) continue;
      if (TARGETS.has(name)) {
        results.push({
          package: name,
          version,
          dev: false,       // dev/optional info not explicit in yarn.lock v1
          optional: false,
          source: 'yarn-lock',
          lockfilePath,
        });
      }
    }
  }
  return results;
}

/**
 * Convert a Yarn selector like:
 *   @scope/name@^1.2.3  -> @scope/name
 *   is@^3.0.0           -> is
 *   "eslint@>=7"        -> eslint
 */
function selectorToPkgName(selector) {
  const s = selector.replace(/^"+|"+$/g, ''); // remove possible quotes
  // Name = everything before the LAST '@'
  const at = s.lastIndexOf('@');
  if (at <= 0) return null; // no '@' or '@' at first position -> invalid
  return s.slice(0, at);
}

/**
 * package.json — just read declared dependencies (not locked versions).
 */
function extractFromPackageJson(pkgJson, lockfilePath) {
  const results = [];
  const buckets = [
    ['dependencies', false, false],
    ['devDependencies', true, false],
    ['optionalDependencies', false, true],
  ];

  for (const [field, isDev, isOpt] of buckets) {
    const deps = pkgJson?.[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps)) {
      if (TARGETS.has(name)) {
        results.push({
          package: name,
          version: String(range || ''), // this is a declared range (ex: ^8.8.0)
          dev: !!isDev,
          optional: !!isOpt,
          source: 'package-json',
          lockfilePath,
        });
      }
    }
  }
  return results;
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.lockfilePath}::${r.package}::${r.version}::${r.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function printMarkdownTable(rows) {
  if (!rows.length) {
    console.log('No occurrences found.');
    return;
  }
  console.log('| Package | Version | Dev | Optional | Source | File |');
  console.log('|---|---|:---:|:---:|---|---|');
  for (const r of rows) {
    console.log(
      `| \`${r.package}\` | \`${r.version}\` | ${r.dev ? '✔' : ''} | ${r.optional ? '✔' : ''} | ${r.source} | \`${shortenPath(r.lockfilePath)}\` |`
    );
  }
}

function shortenPath(p) {
  const cwd = process.cwd() + path.sep;
  return p.startsWith(cwd) ? p.slice(cwd.length) : p;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
