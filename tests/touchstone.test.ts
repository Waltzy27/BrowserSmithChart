import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { c, abs, sub, mul, div } from '../src/math/complex';
import { zToGamma, gammaToZ } from '../src/math/smith';
import { parseTouchstone, selectParameter, serializeS1P, zToS, yToS } from '../src/io/touchstone';
import { applyElement, sectionGammaL, lineInputImpedance } from '../src/rf/network';

const golden = JSON.parse(readFileSync('tests/fixtures/skrf_golden.json', 'utf8'));
const read = (n: string) => readFileSync(`public/examples/${n}`, 'utf8');
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('Touchstone 1.x parsing', () => {
  it('RI / MA / DB give the same complex value', () => {
    const g = c(0.3, -0.4); // |Γ| = 0.5, ∠ −53.130102°
    const ang = (Math.atan2(-0.4, 0.3) * 180) / Math.PI;
    const files = [
      `# MHz S RI R 50\n100 0.3 -0.4\n`,
      `# MHz S MA R 50\n100 0.5 ${ang}\n`,
      `# MHz S DB R 50\n100 ${20 * Math.log10(0.5)} ${ang}\n`,
    ];
    for (const t of files) {
      const r = parseTouchstone(t, 'x.s1p');
      expect(r.network).not.toBeNull();
      expect(r.network!.freqs[0]).toBe(100e6);
      expect(abs(sub(r.network!.s[0][0][0], g))).toBeLessThan(1e-12);
    }
  });
  it('applies defaults (GHz S MA R 50) and warns without an option line', () => {
    const r = parseTouchstone(`1 0.5 90\n2 0.5 0\n`, 'a.s1p');
    expect(r.network!.freqs).toEqual([1e9, 2e9]);
    expect(r.network!.z0).toBe(50);
    expect(r.diagnostics.some((d) => d.level === 'warning')).toBe(true);
  });
  it('2-port order is 11 21 12 22 in v1.x', () => {
    const r = parseTouchstone(`# GHz S RI R 50\n1  0.1 0  0.2 0  0.3 0  0.4 0\n`, 'a.s2p');
    const m = r.network!.s[0];
    expect(m[0][0].re).toBe(0.1); expect(m[1][0].re).toBe(0.2); // S21
    expect(m[0][1].re).toBe(0.3); expect(m[1][1].re).toBe(0.4); // S12
  });
  it('comments, blank lines, tabs, CRLF, exponents', () => {
    const t = `! header\r\n#\tkhz  s  ri  r 75 ! trailing\r\n\r\n 1.0e3\t1E-1 -2.5e-1 ! data\r\n2e3 0 0\r\n`;
    const r = parseTouchstone(t, 'a.s1p');
    expect(r.network!.z0).toBe(75);
    expect(r.network!.freqs).toEqual([1e6, 2e6]);
    close(r.network!.s[0][0][0].im, -0.25, 1e-15);
    expect(r.network!.comments[0]).toBe('header');
  });
  it('Z and Y one-port data (normalised to R in v1.x) convert to Γ', () => {
    const rz = parseTouchstone(`# Hz Z RI R 50\n1 0.4 0.7\n`, 'a.s1p');
    expect(abs(sub(rz.network!.s[0][0][0], zToGamma(c(0.4, 0.7))))).toBeLessThan(1e-14);
    const ry = parseTouchstone(`# Hz Y RI R 50\n1 0.4 -0.2\n`, 'a.s1p');
    expect(abs(sub(ry.network!.s[0][0][0], zToGamma(c(2, 1))))).toBeLessThan(1e-14);
  });
  it('2-port Z ↔ S conversion matches the series-impedance closed form', () => {
    // series impedance z between ports: S11 = z/(z+2), S21 = 2/(z+2); z-matrix is singular, so use a T: z11=z22=1.5, z12=z21=1
    const s = zToS([[c(1.5), c(1)], [c(1), c(1.5)]])!;
    const y = yToS([[c(1.5), c(-1)], [c(-1), c(1.5)]])!;
    expect(abs(s[0][1])).toBeGreaterThan(0);
    // reciprocity and symmetry preserved
    expect(abs(sub(s[0][1], s[1][0]))).toBeLessThan(1e-15);
    expect(abs(sub(y[0][0], y[1][1]))).toBeLessThan(1e-15);
    // For z11 = 1.5, z12 = 1: S11 = (z11² − z12² − 1)/((z11+1)² − z12²) = (2.25 − 1 − 1)/(6.25 − 1)
    close(s[0][0].re, 0.25 / 5.25, 1e-15);
  });
  it('detects and skips v1.x noise data in an S2P', () => {
    const t = `# GHz S MA R 50\n1 .5 0 2 0 .1 0 .5 0\n2 .5 0 2 0 .1 0 .5 0\n! noise\n1 1.2 .3 20 .2\n2 1.5 .3 30 .25\n`;
    const r = parseTouchstone(t, 'a.s2p');
    expect(r.network!.freqs.length).toBe(2);
    expect(r.network!.hasNoiseData).toBe(true);
  });
  it('rejects malformed files with diagnostics instead of throwing', () => {
    expect(parseTouchstone(`# GHz S RI R 50\n1 a b\n`, 'a.s1p').network).toBeNull();
    expect(parseTouchstone(`# GHz S RI R 50\n2 0 0\n1 0 0\n`, 'a.s1p').network).toBeNull();
    expect(parseTouchstone(`# GHz H RI R 50\n1 0 0 0 0 0 0 0 0\n`, 'a.s2p').network).toBeNull();
    expect(parseTouchstone(``, 'a.s1p').network).toBeNull();
    const dup = parseTouchstone(`# GHz S RI R 50\n1 0 0\n1 0 0\n2 0 0\n`, 'a.s1p');
    expect(dup.network!.freqs.length).toBe(2);
  });
  it('3-port v1.x with continuation lines', () => {
    const vals = Array.from({ length: 9 }, (_, i) => `${(i + 1) / 10} 0`);
    const t = `# GHz S RI R 50\n1 ${vals.slice(0, 3).join(' ')}\n${vals.slice(3, 6).join(' ')}\n${vals.slice(6).join(' ')}\n`;
    const r = parseTouchstone(t, 'a.s3p');
    expect(r.network!.ports).toBe(3);
    close(r.network!.s[0][2][1].re, 0.8, 1e-15); // row-major for n ≥ 3
  });
});

