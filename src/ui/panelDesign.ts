/** Design panel: system reference, load entry, and the network chain (load → generator). */
import { type Complex, c, mul, abs, arg, deg, fromPolar, rad } from '../math/complex';
import { zToGamma, gammaToZ, gammaToY, yToGamma, gammaMetrics, normalizeZ } from '../math/smith';
import { formatEngineering, fix, wavelength, formatRect } from '../math/units';
import { type Element, type ElementKind, elementLabel, lumpedImmittance } from '../rf/network';
import { type Store, type AppState, newId } from '../state/store';
import { derive } from '../state/derive';
import { rlText } from './readout';
import { h, numField, segmented, selectField, rebuild, svgIcon } from './dom';

type EntryMode = 'Z' | 'z' | 'Y' | 'G' | 'Gp';
let entryMode: EntryMode = 'Z';

export const PRESETS: Array<{ id: string; name: string; Z0: number; f0: number; ZL: Complex; model: AppState['load']['model']; note: string }> = [
  { id: 'ex22', name: 'Pozar Ex. 2.2 — 40 + j70 Ω on 100 Ω', Z0: 100, f0: 1e9, ZL: c(40, 70), model: 'constant', note: 'Add a 0.3λ line: expect Z_in ≈ 36.5 − j61.1 Ω, |Γ| 0.59, SWR 3.87.' },
  { id: 'ex23', name: 'Pozar Ex. 2.3 — 100 + j50 Ω on 50 Ω', Z0: 50, f0: 1e9, ZL: c(100, 50), model: 'constant', note: 'y_L = 0.4 − j0.2; a 0.15λ line gives y_in ≈ 0.61 + j0.66.' },
  { id: 'ex51', name: 'Pozar Ex. 5.1 — 200 − j100 Ω, 100 Ω, 500 MHz', Z0: 100, f0: 500e6, ZL: c(200, -100), model: 'series', note: 'L-section: shunt C 0.92 pF + series L 38.8 nH, or shunt L 46.1 nH + series C 2.61 pF.' },
  { id: 'ex52', name: 'Pozar Ex. 5.2 — 60 − j80 Ω, 50 Ω, 2 GHz', Z0: 50, f0: 2e9, ZL: c(60, -80), model: 'series', note: 'Shunt short stub: d = 0.110λ, ℓ = 0.095λ (or 0.260λ, 0.405λ).' },
  { id: 'ex53', name: 'Pozar Ex. 5.3 — 100 + j80 Ω, 50 Ω, 2 GHz', Z0: 50, f0: 2e9, ZL: c(100, 80), model: 'series', note: 'Series open stub: d = 0.120λ, ℓ = 0.397λ (or 0.463λ, 0.103λ).' },
  { id: 'ex25', name: 'Pozar Ex. 2.5 — 100 Ω resistor on 50 Ω', Z0: 50, f0: 1e9, ZL: c(100, 0), model: 'constant', note: 'Quarter-wave transformer: Z1 = 70.71 Ω.' },
];

const ICON = {
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  del: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
};

export class DesignPanel {
  readonly el = h('div', { class: 'panel-body' });
  constructor(private store: Store) {
    store.subscribe((s, p) => {
      if (s.Z0 !== p.Z0 || s.f0 !== p.f0 || s.load !== p.load || s.elements !== p.elements || s.selection !== p.selection) this.render();
    });
    this.render();
  }

  private set(fn: (s: AppState) => AppState) { this.store.update(fn); }

  render(): void {
    rebuild(this.el, () => [this.systemSection(), this.loadSection(), this.chainSection()]);
  }

  private systemSection(): HTMLElement {
    const s = this.store.get();
    return h('section', { class: 'card' },
      h('h3', {}, 'Reference'),
      h('div', { class: 'grid2' },
        numField({ label: 'Z0', unit: 'Ω', value: s.Z0, key: 'Z0', min: 1e-6, title: 'System characteristic (reference) impedance. Changing it keeps the load impedance in ohms fixed (renormalises Γ).',
          onCommit: (v) => this.set((st) => {
            // keep the absolute load impedance; re-reference Γ
            const ZL = mul(gammaToZ(st.load.gamma), c(st.Z0, 0));
            return { ...st, Z0: v, load: { ...st.load, gamma: zToGamma(normalizeZ(ZL, v)) } };
          }) }),
        numField({ label: 'Design frequency f0', unit: 'Hz', value: s.f0, key: 'f0', engineering: true, min: 1e-3, onCommit: (v) => this.set((st) => ({ ...st, f0: v })) }),
      ),
      h('p', { class: 'hint' }, `λ0 in free space = ${formatEngineering(wavelength(s.f0), 'm', 4)}`),
    );
  }

