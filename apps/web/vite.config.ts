import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Page-view counting, injected into every entry rather than pasted into five HTML files.
 *
 * GoatCounter: no cookies, no cross-site identifiers, nothing to consent to. One line of config in
 * one place is also the only way five pages stay in step -- a sixth app gets counted by existing.
 *
 * Build-only, so the dev server never reports. `vite preview` serves the built files and therefore
 * does carry the tag, but count.js declines to send from localhost, so screenshot runs against the
 * preview server do not show up as traffic either.
 */
function goatcounter(): Plugin {
  return {
    name: 'mc4d-goatcounter',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'script',
        attrs: {
          'data-goatcounter': 'https://theoryandpractice.goatcounter.com/count',
          async: true,
          src: '//gc.zgo.at/count.js',
        },
        injectTo: 'body',
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), goatcounter()],
  // Served from a project page on GitHub Pages, so assets resolve relative to the deploy path.
  base: process.env.MC4D_BASE ?? '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    // A multi-page build rather than one app per deployment. The point is the shared chunk: every
    // app here pulls in Three.js and React, and Rollup emits those once for all entries, so a
    // second front-end costs its own layout and nothing more. See docs/multi-app.md.
    rollupOptions: {
      input: {
        landing: entry('index.html'),
        classic: entry('classic/index.html'),
        gallery: entry('gallery/index.html'),
        multi: entry('multi/index.html'),
        cube: entry('cube/index.html'),
        flat: entry('flat/index.html'),
      },
    },
  },
});