describe('Touchstone 2.0 keywords', () => {
  it('reads [Version] 2.0 with 12_21 order and absolute Z data', () => {
    const t = `[Version] 2.0\n# GHz Z RI R 50\n[Number of Ports] 1\n[Number of Frequencies] 1\n[Network Data]\n1 20 35\n[End]\n`;
    const r = parseTouchstone(t, 'a.ts');
    expect(abs(sub(r.network!.s[0][0][0], zToGamma(c(0.4, 0.7))))).toBeLessThan(1e-14);
    const t2 = `[Version] 2.0\n# GHz S RI R 50\n[Number of Ports] 2\n[Two-Port Data Order] 12_21\n[Network Data]\n1 .1 0 .3 0 .2 0 .4 0\n[End]\n`;
    const m = parseTouchstone(t2, 'b.ts').network!.s[0];
    expect(m[0][1].re).toBe(0.3); expect(m[1][0].re).toBe(0.2);
  });
});

describe('cross-check against scikit-rf golden data', () => {
  it('Pozar Ex. 5.2 load file (DB format) at 2 GHz', () => {
    const r = parseTouchstone(read('pozar_ex5_2_RC_load.s1p'), 'pozar_ex5_2_RC_load.s1p');
    const net = r.network!;
    const k = net.freqs.indexOf(golden.ex52_file_2GHz[2]);
    expect(k).toBe(100);
    const g = net.s[k][0][0];
    close(g.re, golden.ex52_file_2GHz[0], 1e-9); close(g.im, golden.ex52_file_2GHz[1], 1e-9);
    // and it equals 60 − j80 Ω at 2 GHz (Pozar Example 5.2)
    const Z = mul(gammaToZ(g), c(50, 0));
    close(Z.re, 60, 0.01); close(Z.im, -80, 0.05);
  });
  it('2-port line section (RI) matches scikit-rf', () => {
    const net = parseTouchstone(read('line_30ohm_section.s2p'), 'line_30ohm_section.s2p').network!;
    const k = net.freqs.indexOf(golden.line_2port_1GHz.f);
    close(net.s[k][0][0].re, golden.line_2port_1GHz.s11[0], 1e-12);
    close(net.s[k][1][0].im, golden.line_2port_1GHz.s21[1], 1e-12);
    // Independent check: S11 of a 30 Ω line, 0.3λ, terminated in 50 Ω, with the same loss
    const gl = c(0.02 * 2 * Math.PI * 0.3, 2 * Math.PI * 0.3);
    const Zin = lineInputImpedance(c(50, 0), 30, gl);
    const s11 = zToGamma(div(Zin, c(50, 0)));
    close(s11.re, golden.line_2port_1GHz.s11[0], 1e-9); close(s11.im, golden.line_2port_1GHz.s11[1], 1e-9);
  });
  it('non-reciprocal 2-port keeps S21 and S12 distinct', () => {
    const net = parseTouchstone(read('synthetic_amplifier.s2p'), 'synthetic_amplifier.s2p').network!;
    const k = net.freqs.indexOf(golden.amp_3GHz.f);
    close(net.s[k][1][0].re, golden.amp_3GHz.s21[0], 1e-9);
    close(net.s[k][0][1].im, golden.amp_3GHz.s12[1], 1e-9);
    expect(selectParameter(net, 2, 1)[k]).toEqual(net.s[k][1][0]);
  });
  it('Ex. 2.2 line transform matches scikit-rf (36.534 − j61.119 Ω)', () => {
    const g = applyElement(zToGamma(c(0.4, 0.7)), { id: 'l', kind: 'line', z0: 100, lengthWl: 0.3, lossDb: 0, vf: 1 }, { f: 1e9, f0: 1e9, Z0: 100 });
    const Z = mul(gammaToZ(g), c(100, 0));
    close(Z.re, golden.ex22_zin[0], 1e-9); close(Z.im, golden.ex22_zin[1], 1e-9);
  });
  it('lossy line transform matches scikit-rf', () => {
    const g = applyElement(zToGamma(c(0.3, -0.9)), { id: 'l', kind: 'line', z0: 50, lengthWl: 0.37, lossDb: 1.5, vf: 1 }, { f: 1e9, f0: 1e9, Z0: 50 });
    const Z = mul(gammaToZ(g), c(50, 0));
    close(Z.re, golden.lossy_zin[0], 1e-6); close(Z.im, golden.lossy_zin[1], 1e-6);
    void sectionGammaL;
  });
});

describe('S1P export round trip', () => {
  it('serialize → parse preserves data in every format', () => {
    const freqs = [1e9, 1.5e9, 2e9];
    const g = [c(0.1, 0.2), c(-0.5, 0.3), c(0.9, -0.05)];
    for (const fmt of ['RI', 'MA', 'DB'] as const) {
      const txt = serializeS1P(freqs, g, 50, ['test'], fmt);
      const net = parseTouchstone(txt, 'r.s1p').network!;
      expect(net.freqs).toEqual(freqs);
      net.s.forEach((m, k) => expect(abs(sub(m[0][0], g[k]))).toBeLessThan(1e-10));
    }
  });
});
