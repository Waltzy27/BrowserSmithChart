/**
 * Stub ⇄ L/C converter (lossless relations at f0, θ = βℓ), Pozar (2.45c)/(2.46c):
 *   short stub  Z_in =  jZs·tanθ        open stub  Z_in = −jZs·cotθ
 *   short as L:  θ = atan(ωL/Zs)                         (0 … λ/4)
 *   open  as C:  θ = atan(ωC·Zs)                         (0 … λ/4)
 *   open  as L:  θ = 90° + atan(ωL/Zs)                   (λ/4 … λ/2)
 *   short as C:  θ = 180° − atan(1/(ωC·Zs))              (λ/4 … λ/2)
 * The stub input reactance is the same whether it is used in shunt or in
 * series; only its connection to the main line differs. The microstrip
 * physical length comes from synthesizeWidth()/synthesizeLength(), and an
 * open end is shortened by the open-end extension ΔL.
 */
import { analyzeMicrostrip, openEndExtension, type MicrostripResult, type Substrate, type TlError } from './microstrip';
import { synthesizeWidth, synthesizeLength } from './synth';

export type StubPart = 'L' | 'C' | 'X';
export type StubTerm = 'open' | 'short';

export interface StubSpec {
  part: StubPart;
  value: number;          // H, F, or Ω (reactance X; X > 0 inductive)
  term: StubTerm;
  z0: number;             // stub line impedance Zs, Ω
  f0: number;             // Hz
}

/** Target reactance at f0, Ω. */
export function targetReactance(p: StubPart, value: number, f0: number): number {
  const w = 2 * Math.PI * f0;
  return p === 'L' ? w * value : p === 'C' ? -1 / (w * value) : value;
}

/** Electrical length θ (rad) of a lossless stub with input reactance X. */
export function stubTheta(X: number, Zs: number, term: StubTerm): number {
  if (term === 'short') return X > 0 ? Math.atan(X / Zs) : Math.PI - Math.atan(-X / Zs);   // −X/Zs = 1/(ωC·Zs)
  return X < 0 ? Math.atan(-Zs / X) : Math.PI / 2 + Math.atan(X / Zs);                     // −Zs/X = ωC·Zs
}

/** Input reactance of a lossless stub of electrical length θ, Ω. */
export const stubReactance = (theta: number, Zs: number, term: StubTerm): number =>
  term === 'short' ? Zs * Math.tan(theta) : -Zs / Math.tan(theta);

export interface StubDesign {
  ok: true;
  X: number;                    // target reactance, Ω
  theta: number;                // electrical length at f0, rad
  thetaDeg: number;
  lengthWl: number;             // θ/2π
  long: boolean;                // λ/4 < ℓ < λ/2
  W: number;                    // stub width for Zs
  Lelec: number;                // physical length for θ (m), before end correction
  dL: number;                   // open-end extension (m); 0 for a short stub
  Lphys: number;                // length to draw: Lelec − ΔL
  analysis: MicrostripResult;   // stub line at f0
  alternative: { term: StubTerm; thetaDeg: number };
  warnings: string[];
}

