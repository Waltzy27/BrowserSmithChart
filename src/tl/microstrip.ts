/**
 * Microstrip analysis (quasi-TEM, closed-form). SI units throughout: metres,
 * hertz, siemens per metre, ohms. No DOM dependencies.
 *
 * Models (the same set Qucs and scikit-rf use by default):
 *  - Static Z0 and ε_eff: Hammerstad & Jensen, "Accurate Models for Microstrip
 *    Computer-Aided Design", IEEE MTT-S Digest 1980, pp. 407–409.
 *      Z01(u) = η0/(2π)·ln( f(u)/u + √(1 + (2/u)²) ),  f(u) = 6 + (2π − 6)·exp(−(30.666/u)^0.7528)
 *      ε_eff(u, εr) = (εr+1)/2 + (εr−1)/2 · (1 + 10/u)^(−a·b)
 *      a(u) = 1 + ln((u⁴ + (u/52)²)/(u⁴ + 0.432))/49 + ln(1 + (u/18.1)³)/18.7
 *      b(εr) = 0.564·((εr − 0.9)/(εr + 3))^0.053
 *    Stated accuracy: Z01 better than 0.01 % for u ≤ 1 and 0.03 % for u ≤ 1000;
 *    ε_eff better than 0.2 % for εr ≤ 128 and 0.01 ≤ u ≤ 100.
 *  - Finite strip thickness (Hammerstad & Jensen, after Wheeler), with T = t/h:
 *      Δu1 = (T/π)·ln(1 + 4e/(T·coth²√(6.517u))),  Δur = ½(1 + sech√(εr − 1))·Δu1
 *      Z0 = Z01(u + Δur)/√ε_eff(u + Δur),  ε_eff,t = ε_eff(u + Δur)·(Z01(u + Δu1)/Z01(u + Δur))²
 *    No limit is stated with the formula; the app warns above t/h = 0.2 (a
 *    conservative choice for a thin-strip correction).
 *  - Dispersion of ε_eff: Kirschning & Jansen, Electron. Lett. 18(6), 1982,
 *    pp. 272–273. Accuracy 0.6 % for 0.1 ≤ u ≤ 100, 1 ≤ εr ≤ 20, h/λ0 ≤ 0.13.
 *  - Dispersion of Z0: Jansen & Kirschning, AEÜ 37, 1983, pp. 108–112
 *    (power–current definition). Stated for 0.1 ≤ u ≤ 10, 1 ≤ εr ≤ 18,
 *    f·h ≤ 20 GHz·mm (max error 2.5 %).
 *    As in scikit-rf's default (ADS-like) mode, the dispersion formulas use the
 *    thickness-corrected width u_r.
 *  - Dielectric loss: Pozar (3.198), α_d = k0·εr(ε_eff − 1)·tanδ / (2√ε_eff(εr − 1)).
 *  - Conductor loss: Hammerstad & Jensen, α_c = R_s·K_i·K_r/(Z0·W), with the
 *    current-distribution factor K_i = exp(−1.2(Z0/η0)^0.7) and the
 *    Hammerstad–Bekkadal roughness factor K_r = 1 + (2/π)·atan(1.4(Δ/δ_s)²).
 *    R_s = √(ωµ0/2σ) (Pozar), δ_s = 1/√(πfµ0σ). Valid when t ≥ 3δ_s.
 *    This is the least accurate output: Pozar Ex. 3.7 shows closed forms
 *    can differ from a field solver by tens of percent for conductor loss.
 */
import { C0 } from '../math/units';

export const MU0 = 1.25663706212e-6;        // H/m (CODATA 2018)
export const ETA0 = MU0 * C0;               // ≈ 376.730 Ω
export const SIGMA_CU = 5.8e7;              // S/m, annealed copper (IACS ≈ 5.80e7)

/** Design range of the LineCalc tool (inputs outside it are flagged, not blocked). */
export const F_MIN = 100e6;
export const F_MAX = 15e9;

export interface Substrate {
  er: number;       // relative permittivity εr
  h: number;        // substrate height, m
  t: number;        // copper thickness, m (0 = infinitely thin)
  tanD: number;     // loss tangent
  sigma: number;    // conductor conductivity, S/m
  rough: number;    // RMS surface roughness Δ, m (0 = smooth)
}

export interface Validity { code: string; message: string; }

export interface MicrostripResult {
  ok: true;
  W: number; f: number; u: number;
  /** Width corrections from finite thickness (normalised to h). */
  du1: number; dur: number;
  z0Static: number; eeffStatic: number;
  z0: number; eeff: number;                // at frequency f (dispersive)
  lambda0: number; lambdaG: number;        // m
  beta: number;                            // rad/m
  skinDepth: number; Rs: number; Ki: number; Kr: number;
  alphaC: number; alphaD: number;          // Np/m
  /** Validity warnings: inputs outside the stated range of a formula used. */
  warnings: Validity[];
}
export interface TlError { ok: false; error: string; }

