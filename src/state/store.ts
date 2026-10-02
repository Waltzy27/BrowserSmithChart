/**
 * Application state with undo/redo and local autosave.
 *
 * State objects are treated as immutable: every change produces a new top-level
 * object, so history snapshots share large arrays (imported traces) by reference.
 */
import { type Complex, c } from '../math/complex';
import { zToGamma } from '../math/smith';
import type { Element, LoadModel } from '../rf/network';
import { kvSet, kvGet, libraryAvailable } from './library';
import { setInteractive } from './interactive';

declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export type GridMode = 'Z' | 'Y' | 'ZY' | 'YZ';
export type Tool = 'select' | 'place' | 'compass' | 'protractor' | 'ruler';
export type SnapMode = 'off' | 'grid' | 'guides';

export type Construction =
  | { id: string; type: 'circle'; cx: number; cy: number; r: number }
  | { id: string; type: 'radial'; angle: number }        // radians, Γ-plane angle
  | { id: string; type: 'ruler'; ax: number; ay: number; bx: number; by: number };

export interface Trace {
  id: string;
  name: string;
  param: string;          // e.g. "S11"
  freqs: number[];        // Hz
  gamma: Complex[];       // referenced to the trace's own z0
  z0: number;
  visible: boolean;
  applyNetwork: boolean;  // show the design network applied over this trace
  sourcePorts: number;
  allParams?: Record<string, Complex[]>; // available reflection/transmission params for n-port files
}

export interface Marker { id: string; traceId: string; f: number; }

export type Selection =
  | { kind: 'load' }
  | { kind: 'input' }
  | { kind: 'element'; id: string }
  | { kind: 'marker'; id: string }
  | { kind: 'construction'; id: string }
  | { kind: 'none' };

export interface AppState {
  schema: 1;
  Z0: number;
  f0: number;
  load: { gamma: Complex; model: LoadModel };
  elements: Element[];
  constructions: Construction[];
  traces: Trace[];
  markers: Marker[];
  activeTraceId: string | null;
  gridMode: GridMode;
  overlays: {
    vswrCircle: boolean;
    matchCircles: boolean;  // r = 1 and g = 1 guide circles
    qCircle: number;        // 0 = off
    scales: boolean;        // angle + wavelength rings
    paperY: boolean;        // show the 180°-reflected admittance point (paper method)
    labels: boolean;
    /** Double-stub spacing (λ) whose rotated g = 1 circle and forbidden region are drawn; 0 = off. */
    stubGuide: number;
  };
  sweep: { enabled: boolean; spanPct: number; points: number };
  snap: SnapMode;
  tool: Tool;
  selection: Selection;
  theme: 'dark' | 'light';
}

let uid = 0;
export const newId = (p = 'id'): string => `${p}_${Date.now().toString(36)}_${(uid++).toString(36)}`;

export function defaultState(): AppState {
  // Pozar Example 5.1 load (200 − j100 Ω at 500 MHz, Z0 = 100 Ω) would be one choice;
  // the default uses a familiar 50 Ω problem from Example 5.2.
  return {
    schema: 1,
    Z0: 50,
    f0: 2e9,
    load: { gamma: zToGamma(c(1.2, -1.6)), model: 'series' },
    elements: [],
    constructions: [],
    traces: [],
    markers: [],
    activeTraceId: null,
    gridMode: 'ZY',
    overlays: { vswrCircle: true, matchCircles: false, qCircle: 0, scales: true, paperY: false, labels: true, stubGuide: 0 },
    sweep: { enabled: false, spanPct: 50, points: 201 },
    snap: 'off',
    tool: 'select',
    selection: { kind: 'load' },
    theme: 'dark',
  };
}

type Listener = (s: AppState, prev: AppState) => void;

/**
 * Autosave keys. Each major app version uses its own key so an archived version
 * (e.g. /v0.1/) and the current one never overwrite each other's work; on first
 * start the newest older key is migrated.
 */
const STORAGE_KEY = 'browser-smith-chart:project:v2';
const LEGACY_KEYS = ['browser-smith-chart:project:v1'];
const IDB_FLAG = 'browser-smith-chart:autosave-in-idb';
const MAX_HISTORY = 150;

/** Keys whose changes are view-only and should not create undo steps. */
const TRANSIENT: ReadonlyArray<keyof AppState> = ['tool', 'selection', 'theme'];

export class Store {
  private state: AppState;
  private past: AppState[] = [];
  private future: AppState[] = [];
  private listeners = new Set<Listener>();
  private saveTimer: number | undefined;
  /** When set, the next commit merges into this pending gesture instead of a new step. */
  private gestureBase: AppState | null = null;

  constructor(initial: AppState) { this.state = initial; }

