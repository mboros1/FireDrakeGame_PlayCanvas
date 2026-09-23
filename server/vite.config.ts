import { defineConfig } from 'vite';

// Bundle the room server into one Node ES module. `ws` stays external and is
// installed in the image; everything else (the simulation, the protocol) is
// inlined, so the server runs exactly the code the client ships.
export default defineConfig({
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true
  },
  ssr: { external: ['ws'] }
});
