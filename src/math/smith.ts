/**
 * Smith-chart transforms, mismatch metrics and grid geometry.
 *
 * References (Pozar, Microwave Engineering, 4th ed.):
 *   (2.35)  Γ = (Z_L − Z0)/(Z_L + Z0)
 *   (2.38)  RL = −20 log|Γ| dB
 *   (2.41)  SWR = (1 + |Γ|)/(1 − |Γ|)
 *   (2.53)/(2.54)  Γ = (z − 1)/(z + 1),  z = (1 + Γ)/(1 − Γ)
 *   (2.56a) resistance circles, (2.56b) reactance circles
 *   (2.42)  Γ(ℓ) = Γ(0) e^{−2jβℓ}  → clockwise rotation toward the generator
 */
import {
  type Complex, c, add, sub, div, abs, arg, deg, wrapPi, ONE, isFiniteC, abs2,
} from './complex';

/** Tolerance used to decide that a point is at the open- or short-circuit singularity. */
export const SINGULAR_EPS = 1e-12;

/** Normalised impedance → reflection coefficient. Open circuit (non-finite z) → Γ = 1. */
export function zToGamma(z: Complex): Complex {
  if (!isFiniteC(z)) return c(1, 0);
  return div(sub(z, ONE), add(z, ONE));
}

/** Reflection coefficient → normalised impedance. Γ = 1 → open (Infinity). */
export function gammaToZ(g: Complex): Complex {
  const d = sub(ONE, g);
  if (abs(d) < SINGULAR_EPS) return c(Infinity, 0);
  return div(add(ONE, g), d);
}

/** Normalised admittance → Γ:  Γ = (1 − y)/(1 + y). */
export function yToGamma(y: Complex): Complex {
  if (!isFiniteC(y)) return c(-1, 0);
  return div(sub(ONE, y), add(ONE, y));
}

/** Γ → normalised admittance:  y = (1 − Γ)/(1 + Γ). Γ = −1 → short (Infinity). */
export function gammaToY(g: Complex): Complex {
  const d = add(ONE, g);
  if (abs(d) < SINGULAR_EPS) return c(Infinity, 0);
  return div(sub(ONE, g), d);
}

export const normalizeZ = (Z: Complex, Z0: number): Complex => c(Z.re / Z0, Z.im / Z0);
export const denormalizeZ = (z: Complex, Z0: number): Complex => c(z.re * Z0, z.im * Z0);
/** Absolute admittance (S) → normalised y = Y·Z0. */
export const normalizeY = (Y: Complex, Z0: number): Complex => c(Y.re * Z0, Y.im * Z0);
/** Normalised y → absolute admittance (S) = y / Z0. */
export const denormalizeY = (y: Complex, Z0: number): Complex => c(y.re / Z0, y.im / Z0);

/**
 * Change the reference impedance of a one-port reflection coefficient.
 * Γ' = (Zold(1+Γ) − Znew(1−Γ)) / (Zold(1+Γ) + Znew(1−Γ)) — finite everywhere,
 * including the open (Γ = 1) and short (Γ = −1) points.
 */
export function renormalizeGamma1Port(g: Complex, oldZ0: number, newZ0: number): Complex {
  const a = c((1 + g.re) * oldZ0, g.im * oldZ0);
  const b = c((1 - g.re) * newZ0, -g.im * newZ0);
  return div(sub(a, b), add(a, b));
}

/* ------------------------------------------------------------------ */
/* Mismatch metrics                                                    */
/* ------------------------------------------------------------------ */

export interface GammaMetrics {
  rho: number;              // |Γ|
  angleDeg: number;         // ∠Γ in degrees, (−180, 180]
  magDb: number;            // 20 log10 |Γ|
  vswr: number;             // (1+ρ)/(1−ρ); Infinity for ρ ≥ 1
  returnLossDb: number;     // −20 log10 ρ
  reflectedPower: number;   // ρ²
  acceptedPower: number;    // 1 − ρ²
  mismatchLossDb: number;   // −10 log10(1 − ρ²)
  wtg: number;              // wavelengths-toward-generator scale reading, [0, 0.5)
  wtl: number;              // wavelengths-toward-load scale reading, [0, 0.5)
  active: boolean;          // ρ > 1 (negative resistance)
}

export function gammaMetrics(g: Complex): GammaMetrics {
  const rho = abs(g);
  const angle = deg(arg(g));
  const vswr = rho < 1 ? (1 + rho) / (1 - rho) : Infinity;
  const accepted = 1 - rho * rho;
  return {
    rho,
    angleDeg: angle,
    magDb: 20 * Math.log10(rho),
    vswr,
    returnLossDb: -20 * Math.log10(rho),
    reflectedPower: rho * rho,
    acceptedPower: accepted,
    mismatchLossDb: accepted > 0 ? -10 * Math.log10(accepted) : Infinity,
    wtg: wtgFromAngle(angle),
    wtl: wtlFromAngle(angle),
    active: rho > 1 + 1e-12,
  };
}

/** VSWR → |Γ| (2.41 inverted). */
export const vswrToRho = (s: number): number => (s - 1) / (s + 1);
/** Return loss (dB, positive) → |Γ|. */
export const returnLossToRho = (rl: number): number => Math.pow(10, -rl / 20);
/** Mismatch loss (dB) → |Γ|. */
export const mismatchLossToRho = (ml: number): number => Math.sqrt(1 - Math.pow(10, -ml / 10));

