/** Data panel: Touchstone import, traces, markers, frequency sweep plot, exports and project files. */
import { type Complex, abs, c, mul } from '../math/complex';
import { gammaToZ, gammaMetrics } from '../math/smith';
import { fix, formatRect } from '../math/units';
import { serializeS1P, type Diagnostic } from '../io/touchstone';
import { parseTouchstoneAsync } from '../io/parseAsync';
import { listProjects, saveProject, getProject, deleteProject, libraryAvailable, type LibraryEntry } from '../state/library';
import { type Store, type AppState, type Trace, newId, serializeProject, loadProject } from '../state/store';
import { derive, interpolateTrace, minReflectionIndex, bandAround } from '../state/derive';
import { h, numField, toggle, rebuild, download, toast, svgIcon } from './dom';
import { PALETTES } from './palette';
import { fmtFreq } from './chart';

export const EXAMPLES: Array<[string, string]> = [
  ['pozar_ex5_2_RC_load.s1p', 'Pozar Ex. 5.2 load (60 Ω + 0.995 pF), 1–3 GHz, DB'],
  ['antenna_2g45.s1p', '2.45 GHz resonant antenna model, MA'],
  ['line_30ohm_section.s2p', '30 Ω lossy line section (2-port), RI'],
  ['synthetic_amplifier.s2p', 'Synthetic amplifier (2-port, non-reciprocal), MA'],
];

let lastDiagnostics: Diagnostic[] = [];
let lastFile = '';
let markerFreqInput = NaN;

export class DataPanel {
  readonly el = h('div', { class: 'panel-body' });
  private plot = h('canvas', { class: 'sweep-plot', role: 'img', 'aria-label': 'Return loss versus frequency' });
  private visible = false;
  onExportSVG: () => string = () => '';

  constructor(private store: Store) {
    store.subscribe((s, p) => {
      if (!this.visible) return;
      if (s.traces !== p.traces || s.markers !== p.markers || s.sweep !== p.sweep || s.activeTraceId !== p.activeTraceId || s.selection !== p.selection || s.Z0 !== p.Z0) this.render();
      else if (s.elements !== p.elements || s.load !== p.load || s.f0 !== p.f0 || s.theme !== p.theme) { this.render(); }
    });
    new ResizeObserver(() => this.drawPlot()).observe(this.plot);
  }
  setVisible(v: boolean): void { this.visible = v; if (v) this.render(); }

  async importText(text: string, name: string): Promise<void> {
    if (text.length > 256 * 1024) toast(`Parsing ${name}…`);
    const r = await parseTouchstoneAsync(text, name);
    lastDiagnostics = r.diagnostics;
    lastFile = name;
    if (!r.network) { toast(`Could not import ${name}`, 'error'); this.render(); return; }
    const net = r.network;
    const all: Record<string, Complex[]> = {};
    for (let i = 0; i < net.ports; i++) all[`S${i + 1}${i + 1}`] = net.s.map((m) => m[i][i]);
    if (net.ports === 2) { all.S21 = net.s.map((m) => m[1][0]); all.S12 = net.s.map((m) => m[0][1]); }
    const t: Trace = {
      id: newId('t'), name: name.replace(/\.[^.]+$/, ''), param: 'S11', freqs: net.freqs, gamma: all.S11, z0: net.z0,
      visible: true, applyNetwork: false, sourcePorts: net.ports, allParams: all,
    };
    this.store.update((s) => ({ ...s, traces: [...s.traces, t], activeTraceId: t.id }));
    toast(`Imported ${name}: ${net.ports}-port, ${net.freqs.length} points, ${fmtFreq(net.freqs[0])} – ${fmtFreq(net.freqs[net.freqs.length - 1])}`);
    this.render();
  }

  async importFile(f: File): Promise<void> {
    if (f.size > 50 * 1024 * 1024) { toast('File is larger than 50 MB.', 'error'); return; }
    if (/\.json$/i.test(f.name)) {
      try { const st = loadProject(await f.text()); this.store.replace(st, false); toast(`Opened project ${f.name}`); }
      catch (e) { toast((e as Error).message, 'error'); }
      return;
    }
    await this.importText(await f.text(), f.name);
  }

