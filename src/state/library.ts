/**
 * Project library and large-autosave fallback in IndexedDB.
 *
 * localStorage is limited to ~5 MB and is synchronous, so projects with large
 * Touchstone data go here. Records hold the same JSON produced by serializeProject,
 * so a library entry, a downloaded file and the autosave are interchangeable.
 */
export interface LibraryEntry { id: string; name: string; savedAt: string; size: number; }
interface Rec extends LibraryEntry { json: string; }

const DB = 'browser-smith-chart';
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

export const libraryAvailable = (): boolean => typeof indexedDB !== 'undefined';

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

function tx<T>(store: 'projects' | 'kv', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error ?? r.error);
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
  }));
}

export async function listProjects(): Promise<LibraryEntry[]> {
  const all = await tx<Rec[]>('projects', 'readonly', (s) => s.getAll() as IDBRequest<Rec[]>);
  return all.map(({ id, name, savedAt, size }) => ({ id, name, savedAt, size })).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveProject(name: string, json: string, id?: string): Promise<LibraryEntry> {
  const rec: Rec = { id: id ?? `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name: name.slice(0, 120) || 'Untitled', savedAt: new Date().toISOString(), size: json.length, json };
  await tx('projects', 'readwrite', (s) => s.put(rec));
  return { id: rec.id, name: rec.name, savedAt: rec.savedAt, size: rec.size };
}

export async function getProject(id: string): Promise<string | null> {
  const r = await tx<Rec | undefined>('projects', 'readonly', (s) => s.get(id) as IDBRequest<Rec | undefined>);
  return r?.json ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  await tx('projects', 'readwrite', (s) => s.delete(id));
}

export async function kvSet(key: string, value: string): Promise<void> { await tx('kv', 'readwrite', (s) => s.put(value, key)); }
export async function kvGet(key: string): Promise<string | null> {
  const v = await tx<string | undefined>('kv', 'readonly', (s) => s.get(key) as IDBRequest<string | undefined>);
  return v ?? null;
}
