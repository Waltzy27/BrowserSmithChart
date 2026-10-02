import { describe, it, expect } from 'vitest';
import { c, abs, arg, deg, sub, add, div, mul, tanh, tan, sqrt, J, ONE, fromPolar } from '../src/math/complex';
import {
  zToGamma, gammaToZ, yToGamma, gammaToY, gammaMetrics, wtgFromAngle, angleFromWtg,
  resistanceCircle, reactanceCircle, conductanceCircle, susceptanceCircle, qCircle,
  renormalizeGamma1Port, seriesEquivalent, parallelEquivalent, vswrToRho, returnLossToRho,
  mismatchLossToRho, classifyPoint, nodeQ,
} from '../src/math/smith';
import { parseEngineering, formatEngineering } from '../src/math/units';

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('complex kernel', () => {
  it('division, tanh and tan agree with identities', () => {
    const a = c(3, -4), b = c(-1.5, 2.25);
    const q = div(a, b);
    expect(abs(sub(mul(q, b), a))).toBeLessThan(1e-14);
    // tanh(jx) = j tan(x)
    const x = 0.7;
    const t = tanh(c(0, x));
    close(t.re, 0, 1e-15); close(t.im, Math.tan(x), 1e-14);
    // tan(z) = -j tanh(jz)
    const z = c(0.3, 0.2);
    const lhs = tan(z);
    const sinz = c(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
    const cosz = c(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
    expect(abs(sub(lhs, div(sinz, cosz)))).toBeLessThan(1e-14);
    // sqrt
    const r = sqrt(c(-4, 0));
    close(r.re, 0, 1e-15); close(r.im, 2, 1e-15);
    // tanh overflow guard
    expect(tanh(c(400, 1)).re).toBe(1);
  });
});

describe('Möbius pair Γ = (z−1)/(z+1)  [Pozar 2.53–2.54]', () => {
  it('round-trips random impedances', () => {
    for (let i = 0; i < 500; i++) {
      const z = c(Math.random() * 20, (Math.random() - 0.5) * 40);
      const back = gammaToZ(zToGamma(z));
      expect(abs(sub(back, z)) / Math.max(1, abs(z))).toBeLessThan(1e-11);
    }
  });
  it('maps the special points', () => {
    expect(abs(zToGamma(c(1, 0)))).toBeLessThan(1e-15);         // matched → centre
    expect(abs(sub(zToGamma(c(0, 0)), c(-1, 0)))).toBeLessThan(1e-15); // short → left edge
    expect(abs(sub(zToGamma(c(Infinity, 0)), c(1, 0)))).toBe(0);      // open → right edge
    expect(gammaToZ(c(1, 0)).re).toBe(Infinity);
    const gj = zToGamma(c(0, 1)); // z = j1 → Γ = j (rim, +90°)
    close(gj.re, 0, 1e-15); close(gj.im, 1, 1e-15);
    // Upper half = inductive, lower = capacitive
    expect(zToGamma(c(0.5, 0.5)).im).toBeGreaterThan(0);
    expect(zToGamma(c(0.5, -0.5)).im).toBeLessThan(0);
  });
  it('matches the direct coordinate equations u, v', () => {
    const r = 0.7, x = -1.3;
    const g = zToGamma(c(r, x));
    const d = (r + 1) ** 2 + x * x;
    close(g.re, (r * r + x * x - 1) / d, 1e-15);
    close(g.im, (2 * x) / d, 1e-15);
  });
  it('admittance point is the impedance point rotated 180°', () => {
    for (let i = 0; i < 200; i++) {
      const z = c(Math.random() * 5 + 0.01, (Math.random() - 0.5) * 10);
      const gz = zToGamma(z);
      const gy = zToGamma(div(ONE, z)); // plot y on the same Z grid
      expect(abs(add(gz, gy))).toBeLessThan(1e-12);
      // and yToGamma(y) equals the impedance Γ
      expect(abs(sub(yToGamma(div(ONE, z)), gz))).toBeLessThan(1e-12);
      expect(abs(sub(gammaToY(gz), div(ONE, z)))).toBeLessThan(1e-11);
    }
  });
});

describe('grid circles  [Pozar 2.56]', () => {
  it('constant-r and constant-x sample points lie on their circles', () => {
    for (const r of [0, 0.2, 0.5, 1, 2, 5]) {
      const C = resistanceCircle(r);
      for (const x of [-5, -1, -0.3, 0, 0.4, 2, 10]) {
        const g = zToGamma(c(r, x));
        close(Math.hypot(g.re - C.cx, g.im - C.cy), C.r, 1e-12);
      }
    }
    for (const x of [-5, -1, -0.3, 0.4, 2, 10]) {
      const C = reactanceCircle(x);
      for (const r of [0, 0.2, 1, 3, 50]) {
        const g = zToGamma(c(r, x));
        close(Math.hypot(g.re - C.cx, g.im - C.cy), C.r, 1e-12);
      }
    }
    // r = 1 circle: centre 0.5, radius 0.5 (Pozar text after 2.56)
    expect(resistanceCircle(1)).toEqual({ cx: 0.5, cy: 0, r: 0.5 });
  });
  it('constant-g and constant-b circles hold admittance points', () => {
    for (const gg of [0.2, 1, 3]) for (const b of [-2, -0.5, 0.7, 4]) {
      const g = yToGamma(c(gg, b));
      const C1 = conductanceCircle(gg), C2 = susceptanceCircle(b);
      close(Math.hypot(g.re - C1.cx, g.im - C1.cy), C1.r, 1e-12);
      close(Math.hypot(g.re - C2.cx, g.im - C2.cy), C2.r, 1e-12);
    }
    // Positive (capacitive) susceptance sits in the lower half of the chart
    expect(yToGamma(c(1, 1)).im).toBeLessThan(0);
  });
  it('constant-Q arcs', () => {
    for (const Q of [0.5, 1, 3, 10]) for (const r of [0.1, 0.5, 1, 4]) {
      const up = zToGamma(c(r, Q * r)), lo = zToGamma(c(r, -Q * r));
      const Cu = qCircle(Q, true), Cl = qCircle(Q, false);
      close(Math.hypot(up.re - Cu.cx, up.im - Cu.cy), Cu.r, 1e-12);
      close(Math.hypot(lo.re - Cl.cx, lo.im - Cl.cy), Cl.r, 1e-12);
      close(nodeQ(c(r, Q * r)), Q, 1e-12);
    }
  });
});

describe('mismatch metrics  [Pozar 2.38, 2.41; Example 2.2]', () => {
  it('Example 2.2: z_L = 0.4 + j0.7 → |Γ| 0.59, SWR 3.87, RL 4.6 dB, ∠Γ 104°, WTG 0.106λ', () => {
    const g = zToGamma(c(0.4, 0.7));
    const m = gammaMetrics(g);
    close(m.rho, 0.59, 0.005);
    close(m.vswr, 3.87, 0.03);
    close(m.returnLossDb, 4.6, 0.05);
    close(m.angleDeg, 104, 0.5);
    close(m.wtg, 0.106, 0.001);
  });
  it('formulas are mutually consistent through ρ', () => {
    for (const rho of [0, 0.01, 0.1, 0.333, 0.5, 0.9, 0.999]) {
      const m = gammaMetrics(fromPolar(rho, 0.3));
      close(vswrToRho(m.vswr), rho, 1e-12);
      if (rho > 0) close(returnLossToRho(m.returnLossDb), rho, 1e-12);
      close(mismatchLossToRho(m.mismatchLossDb), rho, 1e-9);
      close(m.reflectedPower + m.acceptedPower, 1, 1e-15);
    }
    expect(gammaMetrics(c(0, 0)).vswr).toBe(1);
    expect(gammaMetrics(c(0, 0)).returnLossDb).toBe(Infinity);
    expect(gammaMetrics(c(-1, 0)).vswr).toBe(Infinity);
    expect(gammaMetrics(c(1.2, 0)).active).toBe(true);
  });
  it('WTG scale: 0 at short, 0.25λ at open, increases clockwise', () => {
    close(wtgFromAngle(180), 0, 1e-15);
    close(wtgFromAngle(0), 0.25, 1e-15);
    close(wtgFromAngle(90), 0.125, 1e-15);
    close(wtgFromAngle(-90), 0.375, 1e-15);
    for (const w of [0.01, 0.106, 0.25, 0.406, 0.49]) close(wtgFromAngle(angleFromWtg(w)), w, 1e-12);
    // Example 2.2: input at 0.406λ WTG → ∠Γ = 248° (= −112°)
    close(angleFromWtg(0.406), 248 - 360, 0.5);
  });
});

describe('renormalisation and equivalents', () => {
  it('renormalising preserves the absolute impedance', () => {
    const Z = c(37, -22);
    const g50 = zToGamma(c(Z.re / 50, Z.im / 50));
    const g75 = renormalizeGamma1Port(g50, 50, 75);
    const Zback = mul(gammaToZ(g75), c(75, 0));
    expect(abs(sub(Zback, Z))).toBeLessThan(1e-11);
    // open & short stay fixed
    expect(abs(sub(renormalizeGamma1Port(c(1, 0), 50, 75), c(1, 0)))).toBeLessThan(1e-15);
    expect(abs(sub(renormalizeGamma1Port(c(-1, 0), 50, 75), c(-1, 0)))).toBeLessThan(1e-15);
  });
  it('series / parallel equivalents (Pozar Ex. 5.2 load: 60 − j80 Ω at 2 GHz → C = 0.995 pF)', () => {
    const s = seriesEquivalent(c(60, -80), 2e9);
    expect(s.kind).toBe('C');
    close(s.C! * 1e12, 0.995, 0.001);
    close(s.Q, 80 / 60, 1e-12);
    const sL = seriesEquivalent(c(100, 80), 2e9); // Ex. 5.3: L = 6.37 nH
    close(sL.L! * 1e9, 6.37, 0.01);
    const Y = div(ONE, c(60, -80));
    const p = parallelEquivalent(Y, 2e9);
    expect(p.kind).toBe('C');
    close(p.Q, s.Q, 1e-12); // node Q is the same in both forms
    close(p.Rp, (60 * 60 + 80 * 80) / 60, 1e-9);
  });
  it('classifies points', () => {
    expect(classifyPoint(c(0, 0))).toBe('matched');
    expect(classifyPoint(c(1, 0))).toBe('open');
    expect(classifyPoint(c(-1, 0))).toBe('short');
    expect(classifyPoint(zToGamma(c(1, 1)))).toBe('inductive');
    expect(classifyPoint(zToGamma(c(1, -1)))).toBe('capacitive');
    expect(classifyPoint(zToGamma(c(-0.2, 0.3)))).toBe('active');
    expect(classifyPoint(J)).toBe('lossless-reactive');
  });
});

describe('engineering units', () => {
  it('parses prefixes and units', () => {
    close(parseEngineering('2.2n'), 2.2e-9, 1e-24);
    close(parseEngineering('38.8 nH', 'H'), 38.8e-9, 1e-22);
    close(parseEngineering('500 MHz', 'Hz'), 5e8, 1e-6);
    close(parseEngineering('4.7k'), 4700, 1e-9);
    close(parseEngineering('1.5e-12'), 1.5e-12, 1e-27);
    close(parseEngineering('10m'), 0.01, 1e-15);
    close(parseEngineering('3u'), 3e-6, 1e-20);
    close(parseEngineering('50 ohm', 'Ω'), 50, 0);
    expect(Number.isNaN(parseEngineering('abc'))).toBe(true);
  });
  it('formats with SI prefixes', () => {
    expect(formatEngineering(3.88e-8, 'H')).toBe('38.80 nH');
    expect(formatEngineering(0.92e-12, 'F', 3)).toBe('920 fF');
    expect(formatEngineering(2e9, 'Hz')).toBe('2.000 GHz');
    expect(formatEngineering(0, 'Ω')).toBe('0 Ω');
  });
  it('angle helpers', () => {
    close(deg(arg(c(-1, 1e-18))), 180, 1e-9);
  });
});
