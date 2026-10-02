/**
 * Closed-form matching-network synthesis (Pozar, Microwave Engineering 4th ed., Ch. 5).
 *
 *  - L-section:      (5.3a,b) for z_L inside the r = 1 circle, (5.6a,b) otherwise
 *  - Single stub:    shunt (5.7)–(5.11), series (5.12)–(5.16)
 *  - Quarter-wave:   (2.63) Z1 = √(Z0 R), with a Z0 line to the nearest real-impedance point
 *
 * Every candidate is returned as an ordered element list (load → generator) and is
 * verified numerically by cascading it with the network engine; candidates whose
 * input reflection exceeds VERIFY_TOL are discarded.
 */
import { type Complex, c, abs } from '../math/complex';
import { zToGamma, normalizeZ, gammaMetrics } from '../math/smith';
import { type Element, cascade } from './network';

export const VERIFY_TOL = 1e-6;

export interface MatchSolution {
  title: string;
  topology: string;
  elements: Element[];
  /** Normalised or absolute design quantities, for display. */
  details: Array<[string, string | number]>;
  /** |Γ_in| at f0 after cascading — should be ~0. */
  residual: number;
}

let idCounter = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** Reactance X (Ω) → series L or C element; null when X ≈ 0. */
function seriesReactance(X: number, w: number): Element | null {
  if (Math.abs(X) < 1e-9) return null;
  return X > 0
    ? { id: nid('e'), kind: 'seriesL', value: X / w }
    : { id: nid('e'), kind: 'seriesC', value: -1 / (w * X) };
}
/** Susceptance B (S) → shunt C or L element; null when B ≈ 0. */
function shuntSusceptance(B: number, w: number): Element | null {
  if (Math.abs(B) < 1e-12) return null;
  return B > 0
    ? { id: nid('e'), kind: 'shuntC', value: B / w }
    : { id: nid('e'), kind: 'shuntL', value: -1 / (w * B) };
}

function verify(ZL: Complex, Z0: number, f0: number, els: Element[]): number {
  const g = cascade(zToGamma(normalizeZ(ZL, Z0)), els, { f: f0, f0, Z0 });
  return abs(g[g.length - 1]);
}

/* ------------------------------------------------------------------ */
/* L-section                                                           */
/* ------------------------------------------------------------------ */

export interface LSolution { B: number; X: number; config: 'shunt-first' | 'series-first'; }

/** Raw (B, X) pairs from Pozar (5.3) and (5.6). B in S, X in Ω. */
export function lSectionValues(ZL: Complex, Z0: number): LSolution[] {
  const RL = ZL.re, XL = ZL.im;
  const out: LSolution[] = [];
  if (RL <= 0) return out;
  // Fig. 5.2a — shunt B next to the load, series X toward the source (5.3a,b)
  const mag2 = RL * RL + XL * XL;
  const disc = mag2 - Z0 * RL;
  if (disc >= -1e-12) {
    const root = Math.sqrt(RL / Z0) * Math.sqrt(Math.max(0, disc));
    for (const s of [1, -1]) {
      const B = (XL + s * root) / mag2;
      const X = Math.abs(B) < 1e-15 ? -XL : 1 / B + (XL * Z0) / RL - Z0 / (B * RL);
      out.push({ B, X, config: 'shunt-first' });
    }
  }
  // Fig. 5.2b — series X next to the load, shunt B at the source (5.6a,b)
  if (RL <= Z0 + 1e-12) {
    const rx = Math.sqrt(Math.max(0, RL * (Z0 - RL)));
    const rb = Math.sqrt(Math.max(0, (Z0 - RL) / RL)) / Z0;
    for (const s of [1, -1]) out.push({ X: s * rx - XL, B: s * rb, config: 'series-first' });
  }
  return out;
}

