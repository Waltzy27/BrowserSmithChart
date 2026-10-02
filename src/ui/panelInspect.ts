/** Inspector: every equivalent form of the selected point, plus construction measurements. */
import { type Complex, abs, sub, deg, c } from '../math/complex';
import { gammaMetrics, wtgFromAngle, wtlFromAngle } from '../math/smith';
import { fix } from '../math/units';
import { elementLabel } from '../rf/network';
import type { Store, AppState } from '../state/store';
import { derive, interpolateTrace } from '../state/derive';
import { h, rebuild, svgIcon } from './dom';
import { pointRows, describePoint } from './readout';

export function selectedPoint(s: AppState): { name: string; gamma: Complex; f: number } {
  const d = derive(s);
  const sel = s.selection;
  if (sel.kind === 'element') {
    const i = s.elements.findIndex((e) => e.id === sel.id);
    if (i >= 0) {
      const el = s.elements[i];
      return { name: `After ${i + 1}: ${el.kind === 'stub' ? `${el.connection} ${el.termination} stub` : elementLabel[el.kind]}`, gamma: d.states[i + 1], f: s.f0 };
    }
  }
  if (sel.kind === 'input') return { name: 'Input (generator side)', gamma: d.input, f: s.f0 };
  if (sel.kind === 'marker') {
    const m = s.markers.find((x) => x.id === sel.id);
    const tr = m && d.traces.find((t) => t.trace.id === m.traceId);
    if (m && tr) {
      const g = interpolateTrace(tr.trace.freqs, tr.applied ?? tr.gamma, m.f).gamma;
      return { name: `Marker M${s.markers.indexOf(m) + 1} · ${tr.trace.name} ${tr.trace.param}${tr.applied ? ' + network' : ''}`, gamma: g, f: m.f };
    }
  }
  return { name: 'Load', gamma: d.states[0], f: s.f0 };
}

export class InspectPanel {
  readonly el = h('div', { class: 'panel-body' });
  private cursorBox = h('div', { class: 'card cursor-card' });
  constructor(private store: Store) {
    store.subscribe(() => this.render());
    this.setCursor(null);
    this.render();
  }

  setCursor(g: Complex | null): void {
    const s = this.store.get();
    if (!g) { this.cursorBox.replaceChildren(h('h3', {}, 'Cursor'), h('p', { class: 'hint' }, 'Hover or touch the chart to read any point.')); return; }
    const rows = pointRows(g, s.Z0, s.f0).filter((r) => ['Γ', '|Γ| ∠ θ', 'z = Z/Z0', 'Z', 'y = Y·Z0', 'VSWR', 'Return loss', 'WTG / WTL'].includes(r.k));
    this.cursorBox.replaceChildren(h('h3', {}, 'Cursor'), table(rows));
  }

