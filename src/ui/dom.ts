/** Minimal DOM helpers. User-provided text is always inserted as text nodes, never HTML. */
import { parseEngineering, formatEngineering, toSig } from '../math/units';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const ch of children) {
    if (ch === null || ch === undefined || ch === false) continue;
    el.append(ch instanceof Node ? ch : document.createTextNode(String(ch)));
  }
  return el;
}

export const svgIcon = (paths: string, size = 18): SVGSVGElement => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size)); s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths; // static, developer-authored icon markup only
  return s;
};

export interface NumFieldOpts {
  label: string;
  value: number;
  unit?: string;
  key: string;               // stable key for focus restoration
  digits?: number;
  engineering?: boolean;     // show with SI prefixes
  min?: number;
  title?: string;
  onCommit: (v: number) => void;
}

/** Labelled numeric input accepting engineering notation (e.g. "2.2n", "500 MHz"). */
export function numField(o: NumFieldOpts): HTMLElement {
  const display = (v: number) => (o.engineering ? formatEngineering(v, '', o.digits ?? 5).trim() : toSig(v, o.digits ?? 6)).replace('−', '-');
  const input = h('input', {
    class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
    'data-key': o.key, value: display(o.value), 'aria-label': `${o.label}${o.unit ? ' (' + o.unit + ')' : ''}`, title: o.title,
  });
  const commit = () => {
    const v = parseEngineering(input.value.replace('−', '-'), o.unit ?? '');
    if (Number.isFinite(v) && (o.min === undefined || v >= o.min)) {
      input.classList.remove('invalid');
      if (v !== o.value) o.onCommit(v);
      else input.value = display(o.value);
    } else {
      input.classList.add('invalid');
    }
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
    if (e.key === 'Escape') { input.value = display(o.value); input.classList.remove('invalid'); input.blur(); }
  });
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, o.label),
    h('span', { class: 'field-input' }, input, o.unit ? h('span', { class: 'unit' }, o.unit) : null),
  );
}

export function segmented<T extends string>(name: string, options: Array<[T, string, string?]>, value: T, onChange: (v: T) => void, small = false): HTMLElement {
  const wrap = h('div', { class: `seg${small ? ' seg-sm' : ''}`, role: 'radiogroup', 'aria-label': name });
  for (const [v, label, title] of options) {
    wrap.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', title: title ?? label,
      onclick: () => onChange(v),
    }, label));
  }
  return wrap;
}

export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void, title?: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
  return h('label', { class: 'toggle', title }, input, h('span', { class: 'toggle-track', 'aria-hidden': 'true' }), h('span', {}, label));
}

export function selectField<T extends string>(label: string, options: Array<[T, string]>, value: T, onChange: (v: T) => void): HTMLElement {
  const sel = h('select', { 'aria-label': label, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T) });
  for (const [v, l] of options) sel.append(h('option', { value: v, selected: v === value }, l));
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), h('span', { class: 'field-input' }, sel));
}

/** Rebuild a container while preserving focus on the element with the same data-key. */
export function rebuild(container: HTMLElement, build: () => Node[]): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active && container.contains(active) ? active.getAttribute('data-key') : null;
  const scroll = container.scrollTop;
  container.replaceChildren(...build());
  container.scrollTop = scroll;
  if (key) {
    const again = container.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    again?.focus();
  }
}

export function download(name: string, data: string | Blob, mime = 'text/plain'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'error' = 'info'): void {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.className = `show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t!.className = ''; }, 3200);
}