export function synthesizeLMatches(ZL: Complex, Z0: number, f0: number): MatchSolution[] {
  const w = 2 * Math.PI * f0;
  const sols: MatchSolution[] = [];
  const seen = new Set<string>();
  for (const v of lSectionValues(ZL, Z0)) {
    const xe = seriesReactance(v.X, w);
    const be = shuntSusceptance(v.B, w);
    const els = (v.config === 'shunt-first' ? [be, xe] : [xe, be]).filter((e): e is Element => e !== null);
    const key = `${v.config}:${v.B.toPrecision(6)}:${v.X.toPrecision(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const residual = verify(ZL, Z0, f0, els);
    if (residual > VERIFY_TOL) continue;
    const names = els.map((e) => (e.kind.startsWith('series') ? 'series ' : 'shunt ') + e.kind.slice(-1)).join(' → ');
    sols.push({
      title: v.config === 'shunt-first' ? 'Shunt-first L (Fig. 5.2a)' : 'Series-first L (Fig. 5.2b)',
      topology: `Load → ${names || 'direct'} → Source`,
      elements: els,
      details: [['b = B·Z0', v.B * Z0], ['x = X/Z0', v.X / Z0], ['B (S)', v.B], ['X (Ω)', v.X]],
      residual,
    });
  }
  return sols;
}

/* ------------------------------------------------------------------ */
/* Single-stub tuning                                                  */
/* ------------------------------------------------------------------ */

export interface StubValues { d: number; t: number; B: number; } // d in λ, B = susceptance (or X for series) at the stub plane

/** d/λ from t = tan βd, Pozar (5.10)/(5.15): principal value in [0, 0.5). */
export const dFromT = (t: number): number =>
  !Number.isFinite(t) ? 0.25 : t >= 0 ? Math.atan(t) / (2 * Math.PI) : (Math.PI + Math.atan(t)) / (2 * Math.PI);

/**
 * Shunt-stub positions (5.9) and line susceptance B (5.8b) at those positions.
 * For R_L = Z0 the quadratic degenerates; the roots are t = −X_L/2Z0 and t → ∞ (d = λ/4).
 */
export function shuntStubPositions(ZL: Complex, Z0: number): StubValues[] {
  const RL = ZL.re, XL = ZL.im;
  const ts: number[] = [];
  if (Math.abs(RL - Z0) < 1e-12 * Z0) {
    ts.push(-XL / (2 * Z0), Infinity);
  } else {
    const root = Math.sqrt((RL * ((Z0 - RL) ** 2 + XL * XL)) / Z0);
    ts.push((XL + root) / (RL - Z0), (XL - root) / (RL - Z0));
  }
  return ts.map((t) => {
    const B = Number.isFinite(t)
      ? (RL * RL * t - (Z0 - XL * t) * (XL + Z0 * t)) / (Z0 * (RL * RL + (XL + Z0 * t) ** 2))
      : XL / (Z0 * Z0); // limit t → ∞ of (5.8b)
    return { d: dFromT(t), t, B };
  });
}

/** Series-stub positions (5.14) and line reactance X (5.13b), returned in field B. */
export function seriesStubPositions(ZL: Complex, Z0: number): StubValues[] {
  const Y0 = 1 / Z0;
  const den = ZL.re * ZL.re + ZL.im * ZL.im;
  const GL = ZL.re / den, BL = -ZL.im / den;
  const ts: number[] = [];
  if (Math.abs(GL - Y0) < 1e-12 * Y0) {
    ts.push(-BL / (2 * Y0), Infinity);
  } else {
    const root = Math.sqrt((GL * ((Y0 - GL) ** 2 + BL * BL)) / Y0);
    ts.push((BL + root) / (GL - Y0), (BL - root) / (GL - Y0));
  }
  return ts.map((t) => {
    const X = Number.isFinite(t)
      ? (GL * GL * t - (Y0 - t * BL) * (BL + t * Y0)) / (Y0 * (GL * GL + (BL + Y0 * t) ** 2))
      : BL / (Y0 * Y0);
    return { d: dFromT(t), t, B: X };
  });
}

/** Stub length (λ) giving susceptance Bs (shunt) — (5.11a) open, (5.11b) short. */
export function shuntStubLength(Bs: number, Zs: number, term: 'open' | 'short'): number {
  const Ys = 1 / Zs;
  // Bs = 0 for a short stub gives atan(∞) = π/2 → ℓ = −λ/4 → +λ/4 after wrapping.
  let l = term === 'open'
    ? Math.atan(Bs / Ys) / (2 * Math.PI)
    : -Math.atan(Ys / Bs) / (2 * Math.PI);
  if (l < 0) l += 0.5;
  return l;
}

/** Stub length (λ) giving reactance Xs (series) — (5.16a) short, (5.16b) open. */
export function seriesStubLength(Xs: number, Zs: number, term: 'open' | 'short'): number {
  let l = term === 'short'
    ? Math.atan(Xs / Zs) / (2 * Math.PI)
    : -Math.atan(Zs / Xs) / (2 * Math.PI);
  if (l < 0) l += 0.5;
  return l;
}

export function synthesizeSingleStub(
  ZL: Complex, Z0: number, f0: number,
  connection: 'shunt' | 'series', termination: 'open' | 'short', Zstub = Z0,
): MatchSolution[] {
  const positions = connection === 'shunt' ? shuntStubPositions(ZL, Z0) : seriesStubPositions(ZL, Z0);
  const sols: MatchSolution[] = [];
  positions.forEach((p, i) => {
    // The stub must cancel the line susceptance/reactance at the stub plane: Bs = −B (or Xs = −X)
    const need = -p.B;
    const len = connection === 'shunt'
      ? shuntStubLength(need, Zstub, termination)
      : seriesStubLength(need, Zstub, termination);
    const els: Element[] = [];
    if (p.d > 1e-12) els.push({ id: nid('e'), kind: 'line', z0: Z0, lengthWl: p.d, lossDb: 0, vf: 1 });
    els.push({ id: nid('e'), kind: 'stub', z0: Zstub, lengthWl: len, lossDb: 0, vf: 1, termination, connection });
    const residual = verify(ZL, Z0, f0, els);
    if (residual > VERIFY_TOL) return;
    const isShunt = connection === 'shunt';
    sols.push({
      title: `Solution ${i + 1}: ${termination}-circuit ${connection} stub`,
      topology: `Load → line d → ${connection} ${termination} stub ℓ → Source`,
      elements: els,
      details: [
        ['d / λ', p.d],
        ['ℓ / λ', len],
        [isShunt ? 'y at stub = 1 + jb, b' : 'z at stub = 1 + jx, x', isShunt ? p.B * Z0 : p.B / Z0],
        [isShunt ? 'Stub B (S)' : 'Stub X (Ω)', need],
      ],
      residual,
    });
  });
  return sols;
}

/* ------------------------------------------------------------------ */
/* Quarter-wave transformer                                            */
/* ------------------------------------------------------------------ */

export function synthesizeQuarterWave(ZL: Complex, Z0: number, f0: number): MatchSolution[] {
  const gL = zToGamma(normalizeZ(ZL, Z0));
  const m = gammaMetrics(gL);
  const sols: MatchSolution[] = [];
  if (m.rho < 1e-12) return sols;
  if (m.rho >= 1) return sols;
  const theta = (m.angleDeg * Math.PI) / 180;
  // Rotation toward the generator to reach ∠Γ = 0 (R_max = Z0·SWR) or ∠Γ = 180° (R_min = Z0/SWR)
  const targets: Array<[string, number, number]> = [
    ['Voltage maximum (R = Z0·SWR)', 0, Z0 * m.vswr],
    ['Voltage minimum (R = Z0/SWR)', Math.PI, Z0 / m.vswr],
  ];
  for (const [label, phi, R] of targets) {
    let rot = theta - phi; // clockwise angle
    rot = ((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const d = rot / (4 * Math.PI);
    const Z1 = Math.sqrt(Z0 * R);
    const els: Element[] = [];
    if (d > 1e-9 && d < 0.5 - 1e-9) els.push({ id: nid('e'), kind: 'line', z0: Z0, lengthWl: d, lossDb: 0, vf: 1 });
    els.push({ id: nid('e'), kind: 'line', z0: Z1, lengthWl: 0.25, lossDb: 0, vf: 1, label: 'λ/4 transformer' });
    const residual = verify(ZL, Z0, f0, els);
    if (residual > VERIFY_TOL) continue;
    sols.push({
      title: label,
      topology: 'Load → Z0 line d → λ/4 section Z1 → Source',
      elements: els,
      details: [['d / λ', d], ['R at plane (Ω)', R], ['Z1 = √(Z0·R) (Ω)', Z1]],
      residual,
    });
  }
  return sols;
}

/** Convenience: quarter-wave match of a real load (2.63). */
export const quarterWaveZ1 = (Z0: number, RL: number): number => Math.sqrt(Z0 * RL);

export const isMatchable = (ZL: Complex): boolean => ZL.re > 0 && Number.isFinite(ZL.re) && Number.isFinite(ZL.im);

export { c as complex };
export type { Complex };
