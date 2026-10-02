/**
 * Network elements and cascades, evaluated in the reflection-coefficient domain.
 *
 * The state that flows through a cascade is Γ referenced to the system Z0.
 * Working in Γ (rather than Z) keeps every operation finite at the open
 * (Γ = +1) and short (Γ = −1) singularities, which are ordinary points on the chart.
 *
 * Element order is from the LOAD toward the GENERATOR: element 0 is attached
 * directly to the load and the last element is at the input port.
 *
 * Pozar references: (2.44) lossless line, (2.90)–(2.91) lossy line,
 * (2.45c)/(2.46c) shorted/open stubs, (5.11)/(5.16) stub lengths.
 */
import {
  type Complex, c, add, sub, mul, div, scale, exp, abs, arg, tanh, ONE, isFiniteC,
} from '../math/complex';
import { gammaToZ, gammaToY } from '../math/smith';

export type ElementKind =
  | 'seriesR' | 'seriesL' | 'seriesC'
  | 'shuntR' | 'shuntL' | 'shuntC'
  | 'line' | 'stub' | 'transformer';

interface Base { id: string; kind: ElementKind; label?: string; }

/** Lumped element. value is SI: Ω for R, H for L, F for C. */
export interface Lumped extends Base {
  kind: 'seriesR' | 'seriesL' | 'seriesC' | 'shuntR' | 'shuntL' | 'shuntC';
  value: number;
}

/** Transmission-line section in cascade. */
export interface Line extends Base {
  kind: 'line';
  z0: number;          // characteristic impedance, Ω (real, low-loss approximation (2.86))
  lengthWl: number;    // electrical length in wavelengths at the design frequency f0
  lossDb: number;      // one-way matched loss of the section at f0, dB (αℓ·8.686)
  vf: number;          // velocity factor, for physical-length readout only
}

/** Open- or short-circuited stub connected in shunt or series. */
export interface Stub extends Base {
  kind: 'stub';
  z0: number;
  lengthWl: number;
  lossDb: number;
  vf: number;
  termination: 'open' | 'short';
  connection: 'shunt' | 'series';
}

/** Ideal transformer: Z_in = n² Z_load. */
export interface Transformer extends Base { kind: 'transformer'; n: number; }

export type Element = Lumped | Line | Stub | Transformer;

export const DB_PER_NEPER = 20 / Math.LN10; // 8.6859

/* ------------------------------------------------------------------ */
/* Primitive Γ-domain operations                                       */
/* ------------------------------------------------------------------ */

/**
 * Add a normalised series impedance ze. Uses the admittance form near the open
 * point so that Γ = 1 stays at Γ = 1.
 *   z-form:  Γ' = (z + ze − 1)/(z + ze + 1)
 *   y-form:  Γ' = (1 + ze·y − y)/(1 + ze·y + y)
 */
export function addSeriesZ(g: Complex, ze: Complex): Complex {
  if (!isFiniteC(ze)) return c(1, 0); // infinite series impedance → open
  if (abs(sub(g, ONE)) < abs(add(g, ONE))) {
    const y = gammaToY(g);
    const zy = mul(ze, y);
    return div(sub(add(ONE, zy), y), add(add(ONE, zy), y));
  }
  const z = add(gammaToZ(g), ze);
  return div(sub(z, ONE), add(z, ONE));
}

/**
 * Add a normalised shunt admittance ye. Uses the impedance form near the short
 * point so that Γ = −1 stays at Γ = −1.
 *   y-form:  Γ' = (1 − y − ye)/(1 + y + ye)
 *   z-form:  Γ' = (z − 1 − ye·z)/(z + 1 + ye·z)
 */
export function addShuntY(g: Complex, ye: Complex): Complex {
  if (!isFiniteC(ye)) return c(-1, 0); // infinite shunt admittance → short
  if (abs(add(g, ONE)) < abs(sub(g, ONE))) {
    const z = gammaToZ(g);
    const yz = mul(ye, z);
    return div(sub(sub(z, ONE), yz), add(add(z, ONE), yz));
  }
  const y = add(gammaToY(g), ye);
  return div(sub(ONE, y), add(ONE, y));
}

