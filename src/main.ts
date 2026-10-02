import '@fontsource-variable/geist';
import '@fontsource-variable/jetbrains-mono';
import 'katex/dist/katex.min.css';
import './styles/app.css';

import { type Complex, c, mul } from './math/complex';
import { gammaToZ, gammaMetrics } from './math/smith';
import { fix, formatRect } from './math/units';
import { Store, defaultState, loadAutosave, type Tool, type GridMode, type AppState } from './state/store';
import { ChartView } from './ui/chart';
import { DesignPanel } from './ui/panelDesign';
import { InspectPanel } from './ui/panelInspect';
import { CalcPanel } from './ui/panelCalc';
import { EquationsPanel } from './ui/panelEquations';
import { DataPanel } from './ui/panelData';
import { h, svgIcon, segmented, toggle, toast } from './ui/dom';

const store = new Store(loadAutosave() ?? defaultState());
document.documentElement.dataset.theme = store.get().theme;

const chart = new ChartView(store);
const design = new DesignPanel(store);
const inspect = new InspectPanel(store);
const calc = new CalcPanel(store);
const equations = new EquationsPanel(store);
const data = new DataPanel(store);
data.onExportSVG = () => chart.exportSVG();

/* ---------------- icons ---------------- */
const I = {
  logo: '<circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4"/><circle cx="16.6" cy="12" r="4.6"/><path d="M21.2 12a9.2 9.2 0 0 0-9.2-9.2M21.2 12a9.2 9.2 0 0 1-9.2 9.2" opacity=".55"/>',
  select: '<path d="M5 3l14 8-6 1.6L10 19z"/>',
  place: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  compass: '<path d="M12 3v3M12 6l-5 15M12 6l5 15"/><circle cx="12" cy="6" r="1.4"/><path d="M8.5 15.5h7"/>',
  protractor: '<path d="M3 18a9 9 0 0 1 18 0z"/><path d="M12 18l5-6"/><path d="M7 18v-1.5M12 18V9.5M17 18v-1.5" opacity=".6"/>',
  ruler: '<path d="M4 16L16 4l4 4L8 20z"/><path d="M8 12l2 2M11 9l2 2M14 6l2 2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5" opacity=".7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  magnet: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
};

/* ---------------- header ---------------- */
const undoBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Undo (Ctrl+Z)', title: 'Undo (Ctrl+Z)', onclick: () => store.undo() }, svgIcon(I.undo));
const redoBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Redo (Ctrl+Shift+Z)', title: 'Redo (Ctrl+Shift+Z)', onclick: () => store.redo() }, svgIcon(I.redo));
const themeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Toggle light/dark theme', title: 'Theme', onclick: () => store.update((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }), false) });
const helpBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Help and shortcuts', title: 'Help', onclick: () => openHelp() }, svgIcon(I.help));
const gridSeg = h('div', { class: 'grid-seg' });
const renderGridSeg = () => gridSeg.replaceChildren(segmented<GridMode>('Chart grid', [['Z', 'Z', 'Impedance grid'], ['Y', 'Y', 'Admittance grid'], ['ZY', 'ZY', 'Impedance grid with admittance overlay'], ['YZ', 'YZ', 'Admittance grid with impedance overlay']], store.get().gridMode, (v) => store.update((s) => ({ ...s, gridMode: v })), true));

const header = h('header', { class: 'topbar' },
  h('div', { class: 'brand' }, svgIcon(I.logo, 26), h('div', {}, h('span', { class: 'brand-name' }, 'Smith Chart'), h('span', { class: 'brand-sub' }, 'browser RF workbench'))),
  h('div', { class: 'top-ctrls' }, gridSeg, h('span', { class: 'divider' }), undoBtn, redoBtn, themeBtn, helpBtn,
    h('a', { class: 'icon-btn', href: 'https://github.com/Waltzy27/BrowserSmithChart', target: '_blank', rel: 'noopener', 'aria-label': 'Source on GitHub', title: 'Source on GitHub' }, svgIcon(I.github))),
);

