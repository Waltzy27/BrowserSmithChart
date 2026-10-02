import { describe, it, expect } from 'vitest';
import { c, abs, sub, div, mul, add, ONE, J } from '../src/math/complex';
import { zToGamma, gammaToZ, gammaToY, gammaMetrics, resistanceCircle, conductanceCircle } from '../src/math/smith';
import {
  type Element, type EvalContext, applyElement, cascade, elementPath, propagateGamma,
  lineInputImpedance, stubInputImpedance, sectionGammaL, addSeriesZ, addShuntY,
  solveElementToward, loadAtFrequency, applyTransformerGamma, DB_PER_NEPER,
} from '../src/rf/network';

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const ctx = (Z0 = 50, f0 = 1e9, f = f0): EvalContext => ({ Z0, f0, f });
const line = (lengthWl: number, z0 = 50, lossDb = 0): Element => ({ id: 'l', kind: 'line', z0, lengthWl, lossDb, vf: 1 });

describe('lossless line  [Pozar 2.42, 2.44, Examples 2.2 & 2.3]', () => {
  it('Example 2.2: 40 + j70 Ω on 100 Ω, 0.3λ → Z_in ≈ 36.5 − j61.1 Ω, ∠Γ_in ≈ 248°', () => {
    const Z0 = 100;
    const gL = zToGamma(c(0.4, 0.7));
    const gIn = applyElement(gL, line(0.3, 100), ctx(Z0));
    const Zin = mul(gammaToZ(gIn), c(Z0, 0));
    // Pozar (graphical): 36.5 − j61.1 Ω. scikit-rf reference: 36.534 − j61.119 Ω.
    close(Zin.re, 36.5, 0.05); close(Zin.im, -61.1, 0.05);
    const m = gammaMetrics(gIn);
    close(m.rho, 0.59, 0.005);
    close(m.angleDeg + 360, 248, 0.5);
    // Closed form (2.44)
    const Z44 = lineInputImpedance(c(40, 70), 100, c(0, 2 * Math.PI * 0.3));
    expect(abs(sub(Z44, Zin))).toBeLessThan(1e-9);
  });
  it('Example 2.3: Z_L = 100 + j50 Ω on 50 Ω → y_L = 0.4 − j0.2, 0.15λ → y_in ≈ 0.61 + j0.66', () => {
    const gL = zToGamma(c(2, 1));
    const yL = gammaToY(gL);
    close(yL.re, 0.4, 1e-12); close(yL.im, -0.2, 1e-12);
    const yIn = gammaToY(applyElement(gL, line(0.15), ctx()));
    close(yIn.re, 0.61, 0.01); close(yIn.im, 0.66, 0.015);
  });
  it('λ/2 returns to the same point, λ/4 inverts a real load (2.47, 2.48)', () => {
    for (const z of [c(0.3, 0.8), c(2, -1), c(5, 0)]) {
      const g = zToGamma(z);
      expect(abs(sub(applyElement(g, line(0.5), ctx()), g))).toBeLessThan(1e-12);
      // λ/4 with Z1 → Z_in = Z1²/Z_L
      const Z1 = 70;
      const Zin = mul(gammaToZ(applyElement(g, line(0.25, Z1), ctx())), c(50, 0));
      const ZL = mul(z, c(50, 0));
      expect(abs(sub(Zin, div(c(Z1 * Z1, 0), ZL)))).toBeLessThan(1e-9);
    }
  });
  it('matched-line rotation is clockwise by 2βℓ and preserves |Γ|', () => {
    const g = zToGamma(c(0.5, 0.5));
    const g2 = applyElement(g, line(0.1), ctx());
    close(abs(g2), abs(g), 1e-14);
    const rot = Math.atan2(g.im, g.re) - Math.atan2(g2.im, g2.re);
    close(((rot + 2 * Math.PI) % (2 * Math.PI)), 4 * Math.PI * 0.1, 1e-12);
  });
  it('mismatched line equals (2.44) for arbitrary Z_line', () => {
    for (let i = 0; i < 100; i++) {
      const ZL = c(Math.random() * 200 + 1, (Math.random() - 0.5) * 300);
      const Zl = 20 + Math.random() * 130;
      const L = Math.random() * 0.7;
      const g = applyElement(zToGamma(div(ZL, c(50, 0))), line(L, Zl), ctx());
      const Zin = mul(gammaToZ(g), c(50, 0));
      const ref = lineInputImpedance(ZL, Zl, c(0, 2 * Math.PI * L));
      expect(abs(sub(Zin, ref)) / abs(ref)).toBeLessThan(1e-9);
    }
  });
  it('electrical length scales with frequency (TEM)', () => {
    const g = zToGamma(c(2, 0));
    const gHalf = applyElement(g, line(0.25), ctx(50, 1e9, 2e9)); // λ/4 at f0 is λ/2 at 2f0
    expect(abs(sub(gHalf, g))).toBeLessThan(1e-12);
  });
});

