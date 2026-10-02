/**
 * Schematic strip: the matching network drawn as a left-to-right ladder
 * (load on the left, generator on the right, matching the element order).
 *
 * Interaction (Pointer Events, so mouse, pen and touch share one path):
 *  - tap/click an element to select it (the Design panel and chart follow);
 *  - mouse/pen: press and drag horizontally to reorder;
 *  - touch: press-and-hold (250 ms) then drag to reorder; a plain swipe scrolls the strip;
 *  - keyboard: focus an element, Alt+← / Alt+→ to move it, Delete to remove.
 */
import type { Element } from '../rf/network';
import { isNonIdeal } from '../rf/network';
import type { Store, AppState } from '../state/store';
import { formatEngineering, fix } from '../math/units';
import { h } from './dom';

const W = 64, H = 44, MID = 14; // symbol box; the through line runs at y = MID

const wire = (x1: number, x2: number) => `<path d="M${x1} ${MID}H${x2}"/>`;
const ground = (x: number, y: number) => `<path d="M${x - 7} ${y}h14M${x - 4.5} ${y + 3}h9M${x - 2} ${y + 6}h4"/>`;
const resistorH = (x: number) => `<path d="M${x} ${MID}l3 -5 5 10 5 -10 5 10 5 -10 3 5"/>`;
const resistorV = (y: number) => `<path d="M32 ${y}l-5 3 10 5 -10 5 10 5 -10 5 5 3"/>`;
const inductorH = (x: number) => `<path d="M${x} ${MID}${[0, 1, 2, 3].map(() => 'a3.4 3.4 0 0 1 6.8 0').join('')}" fill="none"/>`;
const inductorV = (y: number) => `<path d="M32 ${y}${[0, 1, 2, 3].map(() => 'a3.4 3.4 0 0 1 0 6.2').join('')}" fill="none"/>`;
const capH = (x: number) => `<path d="M${x} ${MID}h10M${x + 10} ${MID - 8}v16M${x + 16} ${MID - 8}v16M${x + 16} ${MID}h10"/>`;
const capV = (y: number) => `<path d="M32 ${y}v6M24 ${y + 6}h16M24 ${y + 11}h16M32 ${y + 11}v6"/>`;

function symbol(el: Element): string {
  switch (el.kind) {
    case 'seriesR': return wire(0, 18) + resistorH(18) + wire(46, W);
    case 'seriesL': return wire(0, 18.4) + inductorH(18.4) + wire(45.6, W);
    case 'seriesC': return wire(0, 19) + capH(19) + wire(45, W);
    case 'shuntR': return wire(0, W) + `<path d="M32 ${MID}v2"/>` + resistorV(16) + ground(32, 38);
    case 'shuntL': return wire(0, W) + `<path d="M32 ${MID}v3"/>` + inductorV(17) + `<path d="M32 41.8v-3"/>` + ground(32, 38);
    case 'shuntC': return wire(0, W) + `<path d="M32 ${MID}v4"/>` + capV(18) + ground(32, 38);
    case 'transformer':
      return wire(0, 14) + wire(50, W) + `<path d="M14 ${MID}v6M50 ${MID}v6"/>`
        + `<path d="M14 20${[0, 1, 2].map(() => 'a3 3 0 0 1 0 6').join('')}M14 38v2" fill="none"/>`
        + `<path d="M50 20${[0, 1, 2].map(() => 'a3 3 0 0 0 0 6').join('')}M50 38v2" fill="none"/>`
        + `<path d="M28 18v22M36 18v22"/>`;
    case 'line':
      return wire(0, 10) + wire(54, W) + `<rect x="10" y="${MID - 6}" width="44" height="12" rx="2" fill="none"/>` + `<path d="M10 ${MID + 12}h44" stroke-dasharray="3 2"/>`;
    case 'stub': {
      const end = (x: number, y: number, vertical: boolean) => el.termination === 'short'
        ? (vertical ? ground(x, y) : `<path d="M${x} ${y - 7}v14M${x + 3} ${y - 4.5}v9"/>`)
        : (vertical ? `<circle cx="${x}" cy="${y + 2}" r="2" fill="none"/>` : `<circle cx="${x + 2}" cy="${y}" r="2" fill="none"/>`);
      if (el.connection === 'shunt') {
        return wire(0, W) + `<path d="M32 ${MID}v3"/><rect x="26" y="17" width="12" height="18" rx="2" fill="none"/><path d="M32 35v2"/>` + end(32, 38, true);
      }
      return wire(0, 14) + wire(50, W) + `<path d="M14 ${MID}v6H22M50 ${MID}v6H42"/><rect x="22" y="15" width="20" height="12" rx="2" fill="none"/>`;
    }
  }
}

