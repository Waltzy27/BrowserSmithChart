/** v0.2 kernel additions: non-ideal components, Pi/T, double/triple stubs, multisection transformers. */
import { describe, it, expect } from 'vitest';
import { c, abs } from '../src/math/complex';
import { zToGamma, gammaToY, normalizeZ } from '../src/math/smith';
import {
  componentImpedance, componentQ, lumpedImmittance, solveElementToward, applyElement, cascade, type Lumped,
} from '../src/rf/network';
import {
  synthesizePiT, piTMinQ, synthesizeDoubleStub, doubleStubB1, doubleStubB2, doubleStubGMax,
  synthesizeTripleStub, synthesizeMultisection, synthesizeLMatches,
} from '../src/rf/matching';
import { designMultisection, steppedGamma, chebyshevT } from '../src/rf/multisection';

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThanOrEqual(tol);
const f0 = 1e9, w0 = 2 * Math.PI * f0;

describe('non-ideal lumped components', () => {
  it('ideal components are unchanged', () => {
    const L: Lumped = { id: 'a', kind: 'seriesL', value: 10e-9 };
    const z = lumpedImmittance(L, f0, 50, f0);
    close(z.re, 0, 0); close(z.im, (w0 * 10e-9) / 50, 1e-15);
    const C: Lumped = { id: 'b', kind: 'shuntC', value: 2e-12 };
    close(lumpedImmittance(C, f0, 50, f0).im, w0 * 2e-12 * 50, 1e-15);
  });
  it('Q is honoured at f0 and scales as the ESR model predicts', () => {
    const L: Lumped = { id: 'a', kind: 'seriesL', value: 10e-9, q: 40 };
    const C: Lumped = { id: 'b', kind: 'seriesC', value: 1e-12, q: 200 };
    close(componentQ(L, f0, f0), 40, 1e-9);
    close(componentQ(C, f0, f0), 200, 1e-9);
    close(componentQ(L, 2 * f0, f0), 80, 1e-9);   // fixed ESR: Q ∝ f for L
    close(componentQ(C, 2 * f0, f0), 100, 1e-9);  // and Q ∝ 1/f for C
    // ESR values: R = ω0L/Q and 1/(ω0 C Q)
    close(componentImpedance(L, f0, f0).re, (w0 * 10e-9) / 40, 1e-12);
    close(componentImpedance(C, f0, f0).re, 1 / (w0 * 1e-12 * 200), 1e-9);
  });
  it('self-resonance: inductor goes open (parallel) and capacitor goes resistive (series) at SRF', () => {
    const srf = 3e9;
    const L: Lumped = { id: 'a', kind: 'seriesL', value: 10e-9, srf };
    const C: Lumped = { id: 'b', kind: 'seriesC', value: 1e-12, srf, q: 100 };
    expect(abs(componentImpedance(L, srf * (1 - 1e-9), f0))).toBeGreaterThan(1e6);
    close(componentImpedance(C, srf, f0).im, 0, 1e-6);
    // below SRF an inductor looks larger than ideal: X_eff = ωL/(1 − (f/f_s)²)
    const Xeff = componentImpedance(L, f0, f0).im;
    rel(Xeff, (w0 * 10e-9) / (1 - (f0 / srf) ** 2), 1e-12);
  });
  it('constraint drag lands a lossy shunt C on the target susceptance contour', () => {
    const ctx = { f: f0, f0, Z0: 50 };
    const g0 = zToGamma(c(0.6, -0.4));
    const el: Lumped = { id: 'x', kind: 'shuntC', value: 1e-12, q: 30, srf: 6e9 };
    const target = zToGamma(c(0.5, -0.6));
    const solved = solveElementToward(g0, el, target, ctx) as Lumped;
    const end = applyElement(g0, solved, ctx);
    close(gammaToY(end).im, gammaToY(target).im, 1e-8);
  });
});