describe('lossy line  [Pozar 2.90, 2.91]', () => {
  it('|Γ| decays by e^{−2αℓ} and matches the tanh formula', () => {
    const lossDb = 1.5;
    const gL = zToGamma(c(0.3, -0.9));
    const g = applyElement(gL, line(0.37, 50, lossDb), ctx());
    close(abs(g), abs(gL) * Math.exp((-2 * lossDb) / DB_PER_NEPER), 1e-13);
    const Zref = lineInputImpedance(c(15, -45), 50, sectionGammaL(0.37, lossDb, 1e9, 1e9));
    expect(abs(sub(mul(gammaToZ(g), c(50, 0)), Zref))).toBeLessThan(1e-9);
    // Toward the generator, reflection magnitude never increases for α > 0
    const path = elementPath(gL, line(0.37, 50, lossDb), ctx());
    for (let i = 1; i < path.length; i++) expect(abs(path[i])).toBeLessThanOrEqual(abs(path[i - 1]) + 1e-15);
  });
  it('mismatched lossy line matches (2.91)', () => {
    const ZL = c(120, 35);
    const gl = sectionGammaL(0.21, 0.8, 1e9, 1e9);
    const g = propagateGamma(zToGamma(div(ZL, c(50, 0))), c(75 / 50, 0), gl);
    expect(abs(sub(mul(gammaToZ(g), c(50, 0)), lineInputImpedance(ZL, 75, gl)))).toBeLessThan(1e-9);
  });
});

describe('stubs  [Pozar 2.45c, 2.46c]', () => {
  it('short stub Z = jZ0 tan βℓ, open stub Z = −jZ0 cot βℓ', () => {
    const bl = 2 * Math.PI * 0.1;
    const zs = stubInputImpedance('short', 50, c(0, bl));
    close(zs.re, 0, 1e-12); close(zs.im, 50 * Math.tan(bl), 1e-9);
    const zo = stubInputImpedance('open', 50, c(0, bl));
    close(zo.re, 0, 1e-12); close(zo.im, -50 / Math.tan(bl), 1e-9);
  });
  it('shunt stub element adds jB = 1/Z_stub', () => {
    const g = zToGamma(c(0.6, -0.3));
    const el: Element = { id: 's', kind: 'stub', z0: 50, lengthWl: 0.1, lossDb: 0, vf: 1, termination: 'short', connection: 'shunt' };
    const got = gammaToY(applyElement(g, el, ctx()));
    const yStub = div(c(50, 0), stubInputImpedance('short', 50, c(0, 2 * Math.PI * 0.1)));
    const want = add(gammaToY(g), yStub);
    expect(abs(sub(got, want))).toBeLessThan(1e-12);
  });
  it('series open stub element adds −jZ0 cot βℓ', () => {
    const g = zToGamma(c(0.6, -0.3));
    const el: Element = { id: 's', kind: 'stub', z0: 75, lengthWl: 0.2, lossDb: 0, vf: 1, termination: 'open', connection: 'series' };
    const got = gammaToZ(applyElement(g, el, ctx()));
    const want = add(c(0.6, -0.3), div(stubInputImpedance('open', 75, c(0, 2 * Math.PI * 0.2)), c(50, 0)));
    expect(abs(sub(got, want))).toBeLessThan(1e-12);
  });
});