/**
 * Move along a line of normalised characteristic impedance zl (= Z_line/Z0)
 * with total propagation γℓ = αℓ + jβℓ (toward the generator).
 * 1. Re-reference Γ to the line:  Γl = (z − zl)/(z + zl)
 * 2. Propagate:                  Γl' = Γl e^{−2γℓ}            (2.90)
 * 3. Return to Z0:               Γ' = (zl(1+Γl') − (1−Γl'))/(zl(1+Γl') + (1−Γl'))
 * Written with (1±Γ) so open/short loads are exact.
 */
export function propagateGamma(g: Complex, zl: Complex, gammaL: Complex): Complex {
  const onePlus = add(ONE, g);
  const oneMinus = sub(ONE, g);
  const gl = div(sub(onePlus, mul(zl, oneMinus)), add(onePlus, mul(zl, oneMinus)));
  const gl2 = mul(gl, exp(scale(gammaL, -2)));
  const a = mul(zl, add(ONE, gl2));
  const b = sub(ONE, gl2);
  return div(sub(a, b), add(a, b));
}

/** Ideal transformer, Z_in = n² Z_L:  Γ' = (n²(1+Γ) − (1−Γ))/(n²(1+Γ) + (1−Γ)). */
export function applyTransformerGamma(g: Complex, n2: number): Complex {
  const a = scale(add(ONE, g), n2);
  const b = sub(ONE, g);
  return div(sub(a, b), add(a, b));
}

/* ------------------------------------------------------------------ */
/* Independent closed forms (used for cross-checks and calculators)     */
/* ------------------------------------------------------------------ */

/**
 * Lossy-line input impedance, Pozar (2.91):
 *   Z_in = Z0 (Z_L + Z0 tanh γℓ)/(Z0 + Z_L tanh γℓ).
 * With α = 0 this reduces to (2.44): Z_in = Z0 (Z_L + jZ0 tan βℓ)/(Z0 + jZ_L tan βℓ).
 */
export function lineInputImpedance(ZL: Complex, Z0line: number, gammaL: Complex): Complex {
  if (!isFiniteC(ZL)) {
    // Open load: Z_in = Z0 coth γℓ
    return div(c(Z0line, 0), tanh(gammaL));
  }
  const t = tanh(gammaL);
  const num = add(ZL, scale(t, Z0line));
  const den = add(c(Z0line, 0), mul(ZL, t));
  return scale(div(num, den), Z0line);
}

/** Stub input impedance (Ω): short → Z0 tanh γℓ (2.45c); open → Z0 coth γℓ (2.46c). */
export function stubInputImpedance(term: 'open' | 'short', Z0stub: number, gammaL: Complex): Complex {
  const t = tanh(gammaL);
  return term === 'short' ? scale(t, Z0stub) : div(c(Z0stub, 0), t);
}

/* ------------------------------------------------------------------ */
/* Element evaluation                                                  */
/* ------------------------------------------------------------------ */

export interface EvalContext {
  f: number;   // evaluation frequency, Hz
  f0: number;  // design frequency, Hz (electrical lengths are defined here)
  Z0: number;  // system reference impedance, Ω
}

/** γℓ of a distributed section at frequency f (TEM: βℓ ∝ f; αℓ held at its f0 value). */
export function sectionGammaL(lengthWl: number, lossDb: number, f: number, f0: number): Complex {
  const beta = 2 * Math.PI * lengthWl * (f / f0);
  return c(lossDb / DB_PER_NEPER, beta);
}

/** Normalised impedance of a series element at frequency f, or admittance of a shunt element. */
export function lumpedImmittance(el: Lumped, f: number, Z0: number): Complex {
  const w = 2 * Math.PI * f;
  switch (el.kind) {
    case 'seriesR': return c(el.value / Z0, 0);
    case 'seriesL': return c(0, (w * el.value) / Z0);
    case 'seriesC': return c(0, -1 / (w * el.value * Z0));
    case 'shuntR': return c(Z0 / el.value, 0);
    case 'shuntL': return c(0, -Z0 / (w * el.value));
    case 'shuntC': return c(0, w * el.value * Z0);
  }
}

export const isSeries = (k: ElementKind): boolean => k === 'seriesR' || k === 'seriesL' || k === 'seriesC';
export const isShunt = (k: ElementKind): boolean => k === 'shuntR' || k === 'shuntL' || k === 'shuntC';

/**
 * Stub contribution: normalised admittance for a shunt stub or normalised
 * impedance for a series stub. Computed from the stub's own reflection so the
 * open/short limits are exact; returns Infinity where the stub is resonant.
 */
