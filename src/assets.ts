/**
 * URL for a file under `public/`. Resolves against Vite's base, so the same
 * code works on the dev server at `/` and in a build served from a subpath.
 */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
