// Builds every archived release tag listed in versions.json into dist/<path>/ so that
// old versions stay reachable at permanent URLs (e.g. /BrowserSmithChart/v0.1/) after
// the main app moves on. Run after `npm run build` (needs full git history with tags).
import { readFileSync, writeFileSync, cpSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const versions = JSON.parse(readFileSync(join(root, 'versions.json'), 'utf8'));
const dist = join(root, 'dist');
if (!existsSync(dist)) throw new Error('Run `npm run build` first');
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

for (const v of versions.archived) {
  if (!/^[\w.-]+$/.test(v.tag) || !/^[\w.-]+$/.test(v.path)) throw new Error(`Bad entry ${JSON.stringify(v)}`);
  const wt = join(tmpdir(), `bsc-${v.tag}`);
  rmSync(wt, { recursive: true, force: true });
  sh(`git worktree add --detach "${wt}" "${v.tag}"`, root);
  try {
    sh('npm ci --no-audit --no-fund', wt);
    sh('npx vite build', wt);
    const out = join(dist, v.path);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    cpSync(join(wt, 'dist'), out, { recursive: true });
    console.log(`archived ${v.tag} -> dist/${v.path}/`);
  } finally {
    sh(`git worktree remove --force "${wt}"`, root);
  }
}
writeFileSync(join(dist, 'versions.json'), JSON.stringify(versions, null, 2));