  get(): AppState { return this.state; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply a change. `record=false` for transient view changes. */
  update(fn: (s: AppState) => AppState, record = true): void {
    const prev = this.state;
    const next = fn(prev);
    if (next === prev) return;
    if (record && !this.gestureBase && this.isMeaningful(prev, next)) {
      this.past.push(prev);
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
    }
    this.state = next;
    this.emit(prev);
  }

  /** Begin a continuous gesture (drag): intermediate updates collapse to one undo step. */
  beginGesture(): void {
    if (this.gestureBase) return;
    this.gestureBase = this.state;
    setInteractive(true);
  }
  endGesture(): void {
    if (!this.gestureBase) return;
    if (this.isMeaningful(this.gestureBase, this.state)) {
      this.past.push(this.gestureBase);
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
    }
    this.gestureBase = null;
    setInteractive(false);
    // re-emit so views recompute anything that was decimated during the drag
    const prev = this.state;
    this.state = { ...this.state };
    this.emit(prev);
    this.scheduleSave();
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  undo(): void {
    const p = this.past.pop();
    if (!p) return;
    const prev = this.state;
    this.future.push(prev);
    this.state = { ...p, tool: prev.tool, theme: prev.theme };
    this.emit(prev);
  }
  redo(): void {
    const n = this.future.pop();
    if (!n) return;
    const prev = this.state;
    this.past.push(prev);
    this.state = { ...n, tool: prev.tool, theme: prev.theme };
    this.emit(prev);
  }

  replace(next: AppState, resetHistory = true): void {
    const prev = this.state;
    if (resetHistory) { this.past = []; this.future = []; } else this.past.push(prev);
    this.state = next;
    this.emit(prev);
  }

  private isMeaningful(a: AppState, b: AppState): boolean {
    for (const k of Object.keys(b) as Array<keyof AppState>) {
      if (TRANSIENT.includes(k)) continue;
      if (a[k] !== b[k]) return true;
    }
    return false;
  }

  private emit(prev: AppState): void {
    for (const l of this.listeners) l(this.state, prev);
    if (!this.gestureBase) this.scheduleSave();
  }

  private scheduleSave(): void {
    if (typeof window === 'undefined') return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const json = serializeProject(this.state);
      try {
        localStorage.setItem(STORAGE_KEY, json);
        localStorage.removeItem(IDB_FLAG);
      } catch {
        // Too large for localStorage (big Touchstone data) → IndexedDB
        if (libraryAvailable()) kvSet(STORAGE_KEY, json).then(() => { try { localStorage.setItem(IDB_FLAG, '1'); } catch { /* ignore */ } }).catch(() => { /* private mode */ });
      }
    }, 400);
  }
}

/* ------------------------------------------------------------------ */
/* Project files                                                       */
/* ------------------------------------------------------------------ */

export const PROJECT_FORMAT = 'browser-smith-chart-project';

export function serializeProject(s: AppState): string {
  const { selection: _sel, tool: _tool, ...rest } = s;
  void _sel; void _tool;
  return JSON.stringify({ format: PROJECT_FORMAT, app: APP_VERSION, savedAt: new Date().toISOString(), state: rest });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const toC = (v: unknown): Complex => {
  const o = v as { re?: unknown; im?: unknown };
  return c(isNum(o?.re) ? o.re : 0, isNum(o?.im) ? o.im : 0);
};

/** Validate and migrate an untrusted project JSON string. Throws with a readable message. */
export function loadProject(text: string): AppState {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('Not a valid JSON project file.'); }
  const obj = raw as { format?: string; state?: Partial<AppState> };
  if (obj?.format !== PROJECT_FORMAT || !obj.state) throw new Error('This file is not a Browser Smith Chart project.');
  const d = defaultState();
  const s = obj.state;
  const out: AppState = {
    ...d,
    Z0: isNum(s.Z0) && s.Z0 > 0 ? s.Z0 : d.Z0,
    f0: isNum(s.f0) && s.f0 > 0 ? s.f0 : d.f0,
    load: { gamma: toC(s.load?.gamma), model: (['constant', 'series', 'parallel'] as const).includes(s.load?.model as LoadModel) ? (s.load!.model as LoadModel) : 'constant' },
    elements: Array.isArray(s.elements) ? (s.elements.filter((e) => e && typeof e === 'object' && typeof e.kind === 'string') as Element[]) : [],
    constructions: Array.isArray(s.constructions) ? s.constructions : [],
    traces: Array.isArray(s.traces)
      ? s.traces.map((t) => ({ ...t, gamma: (t.gamma ?? []).map(toC), freqs: (t.freqs ?? []).filter(isNum),
          allParams: t.allParams ? Object.fromEntries(Object.entries(t.allParams).map(([k, v]) => [k, (v as unknown[]).map(toC)])) : undefined }))
      : [],
    markers: Array.isArray(s.markers) ? s.markers : [],
    activeTraceId: typeof s.activeTraceId === 'string' ? s.activeTraceId : null,
    gridMode: (['Z', 'Y', 'ZY', 'YZ'] as const).includes(s.gridMode as GridMode) ? (s.gridMode as GridMode) : d.gridMode,
    overlays: { ...d.overlays, ...(s.overlays ?? {}) },
    sweep: { ...d.sweep, ...(s.sweep ?? {}) },
    snap: (['off', 'grid', 'guides'] as const).includes(s.snap as SnapMode) ? (s.snap as SnapMode) : 'off',
    theme: s.theme === 'light' ? 'light' : 'dark',
    selection: { kind: 'load' },
    tool: 'select',
  };
  return out;
}

export function loadAutosave(): AppState | null {
  try {
    for (const k of [STORAGE_KEY, ...LEGACY_KEYS]) {
      const t = localStorage.getItem(k);
      if (t) return loadProject(t);
    }
  } catch { /* corrupt or unavailable */ }
  return null;
}

/** Autosaves too large for localStorage live in IndexedDB; resolve them asynchronously. */
export async function loadLargeAutosave(): Promise<AppState | null> {
  try {
    if (localStorage.getItem(IDB_FLAG) !== '1' || !libraryAvailable()) return null;
    const t = await kvGet(STORAGE_KEY);
    return t ? loadProject(t) : null;
  } catch { return null; }
}
