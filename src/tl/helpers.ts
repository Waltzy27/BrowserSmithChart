/** Small LineCalc helpers built on the analysis and synthesis functions. */
import { quarterWaveZ1 } from '../rf/matching';
import type { MicrostripResult, Substrate, TlError } from './microstrip';
import { synthesizeLength, synthesizeWidth } from './synth';

export interface QuarterWave { ok: true; Zt: number; W: number; L: number; analysis: MicrostripResult; }

/** λ/4 transformer between real Zs and ZL: Zt = √(Zs·ZL) (Pozar 2.64), then W and L at 90°. */
export function quarterWaveMicrostrip(Zs: number, ZL: number, s: Substrate, f0: number): QuarterWave | TlError {
  if (!(Number.isFinite(Zs) && Zs > 0) || !(Number.isFinite(ZL) && ZL > 0)) return { ok: false, error: 'Both impedances must be real and greater than zero.' };
  const Zt = quarterWaveZ1(Zs, ZL);
  const w = synthesizeWidth(Zt, s, f0);
  if (!w.ok) return w;
  const l = synthesizeLength(Math.PI / 2, w.W, s, f0);
  if (!l.ok) return l;
  return { ok: true, Zt, W: w.W, L: l.L, analysis: w.analysis };
}
