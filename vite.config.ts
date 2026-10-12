import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** Offline build: inline the favicon, drop links that only make sense when served over http(s). */
const offlineHead = () => ({
  name: 'offline-head',
  transformIndexHtml(html: string) {
    const svg = readFileSync(new URL('./public/icons/favicon.svg', import.meta.url), 'utf8');
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    return html
      .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${dataUri}" type="image/svg+xml" />`)
      .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
      .replace(/\s*<link rel="manifest"[^>]*>/, '');
  },
});

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// GitHub Pages serves the app from https://<user>.github.io/BrowserSmithChart/
// A relative base keeps the bundle portable (Pages, local preview, any sub-path).
// `vite build --mode offline` produces one self-contained HTML file (JS, CSS, fonts and
// example data inlined) that runs by double-clicking it, with no server or internet.
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: mode === 'offline' ? [offlineHead(), viteSingleFile({ removeViteModuleLoader: true })] : [],
  publicDir: mode === 'offline' ? false : 'public',
  build: mode === 'offline'
    ? { target: 'es2022', outDir: 'dist-offline', sourcemap: false, assetsInlineLimit: 100_000_000, cssCodeSplit: false }
    : { target: 'es2022', outDir: 'dist', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
