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
import { designMultisection, exactBandwidth, type MultiKind } from './multisection';

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

/* ------------------------------------------------------------------ */
/* Pi and T networks with a chosen loaded Q (virtual-resistance method) */
/* ------------------------------------------------------------------ */

/**
 * Minimum Q of a Pi or T network between Re(Z_L) and Z0: that of the single
 * L-section, Q_min = √(R_high/R_low − 1). A three-element network can only raise Q.
 */
export const piTMinQ = (RL: number, Z0: number): number => Math.sqrt(Math.max(RL, Z0) / Math.min(RL, Z0) - 1);

/**
 * Pi network (shunt – series – shunt) or T network (series – shunt – series)
 * designed as two back-to-back L-sections through a virtual resistance R_v:
 *   Pi:  R_v = R_high / (1 + Q²)  (below both terminations)
 *   T:   R_v = R_low · (1 + Q²)   (above both terminations)
 * where R_high/R_low are the larger/smaller of Re(Z_L) and Z0. The load-side
 * L-section matches Z_L → R_v with Pozar (5.3)/(5.6) using R_v as its reference,
 * the source-side L-section matches R_v → Z0, and the two middle elements
 * (series reactances for Pi, shunt susceptances for T) are combined.
 * Q is the node Q, |X|/R, at the high-resistance end, which sets the bandwidth.
 */
export function synthesizePiT(ZL: Complex, Z0: number, f0: number, type: 'pi' | 't', Q: number): MatchSolution[] {
  const w = 2 * Math.PI * f0;
  const RL = ZL.re;
  if (!(RL > 0) || !(Q > 0)) return [];
  const Rhigh = Math.max(RL, Z0), Rlow = Math.min(RL, Z0);
  const Rv = type === 'pi' ? Rhigh / (1 + Q * Q) : Rlow * (1 + Q * Q);
  if (type === 'pi' ? Rv >= Rlow : Rv <= Rhigh) return []; // Q below the L-section minimum
  // Load side: Z_L → R_v. Pi needs shunt-first (R_L > R_v), T needs series-first (R_L < R_v).
  const loadSide = lSectionValues(ZL, Rv).filter((v) => v.config === (type === 'pi' ? 'shunt-first' : 'series-first'));
  // Source side, seen from the generator: Z0 → R_v (same orientation as the load side), then reversed.
  const srcSide = lSectionValues(c(Z0, 0), Rv).filter((v) => v.config === (type === 'pi' ? 'shunt-first' : 'series-first'));
  const sols: MatchSolution[] = [];
  const seen = new Set<string>();
  for (const a of loadSide) {
    for (const b of srcSide) {
      let els: Array<Element | null>;
      let details: Array<[string, string | number]>;
      if (type === 'pi') {
        // load: shunt B1, series X1 → R_v ; source: series X2, shunt B2 (mirror of Z0 → R_v)
        const X = a.X + b.X;
        els = [shuntSusceptance(a.B, w), seriesReactance(X, w), shuntSusceptance(b.B, w)];
        details = [['R_v (Ω)', Rv], ['B1 load side (S)', a.B], ['X series (Ω)', X], ['B2 source side (S)', b.B],
          ['Q load node = |B1|·R_L', Math.abs(a.B) * RL], ['Q source node = |B2|·Z0', Math.abs(b.B) * Z0]];
      } else {
        const B = a.B + b.B;
        els = [seriesReactance(a.X, w), shuntSusceptance(B, w), seriesReactance(b.X, w)];
        details = [['R_v (Ω)', Rv], ['X1 load side (Ω)', a.X], ['B shunt (S)', B], ['X2 source side (Ω)', b.X],
          ['Q load node = |X1 + X_L|/R_L', Math.abs(a.X + ZL.im) / RL], ['Q source node = |X2|/Z0', Math.abs(b.X) / Z0]];
      }
      const list = els.filter((e): e is Element => e !== null);
      const key = list.map((e) => `${e.kind}:${(e as { value: number }).value.toPrecision(6)}`).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const residual = verify(ZL, Z0, f0, list);
      if (residual > VERIFY_TOL) continue;
      const names = list.map((e) => (e.kind.startsWith('series') ? 'series ' : 'shunt ') + e.kind.slice(-1)).join(' → ');
      sols.push({
        title: `${type === 'pi' ? 'Pi' : 'T'} network, Q = ${Q}`,
        topology: `Load → ${names} → Source`,
        elements: list, details, residual,
      });
    }
  }
  return sols;
}