/**
 * Outer "wavelengths toward generator" scale. A full revolution is λ/2 and
 * rotation toward the generator is clockwise (2.42), so with WTG = 0 at the
 * short-circuit point (∠Γ = 180°):  WTG = ((180° − ∠Γ)/720°) mod 0.5.
 * Check (Pozar Ex. 2.2): ∠Γ = 104° → 0.106 λ.
 */
export function wtgFromAngle(angleDeg: number): number {
  let w = ((180 - angleDeg) / 720) % 0.5;
  if (w < 0) w += 0.5;
  if (w >= 0.5 - 1e-15) w = 0;
  return w;
}
export function wtlFromAngle(angleDeg: number): number {
  const w = 0.5 - wtgFromAngle(angleDeg);
  return w >= 0.5 - 1e-15 ? 0 : w;
}
/** Inverse of wtgFromAngle: WTG reading (λ) → ∠Γ in degrees, (−180, 180]. */
export function angleFromWtg(wtg: number): number {
  return deg(wrapPi(((180 - wtg * 720) * Math.PI) / 180));
}

/* ------------------------------------------------------------------ */
/* Equivalent circuits and Q                                           */
/* ------------------------------------------------------------------ */

export interface SeriesEquivalent {
  R: number; X: number;
  kind: 'L' | 'C' | 'R';
  L?: number; C?: number;
  Q: number;
}

/** Series R + (L or C) model of an absolute impedance Z at frequency f (Hz). */
export function seriesEquivalent(Z: Complex, f: number): SeriesEquivalent {
  const w = 2 * Math.PI * f;
  const Q = Z.re !== 0 ? Math.abs(Z.im) / Math.abs(Z.re) : Infinity;
  if (Z.im > 0) return { R: Z.re, X: Z.im, kind: 'L', L: Z.im / w, Q };
  if (Z.im < 0) return { R: Z.re, X: Z.im, kind: 'C', C: -1 / (w * Z.im), Q };
  return { R: Z.re, X: 0, kind: 'R', Q: 0 };
}

export interface ParallelEquivalent {
  G: number; B: number; Rp: number;
  kind: 'L' | 'C' | 'R';
  L?: number; C?: number;
  Q: number;
}

/** Parallel G ‖ (L or C) model of an absolute admittance Y at frequency f (Hz). */
export function parallelEquivalent(Y: Complex, f: number): ParallelEquivalent {
  const w = 2 * Math.PI * f;
  const Q = Y.re !== 0 ? Math.abs(Y.im) / Math.abs(Y.re) : Infinity;
  const Rp = Y.re !== 0 ? 1 / Y.re : Infinity;
  if (Y.im > 0) return { G: Y.re, B: Y.im, Rp, kind: 'C', C: Y.im / w, Q };
  if (Y.im < 0) return { G: Y.re, B: Y.im, Rp, kind: 'L', L: -1 / (w * Y.im), Q };
  return { G: Y.re, B: 0, Rp, kind: 'R', Q: 0 };
}

/** Node Q = |x|/r (identical for series and parallel forms of the same point). */
export function nodeQ(z: Complex): number {
  if (!isFiniteC(z)) return 0;
  return z.re !== 0 ? Math.abs(z.im) / Math.abs(z.re) : Infinity;
}

/* ------------------------------------------------------------------ */
/* Grid geometry (circles in the Γ plane)                              */
/* ------------------------------------------------------------------ */

export interface Circle { cx: number; cy: number; r: number; }

/** Constant normalised resistance r (2.56a): centre (r/(1+r), 0), radius 1/(1+r). */
export const resistanceCircle = (r: number): Circle => ({ cx: r / (1 + r), cy: 0, r: 1 / (1 + r) });
/** Constant normalised reactance x (2.56b): centre (1, 1/x), radius 1/|x|. */
export const reactanceCircle = (x: number): Circle => ({ cx: 1, cy: 1 / x, r: 1 / Math.abs(x) });
/** Constant normalised conductance g (admittance chart = Z chart rotated 180°). */
export const conductanceCircle = (g: number): Circle => ({ cx: -g / (1 + g), cy: 0, r: 1 / (1 + g) });
/** Constant normalised susceptance b: centre (−1, −1/b), radius 1/|b|. */
export const susceptanceCircle = (b: number): Circle => ({ cx: -1, cy: -1 / b, r: 1 / Math.abs(b) });
/** Constant |Γ| (SWR) circle about the chart centre. */
export const vswrCircle = (rho: number): Circle => ({ cx: 0, cy: 0, r: rho });
/**
 * Constant-Q contour. The arc in the upper (inductive) half lies on the circle
 * centred at (0, −1/Q) with radius √(1 + 1/Q²); the lower arc mirrors it.
 */
export const qCircle = (Q: number, upper: boolean): Circle =>
  ({ cx: 0, cy: upper ? -1 / Q : 1 / Q, r: Math.sqrt(1 + 1 / (Q * Q)) });

/** Point classification for readouts and warnings. */
export type PointClass = 'matched' | 'open' | 'short' | 'resistive' | 'inductive' | 'capacitive' | 'active' | 'lossless-reactive';
export function classifyPoint(g: Complex, tol = 1e-6): PointClass {
  const rho = abs(g);
  if (rho < tol) return 'matched';
  if (rho > 1 + tol) return 'active';
  if (abs2(sub(g, ONE)) < tol * tol) return 'open';
  if (abs2(add(g, ONE)) < tol * tol) return 'short';
  if (Math.abs(rho - 1) < tol) return 'lossless-reactive';
  if (Math.abs(g.im) < tol) return 'resistive';
  return g.im > 0 ? 'inductive' : 'capacitive';
}
