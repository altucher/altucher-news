// World generation: terrain, biomes, caves, ores, trees and vegetation.
// Pure and deterministic (seed + chunk coords → identical blocks everywhere);
// runs inside workers, so no DOM access.
//
// Pipeline per chunk:
//   1. column sampling on a padded 20×20 grid (height, climate, biome, slope)
//   2. column fill (bedrock, stone, biome surface layers, water/ice)
//   3. stone variant + ore blobs (seeded per chunk, applied across borders)
//   4. caves: cheese + spaghetti noise on a 4³ grid, trilinearly interpolated
//   5. trees rooted in this chunk and its 8 neighbours
//   6. ground vegetation (own chunk only)

import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT, SEA_LEVEL } from '../config.js';
import { Noise, hash32, hash01, mulberry32, clamp, lerp, smoothstep } from '../math.js';
import { BLOCK as B, IS_LEAVES } from '../blocks.js';

/** Highest water block. Its surface sits at ≈ SEA_LEVEL − 1/8. */
const WATER_TOP = SEA_LEVEL - 1;
const LAVA_LEVEL = 10;
const AIR = 0;

// ---------------------------------------------------------------------------
// Biomes
// ---------------------------------------------------------------------------
const OCEAN = 0, DEEP_OCEAN = 1, FROZEN_OCEAN = 2, RIVER = 3, BEACH = 4, PLAINS = 5, FOREST = 6,
  BIRCH_FOREST = 7, TAIGA = 8, SNOWY_TUNDRA = 9, DESERT = 10, SWAMP = 11, MOUNTAINS = 12, SNOWY_PEAKS = 13;

export const BIOME_NAMES = [
  'ocean', 'deep_ocean', 'frozen_ocean', 'river', 'beach', 'plains', 'forest',
  'birch_forest', 'taiga', 'snowy_tundra', 'desert', 'swamp', 'mountains', 'snowy_peaks',
];

const COLD = -0.62; // temperature below which grass is snowy
const FREEZE = -0.7; // temperature below which open water freezes

// Trees per 4×4 cell (probability) by biome.
const TREE_DENSITY = new Float32Array(14);
TREE_DENSITY[PLAINS] = 0.012;
TREE_DENSITY[FOREST] = 0.5;
TREE_DENSITY[BIRCH_FOREST] = 0.48;
TREE_DENSITY[TAIGA] = 0.42;
TREE_DENSITY[SNOWY_TUNDRA] = 0.035;
TREE_DENSITY[SWAMP] = 0.14;
TREE_DENSITY[MOUNTAINS] = 0.06;

/** Farthest a tree reaches horizontally from its trunk (large oaks). */
const TREE_REACH = 6;

// ---------------------------------------------------------------------------
// Per-seed noise context (cached: every job for a world uses the same seed)
// ---------------------------------------------------------------------------
const contexts = new Map();

function context(seed) {
  seed >>>= 0;
  let c = contexts.get(seed);
  if (c) return c;
  const noise = (salt) => new Noise(hash32(seed, salt, 0x51f15e));
  c = {
    seed,
    warp: noise(1), cont: noise(2), eros: noise(3), ridge: noise(4), hills: noise(5),
    detail: noise(6), temp: noise(7), humid: noise(8), river: noise(9), patch: noise(10),
    cheese: noise(11), spagA: noise(12), spagB: noise(13),
  };
  if (contexts.size >= 4) contexts.delete(contexts.keys().next().value);
  contexts.set(seed, c);
  return c;
}

// ---------------------------------------------------------------------------
// Column sampling: height + climate + biome for one world column
// ---------------------------------------------------------------------------

// Continentalness → base height (piecewise linear).
const CONT_X = [-1.2, -0.6, -0.35, -0.2, -0.1, 0.0, 0.2, 0.5, 1.2];
const CONT_Y = [30, 38, 48, 56, 61, 64, 67, 72, 82];

function contSpline(v) {
  if (v <= CONT_X[0]) return CONT_Y[0];
  for (let i = 1; i < CONT_X.length; i++) {
    if (v <= CONT_X[i]) {
      const t = (v - CONT_X[i - 1]) / (CONT_X[i] - CONT_X[i - 1]);
      return CONT_Y[i - 1] + (CONT_Y[i] - CONT_Y[i - 1]) * t;
    }
  }
  return CONT_Y[CONT_Y.length - 1];
}

/** Scratch result of sampleColumn (reused: callers copy what they need). */
const COL = { h: 0, hi: 0, cont: 0, temp: 0, humid: 0, m: 0, swamp: 0, desert: 0, bank: 0, bed: 0, biome: 0 };

