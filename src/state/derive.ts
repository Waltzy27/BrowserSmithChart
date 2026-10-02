/** Derived (computed) data for rendering and readouts, memoised on state identity. */
import { isInteractive, INTERACTIVE_BUDGET } from './interactive';
import { type Complex, c, abs, mul } from '../math/complex';
import { gammaToZ, renormalizeGamma1Port, zToGamma, normalizeZ } from '../math/smith';
import { cascade, elementPath, loadAtFrequency, type EvalContext } from '../rf/network';
import type { AppState, Trace } from './store';

export interface Derived {
  ctx: EvalContext;
  /** Γ at the load and after each element (at f0). */
  states: Complex[];
  /** Locus traced by each element (at f0). */
  paths: Complex[][];
  input: Complex;
  /** Absolute load impedance at f0 (Ω). */
  ZL: Complex;
  sweep: { freqs: number[]; gamma: Complex[]; gammaLoad: Complex[] } | null;
  /** Reflection traces referenced to the system Z0, with the network applied where requested. */
  traces: Array<{ trace: Trace; gamma: Complex[]; applied: Complex[] | null }>;
}

let lastKey: unknown[] = [];
let last: Derived | null = null;

export function derive(s: AppState): Derived {
  const fast = isInteractive();
  const key = [s.Z0, s.f0, s.load, s.elements, s.traces, s.sweep, fast];
  if (last && key.every((k, i) => k === lastKey[i])) return last;
  const ctx: EvalContext = { f: s.f0, f0: s.f0, Z0: s.Z0 };
  const states = cascade(s.load.gamma, s.elements, ctx);
  const paths = s.elements.map((el, i) => elementPath(states[i], el, ctx));
  const ZL = mul(gammaToZ(s.load.gamma), c(s.Z0, 0));

  let sweep: Derived['sweep'] = null;
  if (s.sweep.enabled) {
    const n = Math.max(3, Math.min(2001, Math.round(s.sweep.points)));
    const span = Math.max(0.1, Math.min(190, s.sweep.spanPct)) / 100;
    const fStart = s.f0 * (1 - span / 2), fStop = s.f0 * (1 + span / 2);
    const freqs: number[] = [], gamma: Complex[] = [], gammaLoad: Complex[] = [];
    for (let i = 0; i < n; i++) {
      const f = fStart + ((fStop - fStart) * i) / (n - 1);
      const Zf = loadAtFrequency(ZL, s.f0, f, s.load.model);
      const gL = zToGamma(normalizeZ(Zf, s.Z0));
      const st = cascade(gL, s.elements, { f, f0: s.f0, Z0: s.Z0 });
      freqs.push(f); gamma.push(st[st.length - 1]); gammaLoad.push(gL);
    }
    sweep = { freqs, gamma, gammaLoad };
  }

  const traces = s.traces.map((t) => {
    const g = t.z0 === s.Z0 ? t.gamma : t.gamma.map((x) => renormalizeGamma1Port(x, t.z0, s.Z0));
    const at = (k: number) => { const st = cascade(g[k], s.elements, { f: t.freqs[k], f0: s.f0, Z0: s.Z0 }); return st[st.length - 1]; };
    let applied: Complex[] | null = null;
    if (t.applyNetwork && s.elements.length) {
      const stride = fast ? Math.ceil((g.length * s.elements.length) / INTERACTIVE_BUDGET) : 1;
      if (stride <= 1) applied = g.map((_, k) => at(k));
      else {
        // decimated evaluation, linear interpolation in between (display only, during drags)
        applied = new Array<Complex>(g.length);
        let prevK = 0, prevV = at(0);
        applied[0] = prevV;
        for (let k = stride; ; k += stride) {
          const kk = Math.min(k, g.length - 1);
          const v = at(kk);
          for (let j = prevK + 1; j < kk; j++) { const u = (j - prevK) / (kk - prevK); applied[j] = c(prevV.re + (v.re - prevV.re) * u, prevV.im + (v.im - prevV.im) * u); }
          applied[kk] = v; prevK = kk; prevV = v;
          if (kk === g.length - 1) break;
        }
      }
    }
    return { trace: t, gamma: g, applied };
  });

  last = { ctx, states, paths, input: states[states.length - 1], ZL, sweep, traces };
  lastKey = key;
  return last;
}

/** Linear interpolation of a trace at frequency f (re/im interpolated independently). */
export function interpolateTrace(freqs: readonly number[], g: readonly Complex[], f: number): { gamma: Complex; exact: boolean; index: number } {
  const n = freqs.length;
  if (!n) return { gamma: c(0), exact: false, index: -1 };
  if (f <= freqs[0]) return { gamma: g[0], exact: f === freqs[0], index: 0 };
  if (f >= freqs[n - 1]) return { gamma: g[n - 1], exact: f === freqs[n - 1], index: n - 1 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (freqs[m] <= f) lo = m; else hi = m; }
  if (freqs[lo] === f) return { gamma: g[lo], exact: true, index: lo };
  const t = (f - freqs[lo]) / (freqs[hi] - freqs[lo]);
  return { gamma: c(g[lo].re + (g[hi].re - g[lo].re) * t, g[lo].im + (g[hi].im - g[lo].im) * t), exact: false, index: t < 0.5 ? lo : hi };
}

/** Index of the sample nearest (in the Γ plane) to point p. */
export function nearestSample(g: readonly Complex[], p: Complex): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < g.length; i++) {
    const d = (g[i].re - p.re) ** 2 + (g[i].im - p.im) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Sample index with minimum |Γ|. */
export function minReflectionIndex(g: readonly Complex[]): number {
  let best = 0;
  for (let i = 1; i < g.length; i++) if (abs(g[i]) < abs(g[best])) best = i;
  return best;
}

/** Band edges where |Γ| crosses a threshold around index k (linear interpolation in f). */
export function bandAround(freqs: readonly number[], g: readonly Complex[], k: number, rhoMax: number): { lo: number; hi: number } | null {
  if (k < 0 || abs(g[k]) > rhoMax) return null;
  let i = k; while (i > 0 && abs(g[i - 1]) <= rhoMax) i--;
  let j = k; while (j < g.length - 1 && abs(g[j + 1]) <= rhoMax) j++;
  const edge = (a: number, b: number) => {
    const ra = abs(g[a]), rb = abs(g[b]);
    if (ra === rb) return freqs[a];
    return freqs[a] + ((rhoMax - ra) / (rb - ra)) * (freqs[b] - freqs[a]);
  };
  const lo = i > 0 ? edge(i - 1, i) : freqs[0];
  const hi = j < g.length - 1 ? edge(j, j + 1) : freqs[g.length - 1];
  return { lo, hi };
}
