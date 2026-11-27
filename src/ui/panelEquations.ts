/** Equation reference with live substitution of the selected point (KaTeX-rendered). */
import katex from 'katex';
import { type Complex, c, mul, abs, arg, deg } from '../math/complex';
import { gammaToZ, gammaToY, gammaMetrics } from '../math/smith';
import { lumpedImmittance, sectionGammaL, stubImmittance } from '../rf/network';
import type { Store, AppState } from '../state/store';
import { derive } from '../state/derive';
import { h, rebuild } from './dom';
import { selectedPoint } from './panelInspect';
import { ETA0, NP_TO_DB, z01, eeffHJ, openEndExtension, openEndHB } from '../tl/microstrip';
import { solveLine, type LineSolution } from '../tl/linecalc';
import { designStub, targetReactance } from '../tl/stub';
import { quarterWaveMicrostrip } from '../tl/helpers';

/** LineCalc line solution for the Equations tab, cached per state. */
let lcCache: { key: unknown; f0: number; r: LineSolution | null } | null = null;
const lcLine = (s: AppState): LineSolution | null => {
  if (lcCache && lcCache.key === s.lineCalc && lcCache.f0 === s.f0) return lcCache.r;
  const r = solveLine(s.lineCalc, s.f0);
  lcCache = { key: s.lineCalc, f0: s.f0, r: r.ok ? r : null };
  return lcCache.r;
};
const lcStub = (s: AppState) => {
  const st = s.lineCalc.stub;
  const d = designStub({ part: st.part, value: st.values[st.part], term: st.term, z0: st.z0, f0: s.f0 }, s.lineCalc.stackup);
  return d.ok ? d : null;
};
const NO_LC = '\\text{(no valid LineCalc solution for the current inputs)}';

const tex = (s: string, display = true): HTMLElement => {
  const el = h('div', { class: display ? 'tex' : 'tex inline' });
  try { katex.render(s, el, { displayMode: display, throwOnError: false, output: 'html' }); } catch { el.textContent = s; }
  return el;
};

const n = (v: number, d = 4): string => {
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty';
  if (Math.abs(v) < 1e-10) v = 0;
  const s = Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3).replace(/e([+-]?\d+)/, '\\times10^{$1}') : v.toFixed(d);
  return s;
};
const cx = (z: Complex, d = 4): string => {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return '\\infty';
  const im = Math.abs(z.im) < 1e-10 ? 0 : z.im;
  return `${n(z.re, d)} ${im < 0 ? '-' : '+'} j${n(Math.abs(im), d)}`;
};

interface Eq { title: string; tex: string; ref: string; live?: (s: AppState) => string | null; note?: string; }