const isPos = (v: number) => Number.isFinite(v) && v > 0;

/** Hammerstad–Jensen homogeneous-medium (air) impedance, Ω. */
export function z01(u: number): number {
  const fu = 6 + (2 * Math.PI - 6) * Math.exp(-Math.pow(30.666 / u, 0.7528));
  return (ETA0 / (2 * Math.PI)) * Math.log(fu / u + Math.sqrt(1 + (2 / u) ** 2));
}

/** Hammerstad–Jensen static effective permittivity for zero thickness. */
export function eeffHJ(u: number, er: number): number {
  const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + 0.432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7;
  const b = 0.564 * Math.pow((er - 0.9) / (er + 3), 0.053);
  return (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 10 / u, -a * b);
}

/** Thickness corrections Δu1 (air) and Δur (mixed dielectric), normalised to h. */
export function thicknessCorrection(u: number, T: number, er: number): { du1: number; dur: number } {
  if (!(T > 0)) return { du1: 0, dur: 0 };
  const th = Math.tanh(Math.sqrt(6.517 * u)); // 1/coth
  const du1 = (T / Math.PI) * Math.log(1 + (4 * Math.E * th * th) / T);
  const dur = 0.5 * (1 + 1 / Math.cosh(Math.sqrt(Math.max(er - 1, 0)))) * du1;
  return { du1, dur };
}

/** Static Z0 and ε_eff including thickness (Hammerstad–Jensen). */
export function staticMicrostrip(u: number, er: number, T: number): { z0: number; eeff: number; du1: number; dur: number } {
  const { du1, dur } = thicknessCorrection(u, T, er);
  const u1 = u + du1, ur = u + dur;
  const zr = z01(ur), z1 = z01(u1);
  const e = eeffHJ(ur, er);
  return { z0: zr / Math.sqrt(e), eeff: e * (z1 / zr) ** 2, du1, dur };
}

/** Kirschning–Jansen ε_eff(f). fn = f·h in GHz·mm. */
export function eeffKJ(u: number, fn: number, er: number, e0: number): number {
  const P1 = 0.27488 + (0.6315 + 0.525 / Math.pow(1 + 0.0157 * fn, 20)) * u - 0.065683 * Math.exp(-8.7513 * u);
  const P2 = 0.33622 * (1 - Math.exp(-0.03442 * er));
  const P3 = 0.0363 * Math.exp(-4.6 * u) * (1 - Math.exp(-Math.pow(fn / 38.7, 4.97)));
  const P4 = 1 + 2.751 * (1 - Math.exp(-Math.pow(er / 15.916, 8)));
  const P = P1 * P2 * Math.pow((0.1844 + P3 * P4) * fn, 1.5763);
  return er - (er - e0) / (1 + P);
}

/** Jansen–Kirschning Z0(f). R1, R2, R6 are capped at 20 as the authors recommend. */
export function z0KJ(u: number, fn: number, er: number, e0: number, ef: number, z0s: number): number {
  const R1 = Math.min(0.03891 * er ** 1.4, 20);
  const R2 = Math.min(0.2671 * u ** 7, 20);
  const R3 = 4.766 * Math.exp(-3.228 * u ** 0.641);
  const R4 = 0.016 + (0.0514 * er) ** 4.524;
  const R5 = (fn / 28.843) ** 12;
  const R6 = Math.min(22.2 * u ** 1.92, 20);
  const R7 = 1.206 - 0.3144 * Math.exp(-R1) * (1 - Math.exp(-R2));
  const R8 = 1 + 1.275 * (1 - Math.exp(-0.004625 * R3 * er ** 1.674 * (fn / 18.365) ** 2.745));
  const R9 = ((5.086 * R4 * R5) / (0.3838 + 0.386 * R4)) * (Math.exp(-R6) / (1 + 1.2992 * R5)) * ((er - 1) ** 6 / (1 + 10 * (er - 1) ** 6));
  const R10 = 0.00044 * er ** 2.136 + 0.0184;
  const R11 = (fn / 19.47) ** 6 / (1 + 0.0962 * (fn / 19.47) ** 6);
  const R12 = 1 / (1 + 0.00245 * u * u);
  const R13 = 0.9408 * ef ** R8 - 0.9603;
  const R14 = (0.9408 - R9) * e0 ** R8 - 0.9603;
  const R15 = 0.707 * R10 * (fn / 12.3) ** 1.097;
  const R16 = 1 + 0.0503 * er * er * R11 * (1 - Math.exp(-((u / 15) ** 6)));
  const R17 = R7 * (1 - ((1.1241 * R12) / R16) * Math.exp(-0.026 * fn ** 1.15656 - R15));
  return z0s * Math.pow(R13 / R14, R17);
}

