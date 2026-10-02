/** Equation reference with live substitution of the selected point (KaTeX-rendered). */
import katex from 'katex';
import { type Complex, c, mul, abs, arg, deg } from '../math/complex';
import { gammaToZ, gammaToY, gammaMetrics } from '../math/smith';
import { lumpedImmittance, sectionGammaL, stubImmittance } from '../rf/network';
import type { Store, AppState } from '../state/store';
import { derive } from '../state/derive';
import { h, rebuild } from './dom';
import { selectedPoint } from './panelInspect';

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
    { title: 'Non-ideal inductor (fixed ESR, parallel self-capacitance)', tex: 'R_s=\\frac{\\omega_0L}{Q_0},\\quad C_p=\\frac{1}{\\omega_s^2L},\\quad Z_L=\\frac{R_s+j\\omega L}{1+j\\omega C_p\\,(R_s+j\\omega L)}', ref: 'Component model (v0.2)', note: 'Q grows ∝ f with a fixed ESR; the impedance peaks (parallel resonance) at the SRF f_s = ω_s/2π. Below SRF the effective inductance is L/(1 − (f/f_s)²).' },
    { title: 'Non-ideal capacitor (fixed ESR, series inductance)', tex: 'R_s=\\frac{1}{\\omega_0CQ_0},\\quad L_s=\\frac{1}{\\omega_s^2C},\\quad Z_C=R_s+j\\omega L_s+\\frac{1}{j\\omega C}', ref: 'Component model (v0.2)', note: 'At the SRF the reactance cancels and only the ESR remains; above it the capacitor looks inductive.' },
  ] },
  { name: 'Matching', eqs: [
    { title: 'L-section, z_L inside the r = 1 circle (shunt B first)', tex: 'B=\\frac{X_L\\pm\\sqrt{R_L/Z_0}\\sqrt{R_L^2+X_L^2-Z_0R_L}}{R_L^2+X_L^2},\\quad X=\\frac{1}{B}+\\frac{X_LZ_0}{R_L}-\\frac{Z_0}{BR_L}', ref: 'Pozar (5.3a,b)' },
    { title: 'L-section, z_L outside the r = 1 circle (series X first)', tex: 'X=\\pm\\sqrt{R_L(Z_0-R_L)}-X_L,\\qquad B=\\pm\\frac{\\sqrt{(Z_0-R_L)/R_L}}{Z_0}', ref: 'Pozar (5.6a,b)' },
    { title: 'Shunt single-stub position', tex: 't=\\tan\\beta d=\\frac{X_L\\pm\\sqrt{R_L\\left[(Z_0-R_L)^2+X_L^2\\right]/Z_0}}{R_L-Z_0},\\quad \\frac{d}{\\lambda}=\\begin{cases}\\frac{1}{2\\pi}\\tan^{-1}t & t\\ge0\\\\ \\frac{1}{2\\pi}(\\pi+\\tan^{-1}t)&t<0\\end{cases}', ref: 'Pozar (5.9), (5.10)' },
    { title: 'Stub lengths', tex: '\\frac{\\ell_{oc}}{\\lambda}=\\frac{1}{2\\pi}\\tan^{-1}\\frac{B_s}{Y_0},\\qquad \\frac{\\ell_{sc}}{\\lambda}=-\\frac{1}{2\\pi}\\tan^{-1}\\frac{Y_0}{B_s}\\quad(+\\tfrac{\\lambda}{2}\\text{ if negative})', ref: 'Pozar (5.11a,b); series stubs (5.16a,b)' },
    { title: 'Quarter-wave transformer', tex: 'Z_1=\\sqrt{Z_0R_L}', ref: 'Pozar (2.63)', note: 'For a complex load, first move along the line to a voltage maximum (R = Z0·SWR) or minimum (R = Z0/SWR).' },
  ] },
  { name: 'Pi and T networks', eqs: [
    { title: 'Virtual resistance for a chosen loaded Q', tex: '\\text{Pi: }R_v=\\frac{R_{high}}{1+Q^2},\\qquad \\text{T: }R_v=R_{low}\\,(1+Q^2),\\qquad Q>Q_{min}=\\sqrt{\\frac{R_{high}}{R_{low}}-1}', ref: 'Two L-sections back to back', note: 'Each half is an L-section (5.3)/(5.6) to R_v; the two middle elements are combined. Q sets the node Q at the high-resistance end, and bandwidth ≈ f0/Q.' },
  ] },
  { name: 'Double- and triple-stub tuners', eqs: [
    { title: 'Forbidden region', tex: '0\\le g_L\\le\\frac{1+t^2}{t^2}=\\frac{1}{\\sin^2\\beta d},\\qquad t=\\tan\\beta d', ref: 'Pozar (5.21)', note: 'The chart shows the g = 1 circle rotated d toward the load and the shaded region that cannot be matched with this spacing.' },
    { title: 'First-stub susceptance', tex: 'B_1=-B_L+\\frac{Y_0\\pm\\sqrt{(1+t^2)G_LY_0-G_L^2t^2}}{t}', ref: 'Pozar (5.22)' },
    { title: 'Second-stub susceptance', tex: 'B_2=\\frac{\\pm Y_0\\sqrt{Y_0G_L(1+t^2)-G_L^2t^2}+G_LY_0}{G_Lt}', ref: 'Pozar (5.23)', note: 'Stub lengths then follow from (5.24) = (5.11). The app also cascades the result and checks |Γin| = 0.' },
    { title: 'Triple stub', tex: '\\text{choose }B_1:\\ g\\big(y_L+jB_1\\text{ moved by }d\\big)<\\frac{1}{\\sin^2\\beta d}\\ \\Rightarrow\\ \\text{double stub for stubs 2, 3}', ref: 'Extension of §5.3', note: 'The app searches stub-1 lengths and keeps the designs with the shortest total stub length.' },
  ] },
  { name: 'Multisection transformers', eqs: [
    { title: 'Small-reflection theory', tex: '\\Gamma(\\theta)\\approx2e^{-jN\\theta}\\left[\\Gamma_0\\cos N\\theta+\\Gamma_1\\cos(N-2)\\theta+\\cdots\\right],\\quad \\Gamma_n\\approx\\tfrac12\\ln\\frac{Z_{n+1}}{Z_n}', ref: 'Pozar (5.46), (5.51)' },
    { title: 'Binomial (maximally flat)', tex: '\\ln\\frac{Z_{n+1}}{Z_n}\\approx2^{-N}C_n^N\\ln\\frac{Z_L}{Z_0},\\qquad \\frac{\\Delta f}{f_0}=2-\\frac{4}{\\pi}\\cos^{-1}\\left[\\frac12\\left(\\frac{\\Gamma_m}{|A|}\\right)^{1/N}\\right]', ref: 'Pozar (5.53), (5.55)' },
    { title: 'Chebyshev (equal ripple)', tex: '\\Gamma(\\theta)=Ae^{-jN\\theta}T_N(\\sec\\theta_m\\cos\\theta),\\quad \\sec\\theta_m=\\cosh\\left[\\frac1N\\cosh^{-1}\\left(\\frac{1}{2\\Gamma_m}\\left|\\ln\\frac{Z_L}{Z_0}\\right|\\right)\\right],\\quad \\frac{\\Delta f}{f_0}=2-\\frac{4\\theta_m}{\\pi}', ref: 'Pozar (5.61), (5.63), (5.64)' },
    { title: 'Exact design (Tables 5.1, 5.2)', tex: '\\frac{|\\Gamma|^2}{1-|\\Gamma|^2}=k^2\\cos^{2N}\\theta\\ \\text{or}\\ k^2\\frac{T_N^2(\\sec\\theta_m\\cos\\theta)}{T_N^2(\\sec\\theta_m)},\\quad k^2=\\frac{(Z_L-Z_0)^2}{4Z_LZ_0}', ref: 'Insertion-loss form; solved numerically', note: 'Binomial exact values match Table 5.1 to 4 digits. Chebyshev N = 2 matches Table 5.2; for N ≥ 3 the app holds the ripple at exactly Γm, while the printed table values have ripple peaks between about 0.045 and 0.049 for Γm = 0.05 (checked by evaluating them), so they differ by under 0.5 %.' },
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