  private loadSection(): HTMLElement {
    const s = this.store.get();
    const g = s.load.gamma;
    const z = gammaToZ(g), y = gammaToY(g);
    const Z = mul(z, c(s.Z0, 0)), Y = mul(y, c(1 / s.Z0, 0));
    const setG = (ng: Complex) => this.set((st) => ({ ...st, load: { ...st.load, gamma: ng }, selection: { kind: 'load' } }));
    const pair = (): HTMLElement[] => {
      switch (entryMode) {
        case 'Z': return [
          numField({ label: 'R', unit: 'Ω', value: Z.re, key: 'ZR', onCommit: (v) => setG(zToGamma(normalizeZ(c(v, Z.im), s.Z0))) }),
          numField({ label: 'X', unit: 'Ω', value: Z.im, key: 'ZX', onCommit: (v) => setG(zToGamma(normalizeZ(c(Z.re, v), s.Z0))) })];
        case 'z': return [
          numField({ label: 'r', value: z.re, key: 'zr', onCommit: (v) => setG(zToGamma(c(v, z.im))) }),
          numField({ label: 'x', value: z.im, key: 'zx', onCommit: (v) => setG(zToGamma(c(z.re, v))) })];
        case 'Y': return [
          numField({ label: 'G', unit: 'S', value: Y.re, key: 'YG', engineering: true, onCommit: (v) => setG(yToGamma(c(v * s.Z0, Y.im * s.Z0))) }),
          numField({ label: 'B', unit: 'S', value: Y.im, key: 'YB', engineering: true, onCommit: (v) => setG(yToGamma(c(Y.re * s.Z0, v * s.Z0))) })];
        case 'G': return [
          numField({ label: 'Re Γ', value: g.re, key: 'gr', onCommit: (v) => setG(c(v, g.im)) }),
          numField({ label: 'Im Γ', value: g.im, key: 'gi', onCommit: (v) => setG(c(g.re, v)) })];
        case 'Gp': return [
          numField({ label: '|Γ|', value: abs(g), key: 'gm', min: 0, onCommit: (v) => setG(fromPolar(v, arg(g))) }),
          numField({ label: '∠Γ', unit: '°', value: deg(arg(g)), key: 'ga', onCommit: (v) => setG(fromPolar(abs(g), rad(v))) })];
      }
    };
    const m = gammaMetrics(g);
    const presetSel = h('select', { 'aria-label': 'Textbook example presets', class: 'preset',
      onchange: (e: Event) => {
        const p = PRESETS.find((x) => x.id === (e.target as HTMLSelectElement).value);
        if (!p) return;
        this.set((st) => ({ ...st, Z0: p.Z0, f0: p.f0, load: { gamma: zToGamma(normalizeZ(p.ZL, p.Z0)), model: p.model }, elements: [], selection: { kind: 'load' } }));
        document.dispatchEvent(new CustomEvent('smith:toast', { detail: p.note }));
      } },
      h('option', { value: '' }, 'Load a textbook example…'),
      ...PRESETS.map((p) => h('option', { value: p.id }, p.name)));
    return h('section', { class: `card${s.selection.kind === 'load' ? ' selected' : ''}` },
      h('div', { class: 'card-head' },
        h('h3', {}, h('span', { class: 'swatch load' }), 'Load Z_L'),
        h('button', { class: 'link', type: 'button', onclick: () => this.set((st) => ({ ...st, selection: { kind: 'load' } })) }, 'Inspect')),
      presetSel,
      segmented('Load entry format', [['Z', 'Z Ω'], ['z', 'z'], ['Y', 'Y S'], ['G', 'Γ'], ['Gp', '|Γ|∠']], entryMode, (v) => { entryMode = v; this.render(); }, true),
      h('div', { class: 'grid2' }, ...pair()),
      h('div', { class: 'quick' },
        h('button', { type: 'button', class: 'chip', onclick: () => setG(c(0, 0)) }, 'Match'),
        h('button', { type: 'button', class: 'chip', onclick: () => setG(c(-1, 0)) }, 'Short'),
        h('button', { type: 'button', class: 'chip', onclick: () => setG(c(1, 0)) }, 'Open'),
        h('button', { type: 'button', class: 'chip', title: 'Reflect the load through the centre (Z ↔ Y, a λ/4 rotation)', onclick: () => setG(c(-g.re, -g.im)) }, 'Z↔Y 180°'),
      ),
      h('p', { class: 'mono small' }, `z = ${formatRect(z, 3)} · |Γ| ${fix(m.rho, 3)} ∠${fix(m.angleDeg, 1)}° · SWR ${Number.isFinite(m.vswr) ? fix(m.vswr, 2) : '∞'}`),
      selectField('Frequency model (sweeps)', [['constant', 'Constant Z'], ['series', 'Series R + L/C'], ['parallel', 'Parallel G ‖ L/C']], s.load.model,
        (v) => this.set((st) => ({ ...st, load: { ...st.load, model: v } }))),
    );
  }