describe('lumped elements', () => {
  it('series L moves along constant r; shunt C along constant g', () => {
    const g = zToGamma(c(0.5, -0.2));
    const L: Element = { id: 'a', kind: 'seriesL', value: 5e-9 };
    const C = resistanceCircle(0.5);
    for (const p of elementPath(g, L, ctx())) close(Math.hypot(p.re - C.cx, p.im - C.cy), C.r, 1e-12);
    const y0 = gammaToY(g);
    const Sh: Element = { id: 'b', kind: 'shuntC', value: 3e-12 };
    const G = conductanceCircle(y0.re);
    for (const p of elementPath(g, Sh, ctx())) close(Math.hypot(p.re - G.cx, p.im - G.cy), G.r, 1e-12);
    // endpoint of the path equals applyElement
    const path = elementPath(g, Sh, ctx());
    expect(abs(sub(path[path.length - 1], applyElement(g, Sh, ctx())))).toBeLessThan(1e-14);
  });
  it('values: series L → +jωL, series C → −j/ωC, shunt L → −j/ωL, shunt C → +jωC', () => {
    const f = 5e8, w = 2 * Math.PI * f, Z0 = 100;
    const g = zToGamma(c(1, 0));
    const z1 = gammaToZ(applyElement(g, { id: '1', kind: 'seriesL', value: 38.8e-9 }, ctx(Z0, f)));
    close(z1.im, (w * 38.8e-9) / Z0, 1e-12);
    const z2 = gammaToZ(applyElement(g, { id: '2', kind: 'seriesC', value: 0.92e-12 }, ctx(Z0, f)));
    close(z2.im, -1 / (w * 0.92e-12 * Z0), 1e-9);
    const y3 = gammaToY(applyElement(g, { id: '3', kind: 'shuntL', value: 10e-9 }, ctx(Z0, f)));
    close(y3.im, -Z0 / (w * 10e-9), 1e-9);
    const y4 = gammaToY(applyElement(g, { id: '4', kind: 'shuntC', value: 2e-12 }, ctx(Z0, f)));
    close(y4.im, w * 2e-12 * Z0, 1e-12);
  });
  it('series elements on an open stay open; shunt elements on a short stay short', () => {
    expect(abs(sub(addSeriesZ(c(1, 0), c(0, 3)), c(1, 0)))).toBeLessThan(1e-15);
    expect(abs(sub(addShuntY(c(-1, 0), c(0, 3)), c(-1, 0)))).toBeLessThan(1e-15);
    // series on a short gives exactly z = ze
    expect(abs(sub(gammaToZ(addSeriesZ(c(-1, 0), c(0.2, 0.5))), c(0.2, 0.5)))).toBeLessThan(1e-14);
    // shunt on an open gives exactly y = ye
    expect(abs(sub(gammaToY(addShuntY(c(1, 0), c(0.2, 0.5))), c(0.2, 0.5)))).toBeLessThan(1e-14);
  });
  it('ideal transformer multiplies z by n²', () => {
    const z = c(0.4, 0.3);
    const out = gammaToZ(applyTransformerGamma(zToGamma(z), 4));
    expect(abs(sub(out, c(1.6, 1.2)))).toBeLessThan(1e-13);
  });
  it('cascade returns load then each stage', () => {
    const els: Element[] = [{ id: 'a', kind: 'shuntC', value: 1e-12 }, line(0.1)];
    const st = cascade(zToGamma(c(2, 1)), els, ctx());
    expect(st.length).toBe(3);
  });
});

describe('constraint drag solver', () => {
  it('recovers element values from their own endpoint', () => {
    const g0 = zToGamma(c(0.7, -0.4));
    const els: Element[] = [
      { id: '1', kind: 'seriesL', value: 7e-9 }, { id: '2', kind: 'seriesC', value: 2.2e-12 },
      { id: '3', kind: 'shuntL', value: 12e-9 }, { id: '4', kind: 'shuntC', value: 1.5e-12 },
      { id: '5', kind: 'seriesR', value: 20 }, { id: '6', kind: 'shuntR', value: 150 },
      line(0.137), line(0.21, 75),
      { id: 's1', kind: 'stub', z0: 50, lengthWl: 0.093, lossDb: 0, vf: 1, termination: 'short', connection: 'shunt' },
      { id: 's2', kind: 'stub', z0: 50, lengthWl: 0.31, lossDb: 0, vf: 1, termination: 'open', connection: 'shunt' },
      { id: 's3', kind: 'stub', z0: 60, lengthWl: 0.12, lossDb: 0, vf: 1, termination: 'open', connection: 'series' },
      { id: 's4', kind: 'stub', z0: 60, lengthWl: 0.41, lossDb: 0, vf: 1, termination: 'short', connection: 'series' },
    ];
    for (const el of els) {
      const target = applyElement(g0, el, ctx());
      const solved = solveElementToward(g0, el, target, ctx());
      const again = applyElement(g0, solved, ctx());
      expect(abs(sub(again, target)), el.kind + ' ' + el.id).toBeLessThan(1e-9);
    }
  });
});

describe('load models', () => {
  it('series RC/RL and parallel models scale correctly', () => {
    const Zc = loadAtFrequency(c(60, -80), 2e9, 1e9, 'series');
    close(Zc.im, -160, 1e-9); // capacitor reactance doubles at half frequency
    const Zl = loadAtFrequency(c(100, 80), 2e9, 3e9, 'series');
    close(Zl.im, 120, 1e-9);
    const Zp = loadAtFrequency(c(50, 50), 1e9, 1e9, 'parallel');
    expect(abs(sub(Zp, c(50, 50)))).toBeLessThan(1e-12);
    const Y = div(ONE, c(50, 50)); // B < 0 → inductor, B ∝ 1/f
    const Zp2 = loadAtFrequency(c(50, 50), 1e9, 2e9, 'parallel');
    const Y2 = div(ONE, Zp2);
    close(Y2.re, Y.re, 1e-15); close(Y2.im, Y.im / 2, 1e-15);
    void J;
  });
});