/* ------------------------------------------------------------------ */
/* Double- and triple-stub tuners (Pozar §5.3)                          */
/* ------------------------------------------------------------------ */

/**
 * Largest normalised conductance a double-stub tuner with spacing d can match,
 * Pozar (5.21): g ≤ (1 + t²)/t² = 1/sin²βd. Loads beyond it are in the forbidden region.
 */
export const doubleStubGMax = (dWl: number): number => 1 / Math.sin(2 * Math.PI * dWl) ** 2;

/** Pozar (5.22): first-stub susceptance for load admittance G_L + jB_L at the first stub. */
export function doubleStubB1(GL: number, BL: number, Y0: number, t: number): number[] {
  const disc = (1 + t * t) * GL * Y0 - GL * GL * t * t;
  if (disc < -1e-15 || !(GL > 0)) return [];
  const r = Math.sqrt(Math.max(0, disc));
  return [(-BL * t + Y0 + r) / t, (-BL * t + Y0 - r) / t];
}
/** Pozar (5.23): second-stub susceptance; signs pair with (5.22). */
export function doubleStubB2(GL: number, Y0: number, t: number): number[] {
  const r = Math.sqrt(Math.max(0, Y0 * GL * (1 + t * t) - GL * GL * t * t));
  return [(Y0 * r + GL * Y0) / (GL * t), (-Y0 * r + GL * Y0) / (GL * t)];
}

const yAt = (ZL: Complex, Z0: number, f0: number, els: Element[]): Complex => {
  const g = cascade(zToGamma(normalizeZ(ZL, Z0)), els, { f: f0, f0, Z0 });
  const last = g[g.length - 1];
  // y = (1 − Γ)/(1 + Γ), absolute admittance
  const yn = { re: 0, im: 0 };
  const den = (1 + last.re) ** 2 + last.im ** 2;
  yn.re = (1 - last.re * last.re - last.im * last.im) / den;
  yn.im = (-2 * last.im) / den;
  return c(yn.re / Z0, yn.im / Z0);
};

/**
 * Shunt double-stub tuner. The first stub sits a distance d0 from the load (d0 = 0
 * puts it at the load, Fig. 5.7b); stubs are spaced d. Returns both solutions or a
 * forbidden-region diagnosis.
 */
export function synthesizeDoubleStub(
  ZL: Complex, Z0: number, f0: number, dWl: number, termination: 'open' | 'short', d0Wl = 0,
): { solutions: MatchSolution[]; forbidden: boolean; gAtStub1: number; gMax: number } {
  const Y0 = 1 / Z0;
  const t = Math.tan(2 * Math.PI * dWl);
  const pre: Element[] = d0Wl > 1e-12 ? [{ id: nid('e'), kind: 'line', z0: Z0, lengthWl: d0Wl, lossDb: 0, vf: 1 }] : [];
  const YL = yAt(ZL, Z0, f0, pre);
  const gMax = doubleStubGMax(dWl);
  const out = { solutions: [] as MatchSolution[], forbidden: false, gAtStub1: YL.re / Y0, gMax };
  if (!Number.isFinite(t) || Math.abs(t) < 1e-9) return out; // d = 0 or λ/2: degenerate spacing
  if (YL.re / Y0 > gMax * (1 + 1e-12)) { out.forbidden = true; return out; }
  const b1s = doubleStubB1(YL.re, YL.im, Y0, t);
  const b2s = doubleStubB2(YL.re, Y0, t);
  b1s.forEach((B1, i) => {
    const l1 = shuntStubLength(B1, Z0, termination);
    const els: Element[] = [...pre.map((e) => ({ ...e }))];
    els.push({ id: nid('e'), kind: 'stub', z0: Z0, lengthWl: l1, lossDb: 0, vf: 1, termination, connection: 'shunt', label: 'Stub 1' });
    els.push({ id: nid('e'), kind: 'line', z0: Z0, lengthWl: dWl, lossDb: 0, vf: 1, label: 'Stub spacing d' });
    // The second stub cancels whatever susceptance remains at its plane (equals (5.23)).
    const Y2 = yAt(ZL, Z0, f0, els);
    const B2 = -Y2.im;
    const l2 = shuntStubLength(B2, Z0, termination);
    els.push({ id: nid('e'), kind: 'stub', z0: Z0, lengthWl: l2, lossDb: 0, vf: 1, termination, connection: 'shunt', label: 'Stub 2' });
    const residual = verify(ZL, Z0, f0, els);
    if (residual > VERIFY_TOL) return;
    out.solutions.push({
      title: `Double stub, solution ${i + 1} (${termination})`,
      topology: `Load → ${d0Wl > 0 ? 'line d0 → ' : ''}stub 1 → line d → stub 2 → Source`,
      elements: els,
      details: [['b1 = B1·Z0', B1 * Z0], ['ℓ1 / λ', l1], ['b2 = B2·Z0', B2 * Z0], ['ℓ2 / λ', l2],
        ['b2 from (5.23)', b2s[i] * Z0], ['g at stub 1 (≤ 1/sin²βd)', YL.re / Y0]],
      residual,
    });
  });
  return out;
}