function sampleColumn(c, x, z) {
  // Domain warp gives coastlines and ranges an organic shape.
  const wx = x + c.warp.noise2(x / 256, z / 256) * 40;
  const wz = z + c.warp.noise2(x / 256 + 71.3, z / 256 - 19.7) * 40;
  const cont = c.cont.fbm2(wx / 1200, wz / 1200, 5) * 1.8 + 0.12;
  const eros = c.eros.fbm2(wx / 700, wz / 700, 3) * 1.8;
  // Small-scale jitter dithers biome borders so they are not smooth curves.
  const jit = c.detail.noise2(x / 9, z / 9) * 0.035;
  const temp0 = c.temp.fbm2(x / 1500, z / 1500, 3) * 1.8 + jit;
  const humid = c.humid.fbm2(x / 1200 + 50, z / 1200, 3) * 1.8 - jit;

  let h = contSpline(cont);
  const inland = smoothstep(-0.12, 0.12, cont);
  const desert = smoothstep(0.3, 0.45, temp0) * smoothstep(0.0, -0.15, humid);
  const m = smoothstep(0.0, 0.35, cont) * smoothstep(-0.05, -0.5, eros) * (1 - 0.8 * desert);
  const swamp = smoothstep(0.32, 0.52, humid) * smoothstep(-0.2, 0.0, temp0) * smoothstep(0.3, 0.08, cont) * inland;

  const hillAmp = (3 + 15 * smoothstep(0.15, -0.35, eros)) * inland * (1 - 0.85 * desert) * (1 - swamp);
  h += c.hills.fbm2(x / 150, z / 150, 4) * 1.8 * hillAmp;
  if (m > 0) {
    // Broad massifs with sharp ridgelines, plus crags near the summits.
    const r = c.ridge.ridged2(wx / 640, wz / 640, 4);
    const crag = c.ridge.ridged2(x / 70 + 91.7, z / 70, 3);
    h += m * (14 + Math.pow(r, 2.2) * 150 + crag * 24 * smoothstep(0.35, 0.8, r));
  }
  h += c.detail.fbm2(x / 36, z / 36, 3) * 1.8 * (1.2 + 5 * m);
  if (desert > 0) h += desert * inland * (1 - Math.abs(c.patch.noise2(x / 38, z / 64))) * 5;
  // Wetlands sit right at the water line with shallow pools.
  if (swamp > 0) h = lerp(h, WATER_TOP + 0.4 + c.patch.fbm2(x / 20, z / 20, 2) * 3, swamp * (1 - m));

  // Rivers follow the zero set of a noise field; banks slope down to the bed.
  const rv = Math.abs(c.river.fbm2(x / 900, z / 900, 3) * 1.8);
  const riverMask = smoothstep(-0.15, 0.05, cont) * (1 - smoothstep(0.3, 0.7, m));
  const bank = smoothstep(0.09, 0.03, rv) * riverMask;
  const bed = smoothstep(0.035, 0.012, rv) * riverMask;
  if (bank > 0) {
    h = lerp(h, Math.min(h, WATER_TOP + 2), bank);
    h = lerp(h, WATER_TOP - 4, bed);
  }

  h = clamp(h, 6, 236);
  const hi = Math.floor(h);
  COL.h = h;
  COL.hi = hi;
  COL.cont = cont;
  COL.temp = temp0 - Math.max(0, h - 95) * 0.012; // colder with altitude
  COL.humid = humid;
  COL.m = m;
  COL.swamp = swamp;
  COL.desert = desert;
  COL.bank = bank;
  COL.bed = bed;
  COL.biome = classify(COL);
  return COL;
}

function classify(col) {
  const hi = col.hi, t = col.temp;
  if (hi < WATER_TOP) {
    if (col.swamp > 0.5 && t >= COLD) return SWAMP;
    if (col.bed > 0.3) return RIVER;
    if (t < FREEZE) return FROZEN_OCEAN;
    return col.cont < -0.45 ? DEEP_OCEAN : OCEAN;
  }
  if (col.m > 0.45 && hi > 100) return hi > 150 || t < -0.75 ? SNOWY_PEAKS : MOUNTAINS;
  if (hi <= WATER_TOP + 2 && col.swamp < 0.5 && (col.cont < 0.02 || col.bank > 0.6)) return BEACH;
  if (t < COLD) return SNOWY_TUNDRA;
  if (t < -0.32) return TAIGA;
  if (col.desert > 0.5) return DESERT;
  if (col.swamp > 0.5) return SWAMP;
  if (col.humid > 0.3 && t < 0.12) return BIRCH_FOREST;
  if (col.humid > -0.05) return FOREST;
  return PLAINS;
}

// ---------------------------------------------------------------------------
// Surface layers
// ---------------------------------------------------------------------------
/** Scratch result of surfaceFor. */
const SURF = { top: 0, filler: 0, fillerDepth: 0, under: 0, underDepth: 0 };

function setSurf(top, filler, fillerDepth, under = B.stone, underDepth = 0) {
  SURF.top = top;
  SURF.filler = filler;
  SURF.fillerDepth = fillerDepth;
  SURF.under = under;
  SURF.underDepth = underDepth;
  return SURF;
}

