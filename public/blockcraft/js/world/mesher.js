// Chunk mesher: turns a chunk (plus its 8 neighbours) into packed vertex
// buffers per 16³ section and render layer. Pure (worker-safe).
//
// Vertex format (16 bytes, see ARCHITECTURE.md), written as four 32-bit words
// (typed arrays are little-endian on every platform browsers run on):
//   w0 = x | y << 16        (1/16 block units, x relative to chunk, y absolute)
//   w1 = z | layer << 16    (texture array layer)
//   w2 = u | v << 8 | face << 16 | (ao | wave << 2) << 24
//   w3 = sky | block << 8 | id << 16   (light = level * 17)
//
// Quad corners are emitted in the order (s,t) = (0,0) (1,0) (1,1) (0,1) where
// s runs along the face tangent T (+u) and t along −B (up the texture). Since
// B × T = N for every face this order is counter-clockwise seen from outside.

import { MAX_QUADS, SECTIONS, SECTION_SIZE } from '../config.js';
import {
  BLOCK, FACE_LAYER, IS_OPAQUE, IS_LEAVES, RENDER_LAYER, MODEL_OF, MODEL, LAYER, WAVE_OF, WAVE, BLOCKS,
} from '../blocks.js';
import { hash32 } from '../math.js';
import { lightRegion, REGION, REGION_AREA } from './lighting.js';

const CHUNK_OFFSET = 16; // centre chunk origin inside the 48×48 region
const STEP_X = 1, STEP_Z = REGION, STEP_Y = REGION_AREA;
const FACE_STEP = [STEP_X, -STEP_X, STEP_Y, -STEP_Y, STEP_Z, -STEP_Z];

// Tangent (T) and up (−B) region steps per face; see the tangent table.
const T_STEP = [-STEP_Z, STEP_Z, STEP_X, STEP_X, STEP_X, -STEP_X];
const U_STEP = [STEP_Y, STEP_Y, -STEP_Z, STEP_Z, STEP_Y, STEP_Y];
const CORNER_S = [0, 1, 1, 0];
const CORNER_T = [0, 0, 1, 1];

// Cells that darken vertex AO: full opaque cubes and leaves.
const AO_OCC = new Uint8Array(256);
for (let id = 0; id < 256; id++) AO_OCC[id] = IS_OPAQUE[id] || IS_LEAVES[id] ? 1 : 0;

const WATER = BLOCK.water, ICE = BLOCK.ice, LILY_PAD = BLOCK.lily_pad;
const TALL_GRASS = BLOCK.tall_grass;
const FLAT = new Uint8Array(256);
for (let id = 0; id < 256; id++) if (BLOCKS[id] && BLOCKS[id].flat) FLAT[id] = 1;

// ---------------------------------------------------------------------------
// Output buffers (one per render layer, reused per section)
// ---------------------------------------------------------------------------
const WORDS_PER_QUAD = 16;
class LayerBuffer {
  constructor() {
    this.data = new Uint32Array(MAX_QUADS * WORDS_PER_QUAD);
    this.quads = 0;
  }
  take() {
    if (this.quads === 0) return null;
    const out = this.data.slice(0, this.quads * WORDS_PER_QUAD).buffer;
    this.quads = 0;
    return out;
  }
}
const buffers = [null, new LayerBuffer(), new LayerBuffer(), new LayerBuffer()];

// Per-quad scratch: positions (1/16 units), uvs, ao, light (0..255).
const QX = new Int32Array(4), QY = new Int32Array(4), QZ = new Int32Array(4);
const QU = new Int32Array(4), QV = new Int32Array(4);
const QAO = new Int32Array(4), QSKY = new Int32Array(4), QBLK = new Int32Array(4);

/**
 * Append the quad in the scratch arrays. The vertex order is rotated when the
 * 1–3 diagonal is brighter so indices 0,1,2 / 0,2,3 split along it.
 */
