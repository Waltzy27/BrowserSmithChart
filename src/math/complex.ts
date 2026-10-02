/**
 * Immutable complex-number kernel.
 *
 * All functions are pure and never mutate their inputs. Angles are radians.
 * The engineering convention e^{+jωt} is assumed throughout (Pozar, Ch. 1),
 * so inductive reactance is +jωL and capacitive reactance is -j/(ωC).
 */
export interface Complex {
  readonly re: number;
  readonly im: number;
}

export const c = (re: number, im = 0): Complex => Object.freeze({ re, im });

export const ZERO = c(0, 0);
export const ONE = c(1, 0);
export const J = c(0, 1);

export const add = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
export const sub = (a: Complex, b: Complex): Complex => c(a.re - b.re, a.im - b.im);
export const mul = (a: Complex, b: Complex): Complex =>
  c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a: Complex, k: number): Complex => c(a.re * k, a.im * k);
export const conj = (a: Complex): Complex => c(a.re, -a.im);
export const neg = (a: Complex): Complex => c(-a.re, -a.im);

/** Smith's algorithm for numerically robust complex division. */
export function div(a: Complex, b: Complex): Complex {
  if (b.re === 0 && b.im === 0) {
    // Division by exact zero: return a signed infinity so callers can detect it.
    return c(a.re === 0 ? NaN : Infinity * Math.sign(a.re || 1), a.im === 0 ? 0 : Infinity * Math.sign(a.im));
  }
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re;
    const d = b.re + b.im * r;
    return c((a.re + a.im * r) / d, (a.im - a.re * r) / d);
  }
  const r = b.re / b.im;
  const d = b.re * r + b.im;
  return c((a.re * r + a.im) / d, (a.im * r - a.re) / d);
}

export const inv = (a: Complex): Complex => div(ONE, a);
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);
export const abs2 = (a: Complex): number => a.re * a.re + a.im * a.im;
export const arg = (a: Complex): number => Math.atan2(a.im, a.re);
export const fromPolar = (mag: number, angleRad: number): Complex =>
  c(mag * Math.cos(angleRad), mag * Math.sin(angleRad));

export const exp = (a: Complex): Complex => fromPolar(Math.exp(a.re), a.im);

export function sqrt(a: Complex): Complex {
  const m = abs(a);
  const re = Math.sqrt((m + a.re) / 2);
  const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (m - a.re) / 2));
  return c(re, im);
}

/**
 * Complex hyperbolic tangent, overflow-safe:
 * tanh(a + jb) = (sinh 2a + j sin 2b) / (cosh 2a + cos 2b).
 */
export function tanh(z: Complex): Complex {
  const a = z.re;
  const b = z.im;
  if (Math.abs(a) > 20) return c(Math.sign(a), 0);
  const d = Math.cosh(2 * a) + Math.cos(2 * b);
  return c(Math.sinh(2 * a) / d, Math.sin(2 * b) / d);
}

/** Complex tangent via tan(z) = -j tanh(jz). */
export function tan(z: Complex): Complex {
  const t = tanh(c(-z.im, z.re));
  return c(t.im, -t.re);
}

export const isFiniteC = (a: Complex): boolean => Number.isFinite(a.re) && Number.isFinite(a.im);

export const approxEq = (a: Complex, b: Complex, tol = 1e-9): boolean => abs(sub(a, b)) <= tol;

/** Wrap an angle to (-π, π]. */
export function wrapPi(theta: number): number {
  let t = theta % (2 * Math.PI);
  if (t <= -Math.PI) t += 2 * Math.PI;
  if (t > Math.PI) t -= 2 * Math.PI;
  return t;
}

/** Unwrap a phase sequence (radians) by removing 2π discontinuities. */
export function unwrapPhase(phases: readonly number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < phases.length; i++) {
    if (i > 0) {
      const d = phases[i] - phases[i - 1];
      if (d > Math.PI) offset -= 2 * Math.PI;
      else if (d < -Math.PI) offset += 2 * Math.PI;
    }
    out.push(phases[i] + offset);
  }
  return out;
}

export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;