function caption(el: Element): string {
  switch (el.kind) {
    case 'seriesR': case 'shuntR': return formatEngineering(el.value, 'Ω', 3);
    case 'seriesL': case 'shuntL': return formatEngineering(el.value, 'H', 3);
    case 'seriesC': case 'shuntC': return formatEngineering(el.value, 'F', 3);
    case 'line': return `${fix(el.z0, 1)}Ω ${fix(el.lengthWl, 3)}λ`;
    case 'stub': return `${el.termination === 'short' ? 'S' : 'O'} ${fix(el.lengthWl, 3)}λ`;
    case 'transformer': return `n ${fix(el.n, 3)}`;
  }
}

const KIND_NAME: Record<Element['kind'], string> = {
  seriesR: 'series R', seriesL: 'series L', seriesC: 'series C', shuntR: 'shunt R', shuntL: 'shunt L', shuntC: 'shunt C',
  line: 'line', stub: 'stub', transformer: 'transformer',
};

const svg = (inner: string, cls = '') =>
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="${cls}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/** Pure reorder helper, exported for tests. Moves item `from` to index `to`. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

export class SchematicStrip {
  readonly el = h('div', { class: 'schematic', role: 'list', 'aria-label': 'Matching network schematic (load → generator)' });
  private track = h('div', { class: 'sch-track' });
  private dragging = false;

  constructor(private store: Store) {
    this.el.append(this.track);
    store.subscribe((s, p) => {
      if (this.dragging) return;
      if (s.elements !== p.elements || s.selection !== p.selection || s.theme !== p.theme) this.render();
    });
    this.render();
  }

  render(): void {
    const s = this.store.get();
    const sel = s.selection.kind === 'element' ? s.selection.id : null;
    const end = (label: string, sub: string, cls: string, inner: string) => h('div', { class: `sch-end ${cls}`, role: 'listitem' }, this.svgNode(inner), h('span', { class: 'sch-cap' }, label), h('span', { class: 'sch-sub' }, sub));
    const loadSym = `<rect x="34" y="${MID}" width="10" height="16" rx="1.5"/><path d="M39 ${MID}H${W}"/>` + `<path d="M39 30v6"/>` + ground(39, 36);
    const srcSym = `<path d="M0 ${MID}H22"/><circle cx="30" cy="22" r="8"/><path d="M26 22q2-4 4 0t4 0"/><path d="M30 30v6"/>` + ground(30, 36);
    const items: HTMLElement[] = [end('Load', 'Z_L', 'load', loadSym)];
    s.elements.forEach((el, i) => {
      const btn = h('button', {
        type: 'button', role: 'listitem', class: `sch-el k-${el.kind.startsWith('shunt') || (el.kind === 'stub' && el.connection === 'shunt') ? 'shunt' : el.kind === 'line' ? 'line' : el.kind === 'transformer' ? 'xfmr' : 'series'}${sel === el.id ? ' on' : ''}`,
        'data-id': el.id, 'data-i': String(i), 'aria-pressed': String(sel === el.id),
        'aria-label': `Element ${i + 1}: ${KIND_NAME[el.kind]} ${caption(el)}. Alt+arrow keys reorder.`,
        title: `${i + 1}. ${el.label ?? KIND_NAME[el.kind]} — drag to reorder${isNonIdeal(el as never) ? ' (non-ideal)' : ''}`,
      }, this.svgNode(symbol(el)), h('span', { class: 'sch-cap mono' }, caption(el)), h('span', { class: 'sch-sub' }, `${i + 1}${isNonIdeal(el as never) ? ' · Q' : ''}`));
      this.wire(btn, i);
      items.push(btn);
    });
    items.push(end('Source', 'Z_in', 'src', srcSym));
    if (!s.elements.length) items.splice(1, 0, h('div', { class: 'sch-empty', role: 'listitem' }, 'No elements yet — add them in Design or Calculate'));
    this.track.replaceChildren(...items);
  }