function surfaceFor(c, x, z, hi, biome, slope) {
  const patch = c.patch.noise2(x / 14, z / 14);
  const var1 = hash32(c.seed, x, z, 0x5f) & 1;
  switch (biome) {
    case OCEAN:
    case DEEP_OCEAN:
    case FROZEN_OCEAN:
    case RIVER: {
      let top;
      if (biome === RIVER) top = patch > 0.35 ? B.gravel : patch < -0.45 ? B.clay : B.sand;
      else if (WATER_TOP - hi > 14) top = patch > 0.3 ? B.sand : B.gravel;
      else top = patch > 0.45 ? B.gravel : patch < -0.4 ? B.clay : B.sand;
      return setSurf(top, top === B.clay ? B.clay : top, 2 + var1, B.sand === top ? B.sandstone : B.stone, top === B.sand ? 2 : 0);
    }
    case BEACH:
      return setSurf(B.sand, B.sand, 3 + var1, B.sandstone, 2);
    case DESERT:
      if (slope >= 2.5) return setSurf(B.sandstone, B.sandstone, 3, B.sandstone, 4); // wind-cut ledges
      return setSurf(B.sand, B.sand, 3 + var1, B.sandstone, 5);
    case SWAMP:
      if (hi < WATER_TOP) return setSurf(patch > 0.2 ? B.clay : B.dirt, B.dirt, 3);
      return setSurf(B.grass_block, B.dirt, 3 + var1);
    case TAIGA:
      if (slope >= 4) return setSurf(B.stone, B.stone, 1);
      return setSurf(patch > 0.15 ? B.podzol : B.grass_block, B.dirt, 3 + var1);
    case SNOWY_TUNDRA:
      if (slope >= 4) return setSurf(B.stone, B.stone, 1);
      return setSurf(B.snowy_grass_block, B.dirt, 3);
    case MOUNTAINS: {
      // Snow caps the high ground, grass the gentler slopes; cliffs stay bare.
      const snowLine = 136 + patch * 8;
      if (hi > snowLine && slope < 3.5) return setSurf(B.snow_block, B.snow_block, 1 + var1);
      if (slope >= 2.6 + patch * 0.8) return setSurf(B.stone, B.stone, 1);
      if (hi > 112 && patch > 0.3) return setSurf(B.gravel, B.gravel, 2);
      if (hi > 128 && patch < -0.2) return setSurf(B.stone, B.stone, 1);
      return setSurf(B.grass_block, B.dirt, 2 + var1);
    }
    case SNOWY_PEAKS:
      if (slope >= 3.5 + patch) return setSurf(B.stone, B.stone, 1);
      return setSurf(B.snow_block, B.snow_block, 2 + var1);
    default: // plains, forest, birch forest
      if (slope >= 4 && hi > 80) return setSurf(B.stone, B.stone, 1);
      return setSurf(B.grass_block, B.dirt, 3 + var1);
  }
}

// ---------------------------------------------------------------------------
// Caves: two noise fields sampled on a 4-block grid and trilinearly interpolated.
// Spaghetti tunnels = where two independent noise surfaces are both near zero;
// cheese caverns = where a low-frequency field exceeds a threshold.
// ---------------------------------------------------------------------------
const CAVE_STEP = 4;
const SPAG_R2 = 0.0045;

function caveCheese(c, X, Y, Z) {
  return c.cheese.fbm3(X / 90, Y / 50, Z / 90, 2);
}
function caveSpagA(c, X, Y, Z) {
  return c.spagA.noise3(X / 64, Y / 42, Z / 64);
}
function caveSpagB(c, X, Y, Z) {
  return c.spagB.noise3(X / 64, Y / 42, Z / 64);
}

function trilerp(v000, v100, v010, v110, v001, v101, v011, v111, fx, fy, fz) {
  const a = v000 + (v100 - v000) * fx;
  const b = v010 + (v110 - v010) * fx;
  const d = v001 + (v101 - v001) * fx;
  const e = v011 + (v111 - v011) * fx;
  const f = a + (b - a) * fy;
  const g = d + (e - d) * fy;
  return f + (g - f) * fz;
}

/** Cave decision for one cell given the interpolated fields. */
function caveCarves(cheese, a, b, y, hi) {
  if (a * a + b * b < SPAG_R2) return true;
  // Caverns stay well below the surface and grow larger with depth.
  if (y < hi - 8) {
    const threshold = 0.5 + 0.12 * smoothstep(20, 60, y) + 0.2 * smoothstep(hi - 24, hi - 8, y);
    if (cheese > threshold) return true;
  }
  return false;
}

/**
 * Whether the cave carver removes world cell (x,y,z) of a *land* column with
 * top block hi. Computed from the same grid nodes as generateChunk so it agrees
 * bit-for-bit (used for trees rooted in neighbouring chunks).
 */
