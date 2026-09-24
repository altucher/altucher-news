// Sky + block light flood fill over the 48×48 region formed by a chunk and its
// 8 neighbours. Pure (worker-safe); light is recomputed for every mesh job and
// never stored.
//
// Region layout: x,z ∈ [0,48) (the centre chunk occupies [16,32)), layer
// L = y + 1. Layer 0 is an opaque pad under the world and the top layer is
// always air, so neighbour lookups from any block never leave the arrays.
//   index = x + z * 48 + L * 2304

import { CHUNK_SIZE, WORLD_HEIGHT } from '../config.js';
import { LIGHT_EMIT, LIGHT_OPACITY, BLOCK } from '../blocks.js';

export const REGION = CHUNK_SIZE * 3; // 48
export const REGION_AREA = REGION * REGION; // 2304
const PAD_BLOCK = BLOCK.bedrock;

// Scratch buffers, grown on demand and reused (one job runs at a time per thread).
let capacity = 0;
let ids = null;
let sky = null;
let blk = null;
let ids32 = null;
const QUEUE_SIZE = 1 << 20;
const QUEUE_MASK = QUEUE_SIZE - 1;
let queue = null;
const colLight = new Uint8Array(REGION_AREA);
const colTop = new Int32Array(REGION_AREA);

function ensure(cells) {
  if (cells <= capacity) return;
  capacity = cells;
  ids = new Uint8Array(cells);
  sky = new Uint8Array(cells);
  blk = new Uint8Array(cells);
  ids32 = new Uint32Array(ids.buffer);
  if (!queue) queue = new Int32Array(QUEUE_SIZE);
}

/** Highest non-air y + 1 of a chunk (0 when empty). */
export function chunkTop(blocks) {
  const words = new Uint32Array(blocks.buffer, blocks.byteOffset, blocks.length >> 2);
  for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
    const base = y << 6;
    for (let k = 0; k < 64; k++) if (words[base + k] !== 0) return y + 1;
  }
  return 0;
}

/**
 * Copy the 3×3 chunk neighbourhood into region arrays and light it.
 * @param {(Uint8Array|null)[]} neighbors index (dz+1)*3 + (dx+1); null = all air
 * @returns {{ids: Uint8Array, sky: Uint8Array, block: Uint8Array, layers: number, centerTop: number}}
 *   (views into scratch buffers: valid until the next call)
 */
export function lightRegion(neighbors) {
  let top = 0;
  const tops = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < 9; k++) {
    if (neighbors[k]) tops[k] = chunkTop(neighbors[k]);
    if (tops[k] > top) top = tops[k];
  }
  const layers = top + 2; // pad below y=0 + at least one air layer above everything
  const cells = layers * REGION_AREA;
  ensure(cells);

  // Copy blocks: 16-byte rows as 4 aligned 32-bit words.
  ids.fill(PAD_BLOCK, 0, REGION_AREA);
  ids.fill(0, REGION_AREA, cells);
  const copyLayers = Math.min(layers - 1, WORLD_HEIGHT);
  for (let k = 0; k < 9; k++) {
    const src = neighbors[k];
    if (!src || tops[k] === 0) continue;
    const s32 = new Uint32Array(src.buffer, src.byteOffset, src.length >> 2);
    const ox = (k % 3) * CHUNK_SIZE, oz = ((k / 3) | 0) * CHUNK_SIZE;
    const ylim = Math.min(tops[k], copyLayers);
    for (let y = 0; y < ylim; y++) {
      const dstLayer = ((y + 1) * REGION_AREA + ox) >> 2;
      for (let z = 0; z < 16; z++) {
        const s = (z << 2) | (y << 6);
        const d = dstLayer + (((oz + z) * REGION) >> 2);
        ids32[d] = s32[s];
        ids32[d + 1] = s32[s + 1];
        ids32[d + 2] = s32[s + 2];
        ids32[d + 3] = s32[s + 3];
      }
    }
  }

  computeSky(layers);
  computeBlock(layers);
  return {
    ids: ids.subarray(0, cells),
    sky: sky.subarray(0, cells),
    block: blk.subarray(0, cells),
    layers,
    centerTop: tops[4],
  };
}