/* ---------------- chart toolbar ---------------- */
const TOOLS: Array<[Tool, string, string, string]> = [
  ['select', 'Select / drag', I.select, 'V'],
  ['place', 'Place load', I.place, 'P'],
  ['compass', 'Compass', I.compass, 'C'],
  ['protractor', 'Protractor', I.protractor, 'A'],
  ['ruler', 'Dividers', I.ruler, 'D'],
];
const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Chart tools' });
const layersPop = h('div', { class: 'popover', hidden: true, role: 'dialog', 'aria-label': 'Chart overlays' });
function renderToolbar(): void {
  const s = store.get();
  toolbar.replaceChildren(
    ...TOOLS.map(([t, label, icon, key]) => h('button', { type: 'button', class: `tool${s.tool === t ? ' on' : ''}`, 'aria-pressed': String(s.tool === t), 'aria-label': `${label} (${key})`, title: `${label} (${key})`, onclick: () => store.update((st) => ({ ...st, tool: t }), false) }, svgIcon(icon, 20), h('span', { class: 'tool-label' }, label))),
    h('span', { class: 'tool-sep' }),
    h('button', { type: 'button', class: `tool${s.snap !== 'off' ? ' on' : ''}`, 'aria-label': `Snap: ${s.snap}`, title: `Snap: ${s.snap} (S to cycle) — grid values or guide circles`, onclick: () => store.update((st) => ({ ...st, snap: st.snap === 'off' ? 'grid' : st.snap === 'grid' ? 'guides' : 'off' }), false) },
      svgIcon(I.magnet, 20), h('span', { class: 'tool-label' }, `Snap ${s.snap}`)),
    h('button', { type: 'button', class: 'tool', 'aria-label': 'Overlays', title: 'Overlays', 'aria-expanded': String(!layersPop.hidden), onclick: (e: Event) => { e.stopPropagation(); layersPop.hidden = !layersPop.hidden; renderLayers(); renderToolbar(); } }, svgIcon(I.layers, 20), h('span', { class: 'tool-label' }, 'Overlays')),
  );
}
function renderLayers(): void {
  const s = store.get();
  const o = s.overlays;
  const set = (patch: Partial<AppState['overlays']>) => store.update((st) => ({ ...st, overlays: { ...st.overlays, ...patch } }));
  layersPop.replaceChildren(
    h('h4', {}, 'Overlays'),
    toggle('VSWR circles (load / input)', o.vswrCircle, (v) => set({ vswrCircle: v })),
    toggle('Match guides: r = 1 and g = 1', o.matchCircles, (v) => set({ matchCircles: v })),
    toggle('Angle & wavelength scales', o.scales, (v) => set({ scales: v })),
    toggle('Grid labels', o.labels, (v) => set({ labels: v })),
    toggle('Paper Y point (reflect through centre)', o.paperY, (v) => set({ paperY: v })),
    h('label', { class: 'field inline' }, h('span', { class: 'field-label' }, 'Constant-Q arcs'),
      h('select', { 'aria-label': 'Constant Q', onchange: (e: Event) => set({ qCircle: Number((e.target as HTMLSelectElement).value) }) },
        ...[0, 0.5, 1, 2, 3, 5, 10].map((q) => h('option', { value: String(q), selected: o.qCircle === q }, q === 0 ? 'Off' : `Q = ${q}`)))),
  );
}
document.addEventListener('click', (e) => { if (!layersPop.hidden && !layersPop.contains(e.target as Node)) { layersPop.hidden = true; renderToolbar(); } });

