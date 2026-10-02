/** Side calculators: mismatch converter, reactance ⇄ component, wavelength/line length, matching synthesis. */
import { c, mul } from '../math/complex';
import { gammaToZ, vswrToRho, returnLossToRho, mismatchLossToRho, gammaMetrics } from '../math/smith';
import { fix, formatEngineering, wavelength } from '../math/units';
import { elementLabel, type Element } from '../rf/network';
import { synthesizeLMatches, synthesizeSingleStub, synthesizeQuarterWave, type MatchSolution } from '../rf/matching';
import type { Store } from '../state/store';
import { h, numField, segmented, rebuild, toast } from './dom';

let rho = 0.5;
let reactF: number | null = null;
let reactX = 50;
let lineF: number | null = null;
let lineVf = 0.66;
let lineLenWl = 0.25;
let matchMethod: 'L' | 'stub' | 'qw' = 'L';
let stubConn: 'shunt' | 'series' = 'shunt';
let stubTerm: 'open' | 'short' = 'short';

export class CalcPanel {
  readonly el = h('div', { class: 'panel-body' });
  constructor(private store: Store) {
    store.subscribe((s, p) => { if (s.Z0 !== p.Z0 || s.f0 !== p.f0 || s.load !== p.load) this.render(); });
    this.render();
  }

  render(): void {
    rebuild(this.el, () => [this.matchCard(), this.mismatchCard(), this.reactanceCard(), this.lineCard()]);
  }

  private mismatchCard(): HTMLElement {
    const m = gammaMetrics(c(rho, 0));
    const setRho = (v: number) => { rho = Math.max(0, Math.min(0.999999, v)); this.render(); };
    return h('section', { class: 'card' },
      h('h3', {}, 'Mismatch converter'),
      h('p', { class: 'hint' }, 'Edit any field; the others follow. Pozar (2.38), (2.41).'),
      h('div', { class: 'grid2' },
        numField({ label: '|Γ|', value: rho, key: 'c:rho', min: 0, onCommit: setRho }),
        numField({ label: 'VSWR', value: m.vswr, key: 'c:vswr', min: 1, onCommit: (v) => setRho(vswrToRho(v)) }),
        numField({ label: 'Return loss', unit: 'dB', value: m.returnLossDb, key: 'c:rl', min: 0, onCommit: (v) => setRho(returnLossToRho(v)) }),
        numField({ label: 'Mismatch loss', unit: 'dB', value: m.mismatchLossDb, key: 'c:ml', min: 0, onCommit: (v) => setRho(mismatchLossToRho(v)) }),
      ),
      h('p', { class: 'mono small' }, `Reflected power ${fix(m.reflectedPower * 100, 3)} % · delivered ${fix(m.acceptedPower * 100, 3)} %`),
    );
  }

  private reactanceCard(): HTMLElement {
    const s = this.store.get();
    const f = reactF ?? s.f0;
    const w = 2 * Math.PI * f;
    const L = reactX > 0 ? reactX / w : NaN;
    const C = reactX < 0 ? -1 / (w * reactX) : NaN;
    return h('section', { class: 'card' },
      h('h3', {}, 'Reactance ⇄ component'),
      h('div', { class: 'grid2' },
        numField({ label: 'Frequency', unit: 'Hz', value: f, key: 'c:rf', engineering: true, min: 1e-6, onCommit: (v) => { reactF = v; this.render(); } }),
        numField({ label: 'Reactance X', unit: 'Ω', value: reactX, key: 'c:rx', onCommit: (v) => { reactX = v; this.render(); } }),
        numField({ label: 'Inductance (X > 0)', unit: 'H', value: Number.isFinite(L) ? L : 0, key: 'c:rl2', engineering: true, min: 0, onCommit: (v) => { reactX = w * v; this.render(); } }),
        numField({ label: 'Capacitance (X < 0)', unit: 'F', value: Number.isFinite(C) ? C : 0, key: 'c:rc', engineering: true, min: 0, onCommit: (v) => { if (v > 0) reactX = -1 / (w * v); this.render(); } }),
      ),
      h('p', { class: 'mono small' }, `X_L = ωL, X_C = −1/(ωC) · normalised x = ${fix(reactX / s.Z0, 4)} · B = −1/X = ${formatEngineering(-1 / reactX, 'S', 4)}`),
    );
  }

