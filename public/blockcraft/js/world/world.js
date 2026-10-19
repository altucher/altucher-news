// World: chunk map, streaming (generate → mesh → upload), block access,
// edits with simple block updates, and voxel raycasting.

import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, chunkKey } from '../config.js';
import {
  BLOCKS, BLOCK, FACE_DIRS, IS_SOLID, IS_OPAQUE, IS_LIQUID, IS_LEAVES, LIGHT_EMIT, LIGHT_OPACITY, MODEL,
} from '../blocks.js';
import { Chunk } from './chunk.js';
import { surfaceInfo, biomeAt as worldgenBiomeAt } from './worldgen.js';

const EDIT_PRIORITY = -1e6; // mesh jobs for edits jump every streaming job
const UPLOAD_BUDGET_MS = 4;
const GEN_MARGIN = 1.5; // meshing needs all 8 neighbours: generate a bit further out
const UNLOAD_MARGIN = 3;
const MAX_BLOCK_UPDATES = 512;

/** Numeric chunk key (fast Map lookups). Unique for |cx|,|cz| < 32768. */
function key(cx, cz) {
  return (cx + 0x8000) * 0x10000 + ((cz + 0x8000) & 0xffff);
}

// Blocks that fall when unsupported, and blocks that break without support.
const FALLS = new Uint8Array(256);
FALLS[BLOCK.sand] = FALLS[BLOCK.gravel] = FALLS[BLOCK.red_sand] = 1;
const NEEDS_SUPPORT = new Uint8Array(256);
for (const b of BLOCKS) {
  if (b && (b.model === MODEL.CROSS || b.model === MODEL.TORCH || b.id === BLOCK.cactus)) NEEDS_SUPPORT[b.id] = 1;
}
const SPAWN_GROUND = new Set([BLOCK.grass_block, BLOCK.podzol, BLOCK.snowy_grass_block, BLOCK.dirt, BLOCK.sand]);
const SPAWN_BIOMES = new Set(['plains', 'forest', 'birch_forest', 'taiga', 'swamp']);

export class World {
  /**
   * @param {object} opts
   * @param {number} opts.seed
   * @param {import('../render/renderer.js').Renderer} opts.renderer
   * @param {import('./workerpool.js').WorkerPool} opts.pool
   * @param {Map<string, [number, number][]>} [opts.mods] saved edits per chunk key
   * @param {number} opts.renderDistance in chunks
   */
  constructor({ seed, renderer, pool, mods, renderDistance }) {
    this.seed = seed >>> 0;
    this.renderer = renderer;
    this.pool = pool;
    this.chunks = new Map(); // numeric key → Chunk
    /** Every edit ever made, per chunk key string (kept while chunks unload). */
    this.modMaps = new Map();
    if (mods) for (const [k, list] of mods) this.modMaps.set(k, new Map(list));
    this.stats = { loaded: 0, meshed: 0, pendingGen: 0, pendingMesh: 0 };
    this.disposed = false;

    this._genPending = new Set();
    this._genInFlight = 0;
    this._meshInFlight = 0;
    this._meshedCount = 0;
    this._urgent = new Map(); // key → priority of edit remeshes waiting to be dispatched
    this._uploads = [];
    this._center = null;
    this._lastKey = -1;
    this._lastChunk = null;
    this.setRenderDistance(renderDistance);
  }

  // ------------------------------------------------------------------ streaming
  setRenderDistance(n) {
    this.renderDistance = Math.max(2, n | 0);
    const genR = this.renderDistance + GEN_MARGIN;
    const G = Math.ceil(genR);
    const list = [];
    for (let dz = -G; dz <= G; dz++) {
      for (let dx = -G; dx <= G; dx++) {
        const d = Math.hypot(dx, dz);
        if (d <= genR) list.push({ dx, dz, d });
      }
    }
    list.sort((a, b) => a.d - b.d);
    this._offsets = list;
    this._center = null; // re-evaluate unloading on the next update
  }

  /**
   * Stream chunks around the player: unload far chunks, dispatch jobs, upload meshes.
   * @param {number[]} pos player position
   * @param {number} dt
   * @param {boolean} loading upload every finished mesh (no frame budget)
   */
  update(pos, dt, loading) {
    if (this.disposed) return;
    const pcx = Math.floor(pos[0] / CHUNK_SIZE), pcz = Math.floor(pos[2] / CHUNK_SIZE);
    if (!this._center || this._center[0] !== pcx || this._center[1] !== pcz) {
      this._center = [pcx, pcz];
      this._unloadFar(pcx, pcz);
    }
    this._dispatch(pcx, pcz);
    this._upload(loading);
    const s = this.stats;
    s.loaded = this.chunks.size;
    s.meshed = this._meshedCount;
    s.pendingGen = this._genInFlight;
    s.pendingMesh = this._meshInFlight + this._uploads.length;
  }