// ---------------------------------------------------------------------------
// Sky light
// ---------------------------------------------------------------------------
function computeSky(layers) {
  const cells = layers * REGION_AREA;
  sky.fill(0, 0, cells);

  // Vertical pass, top layer down: full strength through clear cells, minus the
  // opacity of leaves/water/ice. colTop = lowest layer that is still 15.
  colLight.fill(15);
  colTop.fill(1);
  let lit = REGION_AREA;
  for (let L = layers - 1; L >= 1 && lit > 0; L--) {
    const base = L * REGION_AREA;
    for (let c = 0; c < REGION_AREA; c++) {
      let v = colLight[c];
      if (v === 0) continue;
      const op = LIGHT_OPACITY[ids[base + c]];
      if (op !== 0) {
        if (v === 15) colTop[c] = L + 1;
        v = op >= 15 ? 0 : v > op ? v - op : 0;
        colLight[c] = v;
        if (v === 0) {
          lit--;
          continue;
        }
      }
      sky[base + c] = v;
    }
  }

  // Seed the flood fill with lit cells that have a darker open horizontal
  // neighbour. Above every neighbouring column's colTop all cells are 15.
  let tail = 0;
  let maxTop = 0;
  for (let c = 0; c < REGION_AREA; c++) if (colTop[c] > maxTop) maxTop = colTop[c];
  for (let L = 1; L < maxTop; L++) {
    const base = L * REGION_AREA;
    for (let z = 0; z < REGION; z++) {
      for (let x = 0; x < REGION; x++) {
        const c = x + z * REGION;
        const i = base + c;
        const v = sky[i];
        if (v < 2) continue;
        const need = v - 1;
        if (
          (x > 0 && sky[i - 1] < need && LIGHT_OPACITY[ids[i - 1]] < 15) ||
          (x < REGION - 1 && sky[i + 1] < need && LIGHT_OPACITY[ids[i + 1]] < 15) ||
          (z > 0 && sky[i - REGION] < need && LIGHT_OPACITY[ids[i - REGION]] < 15) ||
          (z < REGION - 1 && sky[i + REGION] < need && LIGHT_OPACITY[ids[i + REGION]] < 15)
        ) {
          queue[tail++ & QUEUE_MASK] = x | (z << 6) | (L << 12);
        }
      }
    }
  }
  flood(sky, tail, layers, true);
}

// ---------------------------------------------------------------------------
// Block light
// ---------------------------------------------------------------------------
function computeBlock(layers) {
  const cells = layers * REGION_AREA;
  blk.fill(0, 0, cells);
  let tail = 0;
  for (let L = 1; L < layers; L++) {
    const base = L * REGION_AREA;
    for (let c = 0; c < REGION_AREA; c++) {
      const id = ids[base + c];
      if (id === 0) continue;
      const e = LIGHT_EMIT[id];
      if (e === 0) continue;
      blk[base + c] = e;
      queue[tail++ & QUEUE_MASK] = (c % REGION) | (((c / REGION) | 0) << 6) | (L << 12);
    }
  }
  if (tail > 0) flood(blk, tail, layers, false);
}

/**
 * Breadth-first spread. Queue entries are packed x | z<<6 | layer<<12.
 * Sky light loses 1 + opacity per step; block light loses max(1, opacity).
 */
function flood(light, tail, layers, isSky) {
  let head = 0;
  const topLayer = layers - 1;
  while (head !== tail) {
    const e = queue[head++ & QUEUE_MASK];
    const x = e & 63, z = (e >> 6) & 63, L = e >> 12;
    const i = x + z * REGION + L * REGION_AREA;
    const v = light[i];
    if (v <= 1) continue;
    for (let d = 0; d < 6; d++) {
      let n, ne;
      switch (d) {
        case 0: if (x === REGION - 1) continue; n = i + 1; ne = e + 1; break;
        case 1: if (x === 0) continue; n = i - 1; ne = e - 1; break;
        case 2: if (z === REGION - 1) continue; n = i + REGION; ne = e + 64; break;
        case 3: if (z === 0) continue; n = i - REGION; ne = e - 64; break;
        case 4: if (L === topLayer) continue; n = i + REGION_AREA; ne = e + 4096; break;
        default: if (L <= 1) continue; n = i - REGION_AREA; ne = e - 4096; break;
      }
      const op = LIGHT_OPACITY[ids[n]];
      if (op >= 15) continue;
      const nv = isSky ? v - 1 - op : v - (op > 1 ? op : 1);
      if (nv > light[n]) {
        light[n] = nv;
        if (nv > 1) queue[tail++ & QUEUE_MASK] = ne;
      }
    }
  }
}
