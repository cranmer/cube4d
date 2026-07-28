import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
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
      },
    },
  },
});
