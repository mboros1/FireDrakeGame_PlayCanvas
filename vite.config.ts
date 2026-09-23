import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** The commit a build came from, shown on the cover so stale caches are obvious. */
const version = (() => {
  try {
    return execSync('git describe --always --dirty', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
})();

// Relative base so the build runs from any subpath — itch.io serves HTML
// games from a per-upload folder on its CDN, not from a domain root.
export default defineConfig({
  base: './',
  define: { __BUILD_VERSION__: JSON.stringify(version) }
});