const GROUPS: Array<{ name: string; eqs: Eq[] }> = [
  { name: 'Normalisation and reflection', eqs: [
    { title: 'Normalised impedance and admittance', tex: 'z=\\frac{Z}{Z_0}=r+jx,\\qquad y=\\frac{1}{z}=Y Z_0=g+jb', ref: 'Pozar §2.4',
      live: (s) => { const p = selectedPoint(s); const z = gammaToZ(p.gamma); return `z = ${cx(z)},\\quad y = ${cx(gammaToY(p.gamma))}`; } },
    { title: 'Reflection coefficient', tex: '\\Gamma=\\frac{Z_L-Z_0}{Z_L+Z_0}=\\frac{z-1}{z+1}', ref: 'Pozar (2.35), (2.53)',
      live: (s) => { const p = selectedPoint(s); const z = gammaToZ(p.gamma); return `\\Gamma=\\frac{(${cx(z, 3)})-1}{(${cx(z, 3)})+1}=${cx(p.gamma)}=${n(abs(p.gamma))}\\angle ${n(deg(arg(p.gamma)), 2)}^\\circ`; } },
    { title: 'Inverse mapping', tex: 'z=\\frac{1+\\Gamma}{1-\\Gamma}', ref: 'Pozar (2.54)' },
    { title: 'Rectangular chart coordinates', tex: 'r=\\frac{1-\\Gamma_r^2-\\Gamma_i^2}{(1-\\Gamma_r)^2+\\Gamma_i^2},\\qquad x=\\frac{2\\Gamma_i}{(1-\\Gamma_r)^2+\\Gamma_i^2}', ref: 'Pozar (2.55a,b)' },
  ] },
  { name: 'Grid geometry', eqs: [
    { title: 'Constant-resistance circles', tex: '\\left(\\Gamma_r-\\frac{r}{1+r}\\right)^2+\\Gamma_i^2=\\left(\\frac{1}{1+r}\\right)^2', ref: 'Pozar (2.56a)',
      live: (s) => { const z = gammaToZ(selectedPoint(s).gamma); return Number.isFinite(z.re) ? `r=${n(z.re, 3)}:\\ \\text{centre }(${n(z.re / (1 + z.re), 4)},0),\\ \\text{radius }${n(1 / (1 + z.re), 4)}` : null; } },
    { title: 'Constant-reactance circles', tex: '(\\Gamma_r-1)^2+\\left(\\Gamma_i-\\frac{1}{x}\\right)^2=\\left(\\frac{1}{x}\\right)^2', ref: 'Pozar (2.56b)',
      live: (s) => { const z = gammaToZ(selectedPoint(s).gamma); return Number.isFinite(z.im) && Math.abs(z.im) > 1e-9 ? `x=${n(z.im, 3)}:\\ \\text{centre }(1,${n(1 / z.im, 4)}),\\ \\text{radius }${n(1 / Math.abs(z.im), 4)}` : null; } },
    { title: 'Admittance grid', tex: '\\Gamma_y=-\\Gamma_z\\quad\\Rightarrow\\quad g\\text{-circles: centre }\\left(\\tfrac{-g}{1+g},0\\right),\\ b\\text{-circles: centre }\\left(-1,\\tfrac{-1}{b}\\right)', ref: 'Pozar §2.4 (ZY chart, Fig. 2.12)', note: 'Reading y on a plain Z chart is the same as reflecting the point through the centre (a λ/4 rotation).' },
    { title: 'Constant-Q contours', tex: 'Q=\\frac{|x|}{r}=\\frac{|b|}{g}:\\quad \\Gamma_r^2+\\left(\\Gamma_i\\pm\\frac{1}{Q}\\right)^2=1+\\frac{1}{Q^2}', ref: 'Derived from (2.55)' },
  ] },
  { name: 'Mismatch', eqs: [
    { title: 'Standing-wave ratio', tex: '\\mathrm{SWR}=\\frac{V_{max}}{V_{min}}=\\frac{1+|\\Gamma|}{1-|\\Gamma|}', ref: 'Pozar (2.41)',
      live: (s) => { const m = gammaMetrics(selectedPoint(s).gamma); return `\\mathrm{SWR}=\\frac{1+${n(m.rho)}}{1-${n(m.rho)}}=${n(m.vswr, 3)}`; } },
    { title: 'Return loss', tex: '\\mathrm{RL}=-20\\log_{10}|\\Gamma|\\ \\text{dB}', ref: 'Pozar (2.38)',
      live: (s) => { const m = gammaMetrics(selectedPoint(s).gamma); return `\\mathrm{RL}=-20\\log_{10}(${n(m.rho)})=${n(m.returnLossDb, 2)}\\ \\text{dB}`; } },
    { title: 'Power delivered and mismatch loss', tex: '\\frac{P_L}{P_{inc}}=1-|\\Gamma|^2,\\qquad \\mathrm{ML}=-10\\log_{10}\\left(1-|\\Gamma|^2\\right)', ref: 'Pozar (2.37)',
      live: (s) => { const m = gammaMetrics(selectedPoint(s).gamma); return `1-|\\Gamma|^2=${n(m.acceptedPower)},\\quad \\mathrm{ML}=${n(m.mismatchLossDb, 3)}\\ \\text{dB}`; } },
  ] },
  { name: 'Transmission lines', eqs: [
    { title: 'Moving along a line (rotation toward the generator)', tex: '\\Gamma(\\ell)=\\Gamma_L\\,e^{-2j\\beta\\ell}\\quad(\\text{clockwise by }2\\beta\\ell;\\ \\lambda/2=360^\\circ)', ref: 'Pozar (2.42), (2.57)' },
    { title: 'Lossless line input impedance', tex: 'Z_{in}=Z_0\\frac{Z_L+jZ_0\\tan\\beta\\ell}{Z_0+jZ_L\\tan\\beta\\ell}', ref: 'Pozar (2.44)' },
    { title: 'Lossy line', tex: '\\Gamma(\\ell)=\\Gamma_L e^{-2\\gamma\\ell},\\quad \\gamma=\\alpha+j\\beta,\\quad Z_{in}=Z_0\\frac{Z_L+Z_0\\tanh\\gamma\\ell}{Z_0+Z_L\\tanh\\gamma\\ell}', ref: 'Pozar (2.90), (2.91)', note: '|Γ| shrinks by e^{−2αℓ}: the chart path spirals inward toward the centre.' },
    { title: 'Short- and open-circuited stubs', tex: 'Z_{sc}=jZ_0\\tan\\beta\\ell,\\qquad Z_{oc}=-jZ_0\\cot\\beta\\ell', ref: 'Pozar (2.45c), (2.46c)' },
    { title: 'Special lengths', tex: '\\ell=\\tfrac{\\lambda}{2}:\\ Z_{in}=Z_L\\qquad \\ell=\\tfrac{\\lambda}{4}:\\ Z_{in}=\\frac{Z_1^2}{Z_L}', ref: 'Pozar (2.47), (2.48)' },
    { title: 'Wavelength scales', tex: '\\mathrm{WTG}=\\frac{180^\\circ-\\angle\\Gamma}{720^\\circ}\\bmod 0.5,\\qquad \\mathrm{WTL}=0.5-\\mathrm{WTG}', ref: 'Chart convention (WTG = 0 at the short circuit)',
      live: (s) => { const m = gammaMetrics(selectedPoint(s).gamma); return `\\angle\\Gamma=${n(m.angleDeg, 2)}^\\circ\\Rightarrow \\mathrm{WTG}=${n(m.wtg)}\\lambda,\\ \\mathrm{WTL}=${n(m.wtl)}\\lambda`; } },
  ] },
  { name: 'Lumped elements', eqs: [
    { title: 'Series element (move on constant r for reactance)', tex: 'z\\ \\to\\ z+\\frac{jX}{Z_0},\\qquad X_L=\\omega L,\\ X_C=-\\frac{1}{\\omega C}', ref: 'Pozar §5.1' },
    { title: 'Shunt element (move on constant g for susceptance)', tex: 'y\\ \\to\\ y+jBZ_0,\\qquad B_C=\\omega C,\\ B_L=-\\frac{1}{\\omega L}', ref: 'Pozar §5.1' },
    { title: 'Equivalent series / parallel model', tex: 'Z=R_s+jX_s,\\quad Y=G_p+jB_p,\\quad Q=\\frac{|X_s|}{R_s}=\\frac{|B_p|}{G_p}', ref: 'Circuit identity' },
    { title: 'Non-ideal inductor (fixed ESR, parallel self-capacitance)', tex: '\\begin{gathered}R_s=\\frac{\\omega_0L}{Q_0}\\\\[2pt] C_p=\\frac{1}{\\omega_s^2L}\\\\[2pt] Z_L=\\frac{R_s+j\\omega L}{1+j\\omega C_p\\,(R_s+j\\omega L)}\\end{gathered}', ref: 'Component model (v0.2)', note: 'Q grows ∝ f with a fixed ESR; the impedance peaks (parallel resonance) at the SRF f_s = ω_s/2π. Below SRF the effective inductance is L/(1 − (f/f_s)²).' },
    { title: 'Non-ideal capacitor (fixed ESR, series inductance)', tex: '\\begin{gathered}R_s=\\frac{1}{\\omega_0CQ_0}\\\\[2pt] L_s=\\frac{1}{\\omega_s^2C}\\\\[2pt] Z_C=R_s+j\\omega L_s+\\frac{1}{j\\omega C}\\end{gathered}', ref: 'Component model (v0.2)', note: 'At the SRF the reactance cancels and only the ESR remains; above it the capacitor looks inductive.' },
  ] },
  { name: 'Matching', eqs: [
    { title: 'L-section, z_L inside the r = 1 circle (shunt B first)', tex: 'B=\\frac{X_L\\pm\\sqrt{R_L/Z_0}\\sqrt{R_L^2+X_L^2-Z_0R_L}}{R_L^2+X_L^2},\\quad X=\\frac{1}{B}+\\frac{X_LZ_0}{R_L}-\\frac{Z_0}{BR_L}', ref: 'Pozar (5.3a,b)' },
    { title: 'L-section, z_L outside the r = 1 circle (series X first)', tex: 'X=\\pm\\sqrt{R_L(Z_0-R_L)}-X_L,\\qquad B=\\pm\\frac{\\sqrt{(Z_0-R_L)/R_L}}{Z_0}', ref: 'Pozar (5.6a,b)' },
    { title: 'Shunt single-stub position', tex: 't=\\tan\\beta d=\\frac{X_L\\pm\\sqrt{R_L\\left[(Z_0-R_L)^2+X_L^2\\right]/Z_0}}{R_L-Z_0},\\quad \\frac{d}{\\lambda}=\\begin{cases}\\frac{1}{2\\pi}\\tan^{-1}t & t\\ge0\\\\ \\frac{1}{2\\pi}(\\pi+\\tan^{-1}t)&t<0\\end{cases}', ref: 'Pozar (5.9), (5.10)' },
    { title: 'Stub lengths', tex: '\\frac{\\ell_{oc}}{\\lambda}=\\frac{1}{2\\pi}\\tan^{-1}\\frac{B_s}{Y_0},\\qquad \\frac{\\ell_{sc}}{\\lambda}=-\\frac{1}{2\\pi}\\tan^{-1}\\frac{Y_0}{B_s}\\quad(+\\tfrac{\\lambda}{2}\\text{ if negative})', ref: 'Pozar (5.11a,b); series stubs (5.16a,b)' },
    { title: 'Quarter-wave transformer', tex: 'Z_1=\\sqrt{Z_0R_L}', ref: 'Pozar (2.63)', note: 'For a complex load, first move along the line to a voltage maximum (R = Z0·SWR) or minimum (R = Z0/SWR).' },
  ] },
  { name: 'Pi and T networks', eqs: [
    { title: 'Virtual resistance for a chosen loaded Q', tex: '\\begin{gathered}\\text{Pi: }R_v=\\frac{R_{high}}{1+Q^2}\\\\[2pt] \\text{T: }R_v=R_{low}\\,(1+Q^2)\\\\[2pt] Q>Q_{min}=\\sqrt{\\frac{R_{high}}{R_{low}}-1}\\end{gathered}', ref: 'Two L-sections back to back', note: 'Each half is an L-section (5.3)/(5.6) to R_v; the two middle elements are combined. Q sets the node Q at the high-resistance end, and bandwidth ≈ f0/Q.' },
  ] },
  { name: 'Double- and triple-stub tuners', eqs: [
    { title: 'Forbidden region', tex: '0\\le g_L\\le\\frac{1+t^2}{t^2}=\\frac{1}{\\sin^2\\beta d},\\qquad t=\\tan\\beta d', ref: 'Pozar (5.21)', note: 'The chart shows the g = 1 circle rotated d toward the load and the shaded region that cannot be matched with this spacing.' },
    { title: 'First-stub susceptance', tex: 'B_1=-B_L+\\frac{Y_0\\pm\\sqrt{(1+t^2)G_LY_0-G_L^2t^2}}{t}', ref: 'Pozar (5.22)' },
    { title: 'Second-stub susceptance', tex: 'B_2=\\frac{\\pm Y_0\\sqrt{Y_0G_L(1+t^2)-G_L^2t^2}+G_LY_0}{G_Lt}', ref: 'Pozar (5.23)', note: 'Stub lengths then follow from (5.24) = (5.11). The app also cascades the result and checks |Γin| = 0.' },
    { title: 'Triple stub', tex: '\\text{choose }B_1:\\ g\\big(y_L+jB_1\\text{ moved by }d\\big)<\\frac{1}{\\sin^2\\beta d}\\ \\Rightarrow\\ \\text{double stub for stubs 2, 3}', ref: 'Extension of §5.3', note: 'The app searches stub-1 lengths and keeps the designs with the shortest total stub length.' },
  ] },
  { name: 'Multisection transformers', eqs: [
    { title: 'Small-reflection theory', tex: '\\begin{gathered}\\Gamma(\\theta)\\approx2e^{-jN\\theta}\\left[\\Gamma_0\\cos N\\theta+\\Gamma_1\\cos(N-2)\\theta+\\cdots\\right]\\\\[2pt] \\Gamma_n\\approx\\tfrac12\\ln\\frac{Z_{n+1}}{Z_n}\\end{gathered}', ref: 'Pozar (5.46), (5.51)' },
    { title: 'Binomial (maximally flat)', tex: '\\begin{gathered}\\ln\\frac{Z_{n+1}}{Z_n}\\approx2^{-N}C_n^N\\ln\\frac{Z_L}{Z_0}\\\\[2pt] \\frac{\\Delta f}{f_0}=2-\\frac{4}{\\pi}\\cos^{-1}\\left[\\frac12\\left(\\frac{\\Gamma_m}{|A|}\\right)^{1/N}\\right]\\end{gathered}', ref: 'Pozar (5.53), (5.55)' },
    { title: 'Chebyshev (equal ripple)', tex: '\\begin{gathered}\\Gamma(\\theta)=Ae^{-jN\\theta}T_N(\\sec\\theta_m\\cos\\theta)\\\\[2pt] \\sec\\theta_m=\\cosh\\left[\\frac1N\\cosh^{-1}\\left(\\frac{1}{2\\Gamma_m}\\left|\\ln\\frac{Z_L}{Z_0}\\right|\\right)\\right]\\\\[2pt] \\frac{\\Delta f}{f_0}=2-\\frac{4\\theta_m}{\\pi}\\end{gathered}', ref: 'Pozar (5.61), (5.63), (5.64)' },
    { title: 'Exact design (Tables 5.1, 5.2)', tex: '\\begin{gathered}\\frac{|\\Gamma|^2}{1-|\\Gamma|^2}=k^2\\cos^{2N}\\theta\\ \\text{or}\\ k^2\\frac{T_N^2(\\sec\\theta_m\\cos\\theta)}{T_N^2(\\sec\\theta_m)}\\\\[2pt] k^2=\\frac{(Z_L-Z_0)^2}{4Z_LZ_0}\\end{gathered}', ref: 'Insertion-loss form; solved numerically', note: 'Binomial exact values match Table 5.1 to 4 digits. Chebyshev N = 2 matches Table 5.2; for N ≥ 3 the app holds the ripple at exactly Γm, while the printed table values have ripple peaks between about 0.045 and 0.049 for Γm = 0.05 (checked by evaluating them), so they differ by under 0.5 %.' },
  ] },
  { name: 'Microstrip (LineCalc)', eqs: [
    { title: 'Static Z0, homogeneous (air) line', tex: 'Z_{01}(u)=\\frac{\\eta_0}{2\\pi}\\ln\\!\\left[\\frac{f(u)}{u}+\\sqrt{1+\\frac{4}{u^2}}\\right],\\ f(u)=6+(2\\pi-6)e^{-(30.666/u)^{0.7528}},\\ u=\\frac{W}{h}', ref: 'Hammerstad & Jensen, IEEE MTT-S 1980 (0.01 ≤ u ≤ 100)',
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; const a = r.analysis; return `u=${n(a.u)},\\ u_r=u+\\Delta u_r=${n(a.u + a.dur)},\\ Z_{01}(u_r)=${n(z01(a.u + a.dur), 3)}\\ \\Omega,\\ \\eta_0=${n(ETA0, 3)}\\ \\Omega`; } },
    { title: 'Static effective permittivity', tex: '\\varepsilon_e=\\frac{\\varepsilon_r+1}{2}+\\frac{\\varepsilon_r-1}{2}\\left(1+\\frac{10}{u}\\right)^{-ab},\\quad a=1+\\tfrac{1}{49}\\ln\\tfrac{u^4+(u/52)^2}{u^4+0.432}+\\tfrac{1}{18.7}\\ln\\!\\left[1+\\left(\\tfrac{u}{18.1}\\right)^3\\right],\\ b=0.564\\left(\\tfrac{\\varepsilon_r-0.9}{\\varepsilon_r+3}\\right)^{0.053}', ref: 'Hammerstad & Jensen 1980 (εr ≤ 128)',
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; const a = r.analysis; return `\\varepsilon_e(u_r)=${n(eeffHJ(a.u + a.dur, s.lineCalc.stackup.er), 5)}`; } },
    { title: 'Finite strip thickness', tex: '\\Delta u_1=\\frac{T}{\\pi}\\ln\\!\\left(1+\\frac{4e}{T\\coth^2\\sqrt{6.517u}}\\right),\\ \\Delta u_r=\\tfrac12\\left(1+\\operatorname{sech}\\sqrt{\\varepsilon_r-1}\\right)\\Delta u_1,\\ T=\\tfrac{t}{h};\\quad Z_0=\\frac{Z_{01}(u_r)}{\\sqrt{\\varepsilon_e(u_r)}},\\ \\varepsilon_{e}(0)=\\varepsilon_e(u_r)\\left[\\frac{Z_{01}(u_1)}{Z_{01}(u_r)}\\right]^2', ref: 'Hammerstad & Jensen 1980 (used here for t/h ≤ 0.2)',
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; const a = r.analysis; return `\\Delta u_1=${n(a.du1, 5)},\\ \\Delta u_r=${n(a.dur, 5)},\\ Z_0(0)=${n(a.z0Static, 3)}\\ \\Omega,\\ \\varepsilon_e(0)=${n(a.eeffStatic, 5)}`; } },
    { title: 'Dispersion of εeff', tex: '\\varepsilon_e(f)=\\varepsilon_r-\\frac{\\varepsilon_r-\\varepsilon_e(0)}{1+P(f)},\\quad P=P_1P_2\\left[(0.1844+P_3P_4)f_n\\right]^{1.5763},\\ f_n=f\\,h\\ [\\text{GHz·mm}]', ref: 'Kirschning & Jansen, Electron. Lett. 1982 (0.1 ≤ u ≤ 100, εr ≤ 20, h/λ0 ≤ 0.13)',
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; const a = r.analysis; return `f_n=${n((s.f0 * s.lineCalc.stackup.h) / 1e6, 4)},\\ \\varepsilon_e(f_0)=${n(a.eeff, 5)}`; } },
    { title: 'Dispersion of Z0', tex: 'Z_0(f)=Z_0(0)\\left(\\frac{R_{13}}{R_{14}}\\right)^{R_{17}},\\ R_{13}=0.9408\\,\\varepsilon_e(f)^{R_8}-0.9603,\\ R_{14}=(0.9408-R_9)\\,\\varepsilon_e(0)^{R_8}-0.9603', ref: 'Jansen & Kirschning, AEÜ 1983 (0.1 ≤ u ≤ 10, εr ≤ 18, fn ≤ 20 GHz·mm)',
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; return `Z_0(f_0)=${n(r.analysis.z0, 4)}\\ \\Omega`; } },
    { title: 'Synthesis by root finding', tex: 'W:\\ Z_0(W,f_0)-Z_{target}=0,\\qquad \\ell:\\ \\beta(f_0)\\,\\ell-\\theta=0', ref: "Brent's method on ln(W/h) ∈ [ln 0.01, ln 100]; analysis and synthesis use the same function",
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; return `W=${n(r.W * 1e3, 5)}\\ \\text{mm}\\Rightarrow Z_0=${n(r.analysis.z0, 6)}\\ \\Omega,\\quad \\ell=${n(r.L * 1e3, 5)}\\ \\text{mm}\\Rightarrow\\theta=${n(r.q.thetaDeg, 4)}^\\circ`; } },
    { title: 'Guided wavelength and electrical length', tex: '\\lambda_g=\\frac{c}{f\\sqrt{\\varepsilon_e(f)}},\\quad \\beta=\\frac{2\\pi}{\\lambda_g},\\quad \\theta=\\beta\\ell', ref: 'Pozar (3.197)',
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; const a = r.analysis; return `\\lambda_g=${n(a.lambdaG * 1e3, 4)}\\ \\text{mm},\\ \\lambda_g/4=${n(a.lambdaG * 250, 4)}\\ \\text{mm},\\ \\theta=${n(r.q.thetaDeg, 3)}^\\circ`; } },
    { title: 'Dielectric loss', tex: '\\alpha_d=\\frac{k_0\\,\\varepsilon_r(\\varepsilon_e-1)\\tan\\delta}{2\\sqrt{\\varepsilon_e}(\\varepsilon_r-1)}\\ \\text{Np/m}', ref: 'Pozar (3.198)',
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; return `\\alpha_d=${n(r.analysis.alphaD * NP_TO_DB / 100, 5)}\\ \\text{dB/cm},\\ \\alpha_d\\ell=${n(r.q.lossDdB, 4)}\\ \\text{dB}`; } },
    { title: 'Conductor loss with roughness', tex: '\\alpha_c=\\frac{R_s K_i K_r}{Z_0 W},\\ R_s=\\sqrt{\\frac{\\omega\\mu_0}{2\\sigma}},\\ \\delta_s=\\frac{1}{\\sqrt{\\pi f\\mu_0\\sigma}},\\ K_i=e^{-1.2(Z_0/\\eta_0)^{0.7}},\\ K_r=1+\\frac{2}{\\pi}\\arctan\\!\\left[1.4\\left(\\frac{\\Delta}{\\delta_s}\\right)^2\\right]', ref: 'Hammerstad & Jensen 1980; roughness: Hammerstad & Bekkadal 1975',
      live: (s) => { const r = lcLine(s); if (!r) return NO_LC; const a = r.analysis; return `\\delta_s=${n(a.skinDepth * 1e6, 3)}\\ \\mu\\text{m},\\ R_s=${n(a.Rs, 5)}\\ \\Omega,\\ K_i=${n(a.Ki)},\\ K_r=${n(a.Kr)},\\ \\alpha_c=${n(a.alphaC * NP_TO_DB / 100, 5)}\\ \\text{dB/cm}`; },
      note: 'K_r only scales conductor loss; it is not applied to Z0 or phase. It saturates at 2 when Δ ≫ δs.' },
    { title: 'Stub ⇄ L/C at f0', tex: '\\text{short: }Z_{in}=jZ_s\\tan\\theta,\\quad \\text{open: }Z_{in}=-jZ_s\\cot\\theta;\\quad \\theta_{sL}=\\arctan\\frac{\\omega L}{Z_s},\\ \\theta_{oC}=\\arctan(\\omega CZ_s),\\ \\theta_{oL}=\\frac{\\pi}{2}+\\arctan\\frac{\\omega L}{Z_s},\\ \\theta_{sC}=\\pi-\\arctan\\frac{1}{\\omega CZ_s}', ref: 'Pozar (2.45c), (2.46c)',
      live: (s) => { const d = lcStub(s); if (!d) return NO_LC; const st = s.lineCalc.stub; const X = targetReactance(st.part, st.values[st.part], s.f0); return `X=${n(X, 3)}\\ \\Omega,\\ Z_s=${n(st.z0, 2)}\\ \\Omega,\\ \\text{${st.term}}\\Rightarrow\\theta=${n(d.thetaDeg, 3)}^\\circ=${n(d.lengthWl, 4)}\\lambda`; } },
    { title: 'Open-end length extension', tex: '\\frac{\\Delta\\ell}{h}=\\frac{\\xi_1\\xi_3\\xi_5}{\\xi_4}\\ \\ \\text{(Kirschning–Jansen–Koster)};\\quad \\text{cf. }\\frac{\\Delta\\ell}{h}=0.412\\frac{\\varepsilon_e+0.3}{\\varepsilon_e-0.258}\\cdot\\frac{W/h+0.262}{W/h+0.813}', ref: 'Kirschning, Jansen & Koster, Electron. Lett. 1981; comparison formula: Pozar Problem 4.30',
      live: (s) => { const d = lcStub(s); if (!d) return NO_LC; const a = d.analysis, st = s.lineCalc.stackup; return `\\Delta\\ell_{KJK}=${n(openEndExtension(a.u + a.dur, st.er, a.eeff, st.h) * 1e3, 4)}\\ \\text{mm},\\quad \\Delta\\ell_{HB}=${n(openEndHB(d.W, st.h, a.eeff) * 1e3, 4)}\\ \\text{mm}`; } },
    { title: 'Quarter-wave transformer', tex: 'Z_t=\\sqrt{Z_sZ_L},\\quad \\ell=\\frac{\\lambda_g}{4}', ref: 'Pozar (2.64)',
      live: (s) => { const q = quarterWaveMicrostrip(s.lineCalc.qw.zs, s.lineCalc.qw.zl, s.lineCalc.stackup, s.f0); if (!q.ok) return NO_LC; return `Z_t=\\sqrt{${n(s.lineCalc.qw.zs, 2)}\\cdot${n(s.lineCalc.qw.zl, 2)}}=${n(q.Zt, 3)}\\ \\Omega\\Rightarrow W=${n(q.W * 1e3, 4)}\\ \\text{mm},\\ \\ell=${n(q.L * 1e3, 4)}\\ \\text{mm}`; } },
  ] },
];

