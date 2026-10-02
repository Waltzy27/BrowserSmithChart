/**
 * Version menu. The deployed site keeps every released version side by side:
 *   <site>/            current build
 *   <site>/v0.1/ …     archived builds (see scripts/build-archives.mjs)
 * versions.json lives at the site root; archived builds find it one level up.
 */
import { APP_VERSION } from '../state/store';
import { h } from './dom';

interface VersionsFile { current: string; archived: Array<{ version: string; tag: string; path: string; date?: string; note?: string }>; }

async function findManifest(): Promise<{ data: VersionsFile; base: URL; archived: boolean } | null> {
  // Archived copies live at <site>/vX.Y/; look one level up first there (avoids a 404).
  const nested = /\/v\d+\.\d+\/(index\.html)?$/.test(location.pathname);
  const order: Array<readonly [string, boolean]> = nested ? [['../versions.json', true], ['./versions.json', false]] : [['./versions.json', false], ['../versions.json', true]];
  for (const [rel, archived] of order) {
    try {
      const url = new URL(rel, document.baseURI);
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) continue;
      const data = (await r.json()) as VersionsFile;
      if (!data || !Array.isArray(data.archived)) continue;
      // An archived copy at ./ would also answer; the current build is the one whose
      // manifest lists it as current.
      // A permanent /vX.Y/ copy of the current release is not "archived" yet.
      const isCurrent = data.current.replace(/-dev$/, '') === APP_VERSION;
      void archived;
      return { data, base: new URL('.', url), archived: !isCurrent };
    } catch { /* offline or file:// */ }
  }
  return null;
}

export function versionBadge(): HTMLElement {
  const pop = h('div', { class: 'popover version-pop', hidden: true, role: 'dialog', 'aria-label': 'Versions' });
  const btn = h('button', { type: 'button', class: 'version-badge mono', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Versions' }, `v${APP_VERSION}`);
  const wrap = h('div', { class: 'version-wrap' }, btn, pop);
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!pop.hidden) { close(); return; }
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    pop.replaceChildren(h('h4', {}, 'Versions'), h('p', { class: 'small' }, 'Loading…'));
    const m = await findManifest();
    if (!m) { pop.replaceChildren(h('h4', {}, 'Versions'), h('p', { class: 'small' }, `This is v${APP_VERSION}. The version list is unavailable offline.`)); return; }
    const rows: HTMLElement[] = [];
    rows.push(h('a', { class: `ver-row${m.archived ? '' : ' on'}`, href: m.base.href }, h('strong', {}, `v${m.data.current.replace(/-dev$/, '')}`), h('span', { class: 'small' }, 'current')));
    for (const a of [...m.data.archived].reverse()) {
      if (a.version === m.data.current.replace(/-dev$/, '')) continue;
      rows.push(h('a', { class: `ver-row${m.archived && a.version === APP_VERSION ? ' on' : ''}`, href: new URL(`${a.path}/`, m.base).href },
        h('strong', {}, `v${a.version}`), h('span', { class: 'small' }, [a.date, a.note].filter(Boolean).join(' · '))));
    }
    const cur = m.data.current.replace(/-dev$/, '');
    const warn = m.archived ? [h('p', { class: 'small warn' }, `You are using archived v${APP_VERSION}. The current version is v${cur}; saved work is kept separately for each version.`)] : [];
    pop.replaceChildren(h('h4', {}, 'Versions'), ...warn, ...rows,
      h('a', { class: 'small', href: 'https://github.com/Waltzy27/BrowserSmithChart/releases', target: '_blank', rel: 'noopener' }, 'Release notes on GitHub'));
  });
  document.addEventListener('click', (e) => { if (!pop.hidden && !wrap.contains(e.target as Node)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return wrap;
}
