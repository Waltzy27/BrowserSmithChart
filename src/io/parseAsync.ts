/**
 * Touchstone parsing off the main thread. Complex values are plain {re, im}
 * objects, so results survive structured cloning unchanged (freezing is cosmetic).
 * Small files (< 256 kB) parse synchronously: starting a worker costs more than
 * the parse. If workers are unavailable or fail, parsing falls back to the main thread.
 */
import { parseTouchstone, type ParseResult } from './touchstone';

const SYNC_LIMIT = 256 * 1024;
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: ParseResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./touchstone.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: ParseResult; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.result) p.resolve(e.data.result); else p.reject(new Error(e.data.error ?? 'Worker failed'));
    };
    worker.onerror = () => { for (const p of pending.values()) p.reject(new Error('Worker error')); pending.clear(); worker?.terminate(); worker = null; };
    return worker;
  } catch { return null; }
}

export async function parseTouchstoneAsync(text: string, name: string): Promise<ParseResult> {
  if (text.length < SYNC_LIMIT) return parseTouchstone(text, name);
  const w = getWorker();
  if (!w) return parseTouchstone(text, name);
  const id = ++seq;
  try {
    return await new Promise<ParseResult>((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, text, name }); });
  } catch {
    return parseTouchstone(text, name);
  }
}
