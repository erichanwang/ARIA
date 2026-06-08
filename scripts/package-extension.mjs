#!/usr/bin/env node
/**
 * Builds ARIA and packages the dist/ folder into a versioned zip file
 * suitable for Chrome Web Store upload.
 *
 * Usage: node scripts/package-extension.mjs
 * Output: extension-aria-v0.1.0.zip (version read from package.json)
 */
import { execSync } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const __dirname = new URL('.', import.meta.url).pathname;
const root = resolve(__dirname, '..');

// Read version from package.json.
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = pkg.version ?? '0.0.0';
const outFile = resolve(root, `extension-aria-v${version}.zip`);

console.log('Building…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

console.log(`Packaging → ${outFile}`);

// Dynamically import yazl (pure-JS zip). Fall back to zip CLI if unavailable.
let zipped = false;
try {
  const { ZipFile } = await import('yazl');
  const zipfile = new ZipFile();
  const dist = resolve(root, 'dist');

  function addDir(dir) {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      const rel = relative(dist, full);
      if (statSync(full).isDirectory()) {
        addDir(full);
      } else {
        zipfile.addFile(full, rel);
      }
    }
  }
  addDir(dist);
  zipfile.end();
  await new Promise((resolve, reject) => {
    zipfile.outputStream.pipe(createWriteStream(outFile))
      .on('finish', resolve)
      .on('error', reject);
  });
  zipped = true;
} catch {
  // yazl not installed - fall back to system zip.
}

if (!zipped) {
  try {
    execSync(`cd "${root}/dist" && zip -r "${outFile}" .`, { stdio: 'inherit' });
    zipped = true;
  } catch {
    console.error('zip command not found. Install yazl (npm i -D yazl) or zip CLI.');
    process.exit(1);
  }
}

console.log(`Done: extension-aria-v${version}.zip`);
