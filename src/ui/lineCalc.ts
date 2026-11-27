/**
 * LineCalc mode: microstrip analysis/synthesis, stub ⇄ L/C converter and
 * quarter-wave helper. All maths lives in src/tl (DOM-free, SI units); this
 * file only converts units, lays out the form and talks to the Store.
 *
 * Inputs commit to the Store on Enter/blur like every other field in the app,
 * and the result areas also update live while typing (preview only, no undo
 * step) through `live()`, which rebuilds just the registered result regions.
 */
import { formatEngineering, toSig, fix, wavelength } from '../math/units';
import { NP_TO_DB, F_MIN, F_MAX, substrateError, type Validity } from '../tl/microstrip';
import { solveLine } from '../tl/linecalc';
import { designStub, stubSweep, stubBandwidth, stubReactance, type StubSpec, type StubDesign, type StubPart } from '../tl/stub';
import { quarterWaveMicrostrip } from '../tl/helpers';
import { STACKUP_PRESETS, serializeStackup, parseStackup, type Stackup } from '../tl/stackup';
import type { Element } from '../rf/network';
import type { AppState, LineCalcState, Store } from '../state/store';
import { makeElement } from './panelDesign';
import { h, numField, segmented, selectField, download, toast } from './dom';

type LC = LineCalcState;
type Region = { el: HTMLElement; build: (s: AppState) => Node[] };

const mm = (m: number, d = 4) => `${toSig(m * 1e3, d)} mm`;
const db = (x: number) => `${toSig(x, 3)} dB`;
const ohm = (z: number, d = 5) => `${toSig(z, d)} Ω`;