/**
 * Shunt triple-stub tuner (three stubs, equal spacing d, first stub d0 from the load).
 * The first stub is chosen so the admittance reaching the second stub lies safely
 * outside the double-stub forbidden region; the last two stubs are then a double-stub
 * tuner. Among all valid first-stub lengths (searched on a fine grid), the designs
 * with the smallest total stub length are returned. Every result is verified by cascade.
 */
export function synthesizeTripleStub(
  ZL: Complex, Z0: number, f0: number, dWl: number, termination: 'open' | 'short', d0Wl = 0,
): MatchSolution[] {
  const gMax = doubleStubGMax(dWl);
  const pre: Element[] = d0Wl > 1e-12 ? [{ id: nid('e'), kind: 'line', z0: Z0, lengthWl: d0Wl, lossDb: 0, vf: 1 }] : [];
  const cands: Array<{ total: number; sol: MatchSolution; l1: number }> = [];
  const STEPS = 500;
  for (let k = 1; k < STEPS; k++) {
    const l1 = (k / STEPS) * 0.5;
    const stub1: Element = { id: nid('e'), kind: 'stub', z0: Z0, lengthWl: l1, lossDb: 0, vf: 1, termination, connection: 'shunt', label: 'Stub 1' };
    const line1: Element = { id: nid('e'), kind: 'line', z0: Z0, lengthWl: dWl, lossDb: 0, vf: 1, label: 'Stub spacing d' };
    const head = [...pre, stub1, line1];
    const y2 = yAt(ZL, Z0, f0, head);
    const g2 = y2.re * Z0;
    if (!(g2 > 0) || g2 > 0.9 * gMax) continue; // stay clear of the forbidden boundary
    // Load as seen at stub 2, then reuse the double-stub synthesis from there.
    const Zeq = c(y2.re / (y2.re ** 2 + y2.im ** 2), -y2.im / (y2.re ** 2 + y2.im ** 2));
    const ds = synthesizeDoubleStub(Zeq, Z0, f0, dWl, termination, 0);
    for (const s of ds.solutions) {
      const els = [...head.map((e) => ({ ...e })), ...s.elements];
      const residual = verify(ZL, Z0, f0, els);
      if (residual > VERIFY_TOL) continue;
      const stubs = els.filter((e) => e.kind === 'stub') as Array<{ lengthWl: number }>;
      const total = stubs.reduce((a, e) => a + e.lengthWl, 0);
      cands.push({ total, l1, sol: {
        title: 'Triple stub',
        topology: `Load → ${d0Wl > 0 ? 'line d0 → ' : ''}stub 1 → d → stub 2 → d → stub 3 → Source`,
        elements: els,
        details: [['ℓ1 / λ', stubs[0].lengthWl], ['ℓ2 / λ', stubs[1].lengthWl], ['ℓ3 / λ', stubs[2].lengthWl], ['Σℓ / λ', total], ['g at stub 2', g2]],
        residual,
      } });
    }
  }
  cands.sort((a, b) => a.total - b.total);
  const picked: MatchSolution[] = [];
  for (const cnd of cands) {
    if (picked.length >= 2) break;
    if (picked.some((p) => Math.abs((p.details[0][1] as number) - cnd.l1) < 0.02)) continue;
    picked.push({ ...cnd.sol, title: `Triple stub, option ${picked.length + 1} (${termination}, shortest total)` });
  }
  return picked;
}

