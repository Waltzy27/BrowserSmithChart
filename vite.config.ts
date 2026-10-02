import { defineConfig } from 'vitest/config';

// GitHub Pages serves the app from https://<user>.github.io/BrowserSmithChart/
// A relative base keeps the bundle portable (Pages, local preview, any sub-path).
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