export const skinDepth = (f: number, sigma: number): number => 1 / Math.sqrt(Math.PI * f * MU0 * sigma);
export const surfaceResistance = (f: number, sigma: number): number => Math.sqrt((2 * Math.PI * f * MU0) / (2 * sigma));
/** Hammerstad–Bekkadal roughness factor, 1 (smooth) → 2 (Δ ≫ δs). */
export const roughnessFactor = (rough: number, delta: number): number => 1 + (2 / Math.PI) * Math.atan(1.4 * (rough / delta) ** 2);

/** Validate a substrate; returns a readable message or null. */
export function substrateError(s: Substrate): string | null {
  if (!Number.isFinite(s.er) || s.er < 1) return 'Relative permittivity εr must be at least 1.';
  if (!isPos(s.h)) return 'Substrate height h must be greater than zero.';
  if (!Number.isFinite(s.t) || s.t < 0) return 'Copper thickness t cannot be negative (use 0 for an ideal thin strip).';
  if (!Number.isFinite(s.tanD) || s.tanD < 0) return 'Loss tangent tanδ cannot be negative.';
  if (!isPos(s.sigma)) return 'Conductivity σ must be greater than zero.';
  if (!Number.isFinite(s.rough) || s.rough < 0) return 'Surface roughness cannot be negative (use 0 for smooth copper).';
  return null;
}

/** Collect validity warnings for the formulas used at this geometry and frequency. */
export function validity(u: number, s: Substrate, f: number, W: number): Validity[] {
  const w: Validity[] = [];
  const fn = (f * s.h) / 1e6;              // GHz·mm
  const hl0 = (s.h * f) / C0;              // h/λ0
  if (f < F_MIN || f > F_MAX) w.push({ code: 'freq', message: `Frequency is outside the 100 MHz – 15 GHz design range of this tool.` });
  if (u < 0.01 || u > 100) w.push({ code: 'hj-u', message: `W/h = ${u.toPrecision(3)} is outside 0.01–100, the stated range of the Hammerstad–Jensen Z0 and ε_eff formulas.` });
  if (s.er > 128) w.push({ code: 'hj-er', message: 'εr above 128 is outside the Hammerstad–Jensen range.' });
  if (u < 0.1 || u > 100 || s.er > 20 || hl0 > 0.13)
    w.push({ code: 'kj-eeff', message: `ε_eff(f) dispersion (Kirschning–Jansen) is stated for 0.1 ≤ W/h ≤ 100, εr ≤ 20, h/λ0 ≤ 0.13; here W/h = ${u.toPrecision(3)}, εr = ${s.er}, h/λ0 = ${hl0.toPrecision(3)}.` });
  if (u < 0.1 || u > 10 || s.er > 18 || fn > 20)
    w.push({ code: 'kj-z0', message: `Z0(f) dispersion (Jansen–Kirschning) is stated for 0.1 ≤ W/h ≤ 10, εr ≤ 18, f·h ≤ 20 GHz·mm; here W/h = ${u.toPrecision(3)}, f·h = ${fn.toPrecision(3)} GHz·mm.` });
  if (s.t / s.h > 0.2) w.push({ code: 'thick', message: `t/h = ${(s.t / s.h).toPrecision(3)}: the thin-strip thickness correction is used above t/h = 0.2.` });
  if (s.t > W / 2) w.push({ code: 'thick-w', message: 'Copper thickness exceeds half the strip width; the thickness correction assumes t ≪ W.' });
  if (f > 0 && s.t < 3 * skinDepth(f, s.sigma)) w.push({ code: 'skin', message: `Copper is thinner than 3 skin depths (δs = ${(skinDepth(f, s.sigma) * 1e6).toPrecision(3)} µm); the conductor loss is optimistic.` });
  // Pozar (3.201) TM1 coupling threshold and (3.203) transverse resonance
  if (s.er > 1) {
    const fT1 = (C0 / (2 * Math.PI * s.h)) * Math.sqrt(2 / (s.er - 1)) * Math.atan(s.er);
    const fT3 = C0 / (Math.sqrt(s.er) * (2 * W + s.h));
    if (f > fT1) w.push({ code: 'surface', message: `Above the surface-wave coupling threshold f_T1 ≈ ${(fT1 / 1e9).toPrecision(3)} GHz (Pozar 3.201).` });
    if (f > fT3) w.push({ code: 'transverse', message: `Above the transverse-resonance threshold f_T3 ≈ ${(fT3 / 1e9).toPrecision(3)} GHz (Pozar 3.203): the strip is too wide.` });
  }
  return w;
}

