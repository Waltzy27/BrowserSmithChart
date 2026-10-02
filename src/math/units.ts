/** Engineering-notation parsing and formatting (SI internally, prefixes at boundaries). */
import { type Complex, abs, arg, deg } from './complex';

export const C0 = 299_792_458; // speed of light in vacuum, m/s (exact)

const PREFIX: Record<string, number> = {
  f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3,
  '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12,
};

/**
 * Parse a number with optional SI prefix and optional unit symbol.
 * Accepts "2.2n", "2.2 nH", "1.5e-9", "500 MHz", "4k7"-style is NOT accepted (ambiguous).
 * "m" is milli; use "M" for mega. Returns NaN on failure.
 */
export function parseEngineering(text: string, unit = ''): number {
  let s = text.trim().replace(/\s+/g, '').replace(/,/g, '');
  if (!s) return NaN;
  if (unit) {
    const uLower = unit.toLowerCase();
    if (s.toLowerCase().endsWith(uLower)) s = s.slice(0, s.length - unit.length);
    else if (unit === 'Ω' && /ohms?$/i.test(s)) s = s.replace(/ohms?$/i, '');
  }
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([fpnuµμmkKMGT]?)$/.exec(s);
  if (!m) return NaN;
  return parseFloat(m[1]) * PREFIX[m[2]];
}

const ENG: Array<[number, string]> = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'],
  [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
];

/** Format with an SI prefix and `digits` significant figures, e.g. 3.88e-8 H → "38.8 nH". */
export function formatEngineering(value: number, unit = '', digits = 4): string {
  if (!Number.isFinite(value)) return value > 0 ? `∞ ${unit}`.trim() : value < 0 ? `−∞ ${unit}`.trim() : '—';
  if (value === 0) return `0 ${unit}`.trim();
  const a = Math.abs(value);
  let pick = ENG[ENG.length - 1];
  for (const p of ENG) {
    if (a >= p[0] * 0.9995) { pick = p; break; }
  }
  const scaled = value / pick[0];
  return `${toSig(scaled, digits)} ${pick[1]}${unit}`.trim();
}

/** Significant-figure formatting without exponent notation in the normal range. */
export function toSig(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return fixMinus(v.toExponential(digits - 1));
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(a)));
  return fixMinus(v.toFixed(Math.min(decimals, 10)));
}

/** Fixed decimals with a typographic minus. */
export function fix(v: number, decimals = 3): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '—';
  const s = v.toFixed(decimals);
  return fixMinus(Number(s) === 0 ? (0).toFixed(decimals) : s);
}

const fixMinus = (s: string): string => s.replace(/^-/, '−');

/** "a + jb" / "a − jb" with fixed decimals. */
export function formatRect(z: Complex, decimals = 3, unit = ''): string {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return `∞${unit ? ' ' + unit : ''}`;
  const sign = z.im < 0 && Number(Math.abs(z.im).toFixed(decimals)) !== 0 ? '−' : '+';
  return `${fix(z.re, decimals)} ${sign} j${Math.abs(z.im).toFixed(decimals)}${unit ? ' ' + unit : ''}`;
}

/** "|z| ∠ θ°" polar form. */
export function formatPolar(z: Complex, decimals = 3, angleDecimals = 2): string {
  return `${fix(abs(z), decimals)} ∠ ${fix(deg(arg(z)), angleDecimals)}°`;
}

/** Wavelength in metres for frequency f (Hz) and velocity factor vf. */
export const wavelength = (f: number, vf = 1): number => (vf * C0) / f;
