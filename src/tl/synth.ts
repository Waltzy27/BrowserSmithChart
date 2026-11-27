/**
 * Microstrip synthesis: solve W for a target Z0, and L for a target electrical
 * angle, by bracketed root finding wrapped around analyzeMicrostrip(). Because
 * synthesis only ever calls the analysis function, the two cannot disagree.
 */
import { analyzeMicrostrip, type MicrostripResult, type Substrate, type TlError } from './microstrip';

/**
 * Brent's method (inverse quadratic interpolation + secant + bisection) on
 * [a, b] where f(a) and f(b) have opposite signs. Returns null if they do not.
 */
export function brent(fn: (x: number) => number, a: number, b: number, xtol = 1e-14, maxIter = 200): number | null {
  let fa = fn(a), fb = fn(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return null;
  let c = a, fc = fa, d = b - a, e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol = 2 * Number.EPSILON * Math.abs(b) + 0.5 * xtol;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number, q: number;
      if (a === c) { p = 2 * m * s; q = 1 - s; }
      else {
        const qq = fa / fc, r = fb / fc;
        p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; }
      else { d = m; e = d; }
    } else { d = m; e = d; }
    a = b; fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = fn(b);
    if (!Number.isFinite(fb)) return null;
  }
  return b;
}

/** W/h search range: the stated range of the Hammerstad–Jensen formulas. */
export const U_MIN = 0.01;
export const U_MAX = 100;

export interface WidthSolution { ok: true; W: number; analysis: MicrostripResult; }

/** Width giving Z0(f) = target. Searches ln(W/h) in [ln 0.01, ln 100]. */
export function synthesizeWidth(targetZ0: number, s: Substrate, f: number): WidthSolution | TlError {
  if (!(Number.isFinite(targetZ0) && targetZ0 > 0)) return { ok: false, error: 'Target Z0 must be greater than zero.' };
  const probe = analyzeMicrostrip(s.h, s, f); // surfaces substrate / frequency errors first
  if (!probe.ok) return probe;
  const z = (lu: number): number => {
    const a = analyzeMicrostrip(Math.exp(lu) * s.h, s, f);
    return a.ok ? a.z0 - targetZ0 : NaN;
  };
  const lo = Math.log(U_MIN), hi = Math.log(U_MAX);
  const zHi = z(lo) + targetZ0, zLo = z(hi) + targetZ0; // Z0 falls as W grows
  if (targetZ0 > zHi) return { ok: false, error: `No solution: ${targetZ0} Ω needs W/h below 0.01 on this substrate (the narrowest valid line gives ${zHi.toFixed(1)} Ω).` };
  if (targetZ0 < zLo) return { ok: false, error: `No solution: ${targetZ0} Ω needs W/h above 100 on this substrate (the widest valid line gives ${zLo.toFixed(2)} Ω).` };
  const root = brent(z, lo, hi, 1e-15);
  if (root === null) return { ok: false, error: 'The width search did not converge for this target.' };
  const W = Math.exp(root) * s.h;
  const a = analyzeMicrostrip(W, s, f);
  if (!a.ok) return a;
  return { ok: true, W, analysis: a };
}

/** Physical length giving electrical angle θ (radians) on width W at f: θ = β(f)·L. */
export function synthesizeLength(thetaRad: number, W: number, s: Substrate, f: number): { ok: true; L: number; analysis: MicrostripResult } | TlError {
  if (!Number.isFinite(thetaRad) || thetaRad < 0) return { ok: false, error: 'Electrical length cannot be negative.' };
  const a = analyzeMicrostrip(W, s, f);
  if (!a.ok) return a;
  if (thetaRad === 0) return { ok: true, L: 0, analysis: a };
  // ε_eff ≥ 1, so the line is never longer than in free space: L ≤ θ/k0.
  const Lmax = (thetaRad / (2 * Math.PI)) * a.lambda0 * 1.0000001;
  const root = brent((L) => a.beta * L - thetaRad, 0, Lmax, Lmax * 1e-15);
  if (root === null) return { ok: false, error: 'The length search did not converge.' };
  return { ok: true, L: root, analysis: a };
}