  _unloadFar(pcx, pcz) {
    const R = this.renderDistance + UNLOAD_MARGIN;
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz <= R * R) continue;
      this.renderer.removeChunk(c.cx, c.cz);
      if (c.meshed) this._meshedCount--;
      this.chunks.delete(k);
      this._urgent.delete(k);
    }
    this._lastKey = -1;
    this._lastChunk = null;
    // Drop queued jobs the player has left behind.
    const genR = this.renderDistance + GEN_MARGIN + 1, meshR = this.renderDistance + 1;
    this.pool.cancel((msg, owner) => {
      if (owner !== this) return false;
      const d = Math.hypot(msg.cx - pcx, msg.cz - pcz);
      return msg.type === 'generate' ? d > genR : msg.type === 'mesh' && d > meshR && !this._urgent.has(key(msg.cx, msg.cz));
    });
  }

  _maxJobs() {
    return this.pool.mode === 'main' ? 3 : Math.max(6, this.pool.size * 6);
  }

  _dispatch(pcx, pcz) {
    // Edits first, at top priority.
    for (const [k, prio] of this._urgent) {
      const c = this.chunks.get(k);
      if (!c) {
        this._urgent.delete(k);
        continue;
      }
      if (c.meshing || !this._neighborsReady(c.cx, c.cz)) continue;
      this._urgent.delete(k);
      this._submitMesh(c, prio);
    }
    const maxJobs = this._maxJobs();
    const meshR = this.renderDistance;
    const genR = this.renderDistance + GEN_MARGIN;
    for (const o of this._offsets) {
      if (this._genInFlight + this._meshInFlight >= maxJobs) break;
      const cx = pcx + o.dx, cz = pcz + o.dz;
      const k = key(cx, cz);
      const c = this.chunks.get(k);
      if (!c) {
        if (o.d <= genR && !this._genPending.has(k)) this._submitGenerate(cx, cz, k, o.d);
        continue;
      }
      if (o.d <= meshR && (!c.meshed || c.dirty) && !c.meshing && this._neighborsReady(cx, cz)) {
        this._submitMesh(c, o.d);
      }
    }
  }

  _neighborsReady(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!this.chunks.has(key(cx + dx, cz + dz))) return false;
      }
    }
    return true;
  }

  _submitGenerate(cx, cz, k, priority) {
    this._genPending.add(k);
    this._genInFlight++;
    const done = () => {
      this._genInFlight--;
      this._genPending.delete(k);
    };
    this.pool.submit({ type: 'generate', seed: this.seed, cx, cz }, priority, this).then(
      (res) => {
        done();
        if (!res || this.disposed || this.chunks.has(k)) return;
        const c = this._center;
        const R = this.renderDistance + UNLOAD_MARGIN;
        if (c && (cx - c[0]) ** 2 + (cz - c[1]) ** 2 > R * R) return; // left behind meanwhile
        this._addChunk(cx, cz, res.blocks);
      },
      (err) => {
        done();
        console.error('chunk generation failed', cx, cz, err);
      },
    );
  }

  _addChunk(cx, cz, blocks) {
    const chunk = new Chunk(cx, cz, blocks);
    const mods = this.modMaps.get(chunkKey(cx, cz));
    if (mods) {
      for (const [i, id] of mods) blocks[i] = id;
      chunk.recomputeMaxY();
      chunk.modified = mods;
    }
    this.chunks.set(key(cx, cz), chunk);
    return chunk;
  }

  _submitMesh(chunk, priority) {
    const { cx, cz } = chunk;
    const neighbors = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) neighbors.push(this.chunks.get(key(cx + dx, cz + dz)).blocks);
    }
    chunk.meshing = true;
    chunk.dirty = false;
    this._meshInFlight++;
    const urgent = priority < 0;
    const finish = () => {
      this._meshInFlight--;
      chunk.meshing = false;
    };
    this.pool.submit({ type: 'mesh', seed: this.seed, cx, cz, neighbors }, priority, this).then(
      (res) => {
        finish();
        if (this.disposed || this.chunks.get(key(cx, cz)) !== chunk) return;
        if (!res) {
          chunk.dirty = true; // cancelled: try again when back in range
          return;
        }
        this._uploads.push({ chunk, sections: res.sections, urgent });
      },
      (err) => {
        finish();
        chunk.dirty = true;
        console.error('chunk meshing failed', cx, cz, err);
      },
    );
  }

  _upload(loading) {
    const list = this._uploads;
    if (list.length === 0) return;
    const t0 = performance.now();
    const rest = [];
    // Edit results always go up this frame; streaming ones within the budget.
    for (const u of list) {
      if (!u.urgent) continue;
      this._uploadOne(u);
    }
    for (const u of list) {
      if (u.urgent) continue;
      if (!loading && performance.now() - t0 > UPLOAD_BUDGET_MS) rest.push(u);
      else this._uploadOne(u);
    }
    this._uploads = rest;
  }

  _uploadOne(u) {
    const c = u.chunk;
    if (this.chunks.get(key(c.cx, c.cz)) !== c) return;
    this.renderer.setChunkMesh(c.cx, c.cz, u.sections);
    if (!c.meshed) {
      c.meshed = true;
      this._meshedCount++;
    }
  }

  /** Fraction (0..1) of the area within `radius` chunks that is generated and meshed. */
  spawnProgress(x, z, radius) {
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    const genR = radius + GEN_MARGIN;
    let gen = 0, genTotal = 0, mesh = 0, meshTotal = 0;
    const G = Math.ceil(genR);
    for (let dz = -G; dz <= G; dz++) {
      for (let dx = -G; dx <= G; dx++) {
        const d = Math.hypot(dx, dz);
        if (d > genR) continue;
        const c = this.chunks.get(key(pcx + dx, pcz + dz));
        genTotal++;
        if (c) gen++;
        if (d <= radius) {
          meshTotal++;
          if (c && c.meshed) mesh++;
        }
      }
    }
    return 0.5 * (gen / genTotal) + 0.5 * (mesh / meshTotal);
  }

  /** Pick a dry, grassy spawn point near the origin. Returns feet position. */
  async findSpawn() {
    let fallback = null;
    let found = null;
    // Walk square rings outward on a coarse grid until a pleasant biome shows up.
    const step = 24;
    for (let ring = 0; ring <= 80 && !found; ring++) {
      for (let i = -ring; i <= ring && !found; i++) {
        for (let j = -ring; j <= ring; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          const x = i * step, z = j * step;
          const s = surfaceInfo(this.seed, x, z);
          if (s.height <= SEA_LEVEL || s.height > 120) continue;
          if (!fallback) fallback = [x, z];
          if (SPAWN_BIOMES.has(s.biome) && s.height < 100) {
            found = [x, z];
            break;
          }
        }
      }
    }
    const [sx, sz] = found || fallback || [0, 0];
    // Generate the chunk and choose the closest open column (not a tree top).
    const cx = Math.floor(sx / CHUNK_SIZE), cz = Math.floor(sz / CHUNK_SIZE);
    let chunk = this.chunks.get(key(cx, cz));
    if (!chunk) {
      const res = await this.pool.submit({ type: 'generate', seed: this.seed, cx, cz }, EDIT_PRIORITY, this);
      if (!res || this.disposed) return [sx + 0.5, SEA_LEVEL + 40, sz + 0.5];
      chunk = this.chunks.get(key(cx, cz)) || this._addChunk(cx, cz, res.blocks);
    }
    let best = null, bestD = Infinity;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = cx * CHUNK_SIZE + lx, z = cz * CHUNK_SIZE + lz;
        let y = chunk.maxY - 1;
        while (y > 0 && !IS_SOLID[chunk.get(lx, y, lz)] && !IS_LIQUID[chunk.get(lx, y, lz)]) y--;
        const ground = chunk.get(lx, y, lz);
        if (!SPAWN_GROUND.has(ground) || y <= SEA_LEVEL - 1) continue;
        const d = (x - sx) ** 2 + (z - sz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [x + 0.5, y + 1, z + 0.5];
        }
      }
    }
    return best || [sx + 0.5, surfaceInfo(this.seed, sx, sz).height + 1, sz + 0.5];
  }

  // ------------------------------------------------------------------ block access
  _chunkAt(x, z) {
    const k = key(x >> 4, z >> 4);
    if (k === this._lastKey) return this._lastChunk;
    const c = this.chunks.get(k) || null;
    this._lastKey = k;
    this._lastChunk = c;
    return c;
  }

  /** Block id at integer world coords (0 when unloaded or out of range). */
  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    x = Math.floor(x);
    z = Math.floor(z);
    const c = this._chunkAt(x, z);
    return c ? c.blocks[(x & 15) | ((z & 15) << 4) | (Math.floor(y) << 8)] : 0;
  }

  /** Whether the chunk containing block column (x, z) is loaded. */
  isLoaded(x, z) {
    return this._chunkAt(Math.floor(x), Math.floor(z)) !== null;
  }

  /** y of the highest solid block in a column (terrain estimate if unloaded). */
  surfaceHeight(x, z) {
    x = Math.floor(x);
    z = Math.floor(z);
    const c = this._chunkAt(x, z);
    if (!c) return surfaceInfo(this.seed, x, z).height;
    for (let y = c.maxY - 1; y >= 0; y--) if (IS_SOLID[c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)]]) return y;
    return 0;
  }

  biomeAt(x, z) {
    return worldgenBiomeAt(this.seed, Math.floor(x), Math.floor(z));
  }

  /** Whether block `id` could stand at (x,y,z) (plants, torches, cactus need support). */
  canPlace(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT || !this.isLoaded(x, z)) return false;
    const top = BLOCKS[id] && BLOCKS[id].doubleTop;
    if (top && (y + 1 >= WORLD_HEIGHT || this.getBlock(x, y + 1, z) !== 0)) return false;
    return !NEEDS_SUPPORT[id] || this._supported(x, y, z, id, true);
  }

  _supported(x, y, z, id, placing = false) {
    const below = this.getBlock(x, y - 1, z);
    switch (id) {
      case BLOCK.tall_grass_top: return below === BLOCK.tall_grass;
      case BLOCK.tall_grass:
        return IS_OPAQUE[below] === 1 && (placing || this.getBlock(x, y + 1, z) === BLOCK.tall_grass_top);
      case BLOCK.lily_pad: return below === BLOCK.water;
      case BLOCK.sugar_cane:
      case BLOCK.cactus: return below === id || IS_OPAQUE[below] === 1;
      case BLOCK.torch: return IS_SOLID[below] === 1 && !IS_LEAVES[below];
      default: return IS_OPAQUE[below] === 1;
    }
  }

  /**
   * Set a block (player edit). Records the modification, remeshes affected
   * chunks and runs block updates (falling sand, unsupported plants, …).
   * @returns {boolean} whether anything changed
   */
  setBlock(x, y, z, id) {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (!this._rawSet(x, y, z, id)) return false;
    const top = BLOCKS[id] && BLOCKS[id].doubleTop;
    if (top && this.getBlock(x, y + 1, z) === 0) this._rawSet(x, y + 1, z, top);
    this._blockUpdates(x, y, z);
    return true;
  }

  _rawSet(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const c = this._chunkAt(x, z);
    if (!c) return false;
    const i = (x & 15) | ((z & 15) << 4) | (y << 8);
    const old = c.blocks[i];
    if (old === id) return false;
    c.set(x & 15, y, z & 15, id);
    const ck = chunkKey(c.cx, c.cz);
    let mods = this.modMaps.get(ck);
    if (!mods) {
      mods = new Map();
      this.modMaps.set(ck, mods);
      c.modified = mods;
    }
    mods.set(i, id);
    const lightChanged = LIGHT_EMIT[old] !== LIGHT_EMIT[id] || LIGHT_OPACITY[old] !== LIGHT_OPACITY[id];
    this._markEdited(x, z, lightChanged ? 15 : 1);
    return true;
  }

  /** Schedule remeshes of every chunk whose mesh can see a change at (x,z) within r blocks. */
  _markEdited(x, z, r) {
    const hx = x >> 4, hz = z >> 4;
    for (let cz = (z - r) >> 4; cz <= (z + r) >> 4; cz++) {
      for (let cx = (x - r) >> 4; cx <= (x + r) >> 4; cx++) {
        const k = key(cx, cz);
        const c = this.chunks.get(k);
        if (!c) continue;
        c.meshVersion++;
        c.dirty = true;
        // The edited chunk first, then border neighbours, then light-only ones.
        const ring = Math.max(Math.abs(cx - hx), Math.abs(cz - hz));
        const border = Math.abs(x - (cx * 16 + 7.5)) <= 8.5 && Math.abs(z - (cz * 16 + 7.5)) <= 8.5;
        const prio = EDIT_PRIORITY + (ring === 0 ? 0 : border ? 1 : 2);
        const prev = this._urgent.get(k);
        if (prev === undefined || prio < prev) this._urgent.set(k, prio);
      }
    }
  }

  /** Resolve falling blocks and unsupported blocks around a changed cell. */
  _blockUpdates(x, y, z) {
    const queue = [x, y, z, x, y + 1, z, x, y - 1, z];
    for (let n = 0; n < queue.length && n < MAX_BLOCK_UPDATES * 3; n += 3) {
      const qx = queue[n], qy = queue[n + 1], qz = queue[n + 2];
      if (qy < 0 || qy >= WORLD_HEIGHT) continue;
      const id = this.getBlock(qx, qy, qz);
      if (id === 0) continue;
      if (FALLS[id] && qy > 0 && !IS_SOLID[this.getBlock(qx, qy - 1, qz)]) {
        let ty = qy - 1;
        while (ty > 0 && !IS_SOLID[this.getBlock(qx, ty - 1, qz)]) ty--;
        this._rawSet(qx, qy, qz, 0);
        this._rawSet(qx, ty, qz, id);
        queue.push(qx, qy + 1, qz, qx, ty + 1, qz);
      } else if (NEEDS_SUPPORT[id] && !this._supported(qx, qy, qz, id)) {
        this._rawSet(qx, qy, qz, 0);
        queue.push(qx, qy + 1, qz, qx, qy - 1, qz);
      }
    }
  }

  /** Every edit, for saving: Map<chunkKey, [index, id][]>. */
  getModifications() {
    const out = new Map();
    for (const [k, m] of this.modMaps) if (m.size) out.set(k, [...m]);
    return out;
  }

  // ------------------------------------------------------------------ raycast
  /**
   * First non-liquid block hit along a ray (Amanatides–Woo DDA). Blocks with a
   * partial hitbox (plants, torches) are tested against that box.
   * @returns {{x,y,z,face,normal:number[],id,dist,place:number[]}|null}
   */
  raycast(origin, dir, maxDist) {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const dx = dir[0] / len, dy = dir[1] / len, dz = dir[2] / len;
    const ox = origin[0], oy = origin[1], oz = origin[2];
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = sx ? Math.abs(1 / dx) : Infinity;
    const tdy = sy ? Math.abs(1 / dy) : Infinity;
    const tdz = sz ? Math.abs(1 / dz) : Infinity;
    let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
    // Face we entered the current voxel through (the start voxel: facing the ray).
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    let face = ax >= ay && ax >= az ? (dx > 0 ? 1 : 0) : ay >= az ? (dy > 0 ? 3 : 2) : dz > 0 ? 5 : 4;
    let t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== 0 && !IS_LIQUID[id]) {
        const hb = BLOCKS[id].hitbox;
        if (hb[0] === 0 && hb[1] === 0 && hb[2] === 0 && hb[3] === 1 && hb[4] === 1 && hb[5] === 1) {
          return this._hit(x, y, z, face, id, t);
        }
        const hit = rayBox(ox, oy, oz, dx, dy, dz, x + hb[0], y + hb[1], z + hb[2], x + hb[3], y + hb[4], z + hb[5]);
        if (hit && hit.t <= maxDist) return this._hit(x, y, z, hit.face, id, hit.t);
      }
      if (tmx < tmy && tmx < tmz) {
        x += sx;
        t = tmx;
        tmx += tdx;
        face = sx > 0 ? 1 : 0;
      } else if (tmy < tmz) {
        y += sy;
        t = tmy;
        tmy += tdy;
        face = sy > 0 ? 3 : 2;
      } else {
        z += sz;
        t = tmz;
        tmz += tdz;
        face = sz > 0 ? 5 : 4;
      }
    }
    return null;
  }

  _hit(x, y, z, face, id, dist) {
    const n = FACE_DIRS[face];
    return { x, y, z, face, normal: [n[0], n[1], n[2]], id, dist, place: [x + n[0], y + n[1], z + n[2]] };
  }

  dispose() {
    this.disposed = true;
    this.pool.cancel((msg, owner) => owner === this);
    for (const c of this.chunks.values()) this.renderer.removeChunk(c.cx, c.cz);
    this.chunks.clear();
    this._uploads = [];
    this._urgent.clear();
    this._lastKey = -1;
    this._lastChunk = null;
  }
}

/** Slab test of a ray against an AABB; returns entry distance and entry face. */
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  const axes = [
    [ox, dx, x0, x1, 1, 0],
    [oy, dy, y0, y1, 3, 2],
    [oz, dz, z0, z1, 5, 4],
  ];
  for (const [o, d, lo, hi, negFace, posFace] of axes) {
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d, t1 = (hi - o) / d;
    let f = negFace;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
      f = posFace;
    }
    if (t0 > tmin) {
      tmin = t0;
      face = f;
    }
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), face: face < 0 ? 2 : face };
}