function carvedAt(c, x, y, z, hi) {
  if (y < 1 || y > hi) return false;
  const gx = Math.floor(x / CAVE_STEP), gy = Math.floor(y / CAVE_STEP), gz = Math.floor(z / CAVE_STEP);
  const X0 = gx * CAVE_STEP, Y0 = gy * CAVE_STEP, Z0 = gz * CAVE_STEP;
  const X1 = X0 + CAVE_STEP, Y1 = Y0 + CAVE_STEP, Z1 = Z0 + CAVE_STEP;
  const fx = (x - X0) / CAVE_STEP, fy = (y - Y0) / CAVE_STEP, fz = (z - Z0) / CAVE_STEP;
  const field = (fn) => trilerp(
    fn(c, X0, Y0, Z0), fn(c, X1, Y0, Z0), fn(c, X0, Y1, Z0), fn(c, X1, Y1, Z0),
    fn(c, X0, Y0, Z1), fn(c, X1, Y0, Z1), fn(c, X0, Y1, Z1), fn(c, X1, Y1, Z1), fx, fy, fz);
  return caveCarves(field(caveCheese), field(caveSpagA), field(caveSpagB), y, hi);
}

// ---------------------------------------------------------------------------
// Blobs: stone variants, dirt/gravel pockets and ores
// ---------------------------------------------------------------------------
const BLOB_TYPES = [
  { id: B.granite, count: 1.6, y0: 5, y1: 110, r0: 2.4, r1: 4.2 },
  { id: B.diorite, count: 1.6, y0: 5, y1: 110, r0: 2.4, r1: 4.2 },
  { id: B.andesite, count: 1.6, y0: 5, y1: 110, r0: 2.4, r1: 4.2 },
  { id: B.dirt, count: 1.2, y0: 5, y1: 120, r0: 1.8, r1: 3.0 },
  { id: B.gravel, count: 1.0, y0: 5, y1: 120, r0: 1.8, r1: 2.8 },
  { id: B.coal_ore, count: 16, y0: 5, y1: 128, r0: 1.0, r1: 1.9 },
  { id: B.iron_ore, count: 10, y0: 5, y1: 64, r0: 0.9, r1: 1.5 },
  { id: B.gold_ore, count: 2.5, y0: 5, y1: 32, r0: 0.9, r1: 1.4 },
  { id: B.diamond_ore, count: 1.0, y0: 5, y1: 16, r0: 0.8, r1: 1.3 },
];
const BLOB_REACH = 5; // max blob radius (+ margin)

function placeBlobs(c, blocks, cx, cz) {
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ncx = cx + dx, ncz = cz + dz;
      const rand = mulberry32(hash32(c.seed, ncx, ncz, 0xb10b));
      for (let t = 0; t < BLOB_TYPES.length; t++) {
        const T = BLOB_TYPES[t];
        const n = Math.floor(T.count) + (rand() < T.count % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          // Draw every parameter before culling so the stream stays in sync.
          const px = ncx * CHUNK_SIZE + rand() * CHUNK_SIZE;
          const pz = ncz * CHUNK_SIZE + rand() * CHUNK_SIZE;
          const py = T.y0 + rand() * (T.y1 - T.y0);
          const r = T.r0 + rand() * (T.r1 - T.r0);
          const rx = r * (0.8 + 0.4 * rand()), ry = r * (0.6 + 0.3 * rand()), rz = r * (0.8 + 0.4 * rand());
          const x0 = Math.max(ox, Math.ceil(px - rx)), x1 = Math.min(ox + 15, Math.floor(px + rx));
          const z0 = Math.max(oz, Math.ceil(pz - rz)), z1 = Math.min(oz + 15, Math.floor(pz + rz));
          if (x0 > x1 || z0 > z1) continue;
          const y0 = Math.max(1, Math.ceil(py - ry)), y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(py + ry));
          for (let y = y0; y <= y1; y++) {
            const ey = (y + 0.5 - py) / ry;
            for (let z = z0; z <= z1; z++) {
              const ez = (z + 0.5 - pz) / rz;
              for (let x = x0; x <= x1; x++) {
                const ex = (x + 0.5 - px) / rx;
                const d = ex * ex + ey * ey + ez * ez;
                if (d >= 1) continue;
                if (d > 0.6 && hash01(x, y, z, T.id) < 0.5) continue; // ragged edge
                const i = (x - ox) | ((z - oz) << 4) | (y << 8);
                if (blocks[i] === B.stone) blocks[i] = T.id;
              }
            }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------
const OAK = 0, BIG_OAK = 1, BIRCH = 2, SPRUCE = 3;

/** Writes tree blocks into one chunk; parts outside it are dropped. */
class TreeWriter {
  constructor(blocks, ox, oz) {
    this.blocks = blocks;
    this.ox = ox;
    this.oz = oz;
  }
  index(x, y, z) {
    const lx = x - this.ox, lz = z - this.oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 0 || y >= WORLD_HEIGHT) return -1;
    return lx | (lz << 4) | (y << 8);
  }
  log(x, y, z, id) {
    const i = this.index(x, y, z);
    if (i < 0) return;
    const cur = this.blocks[i];
    if (cur === AIR || IS_LEAVES[cur]) this.blocks[i] = id;
  }
  leaf(x, y, z, id) {
    const i = this.index(x, y, z);
    if (i >= 0 && this.blocks[i] === AIR) this.blocks[i] = id;
  }
  ground(x, y, z) {
    const i = this.index(x, y, z);
    if (i < 0) return;
    const cur = this.blocks[i];
    if (cur === B.grass_block || cur === B.podzol || cur === B.snowy_grass_block) this.blocks[i] = B.dirt;
  }
}

/** Classic blob canopy (oak / birch): two wide layers then two narrow ones. */
function roundCanopy(w, x, top, z, leaf, h) {
  for (let dy = -3; dy <= 0; dy++) {
    const r = dy <= -2 ? 2 : 1;
    const y = top + dy;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (dy === 0 || ((h >>> ((dx + 2) * 5 + dz + 2 + dy * 3 + 9)) & 1) === 0)) continue;
        w.leaf(x + dx, y, z + dz, leaf);
      }
    }
  }
}