  render(): void {
    const s = this.store.get();
    const d = derive(s);
    const pt = selectedPoint(s);
    rebuild(this.el, () => {
      const options: Array<[string, string, () => void]> = [
        ['load', 'Load', () => this.store.update((st) => ({ ...st, selection: { kind: 'load' } }), false)],
        ...s.elements.map((el, i): [string, string, () => void] => [`el:${el.id}`, String(i + 1), () => this.store.update((st) => ({ ...st, selection: { kind: 'element', id: el.id } }), false)]),
        ...(s.elements.length ? [['input', 'Input', () => this.store.update((st) => ({ ...st, selection: { kind: 'input' } }), false)] as [string, string, () => void]] : []),
        ...s.markers.map((m, i): [string, string, () => void] => [`m:${m.id}`, `M${i + 1}`, () => this.store.update((st) => ({ ...st, selection: { kind: 'marker', id: m.id } }), false)]),
      ];
      const cur = s.selection.kind === 'element' ? `el:${s.selection.id}` : s.selection.kind === 'marker' ? `m:${s.selection.id}` : s.selection.kind === 'input' ? 'input' : 'load';
      const picker = h('div', { class: 'seg seg-sm wrap', role: 'radiogroup', 'aria-label': 'Point to inspect' },
        ...options.map(([k, l, fn]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === cur), class: k === cur ? 'on' : '', onclick: fn }, l)));
      const main = h('section', { class: 'card' },
        h('h3', {}, pt.name),
        h('p', { class: 'sr-only', 'aria-live': 'polite' }, describePoint(pt.name, pt.gamma, s.Z0)),
        picker,
        groupedTable(pointRows(pt.gamma, s.Z0, pt.f)));
      const cons = this.constructionsCard(s);
      void d;
      return [main, this.cursorBox, cons];
    });
  }

  private constructionsCard(s: AppState): HTMLElement {
    const items = s.constructions.map((k, i) => {
      let text = '';
      if (k.type === 'circle') {
        const centred = Math.hypot(k.cx, k.cy) < 1e-9;
        const m = gammaMetrics(c(k.r, 0));
        text = centred
          ? `Compass circle at centre · |Γ| ${fix(k.r, 4)} · SWR ${fix(m.vswr, 3)} · RL ${fix(m.returnLossDb, 2)} dB`
          : `Compass circle · centre ${fix(k.cx, 3)}, ${fix(k.cy, 3)} · radius ${fix(k.r, 4)}`;
      } else if (k.type === 'radial') {
        const a = deg(k.angle);
        text = `Radial · ∠${fix(a, 2)}° · WTG ${fix(wtgFromAngle(a), 4)}λ · WTL ${fix(wtlFromAngle(a), 4)}λ`;
      } else {
        text = `Dividers · |ΔΓ| = ${fix(abs(sub(c(k.bx, k.by), c(k.ax, k.ay))), 4)}`;
      }
      const sel = s.selection.kind === 'construction' && s.selection.id === k.id;
      return h('li', { class: sel ? 'selected' : '' },
        h('button', { type: 'button', class: 'link', onclick: () => this.store.update((st) => ({ ...st, selection: { kind: 'construction', id: k.id } }), false) }, `${i + 1}.`),
        h('span', { class: 'mono small' }, text),
        h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Delete construction', onclick: () => this.store.update((st) => ({ ...st, constructions: st.constructions.filter((x) => x.id !== k.id), selection: { kind: 'load' } })) },
          svgIcon('<path d="M6 6l12 12M18 6L6 18"/>', 14)));
    });
    const radials = s.constructions.filter((k) => k.type === 'radial') as Array<{ angle: number }>;
    let delta: HTMLElement | null = null;
    if (radials.length >= 2) {
      const a1 = deg(radials[radials.length - 2].angle), a2 = deg(radials[radials.length - 1].angle);
      const dl = (((wtgFromAngle(a2) - wtgFromAngle(a1)) % 0.5) + 0.5) % 0.5;
      delta = h('p', { class: 'mono small accent' }, `Last two radials: Δ = ${fix(dl, 4)} λ toward generator (${fix(dl === 0 ? 0 : 0.5 - dl, 4)} λ toward load) · ${fix(dl * 720, 2)}° of Γ rotation`);
    }
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Constructions'),
        s.constructions.length ? h('button', { type: 'button', class: 'link danger', onclick: () => this.store.update((st) => ({ ...st, constructions: [] })) }, 'Clear all') : null),
      items.length ? h('ol', { class: 'cons-list' }, ...items) : h('p', { class: 'hint' }, 'Use the compass, protractor, and dividers tools to draw on the chart. Compass and dividers snap to the centre and to design points.'),
      delta);
  }
}

function table(rows: Array<{ k: string; v: string; title?: string }>): HTMLElement {
  return h('dl', { class: 'readout' }, ...rows.flatMap((r) => [h('dt', { title: r.title }, r.k), h('dd', { class: 'mono' }, r.v)]));
}
function groupedTable(rows: Array<{ k: string; v: string; group: string; title?: string }>): HTMLElement {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group)!.push(r); }
  return h('div', { class: 'groups' }, ...[...groups.entries()].map(([g, rs]) => h('div', { class: 'group' }, h('h4', {}, g), table(rs))));
}