export class EquationsPanel {
  readonly el = h('div', { class: 'panel-body' });
  private visible = false;
  constructor(private store: Store) {
    store.subscribe(() => { if (this.visible) this.render(); });
  }
  setVisible(v: boolean): void { this.visible = v; if (v) this.render(); }

  render(): void {
    const s = this.store.get();
    rebuild(this.el, () => [
      this.liveStep(s),
      ...GROUPS.map((g) => h('section', { class: 'card eq-group' },
        h('h3', {}, g.name),
        ...g.eqs.map((e) => {
          const live = e.live?.(s);
          return h('div', { class: 'eq' },
            h('div', { class: 'eq-head' }, h('span', { class: 'eq-title' }, e.title), h('span', { class: 'eq-ref' }, e.ref)),
            tex(e.tex),
            live ? h('div', { class: 'eq-live' }, h('span', { class: 'eq-live-tag' }, 'live'), tex(live, false)) : null,
            e.note ? h('p', { class: 'hint' }, e.note) : null);
        }))),
      this.paperGuide(),
      h('p', { class: 'hint ref' }, 'Equation numbers refer to D. M. Pozar, Microwave Engineering, 4th ed., Wiley, 2012.'),
    ]);
  }

  /** The algebra of the currently selected network step, with numbers. */
  private liveStep(s: AppState): HTMLElement {
    const d = derive(s);
    const sel = s.selection;
    let body: HTMLElement[] = [h('p', { class: 'hint' }, 'Select a network element to see its operation worked out with live numbers.')];
    if (sel.kind === 'element') {
      const i = s.elements.findIndex((e) => e.id === sel.id);
      const el = s.elements[i];
      if (el) {
        const g0 = d.states[i], g1 = d.states[i + 1];
        const z0 = gammaToZ(g0), z1 = gammaToZ(g1), y0 = gammaToY(g0), y1 = gammaToY(g1);
        const lines: string[] = [];
        if (el.kind.startsWith('series') && el.kind !== 'stub') {
          const ze = lumpedImmittance(el as Parameters<typeof lumpedImmittance>[0], s.f0, s.Z0, s.f0);
          lines.push(`z_{${i + 1}}=z_{${i}}+z_e=(${cx(z0)})+(${cx(ze)})=${cx(z1)}`);
        } else if (el.kind.startsWith('shunt')) {
          const ye = lumpedImmittance(el as Parameters<typeof lumpedImmittance>[0], s.f0, s.Z0, s.f0);
          lines.push(`y_{${i + 1}}=y_{${i}}+y_e=(${cx(y0)})+(${cx(ye)})=${cx(y1)}`, `z_{${i + 1}}=1/y_{${i + 1}}=${cx(z1)}`);
        } else if (el.kind === 'line') {
          const gl = sectionGammaL(el.lengthWl, el.lossDb, s.f0, s.f0);
          if (Math.abs(el.z0 - s.Z0) < 1e-12) {
            lines.push(`\\Gamma_{${i + 1}}=\\Gamma_{${i}}e^{-2\\gamma\\ell}=(${cx(g0)})\\,e^{-2(${n(gl.re, 4)}+j${n(gl.im, 4)})}=${cx(g1)}`,
              `|\\Gamma|:\\ ${n(abs(g0))}\\to${n(abs(g1))},\\quad \\text{rotation}=2\\beta\\ell=${n(2 * deg(gl.im), 2)}^\\circ\\ \\text{clockwise}`);
          } else {
            lines.push(`Z_{in}=Z_1\\frac{Z+Z_1\\tanh\\gamma\\ell}{Z_1+Z\\tanh\\gamma\\ell},\\ Z_1=${n(el.z0, 2)}\\,\\Omega\\ \\Rightarrow\\ z_{${i + 1}}=${cx(z1)}`);
          }
        } else if (el.kind === 'stub') {
          const v = stubImmittance(el, s.f0, s.f0, s.Z0);
          if (el.connection === 'shunt') lines.push(`y_{stub}=${cx(v)},\\quad y_{${i + 1}}=(${cx(y0)})+(${cx(v)})=${cx(y1)}`);
          else lines.push(`z_{stub}=${cx(v)},\\quad z_{${i + 1}}=(${cx(z0)})+(${cx(v)})=${cx(z1)}`);
        } else if (el.kind === 'transformer') {
          lines.push(`z_{${i + 1}}=n^2 z_{${i}}=${n(el.n * el.n)}\\,(${cx(z0)})=${cx(z1)}`);
        }
        const Z1 = mul(z1, c(s.Z0, 0));
        lines.push(`Z_{${i + 1}}=${cx(Z1, 3)}\\ \\Omega,\\quad |\\Gamma_{${i + 1}}|=${n(abs(g1))}`);
        body = lines.map((l) => tex(l, true));
      }
    }
    return h('section', { class: 'card accent-card' }, h('h3', {}, 'Selected step'), ...body);
  }