  private chainSection(): HTMLElement {
    const s = this.store.get();
    const d = derive(s);
    const add = (kind: ElementKind, extra: Partial<Element> = {}) => {
      const el = makeElement(kind, s, extra);
      this.set((st) => ({ ...st, elements: [...st.elements, el], selection: { kind: 'element', id: el.id } }));
    };
    const cards = s.elements.map((el, i) => this.elementCard(el, i, s));
    const gin = d.input;
    const mi = gammaMetrics(gin);
    const Zin = mul(gammaToZ(gin), c(s.Z0, 0));
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Network'),
        s.elements.length ? h('button', { class: 'link danger', type: 'button', onclick: () => this.set((st) => ({ ...st, elements: [], selection: { kind: 'load' } })) }, 'Clear') : null),
      h('p', { class: 'hint' }, 'Elements are applied from the load toward the generator. Drag any numbered point on the chart to change its value along the correct contour.'),
      h('div', { class: 'add-grid', role: 'group', 'aria-label': 'Add network element' },
        addBtn('Series L', 'seriesL', add), addBtn('Series C', 'seriesC', add), addBtn('Series R', 'seriesR', add),
        addBtn('Shunt L', 'shuntL', add), addBtn('Shunt C', 'shuntC', add), addBtn('Shunt R', 'shuntR', add),
        h('button', { type: 'button', class: 'add line', onclick: () => add('line') }, '+ Line'),
        h('button', { type: 'button', class: 'add stub', onclick: () => add('stub', { connection: 'shunt', termination: 'short' } as Partial<Element>) }, '+ Stub'),
        h('button', { type: 'button', class: 'add xfmr', onclick: () => add('transformer') }, '+ n:1'),
      ),
      h('ol', { class: 'chain', 'aria-label': 'Network elements from load to generator' },
        h('li', { class: 'chain-end' }, h('span', { class: 'swatch load' }), 'Load'),
        ...cards,
        h('li', { class: `chain-end input${s.selection.kind === 'input' ? ' selected' : ''}`, onclick: () => this.set((st) => ({ ...st, selection: { kind: 'input' } })) },
          h('span', { class: 'swatch input' }), 'Input',
          h('span', { class: 'mono small' }, ` ${formatRect(Zin, 2, 'Ω')} · SWR ${Number.isFinite(mi.vswr) ? fix(mi.vswr, 3) : '∞'} · RL ${rlText(mi.returnLossDb)}`)),
      ),
    );
  }

  private elementCard(el: Element, i: number, s: AppState): HTMLElement {
    const upd = (patch: Partial<Element>) => this.set((st) => ({ ...st, elements: st.elements.map((e) => (e.id === el.id ? ({ ...e, ...patch } as Element) : e)) }));
    const move = (dir: -1 | 1) => this.set((st) => {
      const els = st.elements.slice();
      const j = i + dir;
      if (j < 0 || j >= els.length) return st;
      [els[i], els[j]] = [els[j], els[i]];
      return { ...st, elements: els };
    });
    const remove = () => this.set((st) => ({ ...st, elements: st.elements.filter((e) => e.id !== el.id), selection: { kind: 'load' } }));
    const selected = s.selection.kind === 'element' && s.selection.id === el.id;
    const body: Node[] = [];
    const lam = wavelength(s.f0);
    if (el.kind === 'line' || el.kind === 'stub') {
      if (el.kind === 'stub') {
        body.push(h('div', { class: 'row' },
          segmented('Connection', [['shunt', 'Shunt'], ['series', 'Series']], el.connection, (v) => upd({ connection: v } as Partial<Element>), true),
          segmented('Termination', [['short', 'Short'], ['open', 'Open']], el.termination, (v) => upd({ termination: v } as Partial<Element>), true)));
      }
      body.push(h('div', { class: 'grid2' },
        numField({ label: 'Length', unit: 'λ', value: el.lengthWl, key: `${el.id}:len`, min: 0, onCommit: (v) => upd({ lengthWl: v } as Partial<Element>) }),
        numField({ label: 'Electrical', unit: '°', value: el.lengthWl * 360, key: `${el.id}:deg`, min: 0, title: 'βℓ at f0', onCommit: (v) => upd({ lengthWl: v / 360 } as Partial<Element>) }),
        numField({ label: 'Z0 line', unit: 'Ω', value: el.z0, key: `${el.id}:z0`, min: 1e-6, onCommit: (v) => upd({ z0: v } as Partial<Element>) }),
        numField({ label: 'Loss', unit: 'dB', value: el.lossDb, key: `${el.id}:loss`, min: 0, title: 'One-way matched loss αℓ of this section at f0', onCommit: (v) => upd({ lossDb: v } as Partial<Element>) }),
        numField({ label: 'Velocity factor', value: el.vf, key: `${el.id}:vf`, min: 1e-3, onCommit: (v) => upd({ vf: Math.min(1, v) } as Partial<Element>) }),
        h('div', { class: 'readonly' }, h('span', { class: 'field-label' }, 'Physical length'), h('span', { class: 'mono' }, formatEngineering(el.lengthWl * lam * el.vf, 'm', 4))),
      ));
    } else if (el.kind === 'transformer') {
      body.push(numField({ label: 'Turns ratio n (Z_in = n²·Z)', value: el.n, key: `${el.id}:n`, min: 1e-6, onCommit: (v) => upd({ n: v } as Partial<Element>) }));
    } else {
      const unit = el.kind.endsWith('R') ? 'Ω' : el.kind.endsWith('L') ? 'H' : 'F';
      const imm = lumpedImmittance(el, s.f0, s.Z0);
      const series = el.kind.startsWith('series');
      body.push(h('div', { class: 'grid2' },
        numField({ label: 'Value', unit, value: el.value, key: `${el.id}:v`, engineering: true, min: 1e-30, onCommit: (v) => upd({ value: v } as Partial<Element>) }),
        h('div', { class: 'readonly' }, h('span', { class: 'field-label' }, series ? 'z added' : 'y added'),
          h('span', { class: 'mono' }, formatRect(imm, 4))),
      ));
    }
    return h('li', { class: `el-card k-${colorClass(el)}${selected ? ' selected' : ''}`,
      onclick: (e: Event) => { if ((e.target as HTMLElement).closest('input,button,select')) return; this.set((st) => ({ ...st, selection: { kind: 'element', id: el.id } })); } },
      h('div', { class: 'el-head' },
        h('span', { class: 'badge' }, String(i + 1)),
        h('span', { class: 'el-name' }, el.label ?? (el.kind === 'stub' ? `${el.connection === 'shunt' ? 'Shunt' : 'Series'} ${el.termination} stub` : elementLabel[el.kind])),
        h('span', { class: 'el-tools' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move toward load', title: 'Move toward load', onclick: () => move(-1), disabled: i === 0 }, svgIcon(ICON.up, 16)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move toward generator', title: 'Move toward generator', onclick: () => move(1), disabled: i === s.elements.length - 1 }, svgIcon(ICON.down, 16)),
          h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Delete element', title: 'Delete', onclick: remove }, svgIcon(ICON.del, 16)))),
      ...body,
    );
  }
}

