// Packages the single-file offline build (dist-offline/index.html) for download:
//   release/BrowserSmithChart-<ver>-offline.html        the app, one file
//   release/BrowserSmithChart-<ver>-linux-offline.zip   app + icon + menu launcher + README
//   release/BrowserSmithChart-<ver>-linux-offline.tar.gz (same, keeps permissions)
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const html = join(root, 'dist-offline', 'index.html');
if (!existsSync(html)) throw new Error('Run `vite build --mode offline` first');
const out = join(root, 'release');
const name = `BrowserSmithChart-${version}-linux-offline`;
const dir = join(out, name);
rmSync(out, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

copyFileSync(html, join(out, `BrowserSmithChart-${version}-offline.html`));
copyFileSync(html, join(dir, 'BrowserSmithChart.html'));
copyFileSync(join(root, 'public', 'icons', 'icon-512.png'), join(dir, 'smith-chart.png'));
for (const f of ['install-launcher.sh', 'uninstall-launcher.sh']) {
  copyFileSync(join(root, 'packaging', 'linux', f), join(dir, f));
  chmodSync(join(dir, f), 0o755);
}
writeFileSync(join(dir, 'README.txt'), readFileSync(join(root, 'packaging', 'linux', 'README.txt'), 'utf8').replaceAll('__VERSION__', `v${version}`));

execSync(`zip -qr -X "${name}.zip" "${name}"`, { cwd: out, stdio: 'inherit' });
execSync(`tar -czf "${name}.tar.gz" "${name}"`, { cwd: out, stdio: 'inherit' });
console.log(`packaged ${name}`);