describe('Pi and T networks (virtual resistance)', () => {
  it('200 Ω → 50 Ω, Q = 5: node Q equals the requested Q and the match verifies', () => {
    const pi = synthesizePiT(c(200, 0), 50, f0, 'pi', 5);
    expect(pi.length).toBeGreaterThan(0);
    for (const s of pi) {
      expect(s.residual).toBeLessThan(1e-9);
      const qLoad = s.details.find(([k]) => k.startsWith('Q load'))![1] as number;
      close(qLoad, 5, 1e-9);
      expect(s.elements.map((e) => e.kind.slice(0, 5))).toEqual(['shunt', 'serie', 'shunt']);
    }
    const t = synthesizePiT(c(200, 0), 50, f0, 't', 5);
    expect(t.length).toBeGreaterThan(0);
    for (const s of t) {
      expect(s.residual).toBeLessThan(1e-9);
      expect(s.elements.map((e) => e.kind.slice(0, 5))).toEqual(['serie', 'shunt', 'serie']);
    }
  });
  it('rejects Q below the L-section minimum √(R_high/R_low − 1)', () => {
    close(piTMinQ(200, 50), Math.sqrt(3), 1e-12);
    expect(synthesizePiT(c(200, 0), 50, f0, 'pi', 1.5)).toEqual([]);
    expect(synthesizePiT(c(200, 0), 50, f0, 't', 1.5)).toEqual([]);
  });
  it('higher Q gives a narrower match than the L-section (complex load)', () => {
    const ZL = c(20, -35), Z0 = 50;
    const L = synthesizeLMatches(ZL, Z0, f0)[0];
    const pi = synthesizePiT(ZL, Z0, f0, 'pi', 8)[0];
    const bw = (els: typeof L.elements) => {
      let n = 0;
      for (let k = 0; k <= 400; k++) {
        const f = f0 * (0.8 + (0.4 * k) / 400);
        const g = cascade(zToGamma(normalizeZ(ZL, Z0)), els, { f, f0, Z0 });
        if (abs(g[g.length - 1]) <= 1 / 3) n++;
      }
      return n;
    };
    expect(bw(pi.elements)).toBeLessThan(bw(L.elements));
  });
  it('random loads: every Pi/T solution verifies', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) {
      const ZL = c(5 + 300 * rnd(), -200 + 400 * rnd());
      const q = piTMinQ(ZL.re, 50) + 0.5 + 6 * rnd();
      for (const type of ['pi', 't'] as const) for (const s of synthesizePiT(ZL, 50, f0, type, q)) expect(s.residual).toBeLessThan(1e-6);
    }
  });
});

