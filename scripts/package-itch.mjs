/**
 * Package a browser build for itch.io.
 *
 *   npm run package:itch   →  release/fire-drake-itch.zip
 *
 * Builds with Vite, then stages only the runtime files the game loads.
 * `public/assets/` also holds source textures, unused animation clips and the
 * archived Unreal forest (~70 MB); none of that ships. The drake model is a
 * Fab purchase licensed for use in the game, so it goes out inside the build
 * and nowhere else: this zip, never the public repository.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const stage = join(root, 'release', 'itch');
const zip = join(root, 'release', 'fire-drake-itch.zip');

/** Everything under public/assets that the game fetches at runtime. */
const RUNTIME_ASSETS = [
  'assets/wyvern/wyvern.glb',
  'assets/wyvern/wyvern_base.webp',
  'assets/wyvern/wyvern_emissive.webp',
  'assets/wyvern/wyvern_normal.webp',
  'assets/wyvern/idle.glb',
  'assets/wyvern/walk.glb'
];

for (const file of RUNTIME_ASSETS) {
  if (!existsSync(join(root, 'public', file))) {
    console.error(`Missing ${file}. The drake is not in the repository; copy your Fab export into public/assets/wyvern/.`);
    process.exit(1);
  }
}

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
// Vite copies all of public/ into dist; take the app and leave assets behind.
for (const entry of readdirSync(dist)) {
  if (entry === 'assets') continue;
  cpSync(join(dist, entry), join(stage, entry), { recursive: true });
}
// dist/assets mixes Vite's hashed bundles with the copied public assets.
for (const entry of readdirSync(join(dist, 'assets'))) {
  const path = join(dist, 'assets', entry);
  if (statSync(path).isFile()) cpSync(path, join(stage, 'assets', entry));
}
for (const file of RUNTIME_ASSETS) cpSync(join(root, 'public', file), join(stage, file));

rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: stage, stdio: 'inherit' });
const bytes = statSync(zip).size;
console.log(`Wrote ${zip} (${(bytes / 1048576).toFixed(1)} MB). Upload it as an HTML project on itch.io.`);