export class LineCalcView {
  readonly el = h('section', { class: 'linecalc', 'aria-label': 'LineCalc microstrip calculator' });
  /** Switch to the Smith chart Equations tab (wired by main.ts). */
  onShowEquations: () => void = () => {};
  private regions: Region[] = [];
  private visible = false;
  private dirty = true;
  private fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });

  constructor(private store: Store) {
    this.fileInput.addEventListener('change', () => this.importStackup());
    store.subscribe((s, p) => {
      if (s.lineCalc !== p.lineCalc || s.f0 !== p.f0 || s.Z0 !== p.Z0 || s.mode !== p.mode) {
        this.dirty = true;
        if (this.visible) this.render();
      }
    });
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v && this.dirty) this.render();
  }

  private set(fn: (lc: LC) => LC): void {
    this.store.update((s) => ({ ...s, lineCalc: fn(s.lineCalc) }));
  }
  /** Preview a change without committing it: rebuild only the result regions. */
  private live(fn: (s: AppState) => AppState): void {
    const ps = fn(this.store.get());
    for (const r of this.regions) r.el.replaceChildren(...r.build(ps));
  }
  private liveLc(fn: (lc: LC) => LC): void { this.live((s) => ({ ...s, lineCalc: fn(s.lineCalc) })); }
  private region(cls: string, build: (s: AppState) => Node[]): HTMLElement {
    const el = h('div', { class: cls, 'aria-live': 'polite' });
    this.regions.push({ el, build });
    el.replaceChildren(...build(this.store.get()));
    return el;
  }

  render(): void {
    this.dirty = false;
    const active = document.activeElement as HTMLElement | null;
    const key = active && this.el.contains(active) ? active.getAttribute('data-key') : null;
    const scroll = this.el.scrollTop;
    this.regions = [];
    const s = this.store.get();
    this.el.replaceChildren(
      h('div', { class: 'lc-head' },
        h('div', {},
          h('h2', {}, 'LineCalc — microstrip'),
          h('p', { class: 'hint' }, 'Closed-form first-pass design values (Hammerstad–Jensen, Kirschning–Jansen), not an EM simulation. Check critical parts with an EM solver or a test coupon.')),
        h('button', { type: 'button', class: 'btn', onclick: () => this.onShowEquations() }, 'Show equations')),
      ...(o => o ? [o] : [])(this.origin(s)),
      h('div', { class: 'lc-grid' },
        this.referenceCard(s),
        this.stackupCard(s),
        this.lineCard(s),
        this.stubCard(s),
        this.qwCard(s),
        this.limitsCard()),
      this.fileInput,
    );
    this.el.scrollTop = scroll;
    if (key) this.el.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  }

  /* ---------------- cards ---------------- */

  private origin(s: AppState): Node | null {
    const o = s.lineCalc.origin;
    if (!o) return null;
    return h('div', { class: 'lc-origin' },
      h('span', {}, `Prefilled from the Smith chart: ${o.label}. `,
        o.kind === 'stub' && o.term === 'open' ? 'For an open stub, draw the length shown in the stub card (it subtracts the open-end extension ΔL).' : ''),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: () => this.store.update((st) => ({ ...st, lineCalc: { ...st.lineCalc, origin: null } }), false) }, '×'));
  }

  private referenceCard(s: AppState): HTMLElement {
    return card('Frequency and reference',
      h('div', { class: 'grid2' },
        numField({ label: 'Frequency f0', unit: 'Hz', value: s.f0, key: 'lc:f0', engineering: true, min: 1e-9, title: 'Shared with the Smith chart',
          onCommit: (v) => this.store.update((st) => ({ ...st, f0: v })), onLive: (v) => this.live((st) => ({ ...st, f0: v })) }),
        numField({ label: 'System Z0', unit: 'Ω', value: s.Z0, key: 'lc:Z0', min: 1e-6, title: 'Shared with the Smith chart; default for new lines and stubs',
          onCommit: (v) => this.store.update((st) => ({ ...st, Z0: v })) })),
      this.region('', (ps) => {
        const f = ps.f0;
        return [h('p', { class: f < F_MIN || f > F_MAX ? 'hint warn' : 'hint' },
          f < F_MIN || f > F_MAX ? `f0 is outside the 100 MHz – 15 GHz design range of LineCalc.` : `Design range 100 MHz – 15 GHz. λ0 = ${mm(wavelength(f))}. f0 and Z0 are shared with the Smith chart.`)];
      }));
  }

  private stackupCard(s: AppState): HTMLElement {
    const st = s.lineCalc.stackup;
    const presetIdx = STACKUP_PRESETS.findIndex((p) => p.er === st.er && p.h === st.h && p.t === st.t && p.tanD === st.tanD && p.sigma === st.sigma && p.rough === st.rough);
    const setSt = (patch: Partial<Stackup>) => this.set((lc) => ({ ...lc, stackup: { ...lc.stackup, ...patch, name: presetIdx >= 0 && !('name' in patch) ? 'Custom' : (patch.name ?? lc.stackup.name) } }));
    const liveSt = (patch: Partial<Stackup>) => this.liveLc((lc) => ({ ...lc, stackup: { ...lc.stackup, ...patch } }));
    const f = (label: string, k: keyof Stackup, unit: string, scale: number, title?: string, engineering = false) => numField({
      label, unit, value: (st[k] as number) * scale, key: `lc:st:${k}`, min: 0, title, engineering,
      onCommit: (v) => setSt({ [k]: v / scale }), onLive: (v) => liveSt({ [k]: v / scale }),
    });
    const err = substrateError(st);
    return card('Substrate stackup',
      selectField<string>('Preset', [...STACKUP_PRESETS.map((p, i) => [String(i), p.name] as [string, string]), ['custom', presetIdx >= 0 ? 'Custom…' : `Custom: ${st.name}`]],
        presetIdx >= 0 ? String(presetIdx) : 'custom',
        (v) => { if (v !== 'custom') this.set((lc) => ({ ...lc, stackup: { ...STACKUP_PRESETS[Number(v)] } })); }),
      h('div', { class: 'grid2' },
        f('Dielectric constant εr', 'er', '', 1, 'Relative permittivity (design Dk)'),
        f('Substrate height h', 'h', 'mm', 1e3, 'Dielectric thickness between strip and ground'),
        f('Copper thickness t', 't', 'µm', 1e6, '35 µm = 1 oz, 17.5 µm = ½ oz; 0 = infinitely thin'),
        f('Loss tangent tanδ', 'tanD', '', 1),
        f('Conductivity σ', 'sigma', 'S/m', 1, 'Copper 5.8e7 S/m (58M)', true),
        f('Roughness Δ (RMS)', 'rough', 'µm', 1e6, '0 = smooth (off)')),
      err ? h('p', { class: 'hint warn' }, err) : null,
      h('p', { class: 'hint' }, 'Roughness uses the simple Hammerstad–Bekkadal multiplier on conductor loss only; it does not change Z0 or phase.'),
      h('p', { class: 'hint' }, 'Presets are typical values. Use your fabricator\'s stackup for real boards.'),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => download(`${st.name.replace(/[^\w.-]+/g, '_') || 'stackup'}.stackup.json`, serializeStackup(st), 'application/json') }, 'Export stackup JSON'),
        h('button', { type: 'button', class: 'btn', onclick: () => { this.fileInput.value = ''; this.fileInput.click(); } }, 'Import stackup JSON')));
  }

  private async importStackup(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    try {
      const st = parseStackup(await file.text());
      this.set((lc) => ({ ...lc, stackup: st }));
      toast(`Loaded stackup “${st.name}”.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  private lineCard(s: AppState): HTMLElement {
    const lc = s.lineCalc;
    const wIn = lc.widthGiven === 'W', lIn = lc.lengthGiven === 'L';
    const solved = (label: string, build: (ps: AppState) => string) =>
      h('div', { class: 'readonly solved' }, h('span', { class: 'field-label' }, label, ' ', h('span', { class: 'tag' }, 'solved')),
        this.region('mono', (ps) => [document.createTextNode(build(ps))]));
    const sol = (ps: AppState) => solveLine(ps.lineCalc, ps.f0);
    return card('Microstrip line',
      h('div', { class: 'row' },
        h('span', { class: 'lc-pair' }, h('span', { class: 'field-label' }, 'Width'),
        segmented<'W' | 'Z0'>('Width input', [['Z0', 'Z0 → W', 'Enter Z0, solve the width'], ['W', 'W → Z0', 'Enter the width, analyse Z0']], lc.widthGiven, (v) => this.set((x) => ({ ...x, widthGiven: v })), true)),
        h('span', { class: 'lc-pair' }, h('span', { class: 'field-label' }, 'Length'),
        segmented<'angle' | 'L'>('Length input', [['angle', 'θ → L', 'Enter the electrical length, solve L'], ['L', 'L → θ', 'Enter the physical length, analyse θ']], lc.lengthGiven, (v) => this.set((x) => ({ ...x, lengthGiven: v })), true))),
      h('div', { class: 'grid2' },
        wIn
          ? numField({ label: 'Width W', unit: 'mm', value: lc.W * 1e3, key: 'lc:W', min: 0, onCommit: (v) => this.set((x) => ({ ...x, W: v / 1e3 })), onLive: (v) => this.liveLc((x) => ({ ...x, W: v / 1e3 })) })
          : numField({ label: 'Target Z0', unit: 'Ω', value: lc.z0Target, key: 'lc:z0t', min: 0, onCommit: (v) => this.set((x) => ({ ...x, z0Target: v })), onLive: (v) => this.liveLc((x) => ({ ...x, z0Target: v })) }),
        wIn ? solved('Z0 at f0', (ps) => { const r = sol(ps); return r.ok ? ohm(r.analysis.z0) : '—'; })
          : solved('Width W', (ps) => { const r = sol(ps); return r.ok ? mm(r.W) : '—'; }),
        lIn
          ? numField({ label: 'Physical length L', unit: 'mm', value: lc.L * 1e3, key: 'lc:L', min: 0, onCommit: (v) => this.set((x) => ({ ...x, L: v / 1e3 })), onLive: (v) => this.liveLc((x) => ({ ...x, L: v / 1e3 })) })
          : numField({ label: 'Electrical length θ', unit: '°', value: lc.angleDeg, key: 'lc:ang', min: 0, onCommit: (v) => this.set((x) => ({ ...x, angleDeg: v })), onLive: (v) => this.liveLc((x) => ({ ...x, angleDeg: v })) }),
        lIn ? solved('Electrical length θ', (ps) => { const r = sol(ps); return r.ok ? `${fix(r.q.thetaDeg, 3)}°` : '—'; })
          : solved('Physical length L', (ps) => { const r = sol(ps); return r.ok ? mm(r.L) : '—'; })),
      this.region('lc-results', (ps) => {
        const r = sol(ps);
        if (!r.ok) return [h('p', { class: 'lc-error', role: 'alert' }, r.error)];
        const a = r.analysis, q = r.q;
        return [
          validityBadge(a.warnings),
          h('dl', { class: 'kv' },
            kv('Z0 (f0) / static', `${ohm(a.z0)} / ${ohm(a.z0Static)}`),
            kv('εeff (f0) / static', `${toSig(a.eeff, 5)} / ${toSig(a.eeffStatic, 5)}`),
            kv('W / h', toSig(a.u, 4)),
            kv('Electrical length', `${fix(q.thetaDeg, 3)}° = ${toSig(q.lengthWl, 4)} λg`),
            kv('Guided wavelength λg', mm(a.lambdaG)),
            kv('λg / 4 (quarter-wave length)', mm(a.lambdaG / 4)),
            kv('Phase velocity', `${toSig(1 / Math.sqrt(a.eeff), 4)} c`),
            kv('Conductor loss', `${db(q.lossCdB)}  (${toSig(a.alphaC * NP_TO_DB / 100, 3)} dB/cm)`),
            kv('Dielectric loss', `${db(q.lossDdB)}  (${toSig(a.alphaD * NP_TO_DB / 100, 3)} dB/cm)`),
            kv('Total loss', db(q.lossdB)),
            kv('Skin depth δs / roughness K', `${toSig(a.skinDepth * 1e6, 3)} µm / ${toSig(a.Kr, 4)}`)),
        ];
      }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => this.sendLine() }, 'Send line to Smith chart')));
  }

  private stubSpec(ps: AppState): StubSpec {
    const st = ps.lineCalc.stub;
    return { part: st.part, value: st.values[st.part], term: st.term, z0: st.z0, f0: ps.f0 };
  }

  private stubCard(s: AppState): HTMLElement {
    const sb = s.lineCalc.stub;
    const setStub = (patch: Partial<LC['stub']>) => this.set((lc) => ({ ...lc, stub: { ...lc.stub, ...patch } }));
    const unit: Record<StubPart, string> = { L: 'H', C: 'F', X: 'Ω' };
    const label: Record<StubPart, string> = { L: 'Inductance L', C: 'Capacitance C', X: 'Reactance X (+ inductive)' };
    const setVal = (v: number) => setStub({ values: { ...sb.values, [sb.part]: v } });
    return card('Stub ⇄ L / C converter',
      h('div', { class: 'row' },
        segmented<StubPart>('Component', [['L', 'Inductor'], ['C', 'Capacitor'], ['X', 'Reactance']], sb.part, (v) => setStub({ part: v }), true),
        segmented<'short' | 'open'>('Termination', [['short', 'Short'], ['open', 'Open']], sb.term, (v) => setStub({ term: v }), true),
        segmented<'shunt' | 'series'>('Connection', [['shunt', 'Shunt'], ['series', 'Series']], sb.conn, (v) => setStub({ conn: v }), true)),
      h('div', { class: 'grid2' },
        numField({ label: label[sb.part], unit: unit[sb.part], value: sb.values[sb.part], key: `lc:stub:${sb.part}`, engineering: sb.part !== 'X', min: sb.part === 'X' ? undefined : 0,
          onCommit: setVal, onLive: (v) => this.liveLc((lc) => ({ ...lc, stub: { ...lc.stub, values: { ...lc.stub.values, [lc.stub.part]: v } } })) }),
        numField({ label: 'Stub Z0', unit: 'Ω', value: sb.z0, key: 'lc:stub:z0', min: 0, title: 'Characteristic impedance of the stub line',
          onCommit: (v) => setStub({ z0: v }), onLive: (v) => this.liveLc((lc) => ({ ...lc, stub: { ...lc.stub, z0: v } })) })),
      this.region('lc-results', (ps) => {
        const spec = this.stubSpec(ps);
        const d = designStub(spec, ps.lineCalc.stackup);
        if (!d.ok) return [h('p', { class: 'lc-error', role: 'alert' }, d.error)];
        const conn = ps.lineCalc.stub.conn;
        const bw = stubBandwidth(d, spec, ps.lineCalc.stackup);
        const capped = bw.fHi >= 4 * spec.f0 - 1 || bw.fLo <= spec.f0 * 1e-3 + 1;
        const nodes: Node[] = [
          validityBadge(d.analysis.warnings),
          h('dl', { class: 'kv' },
            kv('Target reactance at f0', `${toSig(d.X, 5)} Ω  (${d.X > 0 ? 'L = ' + formatEngineering(d.X / (2 * Math.PI * spec.f0), 'H', 4) : 'C = ' + formatEngineering(-1 / (2 * Math.PI * spec.f0 * d.X), 'F', 4)})`),
            kv('Stub electrical length θ', `${fix(d.thetaDeg, 3)}° = ${toSig(d.lengthWl, 4)} λ`),
            kv('Stub width W', `${mm(d.W)}  (Z0 ${ohm(d.analysis.z0, 4)})`),
            kv('Length for θ', mm(d.Lelec)),
            spec.term === 'open' ? kv('Open-end extension ΔL', `− ${mm(d.dL)}  (Kirschning–Jansen–Koster)`) : null,
            kv(spec.term === 'open' ? 'Length to draw (L − ΔL)' : 'Length to draw (to via centre)', mm(d.Lphys), true),
            kv('Bandwidth, error ≤ 5 %', `${formatEngineering(bw.fLo, 'Hz', 4)} – ${formatEngineering(bw.fHi, 'Hz', 4)}${capped ? ' (search limit)' : ''}, ${toSig(bw.fractional * 100, 3)} % of f0`)),
          ...d.warnings.map((w) => h('p', { class: 'hint warn' }, w)),
          stubPlot(d, spec, ps),
          h('p', { class: 'hint' }, 'Tee junction: the stub joins the main line at a tee, which adds its own reactance and shifts the reference plane by roughly half the main-line width. Measure the stub length from the main-line edge and expect to trim; the tee is not modelled here.'),
        ];
        if (conn === 'series') nodes.push(h('p', { class: 'hint warn' }, 'Series stubs cannot be built directly in microstrip (the stub needs a floating ground, as in CPW, slotline or coax). The θ and reactance are still correct, and the Smith chart models the series stub exactly.'));
        return nodes;
      }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => this.sendStub() }, 'Send stub to Smith chart'),
        h('button', { type: 'button', class: 'btn', onclick: () => setStub({ term: sb.term === 'open' ? 'short' : 'open' }) }, `Try ${sb.term === 'open' ? 'short' : 'open'} stub`)));
  }

  private qwCard(s: AppState): HTMLElement {
    const qw = s.lineCalc.qw;
    return card('Quarter-wave transformer',
      h('div', { class: 'grid2' },
        numField({ label: 'Source Zs', unit: 'Ω', value: qw.zs, key: 'lc:qw:zs', min: 0, onCommit: (v) => this.set((lc) => ({ ...lc, qw: { ...lc.qw, zs: v } })), onLive: (v) => this.liveLc((lc) => ({ ...lc, qw: { ...lc.qw, zs: v } })) }),
        numField({ label: 'Load ZL (real)', unit: 'Ω', value: qw.zl, key: 'lc:qw:zl', min: 0, onCommit: (v) => this.set((lc) => ({ ...lc, qw: { ...lc.qw, zl: v } })), onLive: (v) => this.liveLc((lc) => ({ ...lc, qw: { ...lc.qw, zl: v } })) })),
      this.region('lc-results', (ps) => {
        const r = quarterWaveMicrostrip(ps.lineCalc.qw.zs, ps.lineCalc.qw.zl, ps.lineCalc.stackup, ps.f0);
        if (!r.ok) return [h('p', { class: 'lc-error', role: 'alert' }, r.error)];
        return [
          validityBadge(r.analysis.warnings),
          h('dl', { class: 'kv' },
            kv('Transformer Zt = √(Zs·ZL)', ohm(r.Zt)),
            kv('Width W', mm(r.W), true),
            kv('Length L (90° at f0)', mm(r.L), true),
            kv('εeff (f0)', toSig(r.analysis.eeff, 5))),
          h('p', { class: 'hint' }, 'Matches only at f0 (and odd multiples); both ends must be real. For a complex load, first rotate it to a real point on the Smith chart.'),
        ];
      }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => this.sendQw() }, 'Send transformer to Smith chart')));
  }

  private limitsCard(): HTMLElement {
    return card('Formula limits',
      h('ul', { class: 'lc-limits' },
        h('li', {}, 'Static Z0 and εeff (Hammerstad–Jensen 1980): better than 0.2 % for 0.01 ≤ W/h ≤ 100 and εr ≤ 128.'),
        h('li', {}, 'Dispersion εeff(f) (Kirschning–Jansen 1982): 0.6 % for 0.1 ≤ W/h ≤ 100, 1 ≤ εr ≤ 20, h/λ0 ≤ 0.13.'),
        h('li', {}, 'Dispersion Z0(f) (Jansen–Kirschning 1983): 2.5 % for 0.1 ≤ W/h ≤ 10, εr ≤ 18, f·h ≤ 20 GHz·mm.'),
        h('li', {}, 'Thickness correction: assumed valid for t/h ≤ 0.2 and t < W/2.'),
        h('li', {}, 'Conductor loss is the least accurate output: smooth or lightly rough copper, t > 3δs, no current crowding at very narrow widths.'),
        h('li', {}, 'Open-end ΔL (Kirschning–Jansen–Koster 1981): about 2.5 % for 0.01 ≤ W/h ≤ 100, εr ≤ 50.'),
        h('li', {}, 'Not modelled: tee junctions, bends, vias, coupling to nearby traces, solder mask, radiation and surface waves.')),
      h('p', { class: 'hint' }, 'Any input outside these limits shows a warning badge on the result. Treat every value as a starting point for an EM check or a measured coupon.'));
  }

  /* ---------------- bridges to the chart ---------------- */

  private push(el: Element, what: string): void {
    this.store.update((st) => ({ ...st, elements: [...st.elements, el], selection: { kind: 'element', id: el.id }, mode: 'smith' }));
    toast(`${what} added to the Smith chart as element ${this.store.get().elements.length}.`);
  }

  private sendLine(): void {
    const s = this.store.get();
    const r = solveLine(s.lineCalc, s.f0);
    if (!r.ok) { toast(r.error, 'error'); return; }
    this.push(makeElement('line', s, {
      z0: r.analysis.z0, lengthWl: r.q.lengthWl, lossDb: r.q.lossdB, vf: 1 / Math.sqrt(r.analysis.eeff),
      label: `Microstrip ${toSig(r.W * 1e3, 3)} × ${toSig(r.L * 1e3, 4)} mm`,
    } as Partial<Element>), 'Microstrip line');
  }

  private sendStub(): void {
    const s = this.store.get();
    const spec = this.stubSpec(s);
    const d = designStub(spec, s.lineCalc.stackup);
    if (!d.ok) { toast(d.error, 'error'); return; }
    const a = d.analysis;
    this.push(makeElement('stub', s, {
      z0: a.z0, lengthWl: d.lengthWl, lossDb: (a.alphaC + a.alphaD) * d.Lelec * NP_TO_DB, vf: 1 / Math.sqrt(a.eeff),
      termination: spec.term, connection: s.lineCalc.stub.conn,
      label: `${s.lineCalc.stub.conn === 'shunt' ? 'Shunt' : 'Series'} ${spec.term} stub ${toSig(d.W * 1e3, 3)} × ${toSig(d.Lphys * 1e3, 4)} mm`,
    } as Partial<Element>), 'Stub');
  }

  private sendQw(): void {
    const s = this.store.get();
    const r = quarterWaveMicrostrip(s.lineCalc.qw.zs, s.lineCalc.qw.zl, s.lineCalc.stackup, s.f0);
    if (!r.ok) { toast(r.error, 'error'); return; }
    const a = r.analysis;
    this.push(makeElement('line', s, {
      z0: a.z0, lengthWl: 0.25, lossDb: (a.alphaC + a.alphaD) * r.L * NP_TO_DB, vf: 1 / Math.sqrt(a.eeff),
      label: `λ/4 ${toSig(r.Zt, 4)} Ω: ${toSig(r.W * 1e3, 3)} × ${toSig(r.L * 1e3, 4)} mm`,
    } as Partial<Element>), 'Quarter-wave transformer');
  }
}

/** "Microstrip dimensions" on a chart line/stub: prefill LineCalc and switch to it. */
export function lineCalcFromElement(s: AppState, el: Element, index: number): AppState {
  if (el.kind !== 'line' && el.kind !== 'stub') return s;
  const lc = s.lineCalc;
  const name = el.label ?? (el.kind === 'stub' ? `${el.connection} ${el.termination} stub` : 'line');
  const next: LC = {
    ...lc, widthGiven: 'Z0', z0Target: el.z0, lengthGiven: 'angle', angleDeg: el.lengthWl * 360,
    origin: { kind: el.kind, term: el.kind === 'stub' ? el.termination : undefined, label: `element ${index + 1} (${name}), Z0 ${toSig(el.z0, 4)} Ω, θ ${toSig(el.lengthWl * 360, 4)}°` },
  };
  if (el.kind === 'stub') {
    const X = stubReactance(2 * Math.PI * el.lengthWl, el.z0, el.termination);
    if (Number.isFinite(X) && Math.abs(X) > 1e-9 && Math.abs(X) < 1e9) {
      next.stub = { ...lc.stub, part: 'X', values: { ...lc.stub.values, X }, term: el.termination, conn: el.connection, z0: el.z0 };
    }
  }
  return { ...s, lineCalc: next, mode: 'linecalc' };
}

/* ---------------- small view helpers ---------------- */

function card(title: string, ...children: Array<Node | null>): HTMLElement {
  return h('div', { class: 'card lc-card' }, h('h3', {}, title), ...children);
}

function kv(label: string, value: string, strong = false): HTMLElement {
  return h('div', { class: strong ? 'kv-row strong' : 'kv-row' }, h('dt', {}, label), h('dd', { class: 'mono' }, value));
}

function validityBadge(w: Validity[]): HTMLElement {
  if (!w.length) return h('div', { class: 'lc-badge ok' }, 'Inputs are within the stated formula limits');
  return h('div', { class: 'lc-badge warn', role: 'status' },
    h('strong', {}, `Outside formula limits (${w.length}) — results are less reliable`),
    h('ul', {}, ...w.map((x) => h('li', {}, x.message))));
}

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Stub reactance vs frequency against the ideal L or C, with the 5 % band shaded. */
function stubPlot(d: StubDesign, spec: StubSpec, ps: AppState): Node {
  const W = 360, H = 200, ml = 46, mr = 10, mt = 10, mb = 30;
  const fMin = 0.05 * spec.f0, fMax = 2 * spec.f0;
  const pts = stubSweep(d, spec, ps.lineCalc.stackup, fMin, fMax, 241);
  const bw = stubBandwidth(d, spec, ps.lineCalc.stackup);
  const X0 = Math.abs(d.X), ylim = 3 * X0;
  const x = (f: number) => ml + ((f - fMin) / (fMax - fMin)) * (W - ml - mr);
  const y = (X: number) => mt + ((ylim - X) / (2 * ylim)) * (H - mt - mb);
  const path = (key: 'X' | 'Xideal') => {
    let dStr = '', pen = false, prev = NaN;
    for (const p of pts) {
      const v = p[key];
      const jump = Number.isFinite(prev) && Math.sign(v) !== Math.sign(prev) && Math.abs(v - prev) > ylim;
      if (!Number.isFinite(v) || Math.abs(v) > ylim * 1.02 || jump) { pen = false; prev = v; continue; }
      dStr += `${pen ? 'L' : 'M'}${x(p.f).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true; prev = v;
    }
    return dStr;
  };
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc-plot', role: 'img', 'aria-label': 'Stub reactance against the ideal component versus frequency' });
  const lo = Math.max(bw.fLo, fMin), hi = Math.min(bw.fHi, fMax);
  if (hi > lo) root.append(svg('rect', { x: x(lo), y: mt, width: x(hi) - x(lo), height: H - mt - mb, class: 'band' }));
  for (const yv of [-2 * X0, -X0, 0, X0, 2 * X0]) {
    root.append(svg('line', { x1: ml, x2: W - mr, y1: y(yv), y2: y(yv), class: yv === 0 ? 'axis' : 'grid' }));
    root.append(svg('text', { x: ml - 4, y: y(yv) + 3, 'text-anchor': 'end', class: 'tick' }, toSig(yv, 3)));
  }
  for (const r of [0.5, 1, 1.5, 2]) {
    const f = r * spec.f0;
    root.append(svg('line', { x1: x(f), x2: x(f), y1: mt, y2: H - mb, class: r === 1 ? 'f0' : 'grid' }));
    root.append(svg('text', { x: x(f), y: H - mb + 12, 'text-anchor': 'middle', class: 'tick' }, r === 1 ? 'f0' : `${r} f0`));
  }
  root.append(svg('text', { x: ml + (W - ml - mr) / 2, y: H - 4, 'text-anchor': 'middle', class: 'tick' }, `frequency (f0 = ${formatEngineering(spec.f0, 'Hz', 4)})`));
  root.append(svg('text', { x: 10, y: mt + (H - mt - mb) / 2, 'text-anchor': 'middle', class: 'tick', transform: `rotate(-90 10 ${mt + (H - mt - mb) / 2})` }, 'X (Ω)'));
  root.append(svg('path', { d: path('Xideal'), class: 'ideal' }));
  root.append(svg('path', { d: path('X'), class: 'stub' }));
  const ideal = d.X > 0 ? 'ideal L' : 'ideal C';
  return h('figure', { class: 'lc-fig' }, root,
    h('figcaption', { class: 'legend' },
      h('span', { class: 'lg stub' }, 'stub'), h('span', { class: 'lg ideal' }, ideal), h('span', { class: 'lg band' }, '≤ 5 % error')));
}
