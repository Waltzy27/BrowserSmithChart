/**
 * Substrate stackup presets and JSON import/export (no DOM).
 *
 * Values are starting points, not guarantees: always use your fabricator's
 * stackup. Rogers figures are the "design Dk" and 10 GHz Df from the RO4000
 * data sheet (RO4350B 3.66 / 0.0037, RO4003C 3.55 / 0.0027). FR-4 varies by
 * glass style and resin content; 4.4 and 0.02 are typical 1 GHz values.
 */
import { SIGMA_CU, substrateError, type Substrate } from './microstrip';

export interface Stackup extends Substrate { name: string; }

export const STACKUP_PRESETS: ReadonlyArray<Stackup> = [
  { name: 'FR-4, 1.6 mm, 1 oz', er: 4.4, h: 1.6e-3, t: 35e-6, tanD: 0.02, sigma: SIGMA_CU, rough: 0 },
  { name: 'FR-4 prepreg, 0.2 mm, 1 oz', er: 4.2, h: 0.2e-3, t: 35e-6, tanD: 0.02, sigma: SIGMA_CU, rough: 0 },
  { name: 'Rogers RO4350B, 20 mil, 1 oz', er: 3.66, h: 0.508e-3, t: 35e-6, tanD: 0.0037, sigma: SIGMA_CU, rough: 0 },
  { name: 'Rogers RO4350B, 30 mil, 1 oz', er: 3.66, h: 0.762e-3, t: 35e-6, tanD: 0.0037, sigma: SIGMA_CU, rough: 0 },
  { name: 'Rogers RO4003C, 20 mil, 1 oz', er: 3.55, h: 0.508e-3, t: 35e-6, tanD: 0.0027, sigma: SIGMA_CU, rough: 0 },
  { name: 'Alumina 99.6 %, 25 mil, thin film', er: 9.9, h: 0.635e-3, t: 5e-6, tanD: 0.0001, sigma: SIGMA_CU, rough: 0 },
];

export const STACKUP_FORMAT = 'browser-smith-chart-stackup';

export function serializeStackup(s: Stackup): string {
  return JSON.stringify({ format: STACKUP_FORMAT, version: 1, units: 'SI (m, S/m)', stackup: { ...s } }, null, 2);
}

/** Parse and validate an untrusted stackup JSON. Throws a readable Error. */
export function parseStackup(text: string): Stackup {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('Not a valid JSON file.'); }
  const o = raw as { format?: unknown; stackup?: Record<string, unknown> };
  if (o?.format !== STACKUP_FORMAT || !o.stackup || typeof o.stackup !== 'object') throw new Error('This file is not a Browser Smith Chart stackup.');
  const s = o.stackup;
  const num = (k: string): number => {
    const v = s[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Stackup field "${k}" is missing or not a number.`);
    return v;
  };
  const out: Stackup = {
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : 'Imported stackup',
    er: num('er'), h: num('h'), t: num('t'), tanD: num('tanD'), sigma: num('sigma'),
    rough: typeof s.rough === 'number' && Number.isFinite(s.rough) ? s.rough : 0,
  };
  const err = substrateError(out);
  if (err) throw new Error(err);
  return out;
}