  private paperGuide(): HTMLElement {
    const steps = [
      ['Plot the load', 'Normalise Z_L by Z0 and place it (type it, or use the Place tool). The point is Γ.'],
      ['Compass → |Γ|, SWR, RL', 'Compass tool: press at the centre (it snaps) and drag to the load (it snaps). The radius is |Γ|; the HUD reads SWR and return loss — the paper chart\'s bottom scales.'],
      ['Protractor → ∠Γ and WTG', 'Protractor tool: drag a radial through the load. Read ∠Γ on the inner ring and the wavelengths-toward-generator position on the outer ring.'],
      ['Rotate by line length', 'Add a Line. Moving toward the generator is a clockwise rotation of 2βℓ on the SWR circle; 0.5λ is one full turn. Draw a second radial to read Δλ between two radials.'],
      ['Z ↔ Y', 'Switch to the ZY grid to read admittance directly, or enable "Paper Y point" to reflect the point through the centre like on a plain impedance chart.'],
      ['Add reactance on the right contour', 'Series L/C moves along the constant-r circle; shunt L/C moves along the constant-g circle. Drag the numbered point to slide along that contour.'],
      ['Check the match', 'The goal is the chart centre. The input readout shows the final VSWR and return loss; the sweep shows bandwidth.'],
    ];
    return h('section', { class: 'card' }, h('h3', {}, 'Paper-chart workflow, digitally'),
      h('ol', { class: 'guide' }, ...steps.map(([t, d]) => h('li', {}, h('strong', {}, t), h('span', {}, d)))));
  }
}
