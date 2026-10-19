// Persistence: world meta (seed, player, time) and per-chunk block edits in
// IndexedDB. Falls back to an in-memory store when IndexedDB is unavailable
// (private browsing in some browsers, sandboxed iframes, file://).

const DB_NAME = 'blockcraft';
const DB_VERSION = 1;
const META_KEY = 'world';

/** Edits are stored compactly as Uint32 (index << 8 | id). */
function pack(list) {
  const out = new Uint32Array(list.length);
  for (let i = 0; i < list.length; i++) out[i] = (list[i][0] << 8) | list[i][1];
  return out;
}

function unpack(packed) {
  const out = new Array(packed.length);
  for (let i = 0; i < packed.length; i++) out[i] = [packed[i] >>> 8, packed[i] & 255];
  return out;
}

/** Cheap content signature, used to skip rewriting unchanged chunks. */
function signature(list) {
  let h = 2166136261;
  for (const [i, id] of list) h = Math.imul(h ^ ((i << 8) | id), 16777619);
  return list.length + ':' + (h >>> 0);
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SaveStore {
  constructor() {
    this.db = null;
    /** In-memory fallback: { meta, mods: Map<key, [index,id][]> } */
    this.memory = null;
    this._opening = null;
    this._written = new Map(); // chunk key → signature last written
  }

  /** Open (or create) the database. Never rejects: falls back to memory. */
  open() {
    if (!this._opening) {
      this._opening = new Promise((resolve) => {
        let req;
        try {
          if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB is not available');
          req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (e) {
          this._useMemory(e);
          resolve();
          return;
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
          if (!db.objectStoreNames.contains('mods')) db.createObjectStore('mods');
        };
        req.onsuccess = () => {
          this.db = req.result;
          // Another tab upgrading the schema: step aside rather than block it.
          this.db.onversionchange = () => {
            this.db.close();
            this.db = null;
            this._useMemory(new Error('database closed by another tab'));
          };
          resolve();
        };
        req.onerror = () => {
          this._useMemory(req.error);
          resolve();
        };
      });
    }
    return this._opening;
  }

  _useMemory(reason) {
    if (!this.memory) this.memory = { meta: null, mods: new Map() };
    console.warn('[SaveStore] saving in memory only:', reason && reason.message ? reason.message : reason);
  }

  async _store(name, mode) {
    await this.open();
    if (!this.db) return null;
    return this.db.transaction(name, mode).objectStore(name);
  }

  async loadMeta() {
    const store = await this._store('meta', 'readonly');
    if (!store) return this.memory.meta;
    return (await promisify(store.get(META_KEY))) ?? null;
  }

  async saveMeta(meta) {
    const store = await this._store('meta', 'readwrite');
    if (!store) {
      this.memory.meta = structuredClone(meta);
      return;
    }
    await promisify(store.put(meta, META_KEY));
  }

  /** @returns {Promise<Map<string, [number, number][]>>} */
  async loadMods() {
    const store = await this._store('mods', 'readonly');
    const out = new Map();
    if (!store) {
      for (const [k, list] of this.memory.mods) out.set(k, list.map((e) => e.slice()));
      return out;
    }
    const [keys, values] = await Promise.all([promisify(store.getAllKeys()), promisify(store.getAll())]);
    for (let i = 0; i < keys.length; i++) {
      const list = unpack(values[i]);
      out.set(keys[i], list);
      this._written.set(keys[i], signature(list));
    }
    return out;
  }

  /**
   * Persist every chunk's edits; unchanged chunks are skipped.
   * @param {Map<string, [number, number][]>} mods
   */
  async saveMods(mods) {
    await this.open();
    if (!this.db) {
      this.memory.mods = new Map([...mods].map(([k, list]) => [k, list.map((e) => e.slice())]));
      return;
    }
    const changed = [];
    for (const [k, list] of mods) {
      const sig = signature(list);
      if (this._written.get(k) !== sig) changed.push([k, list, sig]);
    }
    const removed = [...this._written.keys()].filter((k) => !mods.has(k));
    if (!changed.length && !removed.length) return;
    const tx = this.db.transaction('mods', 'readwrite');
    const store = tx.objectStore('mods');
    for (const [k, list] of changed) store.put(pack(list), k);
    for (const k of removed) store.delete(k);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('save aborted'));
    });
    for (const [k, , sig] of changed) this._written.set(k, sig);
    for (const k of removed) this._written.delete(k);
  }

  /** Delete the saved world. */
  async clear() {
    await this.open();
    this._written.clear();
    if (!this.db) {
      this.memory.meta = null;
      this.memory.mods.clear();
      return;
    }
    const tx = this.db.transaction(['meta', 'mods'], 'readwrite');
    tx.objectStore('meta').clear();
    tx.objectStore('mods').clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('clear aborted'));
    });
  }
}
