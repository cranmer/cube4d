import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Served from a project page on GitHub Pages, so assets resolve relative to the deploy path.
  base: process.env.MC4D_BASE ?? '/',
  build: { target: 'es2022', outDir: 'dist' },
});