  render(): void {
    rebuild(this.el, () => [this.importCard(), this.tracesCard(), this.markersCard(), this.sweepCard(), this.exportCard(), this.libraryCard()]);
    requestAnimationFrame(() => this.drawPlot());
  }

  private importCard(): HTMLElement {
    const fileInput = h('input', { type: 'file', accept: '.s1p,.s2p,.s3p,.s4p,.snp,.ts,.txt,.json', class: 'sr-only', id: 'ts-file',
      onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) await this.importFile(f); (e.target as HTMLInputElement).value = ''; } });
    const ex = h('select', { 'aria-label': 'Example data files', onchange: async (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      if (!v) return;
      try { const r = await fetch(`./examples/${v}`); if (!r.ok) throw new Error(String(r.status)); await this.importText(await r.text(), v); }
      catch { toast('Could not load the example file.', 'error'); }
    } }, h('option', { value: '' }, 'Load an example file…'), ...EXAMPLES.map(([f, l]) => h('option', { value: f }, l)));
    return h('section', { class: 'card' },
      h('h3', {}, 'Touchstone data'),
      h('p', { class: 'hint' }, 'S1P / S2P (Touchstone 1.x, core 2.0), RI · MA · DB, S / Z / Y. Files are read locally and never uploaded. You can also drop a file onto the chart.'),
      h('div', { class: 'row' }, h('label', { for: 'ts-file', class: 'btn primary', tabindex: '0', role: 'button',
        onkeydown: (ev: Event) => { const e = ev as KeyboardEvent; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } }, 'Import file…'), fileInput, ex),
      lastDiagnostics.length ? h('details', { class: 'diag', open: lastDiagnostics.some((d) => d.level === 'error') },
        h('summary', {}, `${lastFile}: ${lastDiagnostics.length} note${lastDiagnostics.length > 1 ? 's' : ''}`),
        h('ul', {}, ...lastDiagnostics.slice(0, 30).map((d) => h('li', { class: d.level }, `${d.level}${d.line ? ` (line ${d.line})` : ''}: ${d.message}`)))) : null,
    );
  }

  private tracesCard(): HTMLElement {
    const s = this.store.get();
    if (!s.traces.length) return h('section', { class: 'card' }, h('h3', {}, 'Traces'), h('p', { class: 'hint' }, 'No traces yet.'));
    const upd = (id: string, patch: Partial<Trace>) => this.store.update((st) => ({ ...st, traces: st.traces.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    return h('section', { class: 'card' }, h('h3', {}, 'Traces'),
      ...s.traces.map((t) => {
        const params = Object.keys(t.allParams ?? { [t.param]: [] });
        const isTransmission = /^S(\d)(\d)$/.exec(t.param) && t.param[1] !== t.param[2];
        return h('div', { class: `trace-row${t.id === s.activeTraceId ? ' active' : ''}` },
          h('div', { class: 'row space' },
            h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'active-trace', checked: t.id === s.activeTraceId, onchange: () => this.store.update((st) => ({ ...st, activeTraceId: t.id })) }), h('strong', {}, t.name)),
            h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Remove trace ${t.name}`, onclick: () => this.store.update((st) => ({ ...st, traces: st.traces.filter((x) => x.id !== t.id), markers: st.markers.filter((m) => m.traceId !== t.id), activeTraceId: st.activeTraceId === t.id ? (st.traces.find((x) => x.id !== t.id)?.id ?? null) : st.activeTraceId })) }, svgIcon('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', 16))),
          h('p', { class: 'mono small' }, `${t.sourcePorts}-port · ${t.freqs.length} pts · ${fmtFreq(t.freqs[0])} – ${fmtFreq(t.freqs[t.freqs.length - 1])} · ref ${t.z0} Ω${t.z0 !== s.Z0 ? ` → renormalised to ${s.Z0} Ω` : ''}`),
          h('div', { class: 'row wrap' },
            params.length > 1 ? h('select', { 'aria-label': 'Parameter', onchange: (e: Event) => { const p = (e.target as HTMLSelectElement).value; upd(t.id, { param: p, gamma: t.allParams![p] }); } },
              ...params.map((p) => h('option', { value: p, selected: p === t.param }, p))) : h('span', { class: 'chip static' }, t.param),
            toggle('Visible', t.visible, (v) => upd(t.id, { visible: v })),
            toggle('Apply network', t.applyNetwork, (v) => upd(t.id, { applyNetwork: v }), 'Cascade the design network onto this measured load at every frequency')),
          isTransmission ? h('p', { class: 'hint warn' }, `${t.param} is a transmission coefficient, not a reflection. It is drawn on the Γ plane for inspection only; impedance readouts do not apply.`) : null,
        );
      }));
  }

  private markersCard(): HTMLElement {
    const s = this.store.get();
    const d = derive(s);
    const active = d.traces.find((t) => t.trace.id === s.activeTraceId);
    const addAt = (f: number) => {
      if (!active) return;
      const id = newId('m');
      this.store.update((st) => ({ ...st, markers: [...st.markers, { id, traceId: active.trace.id, f }], selection: { kind: 'marker', id } }));
    };
    const rows = s.markers.map((m, i) => {
      const tr = d.traces.find((t) => t.trace.id === m.traceId);
      if (!tr) return null;
      const ip = interpolateTrace(tr.trace.freqs, tr.applied ?? tr.gamma, m.f);
      const met = gammaMetrics(ip.gamma);
      const Z = mul(gammaToZ(ip.gamma), c(s.Z0, 0));
      const selected = s.selection.kind === 'marker' && s.selection.id === m.id;
      return h('tr', { class: selected ? 'selected' : '', onclick: (e: Event) => { if ((e.target as HTMLElement).closest('button')) return; this.store.update((st) => ({ ...st, selection: { kind: 'marker', id: m.id } }), false); } },
        h('td', {}, `M${i + 1}`), h('td', { class: 'mono' }, fmtFreq(m.f)), h('td', { class: 'mono' }, formatRect(Z, 1)),
        h('td', { class: 'mono' }, Number.isFinite(met.vswr) ? fix(met.vswr, 2) : '∞'), h('td', { class: 'mono' }, fix(met.returnLossDb, 1)),
        h('td', {},
          h('button', { type: 'button', class: 'link', title: 'Use this impedance and frequency as the design load', onclick: () => {
            const raw = interpolateTrace(tr.trace.freqs, tr.gamma, m.f).gamma;
            this.store.update((st) => ({ ...st, f0: m.f, load: { ...st.load, gamma: raw }, selection: { kind: 'load' } }));
            toast(`Load set from M${i + 1} at ${fmtFreq(m.f)}`);
          } }, 'Use'),
          h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `Delete marker M${i + 1}`, onclick: () => this.store.update((st) => ({ ...st, markers: st.markers.filter((x) => x.id !== m.id), selection: { kind: 'load' } })) }, svgIcon('<path d="M6 6l12 12M18 6L6 18"/>', 14))));
    }).filter((x): x is HTMLTableRowElement => x !== null);
    return h('section', { class: 'card' }, h('h3', {}, 'Markers'),
      active ? h('div', { class: 'row wrap' },
        numField({ label: 'Frequency', unit: 'Hz', value: Number.isFinite(markerFreqInput) ? markerFreqInput : active.trace.freqs[Math.floor(active.trace.freqs.length / 2)], key: 'mk:f', engineering: true, onCommit: (v) => { markerFreqInput = v; } }),
        h('button', { type: 'button', class: 'btn', onclick: () => addAt(Number.isFinite(markerFreqInput) ? markerFreqInput : active.trace.freqs[Math.floor(active.trace.freqs.length / 2)]) }, 'Add marker'),
        h('button', { type: 'button', class: 'btn', title: 'Marker at the minimum |Γ| of the active trace', onclick: () => addAt(active.trace.freqs[minReflectionIndex(active.applied ?? active.gamma)]) }, 'At min |Γ|'))
        : h('p', { class: 'hint' }, 'Import a trace to place markers. Drag markers along the trace on the chart.'),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'markers' },
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'f'), h('th', {}, `Z (Ω)`), h('th', {}, 'SWR'), h('th', {}, 'RL dB'), h('th', {}, ''))),
        h('tbody', {}, ...rows))) : null,
      rows.length ? h('p', { class: 'hint' }, 'Between samples, Γ is linearly interpolated in real/imaginary parts.') : null,
    );
  }

  private sweepCard(): HTMLElement {
    const s = this.store.get();
    const d = derive(s);
    let band: HTMLElement | null = null;
    const src = d.sweep ? { f: d.sweep.freqs, g: d.sweep.gamma, name: 'Design sweep' } : (() => {
      const a = d.traces.find((t) => t.trace.id === s.activeTraceId);
      return a ? { f: a.trace.freqs, g: a.applied ?? a.gamma, name: a.applied ? `${a.trace.name} + network` : a.trace.name } : null;
    })();
    if (src) {
      const k = minReflectionIndex(src.g);
      const b = bandAround(src.f, src.g, k, 1 / 3);
      const m = gammaMetrics(src.g[k]);
      band = h('p', { class: 'mono small' }, `${src.name}: best RL ${fix(m.returnLossDb, 2)} dB at ${fmtFreq(src.f[k])}` +
        (b ? ` · SWR ≤ 2 from ${fmtFreq(b.lo)} to ${fmtFreq(b.hi)} (${fix(((b.hi - b.lo) / src.f[k]) * 100, 2)} %)` : ' · SWR never ≤ 2'));
    }
    return h('section', { class: 'card' }, h('h3', {}, 'Frequency response'),
      toggle('Sweep the design around f0', s.sweep.enabled, (v) => this.store.update((st) => ({ ...st, sweep: { ...st.sweep, enabled: v } })), 'Uses the load frequency model from the Design panel'),
      s.sweep.enabled ? h('div', { class: 'grid2' },
        numField({ label: 'Span', unit: '%', value: s.sweep.spanPct, key: 'sw:span', min: 0.1, onCommit: (v) => this.store.update((st) => ({ ...st, sweep: { ...st.sweep, spanPct: Math.min(190, v) } })) }),
        numField({ label: 'Points', value: s.sweep.points, key: 'sw:pts', min: 3, onCommit: (v) => this.store.update((st) => ({ ...st, sweep: { ...st.sweep, points: Math.round(Math.min(2001, v)) } })) })) : null,
      h('p', { class: 'hint' }, `Load model: ${s.load.model === 'constant' ? 'constant impedance' : s.load.model === 'series' ? 'series R + L/C' : 'parallel G ‖ L/C'}; lines scale as βℓ ∝ f (TEM); loss is held at its f0 value.`),
      this.plot, band);
  }

  private exportCard(): HTMLElement {
    const s = this.store.get();
    const d = derive(s);
    const active = d.traces.find((t) => t.trace.id === s.activeTraceId);
    const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const openInput = h('input', { type: 'file', accept: '.json', class: 'sr-only', id: 'proj-file', onchange: async (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (f) await this.importFile(f); (e.target as HTMLInputElement).value = '';
    } });
    return h('section', { class: 'card' }, h('h3', {}, 'Export & project'),
      h('div', { class: 'btn-grid' },
        h('button', { type: 'button', class: 'btn', onclick: () => download(`smith-chart-${stamp()}.svg`, this.onExportSVG(), 'image/svg+xml') }, 'Chart SVG'),
        h('button', { type: 'button', class: 'btn', onclick: () => this.exportPNG(`smith-chart-${stamp()}.png`) }, 'Chart PNG'),
        h('button', { type: 'button', class: 'btn', disabled: !active && !d.sweep, title: 'Active trace (with network if applied) or the design sweep', onclick: () => {
          if (active) {
            const g = active.applied ?? active.gamma;
            download(`${active.trace.name}${active.applied ? '_matched' : ''}.s1p`, serializeS1P(active.trace.freqs, g, s.Z0, [`Exported by Browser Smith Chart`, `Source ${active.trace.name} ${active.trace.param}${active.applied ? ' with design network applied' : ''}`]));
          } else if (d.sweep) download(`design_sweep.s1p`, serializeS1P(d.sweep.freqs, d.sweep.gamma, s.Z0, ['Exported by Browser Smith Chart', 'Design network input reflection']));
        } }, 'Touchstone S1P'),
        h('button', { type: 'button', class: 'btn', disabled: !s.markers.length, onclick: () => download(`markers-${stamp()}.csv`, this.markersCSV(s), 'text/csv') }, 'Markers CSV'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => download(`smith-project-${stamp()}.json`, serializeProject(s), 'application/json') }, 'Save project'),
        h('label', { for: 'proj-file', class: 'btn', role: 'button', tabindex: '0', onkeydown: (ev: Event) => { const e = ev as KeyboardEvent; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInput.click(); } } }, 'Open project…'), openInput,
      ),
      h('p', { class: 'hint' }, 'Projects autosave in this browser. Saved files are plain JSON and include imported data, the network, markers and constructions.'));
  }

  private library: LibraryEntry[] | null = null;
  private libName = '';
  private refreshLibrary(): void {
    listProjects().then((l) => { this.library = l; if (this.visible) this.render(); }).catch(() => { this.library = []; });
  }

  private libraryCard(): HTMLElement {
    if (!libraryAvailable()) return h('section', { class: 'card' }, h('h3', {}, 'Project library'), h('p', { class: 'hint' }, 'IndexedDB is not available in this browser (private mode?).'));
    if (this.library === null) { this.library = []; this.refreshLibrary(); }
    const nameInput = h('input', { class: 'num', type: 'text', placeholder: 'Project name', 'aria-label': 'Project name', value: this.libName, 'data-key': 'lib:name',
      oninput: (e: Event) => { this.libName = (e.target as HTMLInputElement).value; } });
    const save = async () => {
      const name = this.libName.trim() || `Project ${new Date().toLocaleString()}`;
      try { await saveProject(name, serializeProject(this.store.get())); toast(`Saved “${name}” to the library`); this.libName = ''; this.refreshLibrary(); }
      catch (e) { toast(`Could not save: ${(e as Error).message}`, 'error'); }
    };
    const open = async (en: LibraryEntry) => {
      try { const t = await getProject(en.id); if (!t) throw new Error('Not found'); this.store.replace(loadProject(t), false); toast(`Opened “${en.name}”`); }
      catch (e) { toast((e as Error).message, 'error'); }
    };
    const del = async (en: LibraryEntry) => {
      if (!window.confirm(`Delete “${en.name}” from the library?`)) return;
      await deleteProject(en.id).catch(() => undefined); this.refreshLibrary();
    };
    const kb = (n: number) => (n > 1e6 ? `${fix(n / 1e6, 2)} MB` : `${fix(n / 1e3, 1)} kB`);
    return h('section', { class: 'card' }, h('h3', {}, 'Project library'),
      h('p', { class: 'hint' }, 'Named projects stored in this browser (IndexedDB), including large imported data.'),
      h('div', { class: 'row lib-save' }, h('span', { class: 'field-input grow' }, nameInput), h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Save')),
      this.library.length ? h('ul', { class: 'lib-list' }, ...this.library.map((en) => h('li', {},
        h('div', { class: 'lib-meta' }, h('strong', {}, en.name), h('span', { class: 'small mono' }, `${new Date(en.savedAt).toLocaleString()} · ${kb(en.size)}`)),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn', onclick: () => open(en) }, 'Open'),
          h('button', { type: 'button', class: 'btn danger', 'aria-label': `Delete ${en.name}`, onclick: () => del(en) }, 'Delete'))))) : h('p', { class: 'small' }, 'No saved projects yet.'));
  }

  private markersCSV(s: AppState): string {
    const d = derive(s);
    const lines = ['marker,trace,param,freq_Hz,gamma_re,gamma_im,abs_gamma,angle_deg,R_ohm,X_ohm,vswr,return_loss_dB,network_applied'];
    s.markers.forEach((m, i) => {
      const tr = d.traces.find((t) => t.trace.id === m.traceId);
      if (!tr) return;
      const g = interpolateTrace(tr.trace.freqs, tr.applied ?? tr.gamma, m.f).gamma;
      const met = gammaMetrics(g);
      const Z = mul(gammaToZ(g), c(s.Z0, 0));
      const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
      lines.push([`M${i + 1}`, q(tr.trace.name), tr.trace.param, m.f, g.re, g.im, met.rho, met.angleDeg, Z.re, Z.im, met.vswr, met.returnLossDb, tr.applied ? 1 : 0].join(','));
    });
    return lines.join('\n') + '\n';
  }

  private exportPNG(name: string): void {
    const svg = this.onExportSVG();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const k = 2;
      const cv = document.createElement('canvas');
      cv.width = img.width * k; cv.height = img.height * k;
      const ctx = cv.getContext('2d')!;
      ctx.scale(k, k);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => { if (b) download(name, b, 'image/png'); });
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('PNG export failed.', 'error'); };
    img.src = url;
  }

  private drawPlot(): void {
    if (!this.visible || !this.plot.isConnected) return;
    const s = this.store.get();
    const p = PALETTES[s.theme];
    const d = derive(s);
    const rect = this.plot.getBoundingClientRect();
    const W = Math.max(200, rect.width), H = 170;
    const dpr = window.devicePixelRatio || 1;
    this.plot.width = W * dpr; this.plot.height = H * dpr; this.plot.style.height = `${H}px`;
    const ctx = this.plot.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const series: Array<{ f: number[]; g: Complex[]; color: string; dash: number[]; name: string }> = [];
    const active = d.traces.find((t) => t.trace.id === s.activeTraceId);
    if (active) {
      series.push({ f: active.trace.freqs, g: active.gamma, color: p.traceA, dash: [], name: active.trace.name });
      if (active.applied) series.push({ f: active.trace.freqs, g: active.applied, color: p.applied, dash: [5, 3], name: '+ network' });
    }
    if (d.sweep) {
      series.push({ f: d.sweep.freqs, g: d.sweep.gammaLoad, color: p.load, dash: [2, 3], name: 'load' });
      series.push({ f: d.sweep.freqs, g: d.sweep.gamma, color: p.sweep, dash: [], name: 'design' });
    }
    const L = 38, R = 10, T = 10, B = 24;
    ctx.font = '10px "JetBrains Mono Variable", monospace';
    ctx.fillStyle = p.labelDim; ctx.strokeStyle = p.ring; ctx.lineWidth = 1;
    if (!series.length) { ctx.fillText('Enable the sweep or import a trace to plot |Γ| vs frequency.', 8, H / 2); return; }
    const fMin = Math.min(...series.map((x) => x.f[0])), fMax = Math.max(...series.map((x) => x.f[x.f.length - 1]));
    const yMin = -40, yMax = 0;
    const X = (f: number) => L + ((f - fMin) / Math.max(1e-30, fMax - fMin)) * (W - L - R);
    const Y = (db: number) => T + ((yMax - Math.max(yMin, Math.min(yMax, db))) / (yMax - yMin)) * (H - T - B);
    for (let db = 0; db >= -40; db -= 10) {
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(L, Y(db)); ctx.lineTo(W - R, Y(db)); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillText(`${db}`, 6, Y(db) + 3);
    }
    // SWR = 2 reference
    ctx.setLineDash([3, 3]); ctx.strokeStyle = p.guide;
    ctx.beginPath(); ctx.moveTo(L, Y(20 * Math.log10(1 / 3))); ctx.lineTo(W - R, Y(20 * Math.log10(1 / 3))); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = p.labelDim;
    ctx.fillText(fmtFreq(fMin), L, H - 6);
    const tr = fmtFreq(fMax); ctx.fillText(tr, W - R - ctx.measureText(tr).width, H - 6);
    ctx.fillText('|Γ| dB', L + 4, T + 10);
    if (fMin < s.f0 && s.f0 < fMax) { ctx.strokeStyle = p.ring; ctx.beginPath(); ctx.moveTo(X(s.f0), T); ctx.lineTo(X(s.f0), H - B); ctx.stroke(); }
    let lx = L + 60;
    for (const sr of series) {
      ctx.strokeStyle = sr.color; ctx.setLineDash(sr.dash); ctx.lineWidth = 1.8;
      ctx.beginPath();
      sr.f.forEach((f, i) => { const y = Y(20 * Math.log10(Math.max(1e-6, abs(sr.g[i])))); if (i) ctx.lineTo(X(f), y); else ctx.moveTo(X(f), y); });
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = sr.color; ctx.fillText(sr.name, lx, T + 10); lx += ctx.measureText(sr.name).width + 14;
    }
  }
}