const zoomCtl = h('div', { class: 'zoom', role: 'group', 'aria-label': 'Zoom' },
  h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom in (+)', title: 'Zoom in (+)', onclick: () => chart.zoomBy(1.4) }, svgIcon(I.plus)),
  h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zoom out (−)', title: 'Zoom out (−)', onclick: () => chart.zoomBy(1 / 1.4) }, svgIcon(I.minus)),
  h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fit chart (0)', title: 'Fit chart (0)', onclick: () => chart.resetView() }, svgIcon(I.fit)));

const status = h('div', { class: 'statusbar mono', 'aria-live': 'off' });
function renderStatus(g: Complex | null): void {
  const s = store.get();
  const ref = `Z0 ${s.Z0} Ω · f0 ${fmtHz(s.f0)} · grid ${s.gridMode}`;
  if (!g) { status.textContent = ref; return; }
  const z = gammaToZ(g);
  const m = gammaMetrics(g);
  status.textContent = `Γ ${formatRect(g, 3)} · z ${formatRect(z, 3)} · Z ${formatRect(mul(z, c(s.Z0, 0)), 1, 'Ω')} · SWR ${Number.isFinite(m.vswr) ? fix(m.vswr, 2) : '∞'} · ${ref}`;
}
const fmtHz = (f: number) => f >= 1e9 ? `${+(f / 1e9).toPrecision(5)} GHz` : f >= 1e6 ? `${+(f / 1e6).toPrecision(5)} MHz` : f >= 1e3 ? `${+(f / 1e3).toPrecision(5)} kHz` : `${f} Hz`;
chart.onCursor = (g) => { renderStatus(g); inspect.setCursor(g); };

const chartArea = h('section', { class: 'chart-area', 'aria-label': 'Smith chart' }, toolbar, layersPop, chart.root, zoomCtl, status);

/* ---------------- tabs ---------------- */
type TabId = 'design' | 'inspect' | 'calc' | 'eq' | 'data';
const panels: Record<TabId, HTMLElement> = { design: design.el, inspect: inspect.el, calc: calc.el, eq: equations.el, data: data.el };
const TAB_LABEL: Record<TabId, string> = { design: 'Design', inspect: 'Inspect', calc: 'Calculate', eq: 'Equations', data: 'Data' };
let activeTab: TabId = 'inspect';
const tabBar = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Panels' });
const tabBody = h('div', { class: 'tab-body' });
const leftAside = h('aside', { class: 'left', 'aria-label': 'Design' }, h('div', { class: 'left-title' }, 'Design'));
const rightAside = h('aside', { class: 'right' }, tabBar, tabBody);
const wide = window.matchMedia('(min-width: 1180px)');

function availableTabs(): TabId[] { return wide.matches ? ['inspect', 'calc', 'eq', 'data'] : ['design', 'inspect', 'calc', 'eq', 'data']; }
function renderTabs(): void {
  const tabs = availableTabs();
  if (!tabs.includes(activeTab)) activeTab = tabs[0];
  tabBar.replaceChildren(...tabs.map((t) => h('button', { type: 'button', role: 'tab', id: `tab-${t}`, 'aria-selected': String(t === activeTab), 'aria-controls': 'tab-panel', class: t === activeTab ? 'on' : '', onclick: () => { activeTab = t; renderTabs(); } }, TAB_LABEL[t])));
  tabBody.setAttribute('role', 'tabpanel'); tabBody.id = 'tab-panel'; tabBody.setAttribute('aria-labelledby', `tab-${activeTab}`);
  tabBody.replaceChildren(panels[activeTab]);
  equations.setVisible(activeTab === 'eq');
  data.setVisible(activeTab === 'data');
  if (wide.matches) { if (design.el.parentElement !== leftAside) leftAside.append(design.el); }
}
wide.addEventListener('change', () => renderTabs());

const app = h('div', { class: 'app' }, header, h('main', { class: 'workspace' }, leftAside, chartArea, rightAside));
document.getElementById('app')!.replaceWith(app);
renderTabs();

/* ---------------- reactions ---------------- */
store.subscribe((s, p) => {
  if (s.theme !== p.theme) document.documentElement.dataset.theme = s.theme;
  if (s.gridMode !== p.gridMode) renderGridSeg();
  if (s.tool !== p.tool || s.snap !== p.snap) renderToolbar();
  if (s.overlays !== p.overlays && !layersPop.hidden) renderLayers();
  syncHeader();
  renderStatus(null);
});
function syncHeader(): void {
  undoBtn.disabled = !store.canUndo();
  redoBtn.disabled = !store.canRedo();
  themeBtn.replaceChildren(svgIcon(store.get().theme === 'dark' ? I.sun : I.moon));
}
renderGridSeg(); renderToolbar(); syncHeader(); renderStatus(null);
document.addEventListener('smith:toast', (e) => toast((e as CustomEvent<string>).detail));

/* ---------------- keyboard ---------------- */
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
  if (mod) return;
  const toolKey: Record<string, Tool> = { v: 'select', p: 'place', c: 'compass', a: 'protractor', d: 'ruler' };
  const k = e.key.toLowerCase();
  if (toolKey[k]) { store.update((s) => ({ ...s, tool: toolKey[k] }), false); return; }
  if (k === 'escape') { store.update((s) => ({ ...s, tool: 'select' }), false); layersPop.hidden = true; return; }
  if (k === 's') { store.update((s) => ({ ...s, snap: s.snap === 'off' ? 'grid' : s.snap === 'grid' ? 'guides' : 'off' }), false); return; }
  if (k === 'g') { const order: GridMode[] = ['Z', 'ZY', 'Y', 'YZ']; store.update((s) => ({ ...s, gridMode: order[(order.indexOf(s.gridMode) + 1) % 4] })); return; }
  if (k === '+' || k === '=') { chart.zoomBy(1.4); return; }
  if (k === '-') { chart.zoomBy(1 / 1.4); return; }
  if (k === '0') { chart.resetView(); return; }
  if (k === 'delete' || k === 'backspace') {
    const sel = store.get().selection;
    if (sel.kind === 'element') store.update((s) => ({ ...s, elements: s.elements.filter((x) => x.id !== sel.id), selection: { kind: 'load' } }));
    else if (sel.kind === 'construction') store.update((s) => ({ ...s, constructions: s.constructions.filter((x) => x.id !== sel.id), selection: { kind: 'load' } }));
    else if (sel.kind === 'marker') store.update((s) => ({ ...s, markers: s.markers.filter((x) => x.id !== sel.id), selection: { kind: 'load' } }));
    return;
  }
  // Arrow keys nudge the load (fine movement in the Γ plane)
  if (k.startsWith('arrow') && store.get().selection.kind === 'load') {
    e.preventDefault();
    const step = e.shiftKey ? 0.05 : 0.005;
    const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
    const dy = k === 'arrowup' ? step : k === 'arrowdown' ? -step : 0;
    store.update((s) => ({ ...s, load: { ...s.load, gamma: c(s.load.gamma.re + dx, s.load.gamma.im + dy) } }));
  }
});

