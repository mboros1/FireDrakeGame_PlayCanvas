import { defineConfig } from 'vite';

// Relative base so the build runs from any subpath — itch.io serves HTML
// games from a per-upload folder on its CDN, not from a domain root.
export default defineConfig({
  base: './'
});
