/** Formatting of every equivalent representation of a chart point. */
import { type Complex, c, mul } from '../math/complex';
import {
  gammaToZ, gammaToY, gammaMetrics, seriesEquivalent, parallelEquivalent, classifyPoint, nodeQ,
} from '../math/smith';
import { fix, formatEngineering, formatRect, formatPolar } from '../math/units';

export interface ReadoutRow { k: string; v: string; group: string; title?: string; }

const CLASS_TEXT: Record<string, string> = {
  matched: 'Matched (centre)', open: 'Open circuit', short: 'Short circuit', resistive: 'Purely resistive',
  inductive: 'Inductive (upper half)', capacitive: 'Capacitive (lower half)', active: 'Active / negative resistance (|Γ| > 1)',
  'lossless-reactive': 'Pure reactance (rim)',
};

export function pointRows(g: Complex, Z0: number, f: number): ReadoutRow[] {
  const m = gammaMetrics(g);
  const z = gammaToZ(g), y = gammaToY(g);
  const Z = mul(z, c(Z0, 0));
  const Y = mul(y, c(1 / Z0, 0));
  const rows: ReadoutRow[] = [
    { group: 'Reflection', k: 'Γ', v: formatRect(g, 4) },
    { group: 'Reflection', k: '|Γ| ∠ θ', v: formatPolar(g, 4, 2) },
    { group: 'Reflection', k: '|Γ| dB ∠ θ', v: `${fix(m.magDb, 2)} dB ∠ ${fix(m.angleDeg, 2)}°` },
    { group: 'Impedance', k: 'z = Z/Z0', v: formatRect(z, 4) },
    { group: 'Impedance', k: 'Z', v: formatRect(Z, 3, 'Ω') },
    { group: 'Admittance', k: 'y = Y·Z0', v: formatRect(y, 4) },
    { group: 'Admittance', k: 'Y', v: Number.isFinite(Y.re) ? `${formatEngineering(Y.re, 'S', 4)} ${Y.im < 0 ? '−' : '+'} j${formatEngineering(Math.abs(Y.im), 'S', 4)}` : '∞ (short)' },
    { group: 'Mismatch', k: 'VSWR', v: Number.isFinite(m.vswr) ? fix(m.vswr, 3) : '∞' },
    { group: 'Mismatch', k: 'Return loss', v: rlText(m.returnLossDb) },
    { group: 'Mismatch', k: 'Mismatch loss', v: `${fix(m.mismatchLossDb, 3)} dB` },
    { group: 'Mismatch', k: 'Reflected / accepted power', v: `${fix(m.reflectedPower * 100, 2)} % / ${fix(m.acceptedPower * 100, 2)} %` },
    { group: 'Line scales', k: 'WTG / WTL', v: `${fix(m.wtg, 4)} λ / ${fix(m.wtl, 4)} λ`, title: 'Wavelengths toward generator / load, measured from the short-circuit point' },
  ];
  if (Number.isFinite(Z.re) && Number.isFinite(Y.re)) {
    const se = seriesEquivalent(Z, f);
    const pe = parallelEquivalent(Y, f);
    rows.push(
      { group: `Equivalents at ${formatEngineering(f, 'Hz', 4)}`, k: 'Series', v: `${formatEngineering(se.R, 'Ω', 4)} + ${se.kind === 'L' ? formatEngineering(se.L!, 'H', 4) : se.kind === 'C' ? formatEngineering(se.C!, 'F', 4) : '0'}` },
      { group: `Equivalents at ${formatEngineering(f, 'Hz', 4)}`, k: 'Parallel', v: `${formatEngineering(pe.Rp, 'Ω', 4)} ‖ ${pe.kind === 'L' ? formatEngineering(pe.L!, 'H', 4) : pe.kind === 'C' ? formatEngineering(pe.C!, 'F', 4) : '∞'}` },
      { group: `Equivalents at ${formatEngineering(f, 'Hz', 4)}`, k: 'Node Q = |x|/r', v: Number.isFinite(nodeQ(z)) ? fix(nodeQ(z), 3) : '∞' },
    );
  }
  rows.push({ group: 'Class', k: 'Region', v: CLASS_TEXT[classifyPoint(g)] });
  return rows;
}

/** One-line accessible description, e.g. "Load: 60.0 − j80.0 Ω, VSWR 4.27". */
export function describePoint(name: string, g: Complex, Z0: number): string {
  const Z = mul(gammaToZ(g), c(Z0, 0));
  const m = gammaMetrics(g);
  return `${name}: ${formatRect(Z, 1, 'Ω')}, |Γ| ${fix(m.rho, 3)}, VSWR ${Number.isFinite(m.vswr) ? fix(m.vswr, 2) : '∞'}`;
}

/** Return loss text; values above 100 dB are numerically a perfect match. */
export function rlText(db: number): string {
  if (!Number.isFinite(db) || db > 100) return '> 100 dB';
  return `${fix(db, 2)} dB`;
}
