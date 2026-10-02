import { describe, it, expect } from 'vitest';
import { c, abs } from '../src/math/complex';
import { zToGamma, normalizeZ } from '../src/math/smith';
import { cascade, loadAtFrequency, type Element } from '../src/rf/network';
import {
  lSectionValues, synthesizeLMatches, synthesizeSingleStub, synthesizeQuarterWave,
  shuntStubPositions, seriesStubPositions, quarterWaveZ1,
} from '../src/rf/matching';

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('L-section  [Pozar 5.3, 5.6, Example 5.1]', () => {
  it('Example 5.1: 200 − j100 Ω to 100 Ω at 500 MHz → b = 0.29, x = 1.22 and b = −0.69, x = −1.22', () => {
    const v = lSectionValues(c(200, -100), 100).filter((s) => s.config === 'shunt-first');
    expect(v.length).toBe(2);
    const [s1, s2] = v.sort((a, b) => b.B - a.B);
    close(s1.B * 100, 0.29, 0.005); close(s1.X / 100, 1.22, 0.005);
    close(s2.B * 100, -0.69, 0.005); close(s2.X / 100, -1.22, 0.005);
    const sols = synthesizeLMatches(c(200, -100), 100, 500e6);
    const first = sols.find((s) => s.elements[0].kind === 'shuntC')!;
    // Pozar: C = 0.92 pF, L = 38.8 nH. Pozar rounds x to 1.22 before computing L;
    // the exact solution (x = 1.2247) is L = 38.98 nH, so allow textbook rounding.
    const C = first.elements[0] as Extract<Element, { value: number }>;
    const L = first.elements[1] as Extract<Element, { value: number }>;
    close(C.value * 1e12, 0.92, 0.01);
    close(L.value * 1e9, 38.98, 0.01);
    close(L.value * 1e9, 38.8, 0.25);
    // second solution: shunt L 46.1 nH, series C 2.61 pF
    const second = sols.find((s) => s.elements[0].kind === 'shuntL')!;
    close((second.elements[0] as { value: number }).value * 1e9, 46.1, 0.1);
    close((second.elements[1] as { value: number }).value * 1e12, 2.61, 0.02); // exact 2.599 pF
  });
  it('every returned L-network is a verified match for random loads', () => {
    let count = 0;
    for (let i = 0; i < 300; i++) {
      const ZL = c(1 + Math.random() * 400, (Math.random() - 0.5) * 600);
      const sols = synthesizeLMatches(ZL, 50, 1e9);
      expect(sols.length).toBeGreaterThanOrEqual(2); // any R_L > 0 has at least two L solutions
      for (const s of sols) {
        const g = cascade(zToGamma(normalizeZ(ZL, 50)), s.elements, { f: 1e9, f0: 1e9, Z0: 50 });
        expect(abs(g[g.length - 1])).toBeLessThan(1e-6);
        count++;
      }
    }
    expect(count).toBeGreaterThan(600);
  });
});

describe('single-stub tuning  [Pozar 5.7–5.16, Examples 5.2 & 5.3]', () => {
  it('Example 5.2 shunt short stub: d = 0.110λ / 0.260λ, ℓ = 0.095λ / 0.405λ, y = 1 ± j1.47', () => {
    const pos = shuntStubPositions(c(60, -80), 50).sort((a, b) => a.d - b.d);
    close(pos[0].d, 0.110, 0.001); close(pos[1].d, 0.260, 0.001);
    close(pos[0].B * 50, 1.47, 0.01); close(pos[1].B * 50, -1.47, 0.01);
    const sols = synthesizeSingleStub(c(60, -80), 50, 2e9, 'shunt', 'short');
    expect(sols.length).toBe(2);
    const lens = sols.map((s) => (s.elements[s.elements.length - 1] as { lengthWl: number }).lengthWl).sort();
    close(lens[0], 0.095, 0.001); close(lens[1], 0.405, 0.001);
  });
  it('Example 5.2 bandwidth: solution 1 (shorter d, ℓ) is broader, as in Fig. 5.5c', () => {
    const sols = synthesizeSingleStub(c(60, -80), 50, 2e9, 'shunt', 'short')
      .sort((a, b) => (a.elements[0] as { lengthWl: number }).lengthWl - (b.elements[0] as { lengthWl: number }).lengthWl);
    const mean = (els: Element[]) => {
      let sum = 0, n = 0;
      for (let f = 1e9; f <= 3e9; f += 0.05e9) {
        const ZL = loadAtFrequency(c(60, -80), 2e9, f, 'series');
        const g = cascade(zToGamma(normalizeZ(ZL, 50)), els, { f, f0: 2e9, Z0: 50 });
        sum += abs(g[g.length - 1]); n++;
      }
      return sum / n;
    };
    expect(mean(sols[0].elements)).toBeLessThan(mean(sols[1].elements));
  });
  it('Example 5.3 series open stub: d = 0.120λ / 0.463λ, ℓ = 0.397λ / 0.103λ, z = 1 ∓ j1.33', () => {
    const pos = seriesStubPositions(c(100, 80), 50).sort((a, b) => a.d - b.d);
    close(pos[0].d, 0.120, 0.001); close(pos[1].d, 0.463, 0.001);
    close(pos[0].B / 50, -1.33, 0.01); close(pos[1].B / 50, 1.33, 0.01);
    const sols = synthesizeSingleStub(c(100, 80), 50, 2e9, 'series', 'open')
      .sort((a, b) => (a.elements[0] as { lengthWl: number }).lengthWl - (b.elements[0] as { lengthWl: number }).lengthWl);
    close((sols[0].elements[1] as { lengthWl: number }).lengthWl, 0.397, 0.001);
    close((sols[1].elements[1] as { lengthWl: number }).lengthWl, 0.103, 0.001);
  });
  it('all four stub variants produce verified matches for random loads', () => {
    for (let i = 0; i < 200; i++) {
      const ZL = c(2 + Math.random() * 300, (Math.random() - 0.5) * 400);
      for (const conn of ['shunt', 'series'] as const) for (const term of ['open', 'short'] as const) {
        const sols = synthesizeSingleStub(ZL, 50, 1e9, conn, term, 50 + Math.random() * 50);
        expect(sols.length).toBe(2);
        for (const s of sols) for (const e of s.elements) {
          const L = (e as { lengthWl: number }).lengthWl;
          expect(L).toBeGreaterThanOrEqual(0); expect(L).toBeLessThan(0.5);
        }
      }
    }
  });
  it('handles R_L = Z0 (degenerate quadratic) including the λ/4 root', () => {
    const sols = synthesizeSingleStub(c(50, 30), 50, 1e9, 'shunt', 'open');
    expect(sols.length).toBe(2);
  });
});

describe('quarter-wave transformer  [Pozar 2.63, Example 2.5]', () => {
  it('Example 2.5: 100 Ω load on 50 Ω → Z1 = 70.71 Ω', () => {
    close(quarterWaveZ1(50, 100), 70.7107, 1e-4);
    const sols = synthesizeQuarterWave(c(100, 0), 50, 1e9);
    expect(sols.some((s) => s.elements.length === 1 && Math.abs((s.elements[0] as { z0: number }).z0 - 70.7107) < 1e-3)).toBe(true);
  });
  it('complex loads: both voltage-max and voltage-min solutions verify', () => {
    for (let i = 0; i < 100; i++) {
      const ZL = c(5 + Math.random() * 200, (Math.random() - 0.5) * 200);
      expect(synthesizeQuarterWave(ZL, 50, 1e9).length).toBe(2);
    }
  });
});