/**
 * Line lengths (Z0 line, toward the generator) that bring a complex load to a purely
 * resistive point: the voltage maximum (R = Z0·SWR) and minimum (R = Z0/SWR).
 * A real load needs no line (d = 0) and yields a single plane.
 */
export function resistivePlanes(ZL: Complex, Z0: number): Array<{ label: string; d: number; R: number }> {
  const gL = zToGamma(normalizeZ(ZL, Z0));
  const m = gammaMetrics(gL);
  if (m.rho >= 1) return [];
  if (Math.abs(ZL.im) < 1e-12 * Math.max(1, Math.abs(ZL.re))) return [{ label: 'Real load', d: 0, R: ZL.re }];
  const theta = (m.angleDeg * Math.PI) / 180;
  return ([['Voltage maximum (R = Z0·SWR)', 0, Z0 * m.vswr], ['Voltage minimum (R = Z0/SWR)', Math.PI, Z0 / m.vswr]] as const).map(([label, phi, R]) => {
    let rot = theta - phi;
    rot = ((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return { label, d: rot / (4 * Math.PI), R };
  });
}

/**
 * Binomial or Chebyshev N-section quarter-wave transformer (Pozar §5.6, §5.7). For each
 * resistive plane, the exact design (Tables 5.1/5.2 method) is returned first, followed
 * by the textbook small-reflection design for comparison.
 */
export function synthesizeMultisection(ZL: Complex, Z0: number, f0: number, kind: MultiKind, N: number, gm: number): MatchSolution[] {
  const sols: MatchSolution[] = [];
  for (const p of resistivePlanes(ZL, Z0)) {
    const d = designMultisection(kind, N, Z0, p.R, gm);
    if (!d) continue;
    for (const [which, Zs] of [['exact', d.exact], ['small-reflection', d.approx]] as const) {
      const els: Element[] = [];
      if (p.d > 1e-9 && p.d < 0.5 - 1e-9) els.push({ id: nid('e'), kind: 'line', z0: Z0, lengthWl: p.d, lossDb: 0, vf: 1 });
      // Element order is load → generator, so Z_N (next to the load) comes first.
      for (let k = Zs.length - 1; k >= 0; k--) els.push({ id: nid('e'), kind: 'line', z0: Zs[k], lengthWl: 0.25, lossDb: 0, vf: 1, label: `λ/4 section Z${k + 1}` });
      const residual = verify(ZL, Z0, f0, els);
      if (residual > VERIFY_TOL) continue;
      sols.push({
        title: `${kind === 'binomial' ? 'Binomial' : 'Chebyshev'} N = ${N}, ${which}${p.d > 0 ? ` · ${p.label}` : ''}`,
        topology: `Load → ${p.d > 0 ? 'Z0 line d → ' : ''}${N} × λ/4 sections → Source`,
        elements: els,
        details: [
          ...(p.d > 0 ? [['d / λ', p.d] as [string, number], ['R at plane (Ω)', p.R] as [string, number]] : []),
          ...Zs.map((z, k): [string, number] => [`Z${k + 1} (Ω)`, z]),
          ['Δf/f0, formula (5.55)/(5.64)', d.bwFormula],
          ['Δf/f0 for |Γ| ≤ Γm, this design', exactBandwidth(Zs, Z0, p.R, gm).bw],
        ],
        residual,
      });
    }
  }
  return sols;
}

/** Convenience: quarter-wave match of a real load (2.63). */
export const quarterWaveZ1 = (Z0: number, RL: number): number => Math.sqrt(Z0 * RL);

export const isMatchable = (ZL: Complex): boolean => ZL.re > 0 && Number.isFinite(ZL.re) && Number.isFinite(ZL.im);

export { c as complex };
export type { Complex };