function emitQuad(buf, face, texLayer, wave, id) {
  if (buf.quads >= MAX_QUADS) return; // a section can never realistically get here
  const s0 = QAO[0] * 1024 + QSKY[0] + QBLK[0];
  const s1 = QAO[1] * 1024 + QSKY[1] + QBLK[1];
  const s2 = QAO[2] * 1024 + QSKY[2] + QBLK[2];
  const s3 = QAO[3] * 1024 + QSKY[3] + QBLK[3];
  const rot = s1 + s3 > s0 + s2 ? 1 : 0;
  const d = buf.data;
  let o = buf.quads * WORDS_PER_QUAD;
  const w1hi = texLayer << 16;
  const faceBits = face << 16;
  const idBits = id << 16;
  for (let n = 0; n < 4; n++) {
    const k = (n + rot) & 3;
    d[o] = QX[k] | (QY[k] << 16);
    d[o + 1] = QZ[k] | w1hi;
    d[o + 2] = QU[k] | (QV[k] << 8) | faceBits | ((QAO[k] | (wave << 2)) << 24);
    d[o + 3] = QSKY[k] | (QBLK[k] << 8) | idBits;
    o += 4;
  }
  buf.quads++;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Corner positions of face f of the box [x0,x1]×[y0,y1]×[z0,z1] (1/16 units)
 * with uvs spanning [u0,u1]×[v0,v1] (v0 at the top edge).
 */
function boxFace(f, x0, y0, z0, x1, y1, z1, u0, v0, u1, v1) {
  for (let k = 0; k < 4; k++) {
    const s = CORNER_S[k], t = CORNER_T[k];
    switch (f) {
      case 0: QX[k] = x1; QY[k] = t ? y1 : y0; QZ[k] = s ? z0 : z1; break;
      case 1: QX[k] = x0; QY[k] = t ? y1 : y0; QZ[k] = s ? z1 : z0; break;
      case 2: QX[k] = s ? x1 : x0; QY[k] = y1; QZ[k] = t ? z0 : z1; break;
      case 3: QX[k] = s ? x1 : x0; QY[k] = y0; QZ[k] = t ? z1 : z0; break;
      case 4: QX[k] = s ? x1 : x0; QY[k] = t ? y1 : y0; QZ[k] = z1; break;
      default: QX[k] = s ? x0 : x1; QY[k] = t ? y1 : y0; QZ[k] = z0; break;
    }
    QU[k] = s ? u1 : u0;
    QV[k] = t ? v0 : v1;
  }
}

/** Constant light/AO for all four corners (plants, torches). */
function flatLight(sky, blk, ao) {
  for (let k = 0; k < 4; k++) {
    QSKY[k] = sky;
    QBLK[k] = blk;
    QAO[k] = ao;
  }
}

/**
 * Per-corner Minecraft-style AO and smooth light for face f of cell i.
 * Light = average over the non-opaque cells of the 2×2 block touching the
 * corner on the face's outer side (the diagonal cell only when reachable).
 */
function smoothCorners(R, i, f, withAO) {
  const ids = R.ids, sky = R.sky, blk = R.block;
  const o = i + FACE_STEP[f];
  const ts = T_STEP[f], us = U_STEP[f];
  const sky0 = sky[o], blk0 = blk[o];
  for (let k = 0; k < 4; k++) {
    const a = CORNER_S[k] ? ts : -ts;
    const b = CORNER_T[k] ? us : -us;
    const c1 = ids[o + a], c2 = ids[o + b], c3 = ids[o + a + b];
    const op1 = IS_OPAQUE[c1], op2 = IS_OPAQUE[c2];
    let ss = sky0, bs = blk0, n = 1;
    if (!op1) { ss += sky[o + a]; bs += blk[o + a]; n++; }
    if (!op2) { ss += sky[o + b]; bs += blk[o + b]; n++; }
    if (!IS_OPAQUE[c3] && !(op1 && op2)) { ss += sky[o + a + b]; bs += blk[o + a + b]; n++; }
    QSKY[k] = Math.round((ss * 17) / n);
    QBLK[k] = Math.round((bs * 17) / n);
    if (withAO) {
      const s1 = AO_OCC[c1], s2 = AO_OCC[c2];
      QAO[k] = s1 && s2 ? 0 : 3 - s1 - s2 - AO_OCC[c3];
    } else {
      QAO[k] = 3;
    }
  }
}

/** Leaves whose six neighbours are all leaves or opaque (invisible from outside). */
function enclosedLeaves(ids, i) {
  for (let f = 0; f < 6; f++) {
    const n = ids[i + FACE_STEP[f]];
    if (!IS_OPAQUE[n] && !IS_LEAVES[n]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Block models
// ---------------------------------------------------------------------------
function meshCube(R, i, id, px, py, pz) {
  const ids = R.ids;
  const layer = RENDER_LAYER[id];
  const buf = buffers[layer];
  const leaves = IS_LEAVES[id];
  const wave = WAVE_OF[id];
  let enclosed = -1;
  for (let f = 0; f < 6; f++) {
    const n = ids[i + FACE_STEP[f]];
    if (IS_OPAQUE[n]) continue;
    if (n === id && layer === LAYER.TRANSLUCENT) continue;
    if (leaves && IS_LEAVES[n]) {
      if (enclosed < 0) enclosed = enclosedLeaves(ids, i) ? 1 : 0;
      if (enclosed || enclosedLeaves(ids, i + FACE_STEP[f])) continue;
    }
    boxFace(f, px, py, pz, px + 16, py + 16, pz + 16, 0, 0, 16, 16);
    smoothCorners(R, i, f, true);
    emitQuad(buf, f, FACE_LAYER[id * 6 + f], wave, id);
  }
}

function meshLiquid(R, i, id, px, py, pz) {
  const ids = R.ids;
  const buf = buffers[RENDER_LAYER[id]];
  const covered = ids[i + STEP_Y] === id;
  const top = covered ? 16 : 14; // surface sits 2/16 below the block top
  for (let f = 0; f < 6; f++) {
    const n = ids[i + FACE_STEP[f]];
    if (n === id || IS_OPAQUE[n]) continue;
    if (id === WATER && n === ICE) continue; // the ice sheet is the surface
    // Side faces show the texture's lower `top` rows; top/bottom the full square.
    const v0 = f === 2 || f === 3 ? 0 : 16 - top;
    boxFace(f, px, py, pz, px + 16, py + top, pz + 16, 0, v0, 16, 16);
    smoothCorners(R, i, f, false);
    const wave = f === 2 && id === WATER ? WAVE.LIQUID : WAVE_OF[id];
    emitQuad(buf, f, FACE_LAYER[id * 6 + f], wave, id);
  }
}

function meshCross(R, i, id, px, py, pz, wx, wz) {
  const buf = buffers[RENDER_LAYER[id]];
  const tex = FACE_LAYER[id * 6 + 2];
  const sky = R.sky[i] * 17, blk = R.block[i] * 17;
  const h = hash32(wx, wz, 0x9a55);
  if (FLAT[id]) {
    // Lily pad: horizontal quad just above the water, randomly rotated; it
    // bobs with the water surface.
    boxFace(2, px, py, pz, px + 16, py + 1, pz + 16, 0, 0, 16, 16);
    for (let r = h & 3; r > 0; r--) {
      const u = QU[0], v = QV[0];
      QU[0] = QU[1]; QV[0] = QV[1];
      QU[1] = QU[2]; QV[1] = QV[2];
      QU[2] = QU[3]; QV[2] = QV[3];
      QU[3] = u; QV[3] = v;
    }
    flatLight(sky, blk, 3);
    emitQuad(buf, 2, tex, WAVE.LIQUID, id);
    return;
  }
  // Stacked plants (tall grass lower half, sugar cane below more cane) keep
  // their top edge still so the stack does not tear apart when it sways.
  const above = R.ids[i + STEP_Y];
  const wave = id === TALL_GRASS || above === id ? WAVE.NONE : WAVE_OF[id];
  // Random horizontal offset (±2/16) inside the inset diagonal span [2,14].
  const ox = ((h >>> 4) % 5) - 2, oz = ((h >>> 8) % 5) - 2;
  const a = 2, b = 14;
  flatLight(sky, blk, 3);
  for (let q = 0; q < 2; q++) {
    const za = q === 0 ? a : b, zb = q === 0 ? b : a;
    QX[0] = px + a + ox; QY[0] = py; QZ[0] = pz + za + oz;
    QX[1] = px + b + ox; QY[1] = py; QZ[1] = pz + zb + oz;
    QX[2] = px + b + ox; QY[2] = py + 16; QZ[2] = pz + zb + oz;
    QX[3] = px + a + ox; QY[3] = py + 16; QZ[3] = pz + za + oz;
    QU[0] = 0; QV[0] = 16;
    QU[1] = 16; QV[1] = 16;
    QU[2] = 16; QV[2] = 0;
    QU[3] = 0; QV[3] = 0;
    emitQuad(buf, 6, tex, wave, id);
  }
}

function meshTorch(R, i, id, px, py, pz) {
  const buf = buffers[RENDER_LAYER[id]];
  const sky = R.sky[i] * 17, blk = R.block[i] * 17;
  const x0 = px + 7, x1 = px + 9, z0 = pz + 7, z1 = pz + 9, y0 = py, y1 = py + 10;
  flatLight(sky, blk, 3);
  for (const f of TORCH_FACES) {
    if (f === 2) boxFace(2, x0, y0, z0, x1, y1, z1, 7, 6, 9, 8);
    else boxFace(f, x0, y0, z0, x1, y1, z1, 7, 6, 9, 16);
    emitQuad(buf, f, FACE_LAYER[id * 6 + f], WAVE.NONE, id);
  }
}
const TORCH_FACES = [0, 1, 2, 4, 5];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Mesh one chunk.
 * @param {(Uint8Array|null)[]} neighbors 9 chunk block arrays, index (dz+1)*3+(dx+1)
 * @param {number} cx
 * @param {number} cz
 * @returns {{sy:number, opaque:ArrayBuffer|null, cutout:ArrayBuffer|null, translucent:ArrayBuffer|null}[]}
 */
export function meshChunk(neighbors, cx, cz) {
  const R = lightRegion(neighbors);
  const ids = R.ids;
  const sections = [];
  const ox = cx * 16, oz = cz * 16;
  for (let sy = 0; sy < SECTIONS; sy++) {
    const yStart = sy * SECTION_SIZE;
    const yEnd = Math.min(yStart + SECTION_SIZE, R.centerTop);
    if (yStart >= yEnd) break;
    for (let y = yStart; y < yEnd; y++) {
      const layerBase = (y + 1) * REGION_AREA + CHUNK_OFFSET + CHUNK_OFFSET * REGION;
      const py = y * 16;
      for (let z = 0; z < 16; z++) {
        const rowBase = layerBase + z * REGION;
        for (let x = 0; x < 16; x++) {
          const i = rowBase + x;
          const id = ids[i];
          if (id === 0) continue;
          switch (MODEL_OF[id]) {
            case MODEL.CUBE: meshCube(R, i, id, x * 16, py, z * 16); break;
            case MODEL.LIQUID: meshLiquid(R, i, id, x * 16, py, z * 16); break;
            case MODEL.CROSS: meshCross(R, i, id, x * 16, py, z * 16, ox + x, oz + z); break;
            case MODEL.TORCH: meshTorch(R, i, id, x * 16, py, z * 16); break;
          }
        }
      }
    }
    const opaque = buffers[LAYER.OPAQUE].take();
    const cutout = buffers[LAYER.CUTOUT].take();
    const translucent = buffers[LAYER.TRANSLUCENT].take();
    if (opaque || cutout || translucent) sections.push({ sy, opaque, cutout, translucent });
  }
  return sections;
}