function leafBall(w, x, y, z, rh, rv, leaf, salt) {
  const R = Math.ceil(rh);
  const V = Math.ceil(rv);
  for (let dy = -V; dy <= V; dy++) {
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = (dx * dx + dz * dz) / (rh * rh) + (dy * dy) / (rv * rv);
        if (d > 1) continue;
        if (d > 0.7 && hash01(x + dx, y + dy, z + dz, salt) < 0.35) continue;
        w.leaf(x + dx, y + dy, z + dz, leaf);
      }
    }
  }
}

function growTree(w, type, x, base, z, h) {
  switch (type) {
    case OAK:
    case BIRCH: {
      const log = type === OAK ? B.oak_log : B.birch_log;
      const leaf = type === OAK ? B.oak_leaves : B.birch_leaves;
      const t = type === OAK ? 4 + (h % 3) : 5 + (h % 3);
      for (let y = 0; y < t; y++) w.log(x, base + y, z, log);
      roundCanopy(w, x, base + t, z, leaf, h);
      break;
    }
    case BIG_OAK: {
      const t = 6 + (h % 4);
      for (let y = 0; y < t; y++) w.log(x, base + y, z, B.oak_log);
      const branches = 3 + ((h >>> 3) & 1);
      for (let k = 0; k < branches; k++) {
        const ang = (k / branches) * Math.PI * 2 + hash01(x, z, k, 0xb4) * 1.2;
        const len = 2 + ((h >>> (5 + k)) & 1);
        const y0 = base + Math.floor(t * 0.5) + (k & 1);
        const dx = Math.cos(ang), dz = Math.sin(ang);
        let ex = x, ey = y0, ez = z;
        for (let s = 1; s <= len; s++) {
          ex = x + Math.round(dx * s);
          ez = z + Math.round(dz * s);
          ey = y0 + Math.floor(s * 0.7);
          w.log(ex, ey, ez, B.oak_log);
        }
        leafBall(w, ex, ey + 1, ez, 2.4, 1.6, B.oak_leaves, 0x1eaf + k);
      }
      leafBall(w, x, base + t, z, 2.9, 2.1, B.oak_leaves, 0x1eaf);
      break;
    }
    case SPRUCE: {
      const t = 7 + (h % 4);
      const maxR = t >= 9 ? 3 : 2;
      for (let y = 0; y < t; y++) w.log(x, base + y, z, B.spruce_log);
      const first = 2 + ((h >>> 2) & 1); // bare trunk below the canopy
      for (let k = 0; base + t - k >= base + first; k++) {
        const y = base + t - k;
        const r = k === 0 ? 0 : Math.min(maxR, SPRUCE_RADII[Math.min(k - 1, SPRUCE_RADII.length - 1)]);
        const reach = r > 1 ? r + 1 : r; // round the layer's corners
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > reach) continue;
            w.leaf(x + dx, y, z + dz, B.spruce_leaves);
          }
        }
      }
      break;
    }
  }
}
const SPRUCE_RADII = [1, 1, 2, 1, 2, 3, 2, 3, 2, 3];

function treeType(biome, h) {
  const r = (h >>> 12) % 100;
  switch (biome) {
    case FOREST: return r < 28 ? BIRCH : r < 36 ? BIG_OAK : OAK;
    case BIRCH_FOREST: return r < 90 ? BIRCH : OAK;
    case TAIGA:
    case SNOWY_TUNDRA:
    case MOUNTAINS: return SPRUCE;
    case PLAINS: return r < 20 ? BIG_OAK : OAK;
    default: return OAK;
  }
}

