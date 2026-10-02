/**
 * Interactive Smith chart view: SVG grid/annotations + Canvas traces sharing one transform.
 *
 * Coordinates: everything is computed in the Γ plane and mapped to CSS pixels by
 * toPx(). Grid circles are exact (uniform scale), so <circle> and arc paths are drawn
 * from the analytic centres/radii of Pozar (2.56a,b).
 */
import { type Complex, c, abs, arg, sub, neg, deg } from '../math/complex';
import {
  zToGamma, gammaToZ, gammaToY, yToGamma, gammaMetrics, resistanceCircle, conductanceCircle,
  qCircle, wtgFromAngle, wtlFromAngle,
} from '../math/smith';
import { fix } from '../math/units';
import { solveElementToward, isSeries, isShunt, type Element } from '../rf/network';
import { type Store, type AppState, type Construction, newId } from '../state/store';
import { derive, nearestSample } from '../state/derive';
import { PALETTES, type Palette, mix } from './palette';

const MAJOR = [0.2, 0.5, 1, 2, 5];
const MINOR = [0.1, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 1.2, 1.4, 1.6, 1.8, 3, 4, 10, 20];
const FINE = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.1, 1.3, 1.5, 1.7, 1.9, 2.5, 3.5, 4.5, 7, 15, 50];

/** How far along the orthogonal family a line of value v is drawn (classic truncation). */
function truncation(v: number, level: 0 | 1 | 2): number {
  if (level === 0) return Infinity;
  if (level === 1) return v < 1 ? 2 : v <= 2 ? 5 : Infinity;
  return v < 1 ? 1 : v <= 2 ? 2 : 10;
}

type Hit =
  | { kind: 'load' }
  | { kind: 'element'; index: number }
  | { kind: 'marker'; id: string }
  | { kind: 'construction'; id: string };

interface Pending {
  tool: 'compass' | 'protractor' | 'ruler';
  a: Complex;
  b: Complex;
}

export class ChartView {
  readonly root: HTMLElement;
  private svg: SVGSVGElement;
  private svgBase: SVGSVGElement;
  private gStatic: SVGGElement;
  private gDynamic: SVGGElement;
  private canvas: HTMLCanvasElement;
  private hud: HTMLElement;
  private w = 300; private h = 300;
  private view = { cx: 0, cy: 0, zoom: 1 };
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: null | { hit: Hit | 'pan' | 'pinch'; startView: { cx: number; cy: number; zoom: number }; sx: number; sy: number; pinch?: { d: number; mx: number; my: number } } = null;
  private pending: Pending | null = null;
  private hover: Complex | null = null;
  private staticKey = '';
  private raf = 0;
  onCursor: (g: Complex | null) => void = () => {};