export function stubImmittance(s: Stub, f: number, f0: number, Z0: number, lengthScale = 1): Complex {
  const gl = sectionGammaL(s.lengthWl * lengthScale, s.lossDb * lengthScale, f, f0);
  const zs = s.z0 / Z0;
  const gTerm = s.termination === 'open' ? 1 : -1;
  const gIn = scale(exp(scale(gl, -2)), gTerm); // Γ at stub input, referenced to the stub's Z0
  // z_in (normalised to Z0) = zs (1+Γ)/(1−Γ);  y_in = (1/zs)(1−Γ)/(1+Γ)
  if (s.connection === 'series') {
    const d = sub(ONE, gIn);
    if (abs(d) < 1e-14) return c(Infinity, 0);
    return scale(div(add(ONE, gIn), d), zs);
  }
  const d = add(ONE, gIn);
  if (abs(d) < 1e-14) return c(Infinity, 0);
  return scale(div(sub(ONE, gIn), d), 1 / zs);
}

/** Apply one element to Γ (toward the generator). */
export function applyElement(g: Complex, el: Element, ctx: EvalContext): Complex {
  switch (el.kind) {
    case 'seriesR': case 'seriesL': case 'seriesC':
      return addSeriesZ(g, lumpedImmittance(el, ctx.f, ctx.Z0));
    case 'shuntR': case 'shuntL': case 'shuntC':
      return addShuntY(g, lumpedImmittance(el, ctx.f, ctx.Z0));
    case 'line':
      return propagateGamma(g, c(el.z0 / ctx.Z0, 0), sectionGammaL(el.lengthWl, el.lossDb, ctx.f, ctx.f0));
    case 'stub': {
      const v = stubImmittance(el, ctx.f, ctx.f0, ctx.Z0);
      return el.connection === 'shunt' ? addShuntY(g, v) : addSeriesZ(g, v);
    }
    case 'transformer':
      return applyTransformerGamma(g, el.n * el.n);
  }
}

/** Γ after each element: result[0] = load, result[k+1] = after element k. */
export function cascade(gLoad: Complex, elements: readonly Element[], ctx: EvalContext): Complex[] {
  const out: Complex[] = [gLoad];
  let g = gLoad;
  for (const el of elements) {
    g = applyElement(g, el, ctx);
    out.push(g);
  }
  return out;
}

/**
 * Chart locus traced while an element's value grows from zero to its final value.
 * Series elements follow constant-r (reactive) or constant-x (resistive) contours;
 * shunt elements follow constant-g or constant-b contours; lines follow the
 * (possibly spiralling) constant-|Γ_line| path. Stubs are drawn by scaling their
 * immittance, which traces the same contour without jumping through the stub's
 * zero-length short/open state.
 */
export function elementPath(g: Complex, el: Element, ctx: EvalContext, steps = 96): Complex[] {
  const pts: Complex[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(applyScaled(g, el, ctx, t));
  }
  return pts;
}

function applyScaled(g: Complex, el: Element, ctx: EvalContext, t: number): Complex {
  switch (el.kind) {
    case 'seriesR': case 'seriesL': case 'seriesC':
      return addSeriesZ(g, scale(lumpedImmittance(el, ctx.f, ctx.Z0), t));
    case 'shuntR': case 'shuntL': case 'shuntC':
      return addShuntY(g, scale(lumpedImmittance(el, ctx.f, ctx.Z0), t));
    case 'line':
      return propagateGamma(g, c(el.z0 / ctx.Z0, 0), sectionGammaL(el.lengthWl * t, el.lossDb * t, ctx.f, ctx.f0));
    case 'stub': {
      const v = stubImmittance(el, ctx.f, ctx.f0, ctx.Z0);
      if (!isFiniteC(v)) return t < 1 ? g : applyElement(g, el, ctx);
      const sv = scale(v, t);
      return el.connection === 'shunt' ? addShuntY(g, sv) : addSeriesZ(g, sv);
    }
    case 'transformer':
      return applyTransformerGamma(g, 1 + (el.n * el.n - 1) * t);
  }
}

/* ------------------------------------------------------------------ */
/* Constraint-drag solver: element value that best reaches a target Γ   */
/* ------------------------------------------------------------------ */

const MIN_POS = 1e-30;