/* ---------------- drag & drop files ---------------- */
chartArea.addEventListener('dragover', (e) => { e.preventDefault(); chartArea.classList.add('drop'); });
chartArea.addEventListener('dragleave', () => chartArea.classList.remove('drop'));
chartArea.addEventListener('drop', async (e) => {
  e.preventDefault(); chartArea.classList.remove('drop');
  const f = e.dataTransfer?.files?.[0];
  if (f) { await data.importFile(f); activeTab = 'data'; renderTabs(); }
});

/* ---------------- help dialog ---------------- */
function openHelp(): void {
  const dlg = h('dialog', { class: 'help' },
    h('h2', {}, 'Smith Chart — quick guide'),
    h('p', {}, 'Every value is computed from the analytic equations (see the Equations tab); the chart is drawn from those values, never the other way round.'),
    h('h3', {}, 'Tools'),
    h('ul', {},
      h('li', {}, h('kbd', {}, 'V'), ' Select / drag — drag the load or any numbered point; points slide only along their physically correct contour.'),
      h('li', {}, h('kbd', {}, 'P'), ' Place load — tap anywhere to put the load there.'),
      h('li', {}, h('kbd', {}, 'C'), ' Compass — press at a centre and drag a radius. Centred circles read |Γ|, SWR and return loss.'),
      h('li', {}, h('kbd', {}, 'A'), ' Protractor — drag radial lines; reads ∠Γ and wavelengths toward generator/load, and Δλ between radials.'),
      h('li', {}, h('kbd', {}, 'D'), ' Dividers — measure distances in the Γ plane.')),
    h('h3', {}, 'Shortcuts'),
    h('ul', {},
      h('li', {}, h('kbd', {}, 'Ctrl/⌘ Z'), ' undo · ', h('kbd', {}, 'Ctrl/⌘ ⇧ Z'), ' redo'),
      h('li', {}, h('kbd', {}, 'G'), ' cycle grid Z → ZY → Y → YZ · ', h('kbd', {}, 'S'), ' cycle snapping'),
      h('li', {}, h('kbd', {}, '+'), ' / ', h('kbd', {}, '−'), ' zoom · ', h('kbd', {}, '0'), ' fit · wheel or pinch to zoom, drag empty space to pan'),
      h('li', {}, 'Arrow keys nudge the load (Shift for larger steps) · ', h('kbd', {}, 'Delete'), ' removes the selected item')),
    h('h3', {}, 'Conventions'),
    h('p', {}, 'e^{+jωt} time convention; inductive reactance is in the upper half. Elements are ordered from the load toward the generator. Moving toward the generator on a line is a clockwise rotation (Pozar 2.42). Reference: D. M. Pozar, Microwave Engineering, 4th ed.'),
    h('form', { method: 'dialog' }, h('button', { class: 'btn primary', type: 'submit' }, 'Close')));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/* ---------------- offline / PWA ---------------- */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is available — reload to update.');
        });
      });
    }).catch(() => { /* offline support is optional */ });
  });
}