/**
 * Tree rooted at world column (x,z), or null. Pure: every chunk that the tree
 * overlaps derives the same answer from the seed alone.
 */
function treeAt(c, x, z, h) {
  const col = sampleColumn(c, x, z);
  const biome = col.biome;
  const density = TREE_DENSITY[biome];
  if (density === 0) return null;
  // Clumps and clearings.
  const clump = 0.35 + 1.1 * smoothstep(-0.5, 0.5, c.patch.noise2(x / 48 + 300, z / 48));
  if (hash01(h, 0x7ee) >= density * clump) return null;
  const hi = col.hi;
  if (hi < SEA_LEVEL + 1 || hi > 200) return null;
  const hx0 = sampleColumn(c, x - 1, z).hi, hx1 = sampleColumn(c, x + 1, z).hi;
  const hz0 = sampleColumn(c, x, z - 1).hi, hz1 = sampleColumn(c, x, z + 1).hi;
  const slope = Math.max(Math.abs(hx1 - hx0), Math.abs(hz1 - hz0)) * 0.5;
  const top = surfaceFor(c, x, z, hi, biome, slope).top;
  if (top !== B.grass_block && top !== B.podzol && top !== B.snowy_grass_block && top !== B.dirt) return null;
  if (carvedAt(c, x, hi, z, hi)) return null;
  return { type: treeType(biome, h), base: hi + 1 };
}

function placeTrees(c, blocks, cx, cz) {
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  const w = new TreeWriter(blocks, ox, oz);
  // One candidate per 4×4 cell; cells are scanned over the chunk plus the
  // reach of the largest tree so canopies continue seamlessly across borders.
  const g0x = Math.floor((ox - TREE_REACH) / 4), g1x = Math.floor((ox + 15 + TREE_REACH) / 4);
  const g0z = Math.floor((oz - TREE_REACH) / 4), g1z = Math.floor((oz + 15 + TREE_REACH) / 4);
  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      const h = hash32(c.seed, gx, gz, 0x7e3e);
      const x = gx * 4 + (h & 3), z = gz * 4 + ((h >>> 2) & 3);
      if (x < ox - TREE_REACH || x > ox + 15 + TREE_REACH || z < oz - TREE_REACH || z > oz + 15 + TREE_REACH) continue;
      const tree = treeAt(c, x, z, h);
      if (!tree) continue;
      w.ground(x, tree.base - 1, z);
      growTree(w, tree.type, x, tree.base, z, h);
    }
  }
}

// ---------------------------------------------------------------------------
// Chunk generation
// ---------------------------------------------------------------------------
const PAD = 2;
const PW = CHUNK_SIZE + PAD * 2; // padded grid width (20)

/**
 * Generate one chunk column.
 * @returns {{blocks: Uint8Array, maxY: number}} blocks indexed x | z<<4 | y<<8
 */
export function generateChunk(seed, cx, cz) {
  const c = context(seed);
  const blocks = new Uint8Array(CHUNK_VOLUME);
  const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;

  // 1. Column data on the padded grid (neighbour heights feed slopes and the
  //    "no caves near water" rule).
  const H = new Int16Array(PW * PW);
  const BI = new Uint8Array(PW * PW);
  const COLD_WATER = new Uint8Array(PW * PW);
  for (let pz = 0; pz < PW; pz++) {
    for (let px = 0; px < PW; px++) {
      const col = sampleColumn(c, ox + px - PAD, oz + pz - PAD);
      const i = px + pz * PW;
      H[i] = col.hi;
      BI[i] = col.biome;
      COLD_WATER[i] = col.temp < FREEZE ? 1 : 0;
    }
  }

  // 2. Fill columns.
  const topBlock = new Uint8Array(256);
  const caveLimit = new Int16Array(256); // carving allowed below this y (or above WATER_TOP)
  let maxH = WATER_TOP;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = ox + lx, z = oz + lz;
      const pi = lx + PAD + (lz + PAD) * PW;
      const hi = H[pi];
      const biome = BI[pi];
      const slope = Math.max(Math.abs(H[pi + 1] - H[pi - 1]), Math.abs(H[pi + PW] - H[pi - PW])) * 0.5;
      const s = surfaceFor(c, x, z, hi, biome, slope);
      const col = lx | (lz << 4);
      topBlock[col] = s.top;
      if (hi > maxH) maxH = hi;

      let limit = 999;
      for (let dz = -PAD; dz <= PAD; dz++) {
        for (let dx = -PAD; dx <= PAD; dx++) {
          const hn = H[pi + dx + dz * PW];
          if (hn < WATER_TOP && hn - 4 < limit) limit = hn - 4;
        }
      }
      caveLimit[col] = limit;

      blocks[col] = B.bedrock;
      const fillerTop = hi - s.fillerDepth;
      const underTop = fillerTop - s.underDepth;
      for (let y = 1; y <= hi; y++) {
        let id;
        if (y <= 3 && hash01(x, y, z, c.seed) < (4 - y) * 0.25) id = B.bedrock;
        else if (y === hi) id = s.top;
        else if (y > fillerTop) id = s.filler;
        else if (y > underTop) id = s.under;
        else id = B.stone;
        blocks[col | (y << 8)] = id;
      }
      for (let y = hi + 1; y <= WATER_TOP; y++) blocks[col | (y << 8)] = B.water;
      if (hi < WATER_TOP && COLD_WATER[pi]) blocks[col | (WATER_TOP << 8)] = B.ice;
    }
  }

  // 3. Stone variants and ores.
  placeBlobs(c, blocks, cx, cz);

  // 4. Caves.
  carveCaves(c, blocks, ox, oz, H, caveLimit, maxH);

  // 5. Trees (including the parts of neighbouring trees reaching into this chunk).
  placeTrees(c, blocks, cx, cz);

  // 6. Vegetation.
  decorate(c, blocks, ox, oz, H, BI, COLD_WATER, topBlock);

  return { blocks, maxY: computeMaxY(blocks) };
}