function colorClass(el: Element): string {
  if (el.kind === 'line') return 'line';
  if (el.kind === 'transformer') return 'xfmr';
  if (el.kind === 'stub') return el.connection === 'shunt' ? 'shunt' : 'series';
  return el.kind.startsWith('series') ? 'series' : 'shunt';
}

function addBtn(label: string, kind: ElementKind, add: (k: ElementKind) => void): HTMLElement {
  return h('button', { type: 'button', class: `add ${kind.startsWith('series') ? 'series' : 'shunt'}`, onclick: () => add(kind) }, `+ ${label}`);
}

/** New element with a sensible default value: a normalised step of 0.5 at f0. */
export function makeElement(kind: ElementKind, s: AppState, extra: Partial<Element> = {}): Element {
  const w = 2 * Math.PI * s.f0;
  const id = newId('e');
  const X = 0.5 * s.Z0, B = 0.5 / s.Z0;
  let el: Element;
  switch (kind) {
    case 'seriesL': el = { id, kind, value: X / w }; break;
    case 'seriesC': el = { id, kind, value: 1 / (w * X) }; break;
    case 'seriesR': el = { id, kind, value: 0.5 * s.Z0 }; break;
    case 'shuntL': el = { id, kind, value: 1 / (w * B) }; break;
    case 'shuntC': el = { id, kind, value: B / w }; break;
    case 'shuntR': el = { id, kind, value: 2 * s.Z0 }; break;
    case 'line': el = { id, kind, z0: s.Z0, lengthWl: 0.125, lossDb: 0, vf: 1 }; break;
    case 'stub': el = { id, kind, z0: s.Z0, lengthWl: 0.125, lossDb: 0, vf: 1, termination: 'short', connection: 'shunt' }; break;
    case 'transformer': el = { id, kind, n: 1.2 }; break;
  }
  return { ...el, ...extra } as Element;
}