  private lineCard(): HTMLElement {
    const s = this.store.get();
    const f = lineF ?? s.f0;
    const lam = wavelength(f, lineVf);
    return h('section', { class: 'card' },
      h('h3', {}, 'Wavelength & line length'),
      h('div', { class: 'grid2' },
        numField({ label: 'Frequency', unit: 'Hz', value: f, key: 'c:lf', engineering: true, min: 1e-6, onCommit: (v) => { lineF = v; this.render(); } }),
        numField({ label: 'Velocity factor', value: lineVf, key: 'c:vf', min: 1e-3, title: 'vf = 1/√ε_eff', onCommit: (v) => { lineVf = Math.min(1, v); this.render(); } }),
        numField({ label: 'ε_eff', value: 1 / (lineVf * lineVf), key: 'c:er', min: 1, onCommit: (v) => { lineVf = 1 / Math.sqrt(v); this.render(); } }),
        numField({ label: 'Length', unit: 'λ', value: lineLenWl, key: 'c:lw', min: 0, onCommit: (v) => { lineLenWl = v; this.render(); } }),
        numField({ label: 'Electrical length βℓ', unit: '°', value: lineLenWl * 360, key: 'c:ld', min: 0, onCommit: (v) => { lineLenWl = v / 360; this.render(); } }),
        numField({ label: 'Physical length', unit: 'm', value: lineLenWl * lam, key: 'c:lm', engineering: true, min: 0, onCommit: (v) => { lineLenWl = v / lam; this.render(); } }),
      ),
      h('p', { class: 'mono small' }, `λg = vf·c/f = ${formatEngineering(lam, 'm', 5)} · λg/4 = ${formatEngineering(lam / 4, 'm', 5)} · chart rotation 2βℓ = ${fix(lineLenWl * 720, 2)}°`),
    );
  }

  private matchCard(): HTMLElement {
    const s = this.store.get();
    const ZL = mul(gammaToZ(s.load.gamma), c(s.Z0, 0));
    let sols: MatchSolution[] = [];
    let note = '';
    if (!(ZL.re > 0) || !Number.isFinite(ZL.re)) note = 'Matching requires a load with positive, finite resistance.';
    else if (matchMethod === 'L') sols = synthesizeLMatches(ZL, s.Z0, s.f0);
    else if (matchMethod === 'stub') sols = synthesizeSingleStub(ZL, s.Z0, s.f0, stubConn, stubTerm);
    else sols = synthesizeQuarterWave(ZL, s.Z0, s.f0);
    if (!note && !sols.length) note = Math.abs(ZL.re - s.Z0) < 1e-9 && Math.abs(ZL.im) < 1e-9 ? 'The load is already matched.' : 'No valid solution for this configuration.';
    const apply = (sol: MatchSolution, append: boolean) => {
      const els = sol.elements.map((e) => ({ ...e })) as Element[];
      this.store.update((st) => ({ ...st, elements: append ? [...st.elements, ...els] : els, selection: { kind: 'input' } }));
      toast(`Applied: ${sol.title}. Residual |Γin| = ${sol.residual.toExponential(1)}`);
    };
    return h('section', { class: 'card' },
      h('h3', {}, 'Matching synthesis'),
      h('p', { class: 'hint' }, `Load ${fix(ZL.re, 2)} ${ZL.im < 0 ? '−' : '+'} j${fix(Math.abs(ZL.im), 2)} Ω → Z0 ${s.Z0} Ω at ${formatEngineering(s.f0, 'Hz', 4)}. Closed forms from Pozar Ch. 5; each candidate is verified by cascading it.`),
      segmented('Method', [['L', 'L-section'], ['stub', 'Single stub'], ['qw', 'λ/4 transformer']], matchMethod, (v) => { matchMethod = v; this.render(); }, true),
      matchMethod === 'stub' ? h('div', { class: 'row' },
        segmented('Stub connection', [['shunt', 'Shunt'], ['series', 'Series']], stubConn, (v) => { stubConn = v; this.render(); }, true),
        segmented('Stub termination', [['short', 'Short'], ['open', 'Open']], stubTerm, (v) => { stubTerm = v; this.render(); }, true)) : null,
      note ? h('p', { class: 'hint warn' }, note) : null,
      ...sols.map((sol) => h('div', { class: 'solution' },
        h('div', { class: 'sol-head' }, h('strong', {}, sol.title)),
        h('p', { class: 'small' }, sol.topology),
        h('ul', { class: 'sol-els' }, ...sol.elements.map((e) => h('li', { class: 'mono small' }, describeElement(e, s.f0)))),
        h('dl', { class: 'readout compact' }, ...sol.details.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'mono' }, typeof v === 'number' ? (Math.abs(v) < 1e-3 && v !== 0 ? formatEngineering(v, '', 4) : fix(v, 4)) : v)])),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn primary', onclick: () => apply(sol, false) }, 'Use this network'),
          h('button', { type: 'button', class: 'btn', onclick: () => apply(sol, true) }, 'Append')),
      )),
    );
  }
}

export function describeElement(e: Element, f0: number): string {
  void f0;
  switch (e.kind) {
    case 'seriesL': case 'shuntL': return `${elementLabel[e.kind]} ${formatEngineering(e.value, 'H', 4)}`;
    case 'seriesC': case 'shuntC': return `${elementLabel[e.kind]} ${formatEngineering(e.value, 'F', 4)}`;
    case 'seriesR': case 'shuntR': return `${elementLabel[e.kind]} ${formatEngineering(e.value, 'Ω', 4)}`;
    case 'line': return `${e.label ?? 'Line'} Z0 = ${fix(e.z0, 3)} Ω, ℓ = ${fix(e.lengthWl, 4)} λ (${fix(e.lengthWl * 360, 2)}°)`;
    case 'stub': return `${e.connection} ${e.termination} stub Z0 = ${fix(e.z0, 2)} Ω, ℓ = ${fix(e.lengthWl, 4)} λ (${fix(e.lengthWl * 360, 2)}°)`;
    case 'transformer': return `Transformer n = ${fix(e.n, 4)}`;
  }
}