  constructor(private store: Store) {
    this.root = document.createElement('div');
    this.root.className = 'chart-wrap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'chart-canvas';
    this.svgBase = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svgBase.setAttribute('class', 'chart-svg chart-base');
    this.svgBase.setAttribute('aria-hidden', 'true');
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'chart-svg chart-top');
    this.svg.setAttribute('role', 'img');
    this.svg.setAttribute('aria-label', 'Interactive Smith chart');
    this.gStatic = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gDynamic = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svgBase.append(this.gStatic);
    this.svg.append(this.gDynamic);
    this.hud = document.createElement('div');
    this.hud.className = 'chart-hud';
    this.hud.setAttribute('aria-live', 'polite');
    // grid (bottom) → canvas traces → annotations + pointer target (top)
    this.root.append(this.svgBase, this.canvas, this.svg, this.hud);
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(this.root);
    store.subscribe(() => this.schedule());
  }

  /* ---------------- transforms ---------------- */
  private get scaleBase(): number {
    const margin = this.store.get().overlays.scales ? 46 : 14;
    return Math.max(40, Math.min(this.w, this.h) / 2 - margin);
  }
  private get s(): number { return this.scaleBase * this.view.zoom; }
  toPx(g: Complex): [number, number] {
    return [this.w / 2 + (g.re - this.view.cx) * this.s, this.h / 2 - (g.im - this.view.cy) * this.s];
  }
  fromPx(x: number, y: number): Complex {
    return c((x - this.w / 2) / this.s + this.view.cx, -(y - this.h / 2) / this.s + this.view.cy);
  }
  resetView(): void { this.view = { cx: 0, cy: 0, zoom: 1 }; this.schedule(); }
  zoomBy(k: number, px = this.w / 2, py = this.h / 2): void {
    const before = this.fromPx(px, py);
    this.view.zoom = Math.max(0.5, Math.min(60, this.view.zoom * k));
    const after = this.fromPx(px, py);
    this.view.cx += before.re - after.re;
    this.view.cy += before.im - after.im;
    this.schedule();
  }

  private resize(): void {
    const r = this.root.getBoundingClientRect();
    this.w = Math.max(100, r.width); this.h = Math.max(100, r.height);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
    for (const sv of [this.svg, this.svgBase]) {
      sv.setAttribute('viewBox', `0 0 ${this.w} ${this.h}`);
      sv.setAttribute('width', String(this.w)); sv.setAttribute('height', String(this.h));
    }
    this.staticKey = '';
    this.render();
  }

  schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  }

  private get pal(): Palette { return PALETTES[this.store.get().theme]; }

  /* ---------------- rendering ---------------- */
  render(): void {
    const st = this.store.get();
    const key = [this.w, this.h, this.view.cx, this.view.cy, this.view.zoom, st.gridMode, st.theme, st.overlays.scales, st.overlays.labels, st.overlays.qCircle, st.overlays.matchCircles].join('|');
    if (key !== this.staticKey) {
      this.gStatic.innerHTML = this.buildStatic(st);
      this.staticKey = key;
    }
    this.gDynamic.innerHTML = this.buildDynamic(st);
    this.drawTraces(st);
    this.updateHud(st);
  }

  /** Full self-contained SVG for export (grid + annotations + traces as polylines). */
  exportSVG(): string {
    const st = this.store.get();
    const p = this.pal;
    const traces = this.buildTraceSvg(st);
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}" font-family="Geist, Inter, system-ui, sans-serif">
<title>Smith chart — Z0 = ${st.Z0} Ω, f0 = ${st.f0} Hz</title>
<desc>Exported from Browser Smith Chart. Grid mode ${st.gridMode}. ${st.elements.length} network elements.</desc>
<rect width="100%" height="100%" fill="${p.bg}"/>
${this.buildStatic(st)}${traces}${this.buildDynamic(st, true)}
</svg>`;
  }

  private circleEl(cx: number, cy: number, r: number, stroke: string, width = 1, extra = ''): string {
    const [x, y] = this.toPx(c(cx, cy));
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(r * this.s).toFixed(2)}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
  }

  /** Arc on a circle (Γ-plane centre/radius) from A to B passing through M. */
  private arcPath(C: { cx: number; cy: number; r: number }, A: Complex, B: Complex, M: Complex): string {
    const ang = (p: Complex) => Math.atan2(p.im - C.cy, p.re - C.cx);
    const tA = ang(A), tB = ang(B), tM = ang(M);
    const TAU = 2 * Math.PI;
    const span = (((tB - tA) % TAU) + TAU) % TAU;
    const mPos = (((tM - tA) % TAU) + TAU) % TAU;
    const ccw = mPos < span;
    const used = ccw ? span : TAU - span;
    const [ax, ay] = this.toPx(A), [bx, by] = this.toPx(B);
    const R = C.r * this.s;
    // Γ-plane counter-clockwise is clockwise on screen (y flipped) → sweep-flag 0
    return `M${ax.toFixed(2)} ${ay.toFixed(2)}A${R.toFixed(2)} ${R.toFixed(2)} 0 ${used > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${bx.toFixed(2)} ${by.toFixed(2)}`;
  }

  /** Paths for one grid family (Z family; Y family = Γ negated). */
  private familyPaths(values: number[], level: 0 | 1 | 2, mirror: boolean): { r: string; x: string } {
    const map = (g: Complex) => (mirror ? neg(g) : g);
    let rp = '', xp = '';
    for (const v of values) {
      const lim = truncation(v, level);
      // constant-resistance (or conductance) circle, limited to |x| ≤ lim
      const C = resistanceCircle(v);
      const Cm = mirror ? { cx: -C.cx, cy: 0, r: C.r } : C;
      if (!Number.isFinite(lim)) {
        const [x, y] = this.toPx(c(Cm.cx, Cm.cy));
        rp += `M${(x - Cm.r * this.s).toFixed(2)} ${y.toFixed(2)}a${(Cm.r * this.s).toFixed(2)} ${(Cm.r * this.s).toFixed(2)} 0 1 0 ${(2 * Cm.r * this.s).toFixed(2)} 0a${(Cm.r * this.s).toFixed(2)} ${(Cm.r * this.s).toFixed(2)} 0 1 0 ${(-2 * Cm.r * this.s).toFixed(2)} 0`;
      } else {
        rp += this.arcPath(Cm, map(zToGamma(c(v, -lim))), map(zToGamma(c(v, lim))), map(zToGamma(c(v, 0))));
      }
      // constant-reactance (or susceptance) arcs ±v, limited to r ≤ lim
      for (const sgn of [1, -1]) {
        const x = sgn * v;
        const Cx = { cx: 1, cy: 1 / x, r: 1 / Math.abs(x) };
        const Cxm = mirror ? { cx: -1, cy: -1 / x, r: Cx.r } : Cx;
        const A = map(zToGamma(c(0, x)));
        const B = Number.isFinite(lim) ? map(zToGamma(c(lim, x))) : map(c(1, 0));
        const M = map(zToGamma(c(Number.isFinite(lim) ? lim / 2 : 1, x)));
        xp += this.arcPath(Cxm, A, B, M);
      }
    }
    return { r: rp, x: xp };
  }

  private buildStatic(st: AppState): string {
    const p = this.pal;
    const s = this.s;
    const [ox, oy] = this.toPx(c(0, 0));
    const R = s;
    const level = s < 150 ? 0 : s < 300 ? 1 : 2;
    const showZ = st.gridMode !== 'Y';
    const showY = st.gridMode !== 'Z';
    const zStrong = st.gridMode === 'Z' || st.gridMode === 'ZY';
    const yStrong = st.gridMode === 'Y' || st.gridMode === 'YZ';
    let out = `<defs><clipPath id="disk"><circle cx="${ox}" cy="${oy}" r="${R}"/></clipPath></defs>`;
    out += `<circle cx="${ox}" cy="${oy}" r="${R}" fill="${p.disk}"/>`;
    out += `<g clip-path="url(#disk)" fill="none" stroke-linecap="round">`;

    const fam = (mirror: boolean, strong: boolean, majorC: string, minorC: string, faintC: string) => {
      let g = '';
      const sets: Array<[number[], 0 | 1 | 2, string, number]> = strong
        ? [[MAJOR, 0, majorC, 1.1], ...(level >= 1 ? [[MINOR, 1, minorC, 0.8] as [number[], 1, string, number]] : []), ...(level >= 2 ? [[FINE, 2, minorC, 0.6] as [number[], 2, string, number]] : [])]
        : [[MAJOR, 0, faintC, 0.9], ...(level >= 1 ? [[MINOR, 1, faintC, 0.6] as [number[], 1, string, number]] : [])];
      for (const [vals, lv, col, wdt] of sets) {
        const fp = this.familyPaths(vals, lv, mirror);
        g += `<path d="${fp.r}${fp.x}" stroke="${col}" stroke-width="${wdt}"/>`;
      }
      return g;
    };
    // draw the weaker family first
    if (showY && !yStrong) out += fam(true, false, p.yMajor, p.yMinor, p.yFaint);
    if (showZ && !zStrong) out += fam(false, false, p.zMajor, p.zMinor, p.zFaint);
    if (showY && yStrong) out += fam(true, true, p.yMajor, p.yMinor, p.yFaint);
    if (showZ && zStrong) out += fam(false, true, p.zMajor, p.zMinor, p.zFaint);

    // match guides: r = 1 circle and g = 1 circle
    if (st.overlays.matchCircles) {
      const r1 = resistanceCircle(1), g1 = conductanceCircle(1);
      out += this.circleEl(r1.cx, r1.cy, r1.r, p.guide, 1.6, 'stroke-dasharray="6 4"');
      out += this.circleEl(g1.cx, g1.cy, g1.r, p.guide, 1.6, 'stroke-dasharray="2 4"');
    }
    if (st.overlays.qCircle > 0) {
      for (const up of [true, false]) {
        const q = qCircle(st.overlays.qCircle, up);
        // only the arc in the matching half-plane is meaningful
        const A = c(-1, 0), B = c(1, 0), M = zToGamma(c(1, (up ? 1 : -1) * st.overlays.qCircle));
        out += `<path d="${this.arcPath(q, A, B, M)}" stroke="${p.construct}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
      }
    }
    out += `</g>`;
    // real axis + rim
    const [lx, ly] = this.toPx(c(-1, 0)), [rx] = this.toPx(c(1, 0));
    out += `<line x1="${lx}" y1="${ly}" x2="${rx}" y2="${ly}" stroke="${p.axis}" stroke-width="1"/>`;
    out += `<circle cx="${ox}" cy="${oy}" r="${R}" fill="none" stroke="${p.rim}" stroke-width="1.6"/>`;

    if (st.overlays.labels) out += this.buildLabels(st, level);
    if (st.overlays.scales) out += this.buildScales();
    return out;
  }

  private buildLabels(st: AppState, level: number): string {
    const p = this.pal;
    const primaryY = st.gridMode === 'Y' || st.gridMode === 'YZ';
    const vals = level >= 2 ? [...MAJOR, 0.1, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 1.2, 1.4, 1.6, 1.8, 3, 4, 10, 20] : level >= 1 ? [...MAJOR, 0.1, 0.3, 3, 10] : MAJOR;
    const fs = 10;
    let out = `<g font-size="${fs}" fill="${p.label}" font-family="'JetBrains Mono Variable', ui-monospace, monospace" paint-order="stroke" stroke="${p.halo}" stroke-width="3" stroke-linejoin="round">`;
    const map = (g: Complex) => (primaryY ? neg(g) : g);
    for (const v of vals) {
      // r (or g) label on the real axis
      const [x, y] = this.toPx(map(zToGamma(c(v, 0))));
      if (x > 0 && x < this.w && y > 0 && y < this.h) {
        out += `<text x="${(x + (primaryY ? 3 : -3)).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="${primaryY ? 'start' : 'end'}">${fmtGrid(v)}</text>`;
      }
      // ±x (or ±b) labels just inside the rim
      for (const sgn of [1, -1]) {
        const g = map(zToGamma(c(0, sgn * v)));
        const [gx, gy] = this.toPx(c(g.re * 0.93, g.im * 0.93));
        if (gx < 0 || gx > this.w || gy < 0 || gy > this.h) continue;
        const sign = primaryY ? (sgn > 0 ? '+j' : '−j') : (sgn > 0 ? '+j' : '−j');
        out += `<text x="${gx.toFixed(1)}" y="${(gy + 3.5).toFixed(1)}" text-anchor="middle" fill="${p.labelDim}">${sign}${fmtGrid(v)}</text>`;
      }
    }
    const [x0, y0] = this.toPx(c(0, 0));
    out += `<text x="${(x0 + 3).toFixed(1)}" y="${(y0 - 3).toFixed(1)}">1</text>`;
    out += `</g>`;
    return out;
  }

  /** Outer rings: angle of Γ (degrees) and wavelengths toward the generator. */
  private buildScales(): string {
    const p = this.pal;
    const s = this.s;
    const [ox, oy] = this.toPx(c(0, 0));
    const r0 = s, r1 = s + 16, r2 = s + 34;
    let ticks = '';
    let text = '';
    const pt = (r: number, a: number): [number, number] => [ox + r * Math.cos(a), oy - r * Math.sin(a)];
    const small = s < 150;
    for (let d = -175; d <= 180; d += 5) {
      const a = (d * Math.PI) / 180;
      const len = d % 30 === 0 ? 6 : 3;
      const [x1, y1] = pt(r0, a), [x2, y2] = pt(r0 + len, a);
      ticks += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
      if (d % (small ? 90 : 30) === 0) {
        const [tx, ty] = pt(r0 + 11, a);
        text += `<text x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}">${d === 180 ? '±180' : d}</text>`;
      }
    }
    for (let k = 0; k < 50; k++) {
      const w = k / 100; // wavelengths toward generator
      const a = ((180 - 720 * w) * Math.PI) / 180;
      const len = k % 5 === 0 ? 6 : 3;
      const [x1, y1] = pt(r1, a), [x2, y2] = pt(r1 + len, a);
      ticks += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
      if (k % (small ? 25 : 5) === 0) {
        const [tx, ty] = pt(r1 + 12, a);
        text += `<text x="${tx.toFixed(1)}" y="${(ty + 3).toFixed(1)}">${w.toFixed(2).replace(/^0/, '')}</text>`;
      }
    }
    return `<g fill="none"><circle cx="${ox}" cy="${oy}" r="${r1}" stroke="${p.ring}" stroke-width="0.8"/><circle cx="${ox}" cy="${oy}" r="${r2}" stroke="${p.ring}" stroke-width="0.8"/><path d="${ticks}" stroke="${p.ring}" stroke-width="1"/></g>`
      + `<g font-size="9" fill="${p.ringText}" text-anchor="middle" font-family="'JetBrains Mono Variable', ui-monospace, monospace">${text}</g>`
      + (small ? '' : `<g font-size="9" fill="${p.labelDim}" font-family="Geist Variable, system-ui, sans-serif"><text x="${ox + (r2 + 4) * Math.cos(1.25)}" y="${oy - (r2 + 4) * Math.sin(1.25)}">WTG ↻</text><text x="${ox + (r0 + 4) * Math.cos(0.32)}" y="${oy - (r0 + 4) * Math.sin(0.32)}" text-anchor="start">∠Γ°</text></g>`);
  }

  private dot(g: Complex, r: number, fill: string, stroke: string, extra = ''): string {
    const [x, y] = this.toPx(g);
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" ${extra}/>`;
  }
  private label(g: Complex, text: string, color: string, dx = 9, dy = -9, size = 11): string {
    const [x, y] = this.toPx(g);
    return `<text x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" font-size="${size}" fill="${color}" paint-order="stroke" stroke="${this.pal.halo}" stroke-width="3" stroke-linejoin="round" font-weight="600">${esc(text)}</text>`;
  }
  private polyline(pts: Complex[], color: string, width: number, extra = ''): string {
    if (pts.length < 2) return '';
    let d = '';
    pts.forEach((g, i) => { const [x, y] = this.toPx(g); d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`; });
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  }

  private elementColor(el: Element): string {
    const p = this.pal;
    if (isSeries(el.kind) || (el.kind === 'stub' && el.connection === 'series')) return p.series;
    if (isShunt(el.kind) || el.kind === 'stub') return p.shunt;
    if (el.kind === 'line') return p.line;
    return p.transformer;
  }

  private buildDynamic(st: AppState, forExport = false): string {
    const p = this.pal;
    const d = derive(st);
    let out = '';
    const sel = st.selection;

    // reading aid: r and x circles through the hover point
    if (this.hover && !forExport && abs(this.hover) <= 1.0001) {
      const z = gammaToZ(this.hover);
      if (Number.isFinite(z.re)) {
        const primaryY = st.gridMode === 'Y' || st.gridMode === 'YZ';
        const v = primaryY ? gammaToY(this.hover) : z;
        const C = primaryY ? conductanceCircle(v.re) : resistanceCircle(v.re);
        out += `<g clip-path="url(#disk)">${this.circleEl(C.cx, C.cy, C.r, p.hover, 1.4)}`;
        if (Math.abs(v.im) > 1e-6) {
          const Cx = primaryY ? { cx: -1, cy: -1 / v.im, r: 1 / Math.abs(v.im) } : { cx: 1, cy: 1 / v.im, r: 1 / Math.abs(v.im) };
          out += this.circleEl(Cx.cx, Cx.cy, Cx.r, p.hover, 1.4);
        }
        out += `</g>`;
      }
    }

    // constructions
    out += this.buildConstructions(st, forExport);

    // VSWR circles
    if (st.overlays.vswrCircle) {
      const rl = abs(d.states[0]);
      if (rl > 1e-4) out += this.circleEl(0, 0, rl, p.vswr, 1.2, 'stroke-dasharray="4 4"');
      const ri = abs(d.input);
      if (st.elements.length && Math.abs(ri - rl) > 1e-4 && ri > 1e-4) out += this.circleEl(0, 0, ri, p.guide, 1.2, 'stroke-dasharray="4 4"');
    }

    // selected element's guiding contour (full circle through its start point)
    if (sel.kind === 'element') {
      const i = st.elements.findIndex((e) => e.id === sel.id);
      if (i >= 0) out += this.contourFor(st.elements[i], d.states[i]);
    }

    // design path
    d.paths.forEach((path, i) => {
      const el = st.elements[i];
      const col = this.elementColor(el);
      const selected = sel.kind === 'element' && sel.id === el.id;
      out += this.polyline(path, col, selected ? 4 : 2.6, el.kind === 'line' || el.kind === 'stub' ? '' : '');
      // arrow at the middle of the path, pointing toward the generator
      const m = Math.floor(path.length / 2);
      if (path.length > 3) out += this.arrow(path[m - 1], path[m + 1], col);
    });
    d.states.slice(1).forEach((g, i) => {
      const el = st.elements[i];
      const selected = sel.kind === 'element' && sel.id === el.id;
      const isLast = i === st.elements.length - 1;
      out += this.dot(g, selected ? 7 : 5.5, isLast ? p.input : this.elementColor(el), p.halo, `data-hit="el:${i}"`);
      out += this.label(g, isLast ? `${i + 1} · IN` : `${i + 1}`, isLast ? p.input : this.elementColor(el));
    });

    // paper-method admittance point (reflect through the centre)
    if (st.overlays.paperY) {
      const g = sel.kind === 'element'
        ? d.states[Math.max(0, st.elements.findIndex((e) => e.id === sel.id) + 1)]
        : sel.kind === 'input' ? d.input : d.states[0];
      const yg = neg(g);
      const [x1, y1] = this.toPx(g), [x2, y2] = this.toPx(yg);
      out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${p.labelDim}" stroke-width="1" stroke-dasharray="3 3"/>`;
      out += this.dot(yg, 5, 'none', p.shunt);
      out += this.label(yg, 'y (read on Z grid)', p.shunt, 9, 14, 10);
    }

    // load point
    out += this.dot(d.states[0], sel.kind === 'load' ? 8 : 7, p.load, p.halo, 'data-hit="load"');
    out += this.label(d.states[0], 'Z_L', p.load, 10, 16);

    // markers
    st.markers.forEach((m, idx) => {
      const tr = d.traces.find((t) => t.trace.id === m.traceId);
      if (!tr || !tr.trace.visible) return;
      const k = nearestFreqIndex(tr.trace.freqs, m.f);
      const g = tr.applied ? tr.applied[k] : tr.gamma[k];
      const [x, y] = this.toPx(g);
      const selected = sel.kind === 'marker' && sel.id === m.id;
      out += `<path d="M${x} ${y - 9}l6 9l-6 9l-6 -9z" fill="${p.marker}" stroke="${p.halo}" stroke-width="${selected ? 3 : 1.5}"/>`;
      out += this.label(g, `M${idx + 1}`, p.marker, 9, -8, 10.5);
    });

    // in-progress tool preview
    if (this.pending && !forExport) out += this.buildPending(this.pending);
    return out;
  }

  private arrow(a: Complex, b: Complex, color: string): string {
    const [x1, y1] = this.toPx(a), [x2, y2] = this.toPx(b);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const L = 7;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const p1 = [mx - L * Math.cos(ang - 0.45), my - L * Math.sin(ang - 0.45)];
    const p2 = [mx - L * Math.cos(ang + 0.45), my - L * Math.sin(ang + 0.45)];
    return `<path d="M${p1[0].toFixed(1)} ${p1[1].toFixed(1)}L${mx.toFixed(1)} ${my.toFixed(1)}L${p2[0].toFixed(1)} ${p2[1].toFixed(1)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`;
  }

  private contourFor(el: Element, g: Complex): string {
    const p = this.pal;
    const z = gammaToZ(g), y = gammaToY(g);
    let C: { cx: number; cy: number; r: number } | null = null;
    switch (el.kind) {
      case 'seriesL': case 'seriesC': if (Number.isFinite(z.re)) C = resistanceCircle(z.re); break;
      case 'seriesR': if (Number.isFinite(z.im) && Math.abs(z.im) > 1e-9) C = { cx: 1, cy: 1 / z.im, r: 1 / Math.abs(z.im) }; break;
      case 'shuntL': case 'shuntC': if (Number.isFinite(y.re)) C = conductanceCircle(y.re); break;
      case 'shuntR': if (Number.isFinite(y.im) && Math.abs(y.im) > 1e-9) C = { cx: -1, cy: -1 / y.im, r: 1 / Math.abs(y.im) }; break;
      case 'stub': C = el.connection === 'shunt' ? (Number.isFinite(y.re) ? conductanceCircle(y.re) : null) : (Number.isFinite(z.re) ? resistanceCircle(z.re) : null); break;
      case 'line': if (Math.abs(el.z0 - this.store.get().Z0) < 1e-9) C = { cx: 0, cy: 0, r: abs(g) }; break;
      default: break;
    }
    return C ? `<g clip-path="url(#disk)">${this.circleEl(C.cx, C.cy, C.r, p.construct, 1.2, 'stroke-dasharray="2 3" opacity="0.8"')}</g>` : '';
  }

  private buildConstructions(st: AppState, forExport: boolean): string {
    const p = this.pal;
    let out = '';
    const radials: number[] = [];
    for (const k of st.constructions) {
      const selected = st.selection.kind === 'construction' && st.selection.id === k.id;
      const w = selected ? 2.4 : 1.5;
      if (k.type === 'circle') {
        out += this.circleEl(k.cx, k.cy, k.r, p.construct, w, `data-hit="c:${k.id}"`);
        out += this.dot(c(k.cx, k.cy), 2.5, p.construct, 'none');
        if (selected || forExport) {
          const atCenter = Math.hypot(k.cx, k.cy) < 1e-6;
          out += this.label(c(k.cx + k.r * 0.707, k.cy + k.r * 0.707), atCenter ? `|Γ| ${fix(k.r, 3)} · SWR ${fix(gammaMetrics(c(k.r, 0)).vswr, 2)}` : `r ${fix(k.r, 3)}`, p.constructText, 4, -4, 10.5);
        }
      } else if (k.type === 'radial') {
        radials.push(k.angle);
        const [x0, y0] = this.toPx(c(0, 0));
        const R = this.s + (st.overlays.scales ? 34 : 6);
        const x1 = x0 + R * Math.cos(k.angle), y1 = y0 - R * Math.sin(k.angle);
        out += `<line x1="${x0}" y1="${y0}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${p.construct}" stroke-width="${w}" data-hit="c:${k.id}"/>`;
        const dg = deg(k.angle);
        out += `<text x="${(x0 + (R - 40) * Math.cos(k.angle)).toFixed(1)}" y="${(y0 - (R - 40) * Math.sin(k.angle) - 6).toFixed(1)}" font-size="10.5" fill="${p.constructText}" paint-order="stroke" stroke="${p.halo}" stroke-width="3" text-anchor="middle">${fix(dg, 1)}° · ${fix(wtgFromAngle(dg), 3)}λ</text>`;
      } else {
        const A = c(k.ax, k.ay), B = c(k.bx, k.by);
        out += this.polyline([A, B], p.construct, w, `data-hit="c:${k.id}"`);
        out += this.dot(A, 2.5, p.construct, 'none') + this.dot(B, 2.5, p.construct, 'none');
        out += this.label(c((k.ax + k.bx) / 2, (k.ay + k.by) / 2), `${fix(abs(sub(B, A)), 3)}`, p.constructText, 6, -6, 10.5);
      }
    }
    // Δ between the last two radials (toward generator = clockwise)
    if (radials.length >= 2) {
      const a1 = radials[radials.length - 2], a2 = radials[radials.length - 1];
      const dl = ((wtgFromAngle(deg(a2)) - wtgFromAngle(deg(a1))) % 0.5 + 0.5) % 0.5;
      const r = 0.35;
      const A = c(r * Math.cos(a1), r * Math.sin(a1)), B = c(r * Math.cos(a2), r * Math.sin(a2));
      const midA = a1 - (dl * 4 * Math.PI) / 2;
      const M = c(r * Math.cos(midA), r * Math.sin(midA));
      out += `<path d="${this.arcPath({ cx: 0, cy: 0, r }, A, B, M)}" fill="none" stroke="${p.construct}" stroke-width="1.4" stroke-dasharray="3 2"/>`;
      out += this.label(c(M.re * 1.15, M.im * 1.15), `Δ ${fix(dl, 3)}λ WTG`, p.constructText, -24, 4, 10.5);
    }
    return out;
  }

  private buildPending(pd: Pending): string {
    const p = this.pal;
    if (pd.tool === 'compass') {
      const r = abs(sub(pd.b, pd.a));
      return this.circleEl(pd.a.re, pd.a.im, r, p.construct, 1.6, 'stroke-dasharray="5 3"') + this.polyline([pd.a, pd.b], p.construct, 1, 'stroke-dasharray="2 2"') + this.dot(pd.a, 3, p.construct, 'none');
    }
    if (pd.tool === 'ruler') return this.polyline([pd.a, pd.b], p.construct, 1.6) + this.dot(pd.a, 3, p.construct, 'none') + this.dot(pd.b, 3, p.construct, 'none');
    const ang = arg(pd.b);
    const [x0, y0] = this.toPx(c(0, 0));
    const R = this.s + 34;
    return `<line x1="${x0}" y1="${y0}" x2="${x0 + R * Math.cos(ang)}" y2="${y0 - R * Math.sin(ang)}" stroke="${p.construct}" stroke-width="1.6" stroke-dasharray="5 3"/>`;
  }

  /* ---------------- canvas traces ---------------- */
  private traceList(st: AppState): Array<{ pts: Complex[]; c0: string; c1: string; dash: number[]; width: number; label?: [string, string] }> {
    const p = this.pal;
    const d = derive(st);
    const list: Array<{ pts: Complex[]; c0: string; c1: string; dash: number[]; width: number; label?: [string, string] }> = [];
    d.traces.forEach((t, i) => {
      if (!t.trace.visible) return;
      const fmt = (f: number) => fmtFreq(f);
      const [c0, c1] = i % 2 === 0 ? [p.traceA, p.traceB] : [p.traceB, p.traceA];
      list.push({ pts: t.gamma, c0, c1, dash: [], width: t.trace.id === st.activeTraceId ? 2.4 : 1.6, label: [fmt(t.trace.freqs[0]), fmt(t.trace.freqs[t.trace.freqs.length - 1])] });
      if (t.applied) list.push({ pts: t.applied, c0: p.applied, c1: p.applied, dash: [6, 4], width: 2.2 });
    });
    if (d.sweep) {
      list.push({ pts: d.sweep.gammaLoad, c0: p.load, c1: p.load, dash: [2, 3], width: 1.4 });
      list.push({ pts: d.sweep.gamma, c0: p.traceA, c1: p.traceB, dash: [], width: 2.2, label: [fmtFreq(d.sweep.freqs[0]), fmtFreq(d.sweep.freqs[d.sweep.freqs.length - 1])] });
    }
    return list;
  }

  private drawTraces(st: AppState): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const t of this.traceList(st)) {
      const n = t.pts.length;
      if (n < 2) continue;
      ctx.setLineDash(t.dash);
      ctx.lineWidth = t.width;
      const segs = Math.min(64, n - 1);
      for (let sIdx = 0; sIdx < segs; sIdx++) {
        const i0 = Math.floor((sIdx * (n - 1)) / segs), i1 = Math.floor(((sIdx + 1) * (n - 1)) / segs);
        ctx.strokeStyle = t.c0 === t.c1 ? t.c0 : mix(t.c0, t.c1, sIdx / Math.max(1, segs - 1));
        ctx.beginPath();
        for (let i = i0; i <= i1; i++) {
          const [x, y] = this.toPx(t.pts[i]);
          if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      if (t.label) {
        ctx.setLineDash([]);
        ctx.font = '10px "JetBrains Mono Variable", monospace';
        ctx.fillStyle = t.c0;
        const [x0, y0] = this.toPx(t.pts[0]);
        ctx.beginPath(); ctx.arc(x0, y0, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillText(t.label[0], x0 + 5, y0 + 12);
        const [x1, y1] = this.toPx(t.pts[n - 1]);
        ctx.fillStyle = t.c1;
        ctx.beginPath(); ctx.arc(x1, y1, 3, 0, 2 * Math.PI); ctx.fill();
        ctx.fillText(t.label[1], x1 + 5, y1 + 12);
      }
    }
    ctx.setLineDash([]);
  }

  private buildTraceSvg(st: AppState): string {
    let out = '';
    for (const t of this.traceList(st)) {
      out += this.polyline(t.pts, t.c0, t.width, t.dash.length ? `stroke-dasharray="${t.dash.join(' ')}"` : '');
    }
    return out;
  }

  /* ---------------- HUD ---------------- */
  private updateHud(st: AppState): void {
    const pd = this.pending;
    let txt = '';
    if (pd?.tool === 'compass') {
      const r = abs(sub(pd.b, pd.a));
      const atCenter = abs(pd.a) < 1e-9;
      txt = atCenter
        ? `Compass at centre · |Γ| = ${fix(r, 4)} · SWR ${fix(gammaMetrics(c(r, 0)).vswr, 3)} · RL ${fix(-20 * Math.log10(r), 2)} dB`
        : `Compass · radius ${fix(r, 4)} (Γ units)`;
    } else if (pd?.tool === 'protractor') {
      const a = deg(arg(pd.b));
      txt = `Protractor · ∠Γ = ${fix(a, 2)}° · WTG ${fix(wtgFromAngle(a), 4)}λ · WTL ${fix(wtlFromAngle(a), 4)}λ`;
    } else if (pd?.tool === 'ruler') {
      txt = `Dividers · |ΔΓ| = ${fix(abs(sub(pd.b, pd.a)), 4)}`;
    } else {
      const hints: Record<string, string> = {
        select: 'Drag the load or any numbered point along its contour · drag empty space to pan',
        place: 'Tap to place the load',
        compass: 'Press at the centre (snaps) and drag to set the radius',
        protractor: 'Press and drag to place a radial line; two radials show Δλ',
        ruler: 'Press and drag to measure a distance in the Γ plane',
      };
      txt = hints[st.tool];
    }
    this.hud.textContent = txt;
  }

  /* ---------------- pointer interaction ---------------- */
  private localXY(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.svg.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private hitTest(x: number, y: number, touch: boolean): Hit | null {
    const st = this.store.get();
    const d = derive(st);
    const tol = touch ? 26 : 16;
    let best: Hit | null = null, bd = tol * tol;
    const test = (g: Complex, h: Hit) => {
      const [px, py] = this.toPx(g);
      const dd = (px - x) ** 2 + (py - y) ** 2;
      if (dd <= bd) { bd = dd; best = h; }
    };
    st.markers.forEach((m) => {
      const tr = d.traces.find((t) => t.trace.id === m.traceId);
      if (!tr || !tr.trace.visible) return;
      const k = nearestFreqIndex(tr.trace.freqs, m.f);
      test(tr.applied ? tr.applied[k] : tr.gamma[k], { kind: 'marker', id: m.id });
    });
    d.states.slice(1).forEach((g, i) => test(g, { kind: 'element', index: i }));
    test(d.states[0], { kind: 'load' });
    return best;
  }

  /** Snap a Γ-plane point according to the snap mode and design points. */
  private snapPoint(g: Complex, mode: AppState['snap'], extraPoints: Complex[] = []): Complex {
    const tolPx = 14;
    const tol = tolPx / this.s;
    // design points and the chart centre always attract tools
    for (const p of [c(0, 0), ...extraPoints]) if (abs(sub(p, g)) < tol) return p;
    if (mode === 'off') return g;
    if (mode === 'grid') {
      const st = this.store.get();
      const primaryY = st.gridMode === 'Y' || st.gridMode === 'YZ';
      const v = primaryY ? gammaToY(g) : gammaToZ(g);
      if (!Number.isFinite(v.re)) return g;
      const step = (a: number) => { const m = Math.abs(a); return m < 0.2 ? 0.02 : m < 1 ? 0.05 : m < 2 ? 0.1 : m < 5 ? 0.5 : 1; };
      const rnd = (a: number) => Math.round(a / step(a)) * step(a);
      const sv = c(Math.max(0, rnd(v.re)), rnd(v.im));
      const sg = primaryY ? yToGamma(sv) : zToGamma(sv);
      return abs(sub(sg, g)) < tol * 1.4 ? sg : g;
    }
    // guides: r = 1, g = 1, unit circle, real axis, construction circles
    const circles = [resistanceCircle(1), conductanceCircle(1), { cx: 0, cy: 0, r: 1 },
      ...this.store.get().constructions.filter((k): k is Extract<Construction, { type: 'circle' }> => k.type === 'circle')];
    let best = g, bd = tol;
    for (const C of circles) {
      const dx = g.re - C.cx, dy = g.im - C.cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-12) continue;
      const err = Math.abs(dist - C.r);
      if (err < bd) { bd = err; best = c(C.cx + (dx / dist) * C.r, C.cy + (dy / dist) * C.r); }
    }
    if (Math.abs(g.im) < bd) best = c(g.re, 0);
    return best;
  }

  private designPoints(): Complex[] { return derive(this.store.get()).states; }

  private bindPointer(): void {
    const el = this.svg;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const [x, y] = this.localXY(e);
      this.pointers.set(e.pointerId, { x, y });
      if (this.pointers.size === 2) {
        // start pinch: cancel any single-pointer action
        if (this.drag && this.drag.hit !== 'pan' && this.drag.hit !== 'pinch') this.store.endGesture();
        this.pending = null;
        const [p1, p2] = [...this.pointers.values()];
        this.drag = { hit: 'pinch', startView: { ...this.view }, sx: x, sy: y, pinch: { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 } };
        return;
      }
      const st = this.store.get();
      const g = this.fromPx(x, y);
      const touch = e.pointerType === 'touch';
      if (st.tool === 'place') {
        this.store.beginGesture();
        this.store.update((s) => ({ ...s, load: { ...s.load, gamma: this.snapPoint(g, s.snap) }, selection: { kind: 'load' } }));
        this.drag = { hit: { kind: 'load' }, startView: { ...this.view }, sx: x, sy: y };
        return;
      }
      if (st.tool === 'compass' || st.tool === 'protractor' || st.tool === 'ruler') {
        const a = st.tool === 'protractor' ? c(0, 0) : this.snapPoint(g, st.snap, this.designPoints());
        this.pending = { tool: st.tool, a, b: st.tool === 'protractor' ? this.snapAngle(g) : a };
        this.drag = null;
        this.schedule();
        return;
      }
      // select tool
      const hit = this.hitTest(x, y, touch);
      if (hit) {
        this.store.beginGesture();
        const selection = hit.kind === 'load' ? { kind: 'load' as const }
          : hit.kind === 'element' ? { kind: 'element' as const, id: st.elements[hit.index].id }
          : hit.kind === 'marker' ? { kind: 'marker' as const, id: hit.id } : { kind: 'construction' as const, id: hit.id };
        this.store.update((s) => ({ ...s, selection }), false);
        this.drag = { hit, startView: { ...this.view }, sx: x, sy: y };
      } else {
        this.drag = { hit: 'pan', startView: { ...this.view }, sx: x, sy: y };
      }
    });

    el.addEventListener('pointermove', (e) => {
      const [x, y] = this.localXY(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
      const g = this.fromPx(x, y);
      if (e.pointerType !== 'touch' || this.pointers.size > 0) {
        this.hover = this.pointers.size > 1 ? null : g;
        this.onCursor(this.hover);
      }
      if (this.drag?.hit === 'pinch' && this.drag.pinch && this.pointers.size >= 2) {
        const [p1, p2] = [...this.pointers.values()];
        const dNow = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        this.view = { ...this.drag.startView };
        const anchor = this.fromPx(this.drag.pinch.mx, this.drag.pinch.my);
        this.view.zoom = Math.max(0.5, Math.min(60, this.drag.startView.zoom * (dNow / Math.max(1, this.drag.pinch.d))));
        const after = this.fromPx(mx, my);
        this.view.cx += anchor.re - after.re; this.view.cy += anchor.im - after.im;
        this.schedule();
        return;
      }
      if (this.pending && this.pointers.has(e.pointerId)) {
        const st = this.store.get();
        if (this.pending.tool === 'protractor') this.pending.b = this.snapAngle(g);
        else this.pending.b = this.snapPoint(g, st.snap, this.designPoints());
        this.schedule();
        return;
      }
      if (!this.drag) { this.schedule(); return; }
      if (this.drag.hit === 'pan') {
        const k = this.s;
        this.view.cx = this.drag.startView.cx - (x - this.drag.sx) / k;
        this.view.cy = this.drag.startView.cy + (y - this.drag.sy) / k;
        this.schedule();
        return;
      }
      const hit = this.drag.hit as Hit;
      if (hit.kind === 'load') {
        this.store.update((s) => ({ ...s, load: { ...s.load, gamma: this.snapPoint(g, s.snap) } }));
      } else if (hit.kind === 'element') {
        this.store.update((s) => {
          const d = derive(s);
          const els = s.elements.slice();
          const start = d.states[hit.index];
          const target = this.snapPoint(g, s.snap);
          els[hit.index] = solveElementToward(start, els[hit.index], target, d.ctx);
          return { ...s, elements: els };
        });
      } else if (hit.kind === 'marker') {
        this.store.update((s) => {
          const m = s.markers.find((mm) => mm.id === hit.id);
          if (!m) return s;
          const tr = derive(s).traces.find((t) => t.trace.id === m.traceId);
          if (!tr) return s;
          const k = nearestSample(tr.applied ?? tr.gamma, g);
          return { ...s, markers: s.markers.map((mm) => (mm.id === hit.id ? { ...mm, f: tr.trace.freqs[k] } : mm)) };
        });
      }
    });

    const finish = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pending && this.pointers.size === 0) {
        const pd = this.pending;
        this.pending = null;
        const id = newId('k');
        let k: Construction | null = null;
        if (pd.tool === 'compass') {
          const r = abs(sub(pd.b, pd.a));
          if (r * this.s > 4) k = { id, type: 'circle', cx: pd.a.re, cy: pd.a.im, r };
        } else if (pd.tool === 'protractor') {
          if (abs(pd.b) * this.s > 6) k = { id, type: 'radial', angle: arg(pd.b) };
        } else if (abs(sub(pd.b, pd.a)) * this.s > 4) {
          k = { id, type: 'ruler', ax: pd.a.re, ay: pd.a.im, bx: pd.b.re, by: pd.b.im };
        }
        if (k) { const kk = k; this.store.update((s) => ({ ...s, constructions: [...s.constructions, kk], selection: { kind: 'construction', id: kk.id } })); }
        this.schedule();
      }
      if (this.pointers.size === 0) {
        if (this.drag && this.drag.hit !== 'pan' && this.drag.hit !== 'pinch') this.store.endGesture();
        this.drag = null;
      } else if (this.drag?.hit === 'pinch') {
        const [p] = [...this.pointers.values()];
        this.drag = { hit: 'pan', startView: { ...this.view }, sx: p.x, sy: p.y };
      }
      if (e.pointerType === 'touch') { this.hover = null; this.onCursor(null); }
      this.schedule();
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('pointerleave', (e) => {
      if (this.pointers.size === 0) { this.hover = null; this.onCursor(null); this.schedule(); }
      void e;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = this.localXY(e);
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), x, y);
    }, { passive: false });
  }

  /** Protractor direction snapping to design points within a few pixels. */
  private snapAngle(g: Complex): Complex {
    const tol = 18 / this.s;
    for (const p of this.designPoints()) if (abs(sub(p, g)) < tol && abs(p) > 1e-9) return p;
    return g;
  }
}

/* ---------------- helpers ---------------- */
function fmtGrid(v: number): string {
  return v >= 10 ? String(v) : v.toString().replace(/^0\./, '.');
}
export function fmtFreq(f: number): string {
  if (f >= 1e9) return `${+(f / 1e9).toPrecision(4)} GHz`;
  if (f >= 1e6) return `${+(f / 1e6).toPrecision(4)} MHz`;
  if (f >= 1e3) return `${+(f / 1e3).toPrecision(4)} kHz`;
  return `${+f.toPrecision(4)} Hz`;
}
export function nearestFreqIndex(freqs: readonly number[], f: number): number {
  let lo = 0, hi = freqs.length - 1;
  if (hi < 0) return 0;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (freqs[m] <= f) lo = m; else hi = m; }
  return Math.abs(freqs[lo] - f) <= Math.abs(freqs[hi] - f) ? lo : hi;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