export function designStub(spec: StubSpec, s: Substrate): StubDesign | TlError {
  const { part, value, term, z0, f0 } = spec;
  if (!(Number.isFinite(f0) && f0 > 0)) return { ok: false, error: 'f0 must be greater than zero.' };
  if (!(Number.isFinite(z0) && z0 > 0)) return { ok: false, error: 'Stub Z0 must be greater than zero.' };
  if (part !== 'X' && !(Number.isFinite(value) && value > 0)) return { ok: false, error: part === 'L' ? 'Inductance must be greater than zero.' : 'Capacitance must be greater than zero.' };
  if (part === 'X' && !(Number.isFinite(value) && value !== 0)) return { ok: false, error: 'Reactance must be non-zero (X = 0 is a short circuit, not a stub).' };
  const X = targetReactance(part, value, f0);
  const theta = stubTheta(X, z0, term);
  const w = synthesizeWidth(z0, s, f0);
  if (!w.ok) return w;
  const l = synthesizeLength(theta, w.W, s, f0);
  if (!l.ok) return l;
  const a = w.analysis;
  const dL = term === 'open' ? openEndExtension(a.u + a.dur, s.er, a.eeff, s.h) : 0;
  const Lphys = l.L - dL;
  const other: StubTerm = term === 'open' ? 'short' : 'open';
  const altTheta = stubTheta(X, z0, other);
  const long = theta > Math.PI / 2;
  const warnings: string[] = [];
  if (long) warnings.push(`This ${term} stub is between λ/4 and λ/2 long (${((theta * 180) / Math.PI).toFixed(1)}°). A ${other} stub needs only ${((altTheta * 180) / Math.PI).toFixed(1)}° and behaves like an ideal ${X > 0 ? 'inductor' : 'capacitor'} over a wider band.`);
  if (Lphys <= 0) warnings.push('The open-end extension is longer than the stub itself; this value cannot be built as an open stub. Use a short stub or a different stub Z0.');
  if (term === 'short') warnings.push('A short stub needs a via to ground at its end. The via inductance is not modelled and makes the stub look electrically longer.');
  return {
    ok: true, X, theta, thetaDeg: (theta * 180) / Math.PI, lengthWl: theta / (2 * Math.PI), long,
    W: w.W, Lelec: l.L, dL, Lphys, analysis: a,
    alternative: { term: other, thetaDeg: (altTheta * 180) / Math.PI }, warnings,
  };
}

export interface SweepPoint { f: number; X: number; Xideal: number; err: number; }

/**
 * Stub reactance against the ideal component over frequency, including
 * microstrip dispersion: θ(f) = β(f)·ℓ_e with ℓ_e = Lphys + ΔL the electrical
 * length, and Zs(f) from the same analysis.
 */
export function stubSweep(d: StubDesign, spec: StubSpec, s: Substrate, fMin: number, fMax: number, n = 241): SweepPoint[] {
  const pts: SweepPoint[] = [];
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? fMin + ((fMax - fMin) * i) / (n - 1) : fMin;
    pts.push(stubPoint(d, spec, s, f));
  }
  return pts;
}

function stubPoint(d: StubDesign, spec: StubSpec, s: Substrate, f: number): SweepPoint {
  const a = analyzeMicrostrip(d.W, s, f);
  const w = 2 * Math.PI * f;
  // X > 0 at f0 behaves as an inductor, X < 0 as a capacitor
  const Lq = d.X / (2 * Math.PI * spec.f0), Cq = -1 / (2 * Math.PI * spec.f0 * d.X);
  const Xideal = d.X > 0 ? w * Lq : -1 / (w * Cq);
  if (!a.ok) return { f, X: NaN, Xideal, err: Infinity };
  const X = stubReactance(a.beta * d.Lelec, a.z0, spec.term);
  return { f, X, Xideal, err: Math.abs(X - Xideal) / Math.abs(Xideal) };
}

/**
 * Contiguous band around f0 where |X_stub − X_ideal| / |X_ideal| ≤ tol.
 * Steps outward from f0 and refines each edge by bisection.
 */
export function stubBandwidth(d: StubDesign, spec: StubSpec, s: Substrate, tol = 0.05): { fLo: number; fHi: number; fractional: number } {
  const ok = (f: number) => f > 0 && stubPoint(d, spec, s, f).err <= tol;
  const f0 = spec.f0;
  const edge = (dir: 1 | -1): number => {
    let inside = f0, step = f0 * 0.005;
    let outside = NaN;
    for (let i = 0; i < 4000; i++) {
      const f = inside + dir * step;
      if (f <= f0 * 1e-3) return f0 * 1e-3;
      if (f >= f0 * 4) return f0 * 4;
      if (ok(f)) { inside = f; step *= 1.15; } else { outside = f; break; }
    }
    if (!Number.isFinite(outside)) return inside;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (inside + outside);
      if (ok(mid)) inside = mid; else outside = mid;
    }
    return inside;
  };
  const fLo = edge(-1), fHi = edge(1);
  return { fLo, fHi, fractional: (fHi - fLo) / f0 };
}