describe('double-stub tuner  [Pozar §5.3, Example 5.4]', () => {
  it('Example 5.4: 60 − j80 Ω, open stubs λ/8 apart → b1 = 1.314/−0.114, ℓ1 = 0.146/0.482λ, b2 = 3.38/−1.38, ℓ2 = 0.204/0.350λ', () => {
    const r = synthesizeDoubleStub(c(60, -80), 50, 2e9, 0.125, 'open');
    expect(r.forbidden).toBe(false);
    expect(r.solutions).toHaveLength(2);
    const get = (s: typeof r.solutions[0], k: string) => s.details.find(([n]) => n === k)![1] as number;
    const [s1, s2] = r.solutions;
    close(get(s1, 'b1 = B1·Z0'), 1.314, 1e-3); close(get(s2, 'b1 = B1·Z0'), -0.114, 1e-3);
    close(get(s1, 'ℓ1 / λ'), 0.146, 1e-3); close(get(s2, 'ℓ1 / λ'), 0.482, 1e-3);
    close(get(s1, 'b2 = B2·Z0'), 3.38, 5e-3); close(get(s2, 'b2 = B2·Z0'), -1.38, 5e-3);
    close(get(s1, 'ℓ2 / λ'), 0.204, 1e-3); close(get(s2, 'ℓ2 / λ'), 0.350, 1e-3);
    for (const s of r.solutions) expect(s.residual).toBeLessThan(1e-9);
  });
  it('(5.23) agrees with the cascaded second-stub susceptance', () => {
    const r = synthesizeDoubleStub(c(35, 40), 50, 1e9, 0.375, 'short');
    for (const s of r.solutions) {
      const a = s.details.find(([n]) => n === 'b2 = B2·Z0')![1] as number;
      const b = s.details.find(([n]) => n === 'b2 from (5.23)')![1] as number;
      close(a, b, 1e-9);
    }
    // the closed forms by themselves
    const t = Math.tan(2 * Math.PI * 0.125);
    expect(doubleStubB1(0.3 / 50, 0.4 / 50, 1 / 50, t).map((v) => v * 50).map((v) => +v.toFixed(3))).toEqual([1.314, -0.114]);
    expect(doubleStubB2(0.3 / 50, 1 / 50, t).map((v) => v * 50).map((v) => +v.toFixed(2))).toEqual([3.38, -1.38]);
  });
  it('forbidden region (5.21): g > 1/sin²βd cannot be matched; moving the stub fixes it', () => {
    close(doubleStubGMax(0.125), 2, 1e-12);
    const ZL = c(15, 0); // g = 3.33 > 2
    const r = synthesizeDoubleStub(ZL, 50, 1e9, 0.125, 'short');
    expect(r.forbidden).toBe(true);
    expect(r.solutions).toHaveLength(0);
    const moved = synthesizeDoubleStub(ZL, 50, 1e9, 0.125, 'short', 0.25); // λ/4 turns g = 3.33 into 0.3
    expect(moved.forbidden).toBe(false);
    for (const s of moved.solutions) expect(s.residual).toBeLessThan(1e-9);
  });
});

describe('triple-stub tuner', () => {
  it('matches a load inside the double-stub forbidden region', () => {
    const ZL = c(15, 10);
    expect(synthesizeDoubleStub(ZL, 50, 1e9, 0.125, 'short').forbidden).toBe(true);
    const sols = synthesizeTripleStub(ZL, 50, 1e9, 0.125, 'short');
    expect(sols.length).toBeGreaterThan(0);
    for (const s of sols) {
      expect(s.residual).toBeLessThan(1e-9);
      expect(s.elements.filter((e) => e.kind === 'stub')).toHaveLength(3);
    }
  });
});