/** Wrap a positive electrical angle (rad) into [0, π) and convert to wavelengths. */
const angleToWl = (theta: number): number => {
  let t = theta % Math.PI;
  if (t < 0) t += Math.PI;
  return t / (2 * Math.PI);
};

/**
 * Given the element's starting Γ and a pointer position Γt on the chart, return a
 * copy of the element whose value moves the endpoint as close to Γt as its
 * contour allows. Used for "drag along the correct contour" interactions.
 */
export function solveElementToward(gStart: Complex, el: Element, gTarget: Complex, ctx: EvalContext): Element {
  const w = 2 * Math.PI * ctx.f0;
  const zS = gammaToZ(gStart), zT = gammaToZ(gTarget);
  const yS = gammaToY(gStart), yT = gammaToY(gTarget);
  switch (el.kind) {
    case 'seriesR': return { ...el, value: Math.max(0, (zT.re - zS.re) * ctx.Z0) };
    case 'seriesL': {
      const X = Math.max(1e-9, (zT.im - zS.im) * ctx.Z0);
      return { ...el, value: X / w };
    }
    case 'seriesC': {
      const X = Math.min(-1e-9, (zT.im - zS.im) * ctx.Z0);
      return { ...el, value: -1 / (w * X) };
    }
    case 'shuntR': {
      const G = Math.max(MIN_POS, (yT.re - yS.re) / ctx.Z0);
      return { ...el, value: 1 / G };
    }
    case 'shuntL': {
      const B = Math.min(-1e-12, (yT.im - yS.im) / ctx.Z0);
      return { ...el, value: -1 / (w * B) };
    }
    case 'shuntC': {
      const B = Math.max(1e-12, (yT.im - yS.im) / ctx.Z0);
      return { ...el, value: B / w };
    }
    case 'line': {
      const zl = c(el.z0 / ctx.Z0, 0);
      const ref = (g: Complex) => {
        const p = add(ONE, g), m = sub(ONE, g);
        return div(sub(p, mul(zl, m)), add(p, mul(zl, m)));
      };
      // clockwise rotation from start to target in the line's own reference
      let th = arg(ref(gStart)) - arg(ref(gTarget));
      th = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return { ...el, lengthWl: th / (4 * Math.PI) };
    }
    case 'stub': {
      const zs = el.z0 / ctx.Z0;
      let theta: number;
      if (el.connection === 'shunt') {
        const b = yT.im - yS.im; // required stub susceptance (normalised)
        theta = el.termination === 'open' ? Math.atan(b * zs) : Math.atan2(-1, b * zs);
      } else {
        const x = zT.im - zS.im; // required stub reactance (normalised)
        theta = el.termination === 'short' ? Math.atan(x / zs) : Math.atan2(-zs, x);
      }
      return { ...el, lengthWl: angleToWl(theta) };
    }
    case 'transformer': {
      const n2 = Math.max(1e-6, abs(zT) / Math.max(1e-12, abs(zS)));
      return { ...el, n: Math.sqrt(n2) };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Load models for frequency sweeps                                    */
/* ------------------------------------------------------------------ */

export type LoadModel = 'constant' | 'series' | 'parallel';

/**
 * Absolute load impedance at frequency f given its value Z(f0) and an
 * equivalent-circuit model: constant, series R–L/C, or parallel G–L/C.
 */
export function loadAtFrequency(Z0f: Complex, f0: number, f: number, model: LoadModel): Complex {
  if (model === 'constant' || f === f0 || !isFiniteC(Z0f)) return Z0f;
  const k = f / f0;
  if (model === 'series') {
    // X(f) = X0·k for an inductor, X0/k for a capacitor
    const X = Z0f.im >= 0 ? Z0f.im * k : Z0f.im / k;
    return c(Z0f.re, X);
  }
  const Y = div(ONE, Z0f);
  const B = Y.im >= 0 ? Y.im * k : Y.im / k; // capacitor ∝ f, inductor ∝ 1/f
  return div(ONE, c(Y.re, B));
}

export const elementLabel: Record<ElementKind, string> = {
  seriesR: 'Series R', seriesL: 'Series L', seriesC: 'Series C',
  shuntR: 'Shunt R', shuntL: 'Shunt L', shuntC: 'Shunt C',
  line: 'Line', stub: 'Stub', transformer: 'Transformer',
};