function carveCaves(c, blocks, ox, oz, H, caveLimit, maxH) {
  const ny = Math.ceil((maxH + 1) / CAVE_STEP) + 1;
  const nodes = 5 * 5 * ny;
  const fc = new Float64Array(nodes), fa = new Float64Array(nodes), fb = new Float64Array(nodes);
  for (let gy = 0; gy < ny; gy++) {
    for (let gz = 0; gz < 5; gz++) {
      for (let gx = 0; gx < 5; gx++) {
        const X = ox + gx * CAVE_STEP, Y = gy * CAVE_STEP, Z = oz + gz * CAVE_STEP;
        const n = gx + gz * 5 + gy * 25;
        fc[n] = caveCheese(c, X, Y, Z);
        fa[n] = caveSpagA(c, X, Y, Z);
        fb[n] = caveSpagB(c, X, Y, Z);
      }
    }
  }
  for (let lz = 0; lz < 16; lz++) {
    const gz = lz >> 2, fz = (lz & 3) / CAVE_STEP;
    for (let lx = 0; lx < 16; lx++) {
      const gx = lx >> 2, fx = (lx & 3) / CAVE_STEP;
      const col = lx | (lz << 4);
      const hi = H[lx + PAD + (lz + PAD) * PW];
      const limit = caveLimit[col];
      for (let y = 1; y <= hi; y++) {
        if (y >= limit && y <= WATER_TOP) continue; // keep a thick floor under any water
        const i = col | (y << 8);
        const cur = blocks[i];
        if (cur === B.bedrock || cur === B.water || cur === B.ice) continue;
        const gy = y >> 2, fy = (y & 3) / CAVE_STEP;
        const n = gx + gz * 5 + gy * 25;
        const cheese = trilerp(fc[n], fc[n + 1], fc[n + 25], fc[n + 26], fc[n + 5], fc[n + 6], fc[n + 30], fc[n + 31], fx, fy, fz);
        const a = trilerp(fa[n], fa[n + 1], fa[n + 25], fa[n + 26], fa[n + 5], fa[n + 6], fa[n + 30], fa[n + 31], fx, fy, fz);
        const b = trilerp(fb[n], fb[n + 1], fb[n + 25], fb[n + 26], fb[n + 5], fb[n + 6], fb[n + 30], fb[n + 31], fx, fy, fz);
        if (caveCarves(cheese, a, b, y, hi)) blocks[i] = y <= LAVA_LEVEL ? B.lava : AIR;
      }
    }
  }
}