describe('multisection transformers  [Pozar §5.6–5.7]', () => {
  it('Example 5.6 (small-reflection): 50 Ω load, 100 Ω line, N = 3 → 91.7, 70.7, 54.5 Ω; Δf/f0 = 0.70', () => {
    const d = designMultisection('binomial', 3, 100, 50, 0.05)!;
    close(d.approx[0], 91.7, 0.05); close(d.approx[1], 70.7, 0.05); close(d.approx[2], 54.5, 0.05);
    close(d.bwFormula, 0.70, 0.005);
  });
  it('binomial exact designs reproduce Table 5.1', () => {
    const table: Array<[number, number, number[]]> = [
      [2, 2.0, [1.1892, 1.6818]], [2, 10.0, [1.7783, 5.6233]],
      [3, 2.0, [1.0907, 1.4142, 1.8337]], [3, 6.0, [1.2544, 2.4495, 4.7832]],
      [4, 4.0, [1.0919, 1.5442, 2.5903, 3.6633]], [4, 10.0, [1.1613, 2.0651, 4.8424, 8.6110]],
      [5, 10.0, [1.0789, 1.5541, 3.1623, 6.4346, 9.2687]],
      [6, 3.0, [1.0176, 1.1288, 1.4599, 2.0549, 2.6577, 2.9481]],
    ];
    for (const [N, R, Zs] of table) {
      const d = designMultisection('binomial', N, 1, R, 0.05)!;
      d.exact.forEach((z, i) => rel(z, Zs[i], 1.2e-4));
    }
  });
  it('binomial exact response is maximally flat: |Γ| = 2^N|A′|cos^N θ form (first N−1 derivatives vanish)', () => {
    const d = designMultisection('binomial', 4, 50, 150, 0.05)!;
    const g = (th: number) => steppedGamma(d.exact, 50, 150, th);
    const h = 0.02;
    // |Γ| ∝ |cos θ|^N near π/2 → doubling the offset multiplies |Γ| by ≈ 2^N
    rel(g(Math.PI / 2 - 2 * h) / g(Math.PI / 2 - h), 2 ** 4, 0.01);
  });
  it('Example 5.7 (small-reflection): Chebyshev N = 3, 100 Ω load, 50 Ω line, Γm = 0.05 → 57.5, 70.7, 87.0 Ω; Δf/f0 ≈ 1.01', () => {
    const d = designMultisection('chebyshev', 3, 50, 100, 0.05)!;
    close(d.approx[0], 57.5, 0.05); close(d.approx[1], 70.7, 0.05); close(d.approx[2], 87.0, 0.05);
    close(d.thetaM * 180 / Math.PI, 44.7, 0.05);
    close(d.bwFormula, 1.01, 0.005);
  });
  it('Chebyshev exact, N = 2, reproduces Table 5.2', () => {
    const rows: Array<[number, number, number[]]> = [
      [2.0, 0.05, [1.2193, 1.6402]], [4.0, 0.05, [1.4500, 2.7585]], [10.0, 0.05, [1.8233, 5.4845]],
      [2.0, 0.20, [1.3161, 1.5197]], [6.0, 0.20, [1.7321, 3.4641]], [10.0, 0.20, [1.9680, 5.0813]],
    ];
    for (const [R, gm, Zs] of rows) {
      const d = designMultisection('chebyshev', 2, 1, R, gm)!;
      d.exact.forEach((z, i) => rel(z, Zs[i], 1.2e-4));
    }
  });
  it('Chebyshev exact, N = 3, 4: equal ripple exactly at Γm, within 0.5 % of Table 5.2', () => {
    const rows: Array<[number, number, number, number[]]> = [
      [3, 2.0, 0.05, [1.1475, 1.4142, 1.7429]], [3, 4.0, 0.05, [1.2662, 2.0000, 3.1591]],
      [3, 10.0, 0.05, [1.4385, 3.1623, 6.9517]], [3, 3.0, 0.20, [1.3743, 1.7321, 2.1829]],
      [4, 2.0, 0.05, [1.1201, 1.2979, 1.5409, 1.7855]], [4, 10.0, 0.05, [1.2832, 2.2268, 4.4907, 7.7930]],
    ];
    for (const [N, R, gm, Zs] of rows) {
      const d = designMultisection('chebyshev', N, 1, R, gm)!;
      d.exact.forEach((z, i) => rel(z, Zs[i], 5e-3));
      // ripple peaks inside the passband equal Γm
      let peak = 0;
      for (let k = 0; k <= 4000; k++) {
        const th = d.thetaMExact + 1e-6 + (Math.PI / 2 - d.thetaMExact - 1e-6) * (k / 4000);
        peak = Math.max(peak, steppedGamma(d.exact, 1, R, th));
      }
      close(peak, gm, 2e-6);
    }
  });
  it('Chebyshev polynomial identities (5.56)', () => {
    for (const x of [-1.3, -0.4, 0, 0.7, 1.2, 2.5]) {
      close(chebyshevT(2, x), 2 * x * x - 1, 1e-12);
      close(chebyshevT(3, x), 4 * x ** 3 - 3 * x, 1e-12);
      close(chebyshevT(4, x), 8 * x ** 4 - 8 * x * x + 1, 1e-11);
    }
  });
  it('complex loads are matched through a resistive plane; all designs verify', () => {
    for (const kind of ['binomial', 'chebyshev'] as const) {
      const sols = synthesizeMultisection(c(30, 45), 50, 2e9, kind, 3, 0.05);
      expect(sols.length).toBe(4); // (Vmax, Vmin) × (exact, small-reflection)
      for (const s of sols) expect(s.residual).toBeLessThan(1e-9);
    }
  });
});
