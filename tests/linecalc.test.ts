/** v0.3 LineCalc: microstrip analysis/synthesis, stubs, roughness, stackups and the schema-2 migration. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { c } from '../src/math/complex';
import { gammaToY, gammaToZ } from '../src/math/smith';
import { applyElement, type Stub } from '../src/rf/network';
import {
  analyzeMicrostrip, roughnessFactor, skinDepth, openEndExtension, openEndHB, staticMicrostrip, lineQuantities,
  NP_TO_DB, type Substrate, type MicrostripResult,
} from '../src/tl/microstrip';
import { synthesizeWidth, synthesizeLength, brent } from '../src/tl/synth';
import { designStub, stubSweep, stubBandwidth, targetReactance, type StubPart, type StubTerm } from '../src/tl/stub';
import { quarterWaveMicrostrip } from '../src/tl/helpers';
import { STACKUP_PRESETS, serializeStackup, parseStackup } from '../src/tl/stackup';
import { solveLine } from '../src/tl/linecalc';
import { loadProject, serializeProject, defaultLineCalc } from '../src/state/store';

const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThanOrEqual(tol);
const sub = (er: number, h: number, t = 0, tanD = 0, sigma = 5.8e7, rough = 0): Substrate => ({ er, h, t, tanD, sigma, rough });
function ok<T extends { ok: boolean }>(r: T | { ok: false; error: string }): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got: ${(r as { error: string }).error}`);
  return r as Extract<T, { ok: true }>;
}
const allFinite = (a: MicrostripResult) => [a.z0, a.eeff, a.z0Static, a.eeffStatic, a.lambdaG, a.beta, a.alphaC, a.alphaD, a.Kr].every(Number.isFinite);

describe('microstrip analysis against published cases', () => {
  // Pozar, Microwave Engineering 4th ed., Example 3.7: alumina εr 9.9, h 0.5 mm, 50 Ω, 270° at 10 GHz.
  // CAD results quoted there: W = 0.478 mm, εe = 6.83, ℓ = 8.61 mm, αd = 0.022 dB/cm.
  it('Pozar Example 3.7 (CAD values): W within 2 %, εe(10 GHz) within 1 %, ℓ within 1 %, αd within 5 %', () => {
    const s = sub(9.9, 0.5e-3, 0, 0.001);
    const w = ok(synthesizeWidth(50, s, 10e9));
    rel(w.W, 0.478e-3, 0.02);
    rel(w.analysis.eeff, 6.83, 0.01);
    const l = ok(synthesizeLength((270 * Math.PI) / 180, w.W, s, 10e9));
    rel(l.L, 8.61e-3, 0.01);
    rel((w.analysis.alphaD * NP_TO_DB) / 100, 0.022, 0.05);
  });
  // Pozar Example 3.8: εr 10, h 0.65 mm, 25 Ω → W = 2.00 mm, εe(0) = 7.53.
  it('Pozar Example 3.8: W and static εe within 0.5 %', () => {
    const w = ok(synthesizeWidth(25, sub(10, 0.65e-3), 1e6)); // 1 MHz ≈ static (dispersion < 1e-6)
    rel(w.W, 2.0e-3, 0.005);
    rel(w.analysis.eeffStatic, 7.53, 0.005);
  });
  // Pozar Example 6.2: Teflon εr 2.08, h 1.59 mm, 50 Ω → W = 5.08 mm, εe = 1.80.
  it('Pozar Example 6.2: W and static εe within 0.5 %', () => {
    const w = ok(synthesizeWidth(50, sub(2.08, 1.59e-3), 1e6));
    rel(w.W, 5.08e-3, 0.005);
    rel(w.analysis.eeffStatic, 1.80, 0.005);
  });
  // Pozar Problem 3.20 (answer in Appendix): 100 Ω, εr 2.2, h 0.51 mm, 5 GHz → W = 0.457 mm, λg = 4.525 cm.
  it('Pozar Problem 3.20: W within 0.5 %, λg within 1 %', () => {
    const w = ok(synthesizeWidth(100, sub(2.2, 0.51e-3), 5e9));
    rel(w.W, 0.457e-3, 0.005);
    rel(w.analysis.lambdaG, 4.525e-2, 0.01);
  });
  // scikit-rf 2.1.0 MLine (model='hammerstadjensen', disp='kirschningjansen', diel='frequencyinvariant',
  // tand = 0, rho = 1/5.8e7) evaluated offline; values hard-coded here. Same formulas, independent code.
  const SKRF: number[][] = [
    // W, h, t, εr, f, Z0 static, εe static, Z0(f), εe(f), αc (Np/m; -1 = not compared)
    [0.483e-3, 0.5e-3, 0, 9.9, 10e9, 49.8879652967532, 6.623104272395376, 50.07478286049955, 6.880231558485235, -1],
    [5.08e-3, 1.59e-3, 35e-6, 2.08, 5e9, 49.61837772160565, 1.792826264144864, 49.91234541710747, 1.8201433432463672, 0.0543579220199148],
    [3.0e-3, 1.6e-3, 35e-6, 4.4, 2e9, 50.16596082148876, 3.300804585348323, 50.16280039748325, 3.341141826574945, 0.057865151542118264],
    [0.2e-3, 0.508e-3, 17e-6, 3.66, 12e9, 108.64342503540836, 2.5197425327515197, 108.9046507943697, 2.5507848948350045, 0.7931708267440174],
    [20e-3, 1.6e-3, 35e-6, 4.4, 1e9, 12.156113291963267, 3.9229939224506905, 12.190013014985338, 3.960000838474026, 0.030355064109059096],
  ];
  it('matches scikit-rf MLine to 1e-6 relative (static, dispersive, conductor loss)', () => {
    for (const r of SKRF) {
      const [W, h, t, er, f, z0s, e0, z0f, ef, ac] = r;
      const a = ok(analyzeMicrostrip(W, sub(er, h, t), f));
      rel(a.z0Static, z0s, 1e-6); rel(a.eeffStatic, e0, 1e-6);
      rel(a.z0, z0f, 1e-6); rel(a.eeff, ef, 1e-6);
      if (ac > 0) rel(a.alphaC, ac, 1e-6);
    }
  });
  it('dispersion raises εeff toward εr and vanishes at low frequency', () => {
    const s = sub(10, 0.65e-3);
    const a0 = ok(analyzeMicrostrip(2e-3, s, 1e6)), a1 = ok(analyzeMicrostrip(2e-3, s, 10e9)), a2 = ok(analyzeMicrostrip(2e-3, s, 15e9));
    rel(a0.eeff, a0.eeffStatic, 1e-6);
    expect(a1.eeff).toBeGreaterThan(a0.eeff);
    expect(a2.eeff).toBeGreaterThan(a1.eeff);
    expect(a2.eeff).toBeLessThan(10);
  });
  it('thickness lowers Z0 (wider effective strip)', () => {
    const thin = staticMicrostrip(1, 4.4, 0), thick = staticMicrostrip(1, 4.4, 0.035 / 1.6);
    expect(thick.z0).toBeLessThan(thin.z0);
    expect(thick.du1).toBeGreaterThan(0);
  });
  // Pozar Problem 4.30: d 1.58 mm, εr 2.2, w 4.87 mm, εe 1.894; answer Δℓ = 0.082 cm.
  it('open-end extension: Pozar Problem 4.30 answer within 1 %, HB comparison formula within 10 %', () => {
    const dl = openEndExtension(4.87 / 1.58, 2.2, 1.894, 1.58e-3);
    rel(dl, 0.82e-3, 0.01);
    rel(openEndHB(4.87e-3, 1.58e-3, 1.894), dl, 0.1);
  });
  it('line quantities: θ = βℓ, loss = αℓ in dB', () => {
    const a = ok(analyzeMicrostrip(1.1e-3, STACKUP_PRESETS[2], 5e9));
    const q = lineQuantities(a, a.lambdaG / 4);
    rel(q.thetaDeg, 90, 1e-12);
    rel(q.lossdB, q.lossCdB + q.lossDdB, 1e-12);
  });
});

describe('synthesis', () => {
  it('round trip: synthesis then analysis returns the target Z0 to 1e-6 Ω', () => {
    for (const st of STACKUP_PRESETS) for (const z of [10, 25, 35, 50, 75, 100, 120]) for (const f of [100e6, 2.4e9, 15e9]) {
      const w = synthesizeWidth(z, st, f);
      if (!w.ok) { expect(w.error).toMatch(/No solution/); continue; }
      const a = ok(analyzeMicrostrip(w.W, st, f));
      expect(Math.abs(a.z0 - z)).toBeLessThanOrEqual(1e-6);
    }
  });
  it('round trip on length: θ → L → θ to 1e-9 rad', () => {
    const s = STACKUP_PRESETS[0];
    for (const deg of [1, 45, 90, 180, 360]) {
      const th = (deg * Math.PI) / 180;
      const l = ok(synthesizeLength(th, 3e-3, s, 1e9));
      expect(Math.abs(l.analysis.beta * l.L - th)).toBeLessThanOrEqual(1e-9);
    }
  });
  it('solveLine gives the same answer whichever field is the input', () => {
    const st = STACKUP_PRESETS[2];
    const a = ok(solveLine({ stackup: st, widthGiven: 'Z0', W: 0, z0Target: 50, lengthGiven: 'angle', L: 0, angleDeg: 90 }, 3e9));
    const b = ok(solveLine({ stackup: st, widthGiven: 'W', W: a.W, z0Target: 0, lengthGiven: 'L', L: a.L, angleDeg: 0 }, 3e9));
    expect(Math.abs(b.analysis.z0 - 50)).toBeLessThan(1e-6);
    expect(Math.abs(b.q.thetaDeg - 90)).toBeLessThan(1e-6);
  });
  it('brent returns null without a sign change', () => {
    expect(brent((x) => x * x + 1, -1, 1)).toBeNull();
    expect(Math.abs(brent((x) => Math.cos(x) - x, 0, 1)! - 0.7390851332151607)).toBeLessThan(1e-12);
  });
  it('no solution in range gives a clear message, not NaN', () => {
    const hi = synthesizeWidth(300, STACKUP_PRESETS[0], 1e9);
    expect(hi.ok).toBe(false);
    if (!hi.ok) expect(hi.error).toMatch(/No solution.*below 0\.01/);
    const lo = synthesizeWidth(1, STACKUP_PRESETS[0], 1e9);
    expect(lo.ok).toBe(false);
    if (!lo.ok) expect(lo.error).toMatch(/No solution.*above 100/);
  });
});

describe('stub ⇄ L/C converter, cascaded through the network kernel', () => {
  const st = STACKUP_PRESETS[2], f0 = 2.4e9, Z0 = 50;
  const cases: Array<[StubPart, number, StubTerm, boolean]> = [
    ['L', 2.2e-9, 'short', false], // θ = atan(ωL/Zs)
    ['C', 1.5e-12, 'open', false],  // θ = atan(ωC·Zs)
    ['L', 2.2e-9, 'open', true],    // θ = 90° + atan(ωL/Zs)
    ['C', 1.5e-12, 'short', true],  // θ = 180° − atan(1/(ωC·Zs))
  ];
  for (const [part, value, term, long] of cases) {
    for (const conn of ['shunt', 'series'] as const) {
      it(`${term} stub as ${part} (${conn}): reactance at f0 equals the target`, () => {
        const zs = 60;
        const d = ok(designStub({ part, value, term, z0: zs, f0 }, st));
        expect(d.long).toBe(long);
        if (long) expect(d.warnings.join(' ')).toMatch(term === 'open' ? /short stub/ : /open stub/);
        const el: Stub = { id: 's', kind: 'stub', z0: zs, lengthWl: d.lengthWl, lossDb: 0, vf: 1, termination: term, connection: conn };
        const g1 = applyElement(c(0, 0), el, { f: f0, f0, Z0 });       // matched load: z = y = 1
        const Xtarget = part === 'L' ? 2 * Math.PI * f0 * value : -1 / (2 * Math.PI * f0 * value);
        let X: number;
        if (conn === 'shunt') { const b = gammaToY(g1).im; X = -Z0 / b; } else X = gammaToZ(g1).im * Z0;
        rel(X, Xtarget, 1e-9);
        rel(d.X, Xtarget, 1e-12);
      });
    }
  }
  it('closed-form θ matches the brief for each case', () => {
    const w = 2 * Math.PI * f0, L = 2.2e-9, C = 1.5e-12, zs = 60;
    const th = (p: StubPart, v: number, t: StubTerm) => ok(designStub({ part: p, value: v, term: t, z0: zs, f0 }, st)).theta;
    rel(th('L', L, 'short'), Math.atan((w * L) / zs), 1e-12);
    rel(th('C', C, 'open'), Math.atan(w * C * zs), 1e-12);
    rel(th('L', L, 'open'), Math.PI / 2 + Math.atan((w * L) / zs), 1e-12);
    rel(th('C', C, 'short'), Math.PI - Math.atan(1 / (w * C * zs)), 1e-12);
  });
  it('reactance input (X) works and the open-end ΔL is shown separately', () => {
    const d = ok(designStub({ part: 'X', value: -40, term: 'open', z0: 50, f0 }, st));
    expect(d.dL).toBeGreaterThan(0);
    rel(d.Lphys + d.dL, d.Lelec, 1e-12);
    const s = ok(designStub({ part: 'X', value: 40, term: 'short', z0: 50, f0 }, st));
    expect(s.dL).toBe(0);
  });
  it('sweep equals the ideal part at f0, and the 5 % band contains f0 and is narrower for long stubs', () => {
    const spec = { part: 'L' as StubPart, value: 2.2e-9, term: 'short' as StubTerm, z0: 60, f0 };
    const d = ok(designStub(spec, st));
    const mid = stubSweep(d, spec, st, f0, f0, 1)[0];
    expect(mid.err).toBeLessThan(1e-6);
    const bw = stubBandwidth(d, spec, st);
    expect(bw.fLo).toBeLessThan(f0); expect(bw.fHi).toBeGreaterThan(f0);
    const longSpec = { ...spec, term: 'open' as StubTerm };
    const bwLong = stubBandwidth(ok(designStub(longSpec, st)), longSpec, st);
    expect(bwLong.fractional).toBeLessThan(bw.fractional);
    expect(stubSweep(d, spec, st, 0.05 * f0, 2 * f0, 50).every((p) => Number.isFinite(p.Xideal))).toBe(true);
  });
  it('invalid stub inputs give clear messages', () => {
    for (const [part, value] of [['L', 0], ['C', -1e-12], ['X', 0]] as Array<[StubPart, number]>) {
      const r = designStub({ part, value, term: 'short', z0: 50, f0 }, st);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
    expect(designStub({ part: 'L', value: 1e-9, term: 'short', z0: 0, f0 }, st).ok).toBe(false);
    expect(designStub({ part: 'L', value: 1e-9, term: 'short', z0: 50, f0: 0 }, st).ok).toBe(false);
    expect(targetReactance('X', 12, 1e9)).toBe(12);
  });
});

describe('roughness correction', () => {
  it('K = 1 at zero roughness and → 2 for Δ ≫ δs', () => {
    expect(roughnessFactor(0, 1e-6)).toBe(1);
    const ds = skinDepth(10e9, 5.8e7);
    expect(roughnessFactor(100 * ds, ds)).toBeGreaterThan(1.999);
    expect(roughnessFactor(100 * ds, ds)).toBeLessThanOrEqual(2);
    rel(roughnessFactor(ds, ds), 1 + (2 / Math.PI) * Math.atan(1.4), 1e-12);
  });
  it('roughness scales conductor loss only, not Z0 or εeff', () => {
    const smooth = ok(analyzeMicrostrip(1.1e-3, STACKUP_PRESETS[2], 10e9));
    const rough = ok(analyzeMicrostrip(1.1e-3, { ...STACKUP_PRESETS[2], rough: 2e-6 }, 10e9));
    expect(rough.z0).toBe(smooth.z0);
    expect(rough.eeff).toBe(smooth.eeff);
    rel(rough.alphaC / smooth.alphaC, rough.Kr, 1e-12);
    expect(rough.alphaD).toBe(smooth.alphaD);
  });
});

describe('edge cases and validity limits', () => {
  const s = STACKUP_PRESETS[0];
  const codes = (r: ReturnType<typeof analyzeMicrostrip>) => (r.ok ? r.warnings.map((w) => w.code) : []);
  it('very narrow and very wide lines stay finite and flag W/h out of range', () => {
    const narrow = ok(analyzeMicrostrip(0.005 * s.h, s, 1e9));
    const wide = ok(analyzeMicrostrip(150 * s.h, s, 1e9));
    expect(allFinite(narrow) && allFinite(wide)).toBe(true);
    expect(codes(narrow)).toContain('hj-u');
    expect(codes(wide)).toContain('hj-u');
    expect(codes(analyzeMicrostrip(3e-3, s, 1e9))).not.toContain('hj-u');
  });
  it('f = 0 is an error; outside 100 MHz – 15 GHz is a warning', () => {
    const z = analyzeMicrostrip(3e-3, s, 0);
    expect(z.ok).toBe(false);
    if (!z.ok) expect(z.error).toMatch(/Frequency/);
    expect(codes(analyzeMicrostrip(3e-3, s, 50e6))).toContain('freq');
    expect(codes(analyzeMicrostrip(3e-3, s, 20e9))).toContain('freq');
    expect(codes(analyzeMicrostrip(3e-3, s, 1e9))).not.toContain('freq');
  });
  it('zero or negative inputs give clear errors, never NaN', () => {
    const bad: Array<[number, Substrate]> = [
      [0, s], [-1e-3, s], [1e-3, { ...s, er: 0.5 }], [1e-3, { ...s, h: 0 }], [1e-3, { ...s, t: -1e-6 }],
      [1e-3, { ...s, tanD: -0.01 }], [1e-3, { ...s, sigma: 0 }], [1e-3, { ...s, rough: -1e-6 }], [NaN, s],
    ];
    for (const [W, st] of bad) {
      const r = analyzeMicrostrip(W, st, 1e9);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/\w{4,}/);
    }
    expect(synthesizeWidth(-50, s, 1e9).ok).toBe(false);
    expect(synthesizeLength(-1, 1e-3, s, 1e9).ok).toBe(false);
    expect(quarterWaveMicrostrip(50, -10, s, 1e9).ok).toBe(false);
  });
  it('thick copper, high εr and surface-wave limits are flagged', () => {
    expect(codes(analyzeMicrostrip(1e-3, { ...s, h: 0.1e-3, t: 35e-6 }, 1e9))).toContain('thick');
    expect(codes(analyzeMicrostrip(1e-3, { ...s, er: 25 }, 1e9))).toContain('kj-eeff');
    expect(codes(analyzeMicrostrip(20e-3, { ...s, er: 10.2, h: 3e-3 }, 15e9))).toEqual(expect.arrayContaining(['surface', 'transverse']));
  });
});

describe('quarter-wave helper and stackups', () => {
  it('quarter-wave transformer: Zt = √(Zs·ZL), 90° long, Z0 matches', () => {
    const q = ok(quarterWaveMicrostrip(50, 100, STACKUP_PRESETS[2], 2e9));
    rel(q.Zt, Math.sqrt(5000), 1e-12);
    expect(Math.abs(q.analysis.z0 - q.Zt)).toBeLessThan(1e-6);
    rel(q.L, q.analysis.lambdaG / 4, 1e-9);
  });
  it('stackup JSON round-trips and rejects bad files', () => {
    const st = { ...STACKUP_PRESETS[3], rough: 1.2e-6 };
    expect(parseStackup(serializeStackup(st))).toEqual(st);
    expect(() => parseStackup('nope')).toThrow(/JSON/);
    expect(() => parseStackup('{"format":"other"}')).toThrow(/not a Browser Smith Chart stackup/);
    expect(() => parseStackup(JSON.stringify({ format: 'browser-smith-chart-stackup', stackup: { er: 4 } }))).toThrow(/"h"/);
    expect(() => parseStackup(JSON.stringify({ format: 'browser-smith-chart-stackup', stackup: { ...st, h: -1 } }))).toThrow();
  });
});

describe('saved-state schema 2 and migration', () => {
  const text = readFileSync(new URL('./fixtures/project-v0.2.2.json', import.meta.url), 'utf8');
  const v022 = JSON.parse(text).state as Record<string, unknown>;
  it('loads a v0.2.2 project with nothing lost', () => {
    const s = loadProject(text) as unknown as Record<string, unknown>;
    expect(s.schema).toBe(2);
    expect(s.mode).toBe('smith');
    expect(s.lineCalc).toEqual(defaultLineCalc());
    for (const k of Object.keys(v022)) {
      if (k === 'schema') continue;
      expect(s[k], k).toEqual(v022[k]);
    }
  });
  it('schema-2 projects keep their LineCalc state through save and load', () => {
    const s = loadProject(text);
    const lc = { ...s.lineCalc, widthGiven: 'W' as const, W: 2.5e-3, stackup: { ...STACKUP_PRESETS[0], rough: 1e-6 },
      stub: { ...s.lineCalc.stub, part: 'C' as const, term: 'open' as const, conn: 'series' as const } };
    const back = loadProject(serializeProject({ ...s, lineCalc: lc, mode: 'linecalc' }));
    expect(back.lineCalc).toEqual(lc);
    expect(back.mode).toBe('linecalc');
    expect(back.elements).toEqual(s.elements);
  });
  it('corrupt LineCalc fields fall back to defaults', () => {
    const o = JSON.parse(text);
    o.state.schema = 2;
    o.state.lineCalc = { stackup: { er: -3 }, widthGiven: 'bogus', W: 'x', stub: { part: 'Q', values: { L: -1 } } };
    const s = loadProject(JSON.stringify(o));
    expect(s.lineCalc.stackup).toEqual(defaultLineCalc().stackup);
    expect(s.lineCalc.widthGiven).toBe('Z0');
    expect(s.lineCalc.stub.part).toBe('L');
    expect(s.lineCalc.stub.values.L).toBe(defaultLineCalc().stub.values.L);
  });
});