/** Full analysis of a microstrip of width W at frequency f. Never returns NaN: errors are explicit. */
export function analyzeMicrostrip(W: number, s: Substrate, f: number): MicrostripResult | TlError {
  const se = substrateError(s);
  if (se) return { ok: false, error: se };
  if (!isPos(W)) return { ok: false, error: 'Line width W must be greater than zero.' };
  if (!isPos(f)) return { ok: false, error: 'Frequency must be greater than zero.' };
  const u = W / s.h;
  const st = staticMicrostrip(u, s.er, s.t / s.h);
  const ur = u + st.dur;
  const fn = (f * s.h) / 1e6; // GHz·mm
  const eeff = eeffKJ(ur, fn, s.er, st.eeff);
  const z0 = z0KJ(ur, fn, s.er, st.eeff, eeff, st.z0);
  const lambda0 = C0 / f;
  const lambdaG = lambda0 / Math.sqrt(eeff);
  const beta = (2 * Math.PI) / lambdaG;
  const ds = skinDepth(f, s.sigma);
  const Rs = surfaceResistance(f, s.sigma);
  const Ki = Math.exp(-1.2 * Math.pow(z0 / ETA0, 0.7));
  const Kr = roughnessFactor(s.rough, ds);
  const alphaC = (Rs * Ki * Kr) / (z0 * W);
  const k0 = (2 * Math.PI) / lambda0;
  const alphaD = s.er > 1 ? (k0 * s.er * (eeff - 1) * s.tanD) / (2 * Math.sqrt(eeff) * (s.er - 1)) : 0;
  const vals = [st.z0, st.eeff, z0, eeff, alphaC, alphaD];
  if (!vals.every(Number.isFinite)) return { ok: false, error: 'The formulas returned a non-finite value for these inputs; check that they are physically reasonable.' };
  return {
    ok: true, W, f, u, du1: st.du1, dur: st.dur,
    z0Static: st.z0, eeffStatic: st.eeff, z0, eeff, lambda0, lambdaG, beta,
    skinDepth: ds, Rs, Ki, Kr, alphaC, alphaD,
    warnings: validity(u, s, f, W),
  };
}

export const NP_TO_DB = 20 / Math.LN10; // 8.686 dB per neper

/** Line-length quantities for a given analysis. θ in radians, losses in dB. */
export function lineQuantities(a: MicrostripResult, L: number) {
  return {
    L, theta: a.beta * L, thetaDeg: (a.beta * L * 180) / Math.PI, lengthWl: L / a.lambdaG,
    lossCdB: a.alphaC * L * NP_TO_DB, lossDdB: a.alphaD * L * NP_TO_DB, lossdB: (a.alphaC + a.alphaD) * L * NP_TO_DB,
  };
}

/**
 * Open-end length extension ΔL (m): Kirschning, Jansen & Koster, Electron.
 * Lett. 17(3), 1981 (as implemented in Qucs msopen.cpp). Commonly quoted
 * accuracy about 2.5 % for 0.01 ≤ W/h ≤ 100 and εr ≤ 50.
 */
export function openEndExtension(u: number, er: number, eeff: number, h: number): number {
  const Q6 = Math.pow(eeff, 0.81);
  const Q7 = Math.pow(u, 0.8544);
  const Q1 = (0.434907 * (Q6 + 0.26) / (Q6 - 0.189)) * ((Q7 + 0.236) / (Q7 + 0.87));
  const Q2 = 1 + Math.pow(u, 0.371) / (2.358 * er + 1);
  const Q3 = 1 + (0.5274 * Math.atan(0.084 * Math.pow(u, 1.9413 / Q2))) / Math.pow(eeff, 0.9236);
  const Q4 = 1 + 0.0377 * Math.atan(0.067 * Math.pow(u, 1.456)) * (6 - 5 * Math.exp(0.036 * (1 - er)));
  const Q5 = 1 - 0.218 * Math.exp(-7.5 * u);
  return ((Q1 * Q3 * Q5) / Q4) * h;
}

/** Hammerstad–Bekkadal open-end extension quoted in Pozar Problem 4.30 (for comparison). */
export const openEndHB = (W: number, h: number, eeff: number): number =>
  0.412 * h * ((eeff + 0.3) / (eeff - 0.258)) * ((W + 0.262 * h) / (W + 0.813 * h));
