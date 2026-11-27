/** Resolve the LineCalc line card: whichever of W/Z0 and L/θ is the input, solve the other. */
import { analyzeMicrostrip, lineQuantities, type MicrostripResult, type Substrate, type TlError } from './microstrip';
import { synthesizeLength, synthesizeWidth } from './synth';

export interface LineInputs {
  stackup: Substrate;
  widthGiven: 'W' | 'Z0'; W: number; z0Target: number;
  lengthGiven: 'L' | 'angle'; L: number; angleDeg: number;
}

export interface LineSolution {
  ok: true;
  W: number; L: number;
  analysis: MicrostripResult;
  q: ReturnType<typeof lineQuantities>;
}

export function solveLine(p: LineInputs, f: number): LineSolution | TlError {
  let W = p.W;
  let a: MicrostripResult;
  if (p.widthGiven === 'Z0') {
    const w = synthesizeWidth(p.z0Target, p.stackup, f);
    if (!w.ok) return w;
    W = w.W; a = w.analysis;
  } else {
    const r = analyzeMicrostrip(W, p.stackup, f);
    if (!r.ok) return r;
    a = r;
  }
  let L = p.L;
  if (p.lengthGiven === 'angle') {
    const l = synthesizeLength((p.angleDeg * Math.PI) / 180, W, p.stackup, f);
    if (!l.ok) return l;
    L = l.L;
  } else if (!(Number.isFinite(L) && L >= 0)) return { ok: false, error: 'Length cannot be negative.' };
  return { ok: true, W, L, analysis: a, q: lineQuantities(a, L) };
}