  private svgNode(inner: string): HTMLElement {
    const span = h('span', { class: 'sch-sym' });
    span.innerHTML = svg(inner); // developer-authored symbol markup only
    return span;
  }

  private select(id: string): void {
    this.store.update((st: AppState) => ({ ...st, selection: { kind: 'element', id } }), false);
  }

  private commitMove(from: number, to: number): void {
    if (from === to) return;
    this.store.update((st) => ({ ...st, elements: moveItem(st.elements, from, to) }));
  }

  private wire(btn: HTMLElement, index: number): void {
    const id = btn.dataset.id!;
    btn.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const to = index + (e.key === 'ArrowLeft' ? -1 : 1);
        if (to < 0 || to >= this.store.get().elements.length) return;
        this.commitMove(index, to);
        requestAnimationFrame(() => this.track.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus());
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        this.store.update((st) => ({ ...st, elements: st.elements.filter((x) => x.id !== id), selection: { kind: 'load' } }));
      }
    });
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX, startY = e.clientY;
      const scroll0 = this.el.scrollLeft;
      const touch = e.pointerType === 'touch';
      let mode: 'pending' | 'drag' | 'scroll' = 'pending';
      let armed = !touch; // mouse/pen can drag immediately; touch needs a hold
      let target = index;
      const holdTimer = touch ? window.setTimeout(() => { armed = true; btn.classList.add('armed'); navigator.vibrate?.(10); }, 250) : 0;
      btn.setPointerCapture(e.pointerId);
      const siblings = () => Array.from(this.track.querySelectorAll<HTMLElement>('.sch-el'));
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (mode === 'pending') {
          if (Math.hypot(dx, dy) < 6) return;
          if (armed) { mode = 'drag'; this.dragging = true; btn.classList.add('dragging'); }
          else { mode = 'scroll'; window.clearTimeout(holdTimer); }
        }
        if (mode === 'scroll') { this.el.scrollLeft = scroll0 - dx; return; }
        btn.style.transform = `translateX(${dx}px)`;
        // insertion index from the pointer position against the other items' centres
        const others = siblings().filter((x) => x !== btn);
        let t = 0;
        for (const o of others) { const r = o.getBoundingClientRect(); if (ev.clientX > r.left + r.width / 2) t++; }
        target = t;
        others.forEach((o, k) => o.classList.toggle('gap-before', k === t && t !== index));
        this.track.classList.toggle('gap-end', t === others.length && t !== index);
        // auto-scroll near the edges
        const box = this.el.getBoundingClientRect();
        if (ev.clientX < box.left + 24) this.el.scrollLeft -= 8;
        else if (ev.clientX > box.right - 24) this.el.scrollLeft += 8;
      };
      const up = (ev: PointerEvent) => {
        window.clearTimeout(holdTimer);
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
        btn.classList.remove('armed', 'dragging');
        btn.style.transform = '';
        siblings().forEach((o) => o.classList.remove('gap-before'));
        this.track.classList.remove('gap-end');
        const wasDrag = mode === 'drag';
        this.dragging = false;
        if (ev.type === 'pointercancel') { this.render(); return; }
        if (wasDrag) this.commitMove(index, target);
        else if (mode === 'pending') this.select(id);
        this.render();
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
    // Pointer handling covers clicks; keep keyboard activation (Enter/Space) working.
    btn.addEventListener('click', (e) => { if ((e as MouseEvent).detail === 0) this.select(id); });
  }
}