function decorate(c, blocks, ox, oz, H, BI, COLD_WATER, topBlock) {
  const seed = c.seed;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const x = ox + lx, z = oz + lz;
      const pi = lx + PAD + (lz + PAD) * PW;
      const hi = H[pi];
      const biome = BI[pi];
      const col = lx | (lz << 4);
      const r = hash01(seed, x, z, 0xdec0);

      if (hi < WATER_TOP) {
        // Lily pads float on shallow wetland water.
        if (biome === SWAMP && WATER_TOP - hi <= 3 && r < 0.09) {
          const i = col | ((WATER_TOP + 1) << 8);
          if (blocks[col | (WATER_TOP << 8)] === B.water && blocks[i] === AIR) blocks[i] = B.lily_pad;
        }
        continue;
      }
      const ground = col | (hi << 8);
      const top = blocks[ground];
      if (top !== topBlock[col] || hi + 3 >= WORLD_HEIGHT) continue; // carved away or built over
      const above = ground + 256;
      if (blocks[above] !== AIR) continue;
      const grassy = top === B.grass_block || top === B.podzol;
      const sandy = top === B.sand;

      // Sugar cane on shores directly beside open water.
      if ((grassy || sandy || top === B.dirt) && hi === WATER_TOP && r < 0.22) {
        let wet = false;
        for (let k = 0; k < 4 && !wet; k++) {
          const ni = pi + (k === 0 ? 1 : k === 1 ? -1 : k === 2 ? PW : -PW);
          wet = H[ni] < WATER_TOP && !COLD_WATER[ni];
        }
        if (wet) {
          const tall = 1 + (hash32(seed, x, z, 0xca9e) % 3);
          for (let k = 0; k < tall; k++) {
            if (blocks[above + k * 256] !== AIR) break;
            blocks[above + k * 256] = B.sugar_cane;
          }
          continue;
        }
      }

      const r2 = hash01(seed, x, z, 0xf10a);
      const flowers = c.patch.noise2(x / 24 + 90, z / 24);
      let plant = AIR;
      switch (biome) {
        case PLAINS:
          if (!grassy) break;
          if (r < 0.0012) plant = B.pumpkin;
          else if (flowers > 0.45 && r < 0.14) plant = r2 < 0.5 ? B.dandelion : B.poppy;
          else if (r < 0.018) plant = r2 < 0.6 ? B.dandelion : B.poppy;
          else if (r < 0.08) plant = B.tall_grass;
          else if (r < 0.42) plant = B.short_grass;
          break;
        case FOREST:
        case BIRCH_FOREST:
          if (!grassy) break;
          if (r > 0.9992) plant = B.pumpkin;
          else if (r < 0.018 && shaded(blocks, ground)) plant = r2 < 0.5 ? B.red_mushroom : B.brown_mushroom;
          else if (r < 0.03) plant = r2 < 0.5 ? B.dandelion : B.poppy;
          else if (r < 0.045) plant = B.fern;
          else if (r < 0.07) plant = B.tall_grass;
          else if (r < 0.26) plant = B.short_grass;
          break;
        case TAIGA:
          if (!grassy) break;
          if (r < 0.02 && shaded(blocks, ground)) plant = r2 < 0.4 ? B.red_mushroom : B.brown_mushroom;
          else if (r < 0.14) plant = B.fern;
          else if (r < 0.2) plant = B.short_grass;
          else if (r < 0.215) plant = B.tall_grass;
          break;
        case SWAMP:
          if (!grassy) break;
          if (r < 0.03) plant = B.blue_orchid;
          else if (r < 0.045 && shaded(blocks, ground)) plant = B.brown_mushroom;
          else if (r < 0.08) plant = B.tall_grass;
          else if (r < 0.32) plant = B.short_grass;
          break;
        case MOUNTAINS:
          if (grassy && r < 0.12) plant = B.short_grass;
          break;
        case DESERT:
          if (!sandy) break;
          if (r < 0.06 && ((x % 3) + 3) % 3 === 0 && ((z % 3) + 3) % 3 === 0 && cactusRoom(H, pi, hi)) {
            const tall = 1 + (hash32(seed, x, z, 0xcac7) % 3);
            for (let k = 0; k < tall; k++) blocks[above + k * 256] = B.cactus;
          } else if (r > 0.985) plant = B.dead_bush;
          break;
        case BEACH:
          if (sandy && r > 0.996) plant = B.dead_bush;
          break;
      }
      if (plant === AIR) continue;
      if (plant === B.tall_grass) {
        if (blocks[above + 256] !== AIR) continue;
        blocks[above] = B.tall_grass;
        blocks[above + 256] = B.tall_grass_top;
      } else {
        blocks[above] = plant;
      }
    }
  }
}

/** Leaves somewhere in the few blocks above the ground (forest floor shade). */
function shaded(blocks, ground) {
  for (let k = 2; k <= 12; k++) {
    const i = ground + k * 256;
    if (i >= CHUNK_VOLUME) return false;
    if (IS_LEAVES[blocks[i]]) return true;
  }
  return false;
}

/** Cactus needs its four side neighbours free (no taller terrain beside it). */
function cactusRoom(H, pi, hi) {
  return H[pi + 1] <= hi && H[pi - 1] <= hi && H[pi + PW] <= hi && H[pi - PW] <= hi;
}

function computeMaxY(blocks) {
  const words = new Uint32Array(blocks.buffer, blocks.byteOffset, blocks.length >> 2);
  for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
    const base = y << 6; // 256 bytes per layer = 64 words
    for (let k = 0; k < 64; k++) if (words[base + k] !== 0) return y + 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Terrain surface (top block before caves/trees) and biome name of a column. */
export function surfaceInfo(seed, x, z) {
  const col = sampleColumn(context(seed), Math.floor(x), Math.floor(z));
  return { height: col.hi, biome: BIOME_NAMES[col.biome] };
}

/** Biome name at a world column. */
export function biomeAt(seed, x, z) {
  return BIOME_NAMES[sampleColumn(context(seed), Math.floor(x), Math.floor(z)).biome];
}
