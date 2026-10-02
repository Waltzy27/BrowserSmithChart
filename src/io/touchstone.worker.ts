/// <reference lib="webworker" />
/** Off-main-thread Touchstone parsing and parameter conversion (Z/Y/H/G → S). */
import { parseTouchstone } from './touchstone';

self.onmessage = (e: MessageEvent<{ id: number; text: string; name: string }>) => {
  const { id, text, name } = e.data;
  try {
    const t0 = performance.now();
    const r = parseTouchstone(text, name);
    (self as unknown as Worker).postMessage({ id, result: r, ms: performance.now() - t0 });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
