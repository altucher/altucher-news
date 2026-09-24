// Procedural block textures (32×32 pixel art + PBR maps) and inventory icons.
//
// generateTextures() is DOM-free. Every texture is painted into a Tex builder
// (sRGB colour, coverage, height, smoothness, F0, subsurface, emission) by the
// generator registered under its name; finish() derives the tangent-space
// normal map from the height field and packs the three layer-major RGBA8
// arrays described in ARCHITECTURE.md. All noise is periodic over the tile so
// every texture repeats seamlessly across neighbouring blocks.

import { TEXTURE_NAMES, BLOCKS, MODEL, LAYER } from './blocks.js';
import { TEX_SIZE } from './config.js';
import { hash32, mulberry32, seedFrom, clamp, lerp, smoothstep } from './math.js';

const N = TEX_SIZE;
const PX = N * N;
const C = N / 2; // tile centre

// ------------------------------------------------------------------ colour helpers
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const pal = (...hs) => hs.map(hex);
/** Nearest palette entry for t ∈ [0,1] (crisp pixel-art banding). */
const pick = (p, t) => p[clamp(Math.floor(t * p.length), 0, p.length - 1)];
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scalec = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
/** Push t away from 0.5 by factor k (fbm output clusters around the middle). */
const contrast = (v, k) => clamp((v - 0.5) * k + 0.5, 0, 1);

// ------------------------------------------------------------------ tileable noise
function wrapi(v, p) {
  v %= p;
  return v < 0 ? v + p : v;
}

/** Per-texel white noise in [0,1). */
function rnd(x, y, seed) {
  return hash32(wrapi(x, N), wrapi(y, N), seed) / 4294967296;
}

/** Tileable value noise in [0,1]; fx×fy lattice cells span the tile. x,y in pixels. */
function vnoise(x, y, fx, fy, seed) {
  const u = (x / N) * fx, v = (y / N) * fy;
  const ix = Math.floor(u), iy = Math.floor(v);
  let tx = u - ix, ty = v - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const x0 = wrapi(ix, fx), x1 = wrapi(ix + 1, fx), y0 = wrapi(iy, fy), y1 = wrapi(iy + 1, fy);
  const a = hash32(x0, y0, seed) / 4294967296;
  const b = hash32(x1, y0, seed) / 4294967296;
  const c = hash32(x0, y1, seed) / 4294967296;
  const d = hash32(x1, y1, seed) / 4294967296;
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

/** Tileable fractal value noise in [0,1] (clusters around 0.5). */
function fbm(x, y, fx, octaves, seed, fy = fx, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x, y, fx << o, fy << o, seed + o * 1013) * amp;
    norm += amp;
    amp *= gain;
  }
  return sum / norm;
}

const W = { f1: 0, edge: 0, id: 0, px: 0, py: 0 };
const featureCache = new Map();
let lastLayout = null;
/** Jittered feature point of every cell, in cell units (cached per layout). */
function features(cx, cy, seed, jitter) {
  const l = lastLayout;
  if (l && l.cx === cx && l.cy === cy && l.seed === seed && l.jitter === jitter) return l.f;
  const key = cx + ',' + cy + ',' + seed + ',' + jitter;
  let f = featureCache.get(key);
  if (!f) {
    f = new Float32Array(cx * cy * 2);
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const h = hash32(i, j, seed);
        f[(j * cx + i) * 2] = 0.5 + ((h & 0xffff) / 65536 - 0.5) * jitter;
        f[(j * cx + i) * 2 + 1] = 0.5 + ((h >>> 16) / 65536 - 0.5) * jitter;
      }
    }
    featureCache.set(key, f);
  }
  lastLayout = { cx, cy, seed, jitter, f };
  return f;
}

/**
 * Tileable Voronoi over cx×cy jittered cells. Returns a shared object:
 * f1 = distance (px) to the nearest feature, edge = distance (px) to the
 * nearest cell border, id = wrapped cell id, px/py = nearest feature point.
 */
function worley(x, y, cx, cy, seed, jitter = 0.85) {
  const cw = N / cx, ch = N / cy;
  const F = features(cx, cy, seed, jitter);
  const gx = Math.floor(x / cw), gy = Math.floor(y / ch);
  let f1 = 1e9, id = 0, bx = 0, by = 0, bcx = 0, bcy = 0;
  for (let j = gy - 1; j <= gy + 1; j++) {
    const wj = wrapi(j, cy);
    for (let i = gx - 1; i <= gx + 1; i++) {
      const c = wj * cx + wrapi(i, cx);
      const fx = (i + F[c * 2]) * cw, fy = (j + F[c * 2 + 1]) * ch;
      const ddx = x - fx, ddy = y - fy;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < f1) {
        f1 = d; id = c; bx = fx; by = fy; bcx = i; bcy = j;
      }
    }
  }
  // Exact distance to the cell border (bisectors between the nearest feature and its neighbours).
  let edge = 1e9;
  for (let j = bcy - 2; j <= bcy + 2; j++) {
    const wj = wrapi(j, cy);
    for (let i = bcx - 2; i <= bcx + 2; i++) {
      if (i === bcx && j === bcy) continue;
      const c = wj * cx + wrapi(i, cx);
      const fx = (i + F[c * 2]) * cw, fy = (j + F[c * 2 + 1]) * ch;
      const dx = fx - bx, dy = fy - by;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) continue;
      const d = ((bx + fx) * 0.5 - x) * dx / len + ((by + fy) * 0.5 - y) * dy / len;
      if (d < edge) edge = d;
    }
  }
  W.f1 = f1; W.edge = edge; W.id = id; W.px = bx; W.py = by;
  return W;
}

// ------------------------------------------------------------------ texture builder
class Tex {
  constructor(name) {
    this.name = name;
    this.seed = seedFrom(name);
    this.rand = mulberry32(this.seed);
    this.col = new Float32Array(PX * 3); // sRGB 0..1
    this.alpha = new Float32Array(PX).fill(1);
    this.height = new Float32Array(PX).fill(0.8);
    this.smooth = new Float32Array(PX).fill(0.2);
    this.f0 = new Float32Array(PX).fill(0.04);
    this.sss = new Float32Array(PX);
    this.emit = new Float32Array(PX);
    this.bump = 2; // normal-map strength (height units → slope)
    this.cutout = false; // alpha-tested: bleed colour into holes
    this.wrap = true; // height field tiles across the block edge
    this.relief = 0; // bake top-left lighting of the height field into albedo
    this.cavity = 0; // bake cavity darkening (low height) into albedo
  }

  each(fn) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) fn(x, y, y * N + x);
  }

  set(i, c, k = 1) {
    this.col[i * 3] = c[0] * k;
    this.col[i * 3 + 1] = c[1] * k;
    this.col[i * 3 + 2] = c[2] * k;
  }

  get(i) {
    return [this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]];
  }

  /** Multiply the colour of texel i by k. */
  shade(i, k) {
    this.col[i * 3] *= k;
    this.col[i * 3 + 1] *= k;
    this.col[i * 3 + 2] *= k;
  }

  /** Make the whole tile transparent (for sprites painted with plot()). */
  clear() {
    this.alpha.fill(0);
    this.height.fill(0);
    this.cutout = true;
    this.wrap = false;
  }

  /** Paint one opaque texel of a sprite (ignored outside the tile). */
  plot(x, y, c, h = 0.6) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = y * N + x;
    this.set(i, c);
    this.alpha[i] = 1;
    this.height[i] = h;
  }

  /** Apply material values to every opaque texel. */
  material({ smooth, f0, sss, emit }) {
    for (let i = 0; i < PX; i++) {
      if (this.alpha[i] <= 0) continue;
      if (smooth !== undefined) this.smooth[i] = smooth;
      if (f0 !== undefined) this.f0[i] = f0;
      if (sss !== undefined) this.sss[i] = sss;
      if (emit !== undefined) this.emit[i] = emit;
    }
  }

  h(x, y) {
    if (this.wrap) return this.height[wrapi(y, N) * N + wrapi(x, N)];
    return this.height[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)];
  }

  /** Fill transparent texels with their neighbours' colour and material (no dark mip fringes). */
  bleed() {
    const filled = new Uint8Array(PX);
    for (let i = 0; i < PX; i++) filled[i] = this.alpha[i] >= 0.5 ? 1 : 0;
    const chans = [this.height, this.smooth, this.f0, this.sss];
    for (let pass = 0; pass < N; pass++) {
      const next = filled.slice();
      let changed = false;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          if (filled[i]) continue;
          let r = 0, g = 0, b = 0, n = 0;
          const acc = [0, 0, 0, 0];
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
              const j = yy * N + xx;
              if (!filled[j]) continue;
              r += this.col[j * 3]; g += this.col[j * 3 + 1]; b += this.col[j * 3 + 2];
              for (let k = 0; k < 4; k++) acc[k] += chans[k][j];
              n++;
            }
          }
          if (!n) continue;
          this.col[i * 3] = r / n; this.col[i * 3 + 1] = g / n; this.col[i * 3 + 2] = b / n;
          for (let k = 0; k < 4; k++) chans[k][i] = acc[k] / n;
          this.emit[i] = 0;
          next[i] = 1;
          changed = true;
        }
      }
      filled.set(next);
      if (!changed) break;
    }
  }

  /** Pack into the output arrays at `layer`. */
  finish(out, layer) {
    if (this.relief || this.cavity) {
      const src = this.col.slice();
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          if (this.alpha[i] <= 0) continue;
          const slope = this.h(x - 1, y - 1) - this.h(x + 1, y + 1);
          const k = (1 - this.relief * slope * 1.5) * (1 - this.cavity * (1 - this.height[i]));
          for (let c = 0; c < 3; c++) this.col[i * 3 + c] = src[i * 3 + c] * k;
        }
      }
    }
    if (this.cutout) this.bleed();
    const o = layer * PX * 4;
    // Height field padded by one texel. Transparent texels of a cutout are NaN
    // and read as the centre height, so sprite silhouettes get no cliff normals.
    const S = N + 2;
    const H = new Float32Array(S * S);
    for (let y = -1; y <= N; y++) {
      for (let x = -1; x <= N; x++) {
        let v;
        if (!this.cutout) v = this.h(x, y);
        else if (x < 0 || y < 0 || x >= N || y >= N || this.alpha[y * N + x] < 0.5) v = NaN;
        else v = this.height[y * N + x];
        H[(y + 1) * S + x + 1] = v;
      }
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const p = o + i * 4;
        out.albedo[p] = b8(this.col[i * 3]);
        out.albedo[p + 1] = b8(this.col[i * 3 + 1]);
        out.albedo[p + 2] = b8(this.col[i * 3 + 2]);
        out.albedo[p + 3] = b8(this.alpha[i]);
        const hc = this.height[i];
        const c = (y + 1) * S + x + 1;
        const tl = hv(H[c - S - 1], hc), t = hv(H[c - S], hc), tr = hv(H[c - S + 1], hc);
        const l = hv(H[c - 1], hc), r = hv(H[c + 1], hc);
        const bl = hv(H[c + S - 1], hc), b = hv(H[c + S], hc), br = hv(H[c + S + 1], hc);
        // Sobel gradient; x → +u (right), y → +v (down the image).
        const gx = (tr + 2 * r + br - tl - 2 * l - bl) / 8;
        const gy = (bl + 2 * b + br - tl - 2 * t - tr) / 8;
        let nx = -gx * this.bump * 2, ny = -gy * this.bump * 2, nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= len; ny /= len; nz /= len;
        out.normal[p] = b8(nx * 0.5 + 0.5);
        out.normal[p + 1] = b8(ny * 0.5 + 0.5);
        out.normal[p + 2] = b8(nz * 0.5 + 0.5);
        out.normal[p + 3] = b8(hc);
        out.specular[p] = b8(this.smooth[i]);
        out.specular[p + 1] = b8(this.f0[i]);
        out.specular[p + 2] = b8(this.sss[i]);
        out.specular[p + 3] = b8(this.emit[i]);
      }
    }
  }
}

const hv = (v, fallback) => (v === v ? v : fallback); // NaN → fallback
const b8 = (v) => Math.round(clamp(v, 0, 1) * 255);

// ------------------------------------------------------------------ palettes
const P = {
  stone: pal(0x5d5d60, 0x6a6a6d, 0x767679, 0x828285, 0x8e8e91, 0x9a9a9d),
  cobble: pal(0x4e4e51, 0x5e5e61, 0x6e6e71, 0x7e7e81, 0x8f8f92, 0xa2a2a4),
  mortar: pal(0x252527, 0x2f2f31, 0x39393b),
  moss: pal(0x2f4a1a, 0x3b5c20, 0x4a6f27, 0x5a8230, 0x6c953a),
  dirt: pal(0x4f3421, 0x5f3f28, 0x6d4a30, 0x7a5537, 0x87603f, 0x946c49),
  grass: pal(0x2f5a1c, 0x3a6b22, 0x467d29, 0x528e30, 0x5f9f38, 0x6fb043, 0x82c052),
  snow: pal(0xcfdbe8, 0xdce6f0, 0xe7eef6, 0xf1f6fb, 0xfbfdff),
  sand: pal(0xcdb886, 0xd6c28f, 0xdecb99, 0xe5d3a3, 0xecdcae, 0xf2e5bb),
  redSand: pal(0x9f4c22, 0xae5727, 0xbc632d, 0xc86f35, 0xd37d40, 0xdc8b4d),
  gravel: pal(0x5a5553, 0x6b6562, 0x7b7572, 0x8b8581, 0x9c9591, 0xaea8a3),
  clay: pal(0x8d95a4, 0x959dac, 0x9ca4b3, 0xa4acba, 0xabb3c1, 0xb4bcca),
  terracotta: pal(0x7f4b35, 0x8a533b, 0x945b41, 0x9d6347, 0xa56b4e),
  sandstone: pal(0xc2ae76, 0xcdba83, 0xd6c48f, 0xdecd9a, 0xe6d6a6, 0xeddfb3),
  granite: pal(0x7a5143, 0x8c5f4f, 0x9b6c5b, 0xa97967, 0xb88874, 0xc99a86),
  diorite: pal(0x8e8e90, 0xa9a9ab, 0xbdbdbf, 0xcdcdcf, 0xdcdcde, 0xeaeaec),
  andesite: pal(0x6c6c6e, 0x78787a, 0x838385, 0x8d8d8f, 0x98989a, 0xa4a4a6),
  bedrock: pal(0x1b1b1c, 0x2c2c2e, 0x414143, 0x57575a, 0x6f6f72, 0x8a8a8d),
  obsidian: pal(0x07050c, 0x0e0917, 0x150e22, 0x1d142e, 0x281b3e, 0x3a2757, 0x523a78),
  oakBark: pal(0x2f2213, 0x3d2c19, 0x4b3720, 0x584228, 0x654d30, 0x735a3a),
  oakWood: pal(0x7d6136, 0x8b6c3d, 0x987745, 0xa5834e, 0xb28f58, 0xbf9c64),
  birchBark: pal(0xc9c6bb, 0xd6d3c9, 0xe1dfd6, 0xebe9e2, 0xf4f3ee),
  birchWood: pal(0xb09a64, 0xbca76f, 0xc7b37b, 0xd2bf88, 0xdccb96),
  spruceBark: pal(0x21160c, 0x2c1e11, 0x382716, 0x44301c, 0x503a23, 0x5c442a),
  spruceWood: pal(0x5a4027, 0x654a2d, 0x705333, 0x7b5c39, 0x876741),
  oakPlanks: pal(0x7e6238, 0x8e703f, 0x9c7c47, 0xa98850, 0xb5945a, 0xc2a166),
  sprucePlanks: pal(0x4e3620, 0x5a3f25, 0x66482b, 0x725232, 0x7e5c39, 0x8a6741),
  birchPlanks: pal(0xae9960, 0xbba66b, 0xc6b277, 0xd0bd83, 0xd9c78f, 0xe2d19b),
  oakLeaves: pal(0x1e3f12, 0x285118, 0x33631f, 0x3e7526, 0x4a872e, 0x589a38),
  birchLeaves: pal(0x3a5c22, 0x4a6f2b, 0x5a8235, 0x6a943f, 0x7ba64b, 0x8db858),
  spruceLeaves: pal(0x16301d, 0x1d3b24, 0x25472c, 0x2e5335, 0x38603f, 0x436d4a),
  gold: pal(0x9c6a12, 0xc28a1c, 0xdca82a, 0xf0c43c, 0xfcdc5a, 0xfff08e),
  iron: pal(0x8a8d91, 0xa3a6aa, 0xb8bbbf, 0xcbced1, 0xdcdfe2, 0xeef0f2),
  diamond: pal(0x147a78, 0x1f9d98, 0x2fc2b9, 0x55ded3, 0x8ef2e6, 0xcffcf6),
  emerald: pal(0x0a6a2e, 0x0d8a3b, 0x12a84a, 0x2cc563, 0x5fe08a, 0xa6f5c0),
  lapis: pal(0x122a70, 0x173587, 0x1d419f, 0x244eb6, 0x2f5ec9, 0x4474d8),
  coal: pal(0x0b0b0c, 0x131314, 0x1b1b1d, 0x242427, 0x303033, 0x414145),
  quartz: pal(0xd6cfc5, 0xdfd9d0, 0xe7e2da, 0xeeeae4, 0xf5f2ed, 0xfbf9f6),
  pumpkin: pal(0x8f4a0b, 0xa9590f, 0xc26a13, 0xd67d19, 0xe48f22, 0xefa434),
  cactus: pal(0x0b4a17, 0x0f5c1d, 0x137024, 0x19832c, 0x229536, 0x2fa843),
  wood: pal(0x3d2a17, 0x5a3f22, 0x6f4f2c, 0x866137, 0x9b7243),
};

// ------------------------------------------------------------------ material families

/** Natural stone: soft tonal patches with crisp dark pits and light specks, rare hairline cracks. */
function stoneBase(t, p = P.stone, o = {}) {
  const s = o.seed ?? t.seed;
  const strata = o.strata ?? 0.2;
  const cracks = o.cracks ?? 0.64;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const blot = contrast(fbm(px, py, 4, 2, s + 1), 2);
    const band = contrast(fbm(px, py, 1, 2, s + 7, 6), 2.2);
    const pit = fbm(px, py, 16, 1, s + 20);
    const speck = fbm(px, py, 16, 1, s + 21);
    let v = 0.42 + (blot - 0.5) * 0.35 + (band - 0.5) * strata + (rnd(x, y, s + 3) - 0.5) * 0.14;
    let h = 0.75 + (blot - 0.5) * 0.15;
    if (o.specks !== false) {
      if (pit > 0.7) { v -= 0.28; h -= 0.3; }
      else if (speck > 0.72) { v += 0.22; h += 0.1; }
    }
    const w = worley(px, py, 3, 3, s + 11, 0.9);
    if (w.edge < 0.5 && fbm(px, py, 2, 2, s + 13) > cracks) { v *= 0.35; h = 0.35; }
    t.set(i, pick(p, v));
    t.height[i] = h;
    t.smooth[i] = (o.smooth ?? 0.3) + (v > 0.6 ? 0.08 : 0);
  });
  t.bump = o.bump ?? 2.2;
  t.relief = 0.2;
  t.cavity = 0.15;
}

/** Speckled igneous rock (granite, diorite, andesite): interlocking mineral grains. */
function speckled(t, p, o = {}) {
  const s = t.seed;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const blot = contrast(fbm(px, py, 4, 2, s), 2);
    const cell = worley(px, py, 10, 10, s + 5, 1);
    const tone = hash32(cell.id, s) / 4294967296;
    const grain = rnd(x, y, s + 1);
    let v = 0.55 * tone + 0.3 * blot + 0.15 * grain;
    if (tone > 0.9) v = o.light ?? 0.97; // bright feldspar/quartz grain
    else if (tone < (o.darkFrac ?? 0.08)) v = 0.04; // dark mafic grain
    t.set(i, pick(p, v));
    t.height[i] = 0.75 + (v - 0.5) * 0.25 - (cell.edge < 0.5 ? 0.1 : 0);
    t.smooth[i] = (o.smooth ?? 0.35) + (v > 0.8 ? 0.2 : 0);
  });
  t.bump = 1.6;
}

/** Rounded stones set in deep dark mortar. */
function cobbleBase(t) {
  const s = t.seed;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const w = worley(px, py, 5, 5, s, 0.8);
    const e = w.edge;
    const d = clamp((e - 0.6) / 3.2, 0, 1);
    const dm = 1 - (1 - d) * (1 - d);
    const tone = hash32(w.id, s + 1) / 4294967296;
    const n = fbm(px, py, 8, 2, s + 2);
    if (e < 0.75) {
      t.set(i, pick(P.mortar, rnd(x, y, s + 4)));
      t.height[i] = 0.05 + 0.08 * rnd(x, y, s + 5);
      t.smooth[i] = 0.08;
    } else {
      // Brighter towards the dome centre, a little lit from the top-left.
      const light = clamp(((w.px - px) + (w.py - py)) * 0.06, -0.15, 0.15);
      const v = 0.18 + tone * 0.35 + dm * 0.35 + (n - 0.5) * 0.45 + light + (rnd(x, y, s + 6) - 0.5) * 0.12;
      t.set(i, pick(P.cobble, v));
      t.height[i] = 0.3 + dm * 0.62 + (n - 0.5) * 0.12;
      t.smooth[i] = 0.3 + n * 0.1;
    }
  });
  t.bump = 3.2;
  t.relief = 0.25;
  t.cavity = 0.15;
}

/** Moss growing from crevices (low height) onto the surface; `amount` = covered fraction. */
function addMoss(t, amount, seed, o = {}) {
  const m = new Float32Array(PX);
  t.each((x, y, i) => {
    m[i] = fbm(x + 0.5, y + 0.5, 4, 3, seed) + (1 - t.height[i]) * (o.crevice ?? 0.35) + (rnd(x, y, seed + 1) - 0.5) * 0.15;
  });
  const threshold = Float32Array.from(m).sort()[Math.floor(PX * (1 - amount))];
  t.each((x, y, i) => {
    if (m[i] < threshold) return;
    const v = clamp((m[i] - threshold) * 4 + (rnd(x, y, seed + 2) - 0.5) * 0.4 + 0.25, 0, 1);
    t.set(i, pick(P.moss, v));
    t.height[i] = Math.max(t.height[i], 0.45 + v * 0.3);
    t.smooth[i] = 0.12;
    t.sss[i] = 0.3;
  });
}

/**
 * Brick/block masonry. rowH/brickW in px (must divide N), offset = horizontal
 * shift of odd rows, mortar = joint width at the top/left edge of each brick.
 */
function masonry(t, o) {
  const s = t.seed;
  const { rowH, brickW, offset, mortar, bevel } = o;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const row = Math.floor(y / rowH);
    const xo = wrapi(x + (row & 1) * offset, N);
    const bx = Math.floor(xo / brickW);
    const lx = xo - bx * brickW, ly = y - row * rowH;
    const id = hash32(row, bx, s);
    const n = fbm(px, py, 8, 2, s + 1);
    if (lx < mortar || ly < mortar) {
      t.set(i, pick(o.mortarPal, rnd(x, y, s + 2) * 0.6 + n * 0.4));
      t.height[i] = 0.15 + rnd(x, y, s + 3) * 0.1;
      t.smooth[i] = 0.12;
      return;
    }
    const edge = Math.min(lx - mortar + 0.5, brickW - lx - 0.5, ly - mortar + 0.5, rowH - ly - 0.5);
    const bev = clamp(edge / bevel, 0, 1);
    const tone = (id & 0xffff) / 65536;
    let v = 0.25 + tone * 0.3 + (n - 0.5) * 0.6 + (rnd(x, y, s + 4) - 0.5) * 0.25;
    // Highlight the top/left bevel, darken the bottom/right one.
    if (edge < bevel) v += ly - mortar < rowH - ly - 1 || lx - mortar < brickW - lx - 1 ? 0.15 : -0.2;
    const chip = rnd(x, y, s + 5) > 0.975 && edge < 2;
    t.set(i, pick(o.pal, chip ? v - 0.3 : v));
    t.height[i] = 0.55 + bev * 0.4 + (n - 0.5) * 0.08 - (chip ? 0.25 : 0);
    t.smooth[i] = (o.smooth ?? 0.3) + n * 0.1;
  });
  t.bump = o.bump ?? 3;
  t.cavity = 0.15;
}

/** Granular ground (sand, dirt, gravel base, clay...). */
function granular(t, p, o = {}) {
  const s = t.seed;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const low = fbm(px, py, o.freq ?? 4, 3, s);
    const grain = rnd(x, y, s + 1);
    const v = contrast(low, o.contrast ?? 1.8) * (o.lowW ?? 0.55) + grain * (1 - (o.lowW ?? 0.55));
    t.set(i, pick(p, v));
    t.height[i] = 0.7 + (v - 0.5) * (o.heightAmp ?? 0.4);
    t.smooth[i] = (o.smooth ?? 0.18) + (grain > 0.96 ? o.sparkle ?? 0 : 0);
    t.sss[i] = o.porosity ?? 0.05;
  });
  t.bump = o.bump ?? 1.5;
}

/** Dirt: brown earth with pebbles and root specks. */
function dirtBase(t, seed = t.seed, p = P.dirt) {
  const s = seed;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const low = contrast(fbm(px, py, 4, 3, s), 1.8);
    const clump = contrast(fbm(px, py, 8, 2, s + 9), 2);
    const grain = rnd(x, y, s + 1);
    let v = low * 0.4 + clump * 0.3 + grain * 0.3;
    let h = 0.65 + (clump - 0.5) * 0.35;
    const w = worley(px, py, 6, 6, s + 2, 0.9);
    const pebble = w.f1 < 1.3 && (hash32(w.id, s + 3) & 3) === 0;
    let c = pick(p, v);
    if (pebble) {
      c = mixc(pick(P.gravel, 0.4 + (1.3 - w.f1) * 0.4), c, 0.25);
      h = 0.9;
    } else if (grain < 0.05) {
      c = scalec(c, 0.72);
      h -= 0.15;
    }
    t.set(i, c);
    t.height[i] = h;
    t.smooth[i] = 0.14;
    t.sss[i] = 0.08;
  });
  t.bump = 1.8;
  t.relief = 0.2;
}

/** Grass surface seen from above: layered blades, baked green. */
function grassTop(t, seed = t.seed) {
  const s = seed;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const low = contrast(fbm(px, py, 4, 2, s), 1.6);
    const v = low * 0.45 + rnd(x, y, s + 1) * 0.35;
    t.set(i, pick(P.grass, 0.1 + v * 0.6));
    t.height[i] = 0.45 + v * 0.2;
    t.smooth[i] = 0.22;
    t.sss[i] = 0.3;
  });
  // Blade strokes: bright tip with a dark shadow texel beneath.
  const r = mulberry32(s + 7);
  for (let k = 0; k < 90; k++) {
    const x = Math.floor(r() * N), y = Math.floor(r() * N), len = 1 + Math.floor(r() * 3);
    const tone = 0.55 + r() * 0.45;
    for (let j = 0; j < len; j++) {
      const i = wrapi(y - j, N) * N + x;
      t.set(i, pick(P.grass, tone - j * 0.08));
      t.height[i] = 0.85 + j * 0.05;
    }
    const sh = wrapi(y + 1, N) * N + x;
    t.set(sh, pick(P.grass, 0.05));
    t.height[sh] = 0.3;
  }
  t.bump = 1.6;
}

/** Jagged fringe depth per column (grass/snow/podzol overhang on side faces). */
function fringe(seed, base, spread, drips) {
  const r = mulberry32(seed);
  const d = new Int32Array(N);
  for (let x = 0; x < N; x++) d[x] = base + Math.floor(r() * spread);
  for (let k = 0; k < drips; k++) {
    const x = Math.floor(r() * N);
    d[x] += 2 + Math.floor(r() * 4);
    d[wrapi(x + 1, N)] += 1 + Math.floor(r() * 2);
  }
  return d;
}

/** Side of a block whose top layer (grass, snow, podzol) overhangs dirt. */
function overhangSide(t, depth, paint) {
  dirtBase(t, seedFrom('dirt'));
  t.each((x, y, i) => {
    if (y < depth[x]) paint(x, y, i, depth[x] - y);
    else if (y === depth[x]) {
      t.shade(i, 0.7); // shadow under the overhang
      t.height[i] = 0.45;
    }
  });
}

/** Bark: vertical plates split by dark wandering furrows and occasional cross-cracks. */
function barkSide(t, p, o = {}) {
  const s = t.seed;
  const cols = o.cols ?? 5;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const wob = (fbm(px, py, 1, 2, s + 4, 2) - 0.5) * (o.wobble ?? 4);
    const u = ((px + wob) / N) * cols;
    const col = Math.floor(u), fu = u - col;
    const plate = hash32(wrapi(col, cols), s) / 4294967296;
    const segLen = o.segment ?? 13;
    const seg = py / segLen + plate * 3.7;
    const crossCrack = seg - Math.floor(seg) < 1 / segLen && fu > 0.15 && fu < 0.85;
    const profile = smoothstep(0, 0.42, Math.min(fu, 1 - fu));
    const fine = fbm(px, py, 8, 2, s + 1, 16);
    let v = profile * 0.55 + plate * 0.15 + (fine - 0.5) * 0.4 + (rnd(x, y, s + 2) - 0.5) * 0.12;
    if (crossCrack) v -= 0.3;
    t.set(i, pick(p, v));
    t.height[i] = 0.2 + profile * 0.7 + (fine - 0.5) * 0.1 - (crossCrack ? 0.25 : 0);
    t.smooth[i] = 0.14;
  });
  t.bump = o.bump ?? 3;
  t.cavity = 0.2;
}

/** Log end grain: growth rings in a rounded square, bark rim. */
function logTop(t, woodPal, barkPal, o = {}) {
  const s = t.seed;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const dx = Math.abs(px - C), dy = Math.abs(py - C);
    const sq = Math.max(dx, dy), circ = Math.hypot(dx, dy);
    const warp = (fbm(px, py, 4, 2, s) - 0.5) * 2.2;
    const d = lerp(sq, circ * 0.92, 0.45) + warp;
    if (sq >= C - 2) {
      const v = rnd(x, y, s + 1) * 0.6 + (sq >= C - 1 ? 0 : 0.35);
      t.set(i, pick(barkPal, v));
      t.height[i] = 0.9 + rnd(x, y, s + 2) * 0.1;
      t.smooth[i] = 0.12;
      return;
    }
    const ring = 0.5 + 0.5 * Math.cos(d * (Math.PI * 2 / (o.ringPx ?? 3)));
    let v = 0.3 + ring * 0.45 + (rnd(x, y, s + 3) - 0.5) * 0.2;
    if (d < 1.6) v = 0.1; // pith
    if (sq >= C - 3) v -= 0.2; // cambium just inside the bark
    // One radial drying crack.
    const ang = Math.atan2(py - C, px - C);
    if (Math.abs(ang - (o.crackAngle ?? 0.6)) < 0.07 && d > 3 && d < 11) v = 0;
    t.set(i, pick(woodPal, v));
    t.height[i] = 0.72 + ring * 0.1 - (v === 0 ? 0.35 : 0);
    t.smooth[i] = 0.2;
  });
  t.bump = 2;
}

/** Horizontal boards with grain, joints, gaps and the odd knot. */
function planksBase(t, p, o = {}) {
  const s = o.seed ?? t.seed;
  const boardH = 8;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const board = Math.floor(y / boardH);
    const ly = y - board * boardH;
    const bh = hash32(board, s);
    const joint = (bh >>> 8) % N; // butt joint position of this board
    const shift = (bh & 255) / 16;
    const grain = fbm(px + shift * 3, py, 2, 3, s + board, 16);
    const fine = rnd(x, y, s + 5);
    let v = 0.2 + (((bh >>> 20) & 255) / 255) * 0.3 + contrast(grain, 2.5) * 0.45 + (fine - 0.5) * 0.15;
    let h = 0.82 + (grain - 0.5) * 0.12;
    if (ly === boardH - 1) {
      v = 0.02; // gap between boards
      h = 0.2;
    } else if (ly === 0) {
      v += 0.12; // lit board edge
      h = 0.8;
    }
    if (x === joint && ly < boardH - 1) {
      v = 0.08;
      h = 0.35;
    }
    // Knot: a small dark oval with a lighter ring on some boards.
    const kx = ((bh >>> 13) % 22) + 5;
    if (((bh >>> 3) & 3) === 0 && ly > 0 && ly < boardH - 1) {
      const d = Math.hypot((x + 0.5 - kx) / 2.4, (ly + 0.5 - 3.5) / 1.4);
      if (d < 0.55) { v = 0.05; h = 0.65; }
      else if (d < 1.05) { v -= 0.2; h -= 0.05; }
    }
    t.set(i, pick(p, v));
    t.height[i] = h;
    t.smooth[i] = 0.28 + grain * 0.08;
  });
  t.bump = 2.2;
  t.relief = 0.15;
}

/**
 * Leaf canopy built from overlapping pixel-art leaf stamps. Later (upper)
 * leaves are brighter; texels no leaf covers stay see-through (~holes).
 * Shape chars: h highlight, m mid, s shadow.
 */
function leavesBase(t, p, shapes, o = {}) {
  t.clear();
  t.wrap = true;
  const r = t.rand;
  const target = Math.floor(PX * (1 - (o.holes ?? 0.3)));
  const tone = { h: 0.3, m: 0.08, s: -0.2 };
  let covered = 0;
  for (let k = 0; k < 4000 && covered < target; k++) {
    const shape = shapes[Math.floor(r() * shapes.length)];
    const x0 = Math.floor(r() * N), y0 = Math.floor(r() * N);
    const depth = covered / target; // 0 = deepest, 1 = top layer
    const base = 0.12 + depth * 0.45 + (r() - 0.5) * 0.2;
    for (let j = 0; j < shape.length; j++) {
      for (let q = 0; q < shape[j].length; q++) {
        const ch = shape[j][q];
        if (ch === '.') continue;
        const i = wrapi(y0 + j, N) * N + wrapi(x0 + q, N);
        if (t.alpha[i] === 0) covered++;
        t.set(i, pick(p, base + tone[ch] + (rnd(x0 + q, y0 + j, t.seed) - 0.5) * 0.1));
        t.alpha[i] = 1;
        t.height[i] = 0.3 + depth * 0.55 + (ch === 'h' ? 0.1 : ch === 's' ? -0.05 : 0.05);
        t.smooth[i] = 0.3 + depth * 0.15;
        t.sss[i] = 0.72;
      }
    }
  }
  t.bump = 1.8;
}

const LEAF_SHAPES = {
  broad: [
    ['.hm.', 'hmms', '.ms.'],
    ['.h.', 'hms', 'mms', '.s.'],
    ['hm.', 'mms', '.ss'],
    ['.hh.', 'hmmm', 'mmms', '.ss.'],
    ['h.', 'ms'],
  ],
  small: [
    ['hm', 'ms'],
    ['.h.', 'hms', '.s.'],
    ['hm.', '.ms'],
    ['.hm', 'hms', 'ms.'],
  ],
  needles: [
    ['h...', '.m..', '..m.', '...s'],
    ['...h', '..m.', '.m..', 's...'],
    ['h', 'm', 'm', 's'],
    ['h..', 'mm.', '.ms'],
    ['..h', '.mm', 'sm.'],
    ['hmms'],
  ],
};

/** Bevelled frame: raises the rim and lights top/left, shades bottom/right. */
function bevel(t, width, light = 0.12, dark = 0.2, depth = 0.15) {
  t.each((x, y, i) => {
    const e = Math.min(x, y, N - 1 - x, N - 1 - y);
    if (e >= width) return;
    const topLeft = x + y < N - 1 ? Math.min(x, y) === e : false;
    t.shade(i, topLeft ? 1 + light : 1 - dark);
    t.height[i] = Math.min(t.height[i], 1 - depth * (1 - e / width)) + (e === 0 ? -depth : 0);
  });
}

/** Knitted cloth: columns of V stitches with fuzz. */
function wool(t, color) {
  const s = t.seed;
  const base = hex(color);
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const lx = x & 7, ly = y & 3;
    const leftLeg = lx === ly || lx === ly + 1;
    const rightLeg = lx === 7 - ly || lx === 6 - ly;
    const stitch = leftLeg ? 0.06 - ly * 0.025 : rightLeg ? 0.02 - ly * 0.025 : -0.08;
    const fuzz = (fbm(px, py, 8, 2, s) - 0.5) * 0.2 + (rnd(x, y, s + 1) - 0.5) * 0.07;
    t.set(i, base, 1 + stitch + fuzz);
    t.height[i] = 0.7 + stitch * 2.5 + fuzz * 0.5;
    t.smooth[i] = 0.1;
    t.sss[i] = 0.25;
  });
  t.bump = 1.5;
}

/** Glass pane: frame, near-clear interior, streak highlights. */
function glass(t, tint, o = {}) {
  const frame = mixc(tint, [1, 1, 1], o.frameLight ?? 0.55);
  t.each((x, y, i) => {
    const e = Math.min(x, y, N - 1 - x, N - 1 - y);
    let c = tint, a = o.alpha ?? 0.12;
    if (e === 0) {
      c = scalec(frame, x + y < N ? 1.05 : 0.85);
      a = o.frameAlpha ?? 0.85;
    }
    // Diagonal streaks in the upper-left and lower-right corners.
    const d1 = x + y;
    const streak = (e > 1 && ((d1 >= 8 && d1 <= 9 && x > 2 && y > 2) || (d1 === 13 && x > 3 && y > 3 && x < 11) || (d1 >= 46 && d1 <= 47 && x < 29 && y < 29) || (d1 === 42 && x > 20 && x < 28)));
    if (streak) {
      c = mixc(tint, [1, 1, 1], 0.75);
      a = o.streakAlpha ?? 0.45;
    }
    t.set(i, c);
    t.alpha[i] = a;
    t.height[i] = e === 0 ? 1 : 0.97;
    t.smooth[i] = e === 0 ? 0.85 : 0.96;
    t.f0[i] = 0.04;
  });
  t.bump = 1;
}

/** Scatter rounded mineral clusters over the stone texture. */
function ore(t, p, o = {}) {
  stoneBase(t, P.stone, { seed: seedFrom('stone') });
  const r = mulberry32(t.seed + 99);
  const mark = new Uint8Array(PX);
  const centres = [];
  const clusters = o.clusters ?? 5;
  for (let k = 0, tries = 0; k < clusters && tries < 200; tries++) {
    const cx = 3 + r() * (N - 6), cy = 3 + r() * (N - 6);
    if (centres.some(([x, y]) => Math.hypot(x - cx, y - cy) < 8)) continue;
    centres.push([cx, cy]);
    k++;
    const rad = 1.7 + r() * 1.1;
    const stretch = 0.7 + r() * 0.6;
    for (let y = Math.floor(cy - rad - 2); y <= cy + rad + 2; y++) {
      for (let x = Math.floor(cx - rad - 2); x <= cx + rad + 2; x++) {
        const d = Math.hypot((x + 0.5 - cx) * stretch, (y + 0.5 - cy) / stretch) + (rnd(x, y, t.seed + 7) - 0.5) * 1.2;
        if (d < rad) mark[wrapi(y, N) * N + wrapi(x, N)] = 1;
      }
    }
  }
  const at = (x, y) => mark[wrapi(y, N) * N + wrapi(x, N)];
  t.each((x, y, i) => {
    if (!at(x, y)) {
      // Dark rim hugging the mineral so clusters read at a distance.
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        t.shade(i, 0.7);
        t.height[i] -= 0.12;
      }
      return;
    }
    const lit = !at(x - 1, y) || !at(x, y - 1);
    const shadow = !at(x + 1, y) || !at(x, y + 1);
    let v = 0.3 + rnd(x, y, t.seed + 5) * 0.4 + (lit ? 0.3 : 0) - (shadow && !lit ? 0.3 : 0);
    t.smooth[i] = o.smooth ?? 0.5;
    t.f0[i] = o.f0 ?? 0.05;
    if (o.glint && lit && rnd(x, y, t.seed + 6) > 0.55) {
      v = 1;
      t.smooth[i] = o.glint;
    }
    t.set(i, pick(p, v));
    t.height[i] = 0.9 + (lit ? 0.1 : 0);
  });
  t.bump = 2.4;
}

/** Metal block: brushed surface, bevelled rim. */
function metalBlock(t, p, o = {}) {
  const s = t.seed;
  t.each((x, y, i) => {
    const px = x + 0.5, py = y + 0.5;
    const brush = fbm(px, py, 1, 3, s, 16);
    let v = 0.45 + (brush - 0.5) * 0.5 + (rnd(x, y, s + 1) - 0.5) * 0.08;
    // Soft diagonal sheen band baked in for icons and distant mips.
    const sheen = Math.exp(-(((px - py) - 6) ** 2) / 40) * 0.25;
    v += sheen;
    t.set(i, pick(p, v));
    t.height[i] = 0.9 + (brush - 0.5) * 0.04;
    t.smooth[i] = (o.smooth ?? 0.78) + (brush - 0.5) * 0.1;
    t.f0[i] = 1;
  });
  bevel(t, 2, 0.15, 0.3, 0.25);
  t.bump = 2.5;
}

// ------------------------------------------------------------------ sprite helpers

/** Quadratic-bezier blade from (x0,y0) to (x1,y1) bowed sideways by `bend`. */
function blade(t, x0, y0, x1, y1, bend, p, o = {}) {
  const cx = (x0 + x1) / 2 + bend, cy = (y0 + y1) / 2;
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(2, Math.ceil(len * 2.5));
  for (let k = 0; k <= steps; k++) {
    const u = k / steps, iu = 1 - u;
    const x = iu * iu * x0 + 2 * iu * u * cx + u * u * x1;
    const y = iu * iu * y0 + 2 * iu * u * cy + u * u * y1;
    const tone = (o.base ?? 0.1) + u * (o.range ?? 0.85);
    t.plot(x, y, pick(p, tone), 0.4 + u * 0.4);
    if (o.width && u < o.width) t.plot(x + 1, y, pick(p, tone - 0.2), 0.35 + u * 0.4);
  }
}

/** Paint a small pixel-art stamp. map: array of strings, colors: char → rgb. */
function stamp(t, x0, y0, map, colors, heights = {}) {
  for (let j = 0; j < map.length; j++) {
    for (let k = 0; k < map[j].length; k++) {
      const ch = map[j][k];
      if (ch === '.' || !colors[ch]) continue;
      const x = x0 + k, y = y0 + j;
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const i = y * N + x;
      t.set(i, colors[ch]);
      t.alpha[i] = 1;
      t.height[i] = heights[ch] ?? 0.9;
    }
  }
}

/** Blades of a two-block tall grass plant on a 32×64 virtual canvas. */
function tallGrass(t, half) {
  t.clear();
  const r = mulberry32(seedFrom('tall_grass'));
  const yOff = half === 'top' ? 0 : N;
  const shim = { plot: (x, y, c, h) => t.plot(x, y - yOff, c, h) };
  for (let k = 0; k < 16; k++) {
    const x0 = 3 + r() * 26, top = 4 + r() * 40, lean = (r() - 0.5) * 12;
    blade(shim, x0, 2 * N - 1, x0 + lean, top, (r() - 0.5) * 6, P.grass, { base: 0.05, range: 0.9, width: 0.3 });
  }
  t.material({ smooth: 0.3, sss: 0.7 });
}

/** Brilliant-cut gem face: table, star and girdle facets lit from the top-left. */
function brilliantBlock(t, p) {
  const s = t.seed;
  t.each((x, y, i) => {
    const dx = x + 0.5 - C, dy = y + 0.5 - C;
    const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.hypot(dx, dy) * 0.45;
    const ang = Math.atan2(dy, dx);
    const sector = Math.floor((ang + Math.PI) / (Math.PI / 4));
    const band = d < 5 ? 0 : d < 10 ? 1 : 2;
    const mid = -Math.PI + (sector + 0.5) * (Math.PI / 4);
    // Facet slope grows outward; light comes from the top-left.
    const slope = [0, 0.35, 0.7][band];
    const light = -(Math.cos(mid) + Math.sin(mid)) * 0.7071 * slope;
    const facet = hash32(sector, band, s) / 4294967296;
    const angEdge = Math.abs(((ang + Math.PI) % (Math.PI / 4)) - Math.PI / 8) > Math.PI / 8 - 0.09;
    const bandEdge = Math.abs(d - 5) < 0.45 || Math.abs(d - 10) < 0.45;
    let v = 0.5 + light * 0.6 + (facet - 0.5) * 0.2 + (band === 0 ? 0.15 : 0);
    if ((angEdge && band > 0) || bandEdge) v = 0.78 + light * 0.3;
    t.set(i, pick(p, v));
    t.height[i] = 0.95 - band * 0.12;
    t.smooth[i] = 0.93;
    t.f0[i] = 0.17;
  });
  bevel(t, 2, 0.15, 0.3, 0.2);
  t.bump = 2;
}

/** Step-cut gem face: concentric rectangular facets, each side lit differently. */
function stepCutBlock(t, p) {
  const s = t.seed;
  t.each((x, y, i) => {
    const e = Math.min(x, y, N - 1 - x, N - 1 - y);
    const step = Math.floor(e / 3);
    const side = e === y ? 0 : e === x ? 1 : e === N - 1 - x ? 2 : 3; // top, left, right, bottom
    const slope = step >= 4 ? 0 : 1 - step * 0.2;
    const light = [0.3, 0.15, -0.15, -0.3][side] * slope;
    let v = 0.5 + light + (rnd(x, y, s) - 0.5) * 0.12 + (step >= 4 ? 0.15 : 0);
    if (e % 3 === 0 && e > 0 && step < 5) v += 0.25;
    t.set(i, pick(p, v));
    t.height[i] = 0.7 + Math.min(step, 4) * 0.07;
    t.smooth[i] = 0.9;
    t.f0[i] = 0.17;
  });
  t.bump = 1.5;
}

// ------------------------------------------------------------------ generators by texture name
const GEN = {
  stone: (t) => stoneBase(t),
  smooth_stone: (t) => {
    stoneBase(t, pal(0x8f8f92, 0x96969a, 0x9c9ca0, 0xa3a3a6), { strata: 0.1, cracks: 2, smooth: 0.42, bump: 0.8, specks: false });
    t.each((x, y, i) => {
      if (y === 0 || y === N - 1 || x === 0 || x === N - 1) {
        t.set(i, hex(y === 0 || x === 0 ? 0xb4b4b7 : 0x6c6c70));
        t.height[i] = 0.75;
      }
    });
  },
  granite: (t) => speckled(t, P.granite, { light: 0.93, darkFrac: 0.1, smooth: 0.38 }),
  diorite: (t) => speckled(t, P.diorite, { light: 0.99, darkFrac: 0.16, smooth: 0.4 }),
  andesite: (t) => speckled(t, P.andesite, { light: 0.85, darkFrac: 0.05, smooth: 0.32 }),
  polished_andesite: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const v = contrast(fbm(x + 0.5, y + 0.5, 4, 3, s), 1.6) * 0.6 + rnd(x, y, s) * 0.3;
      t.set(i, pick(P.andesite, 0.25 + v * 0.55));
      t.height[i] = 0.92;
      t.smooth[i] = 0.62 + v * 0.1;
    });
    bevel(t, 2, 0.14, 0.22, 0.2);
    t.bump = 1.5;
  },
  bedrock: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const w = worley(px, py, 6, 6, s, 1);
      const tone = hash32(w.id, s) / 4294967296;
      const n = fbm(px, py, 4, 3, s + 1);
      const v = tone * 0.55 + contrast(n, 2) * 0.35 + rnd(x, y, s + 2) * 0.15 - (w.edge < 0.8 ? 0.35 : 0);
      t.set(i, pick(P.bedrock, v));
      t.height[i] = clamp(0.25 + v * 0.75, 0, 1);
      t.smooth[i] = 0.15;
    });
    t.bump = 3.5;
    t.relief = 0.25;
  },
  obsidian: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const w = worley(px, py, 4, 4, s, 0.9);
      const tone = hash32(w.id, s) / 4294967296;
      // Conchoidal fracture: each shard darkens toward its centre.
      const grad = clamp(w.edge / 5, 0, 1);
      let v = 0.2 + tone * 0.25 + (1 - grad) * 0.3 + (fbm(px, py, 8, 2, s + 1) - 0.5) * 0.3;
      if (w.edge < 0.6) v = 0.85 + tone * 0.15;
      t.set(i, pick(P.obsidian, v));
      t.height[i] = 0.7 + grad * 0.25;
      t.smooth[i] = 0.86;
      t.f0[i] = 0.05;
    });
    t.bump = 1.6;
  },
  cobblestone: (t) => cobbleBase(t),
  mossy_cobblestone: (t) => {
    cobbleBase(t);
    addMoss(t, 0.33, t.seed + 50);
  },
  bricks: (t) => masonry(t, {
    rowH: 8, brickW: 16, offset: 8, mortar: 1, bevel: 1.5,
    pal: pal(0x6f3326, 0x7e3b2c, 0x8c4433, 0x994d3a, 0xa65742, 0xb4644d),
    mortarPal: pal(0x8e877e, 0x9d968c, 0xaca59a), smooth: 0.3,
  }),
  stone_bricks: (t) => masonry(t, {
    rowH: 16, brickW: 32, offset: 16, mortar: 1, bevel: 2.5,
    pal: pal(0x626265, 0x6e6e71, 0x7a7a7d, 0x858588, 0x909093, 0x9c9c9f),
    mortarPal: P.mortar, smooth: 0.3,
  }),
  mossy_stone_bricks: (t) => {
    GEN.stone_bricks(t);
    addMoss(t, 0.28, t.seed + 5, { crevice: 0.6 });
  },
  dirt: (t) => dirtBase(t),
  grass_top: (t) => grassTop(t),
  grass_side: (t) => {
    const depth = fringe(t.seed, 4, 3, 5);
    overhangSide(t, depth, (x, y, i, fromEdge) => {
      const v = 0.2 + rnd(x, y, t.seed) * 0.5 + (y < 2 ? 0.2 : 0) - (fromEdge === 1 ? 0.2 : 0);
      t.set(i, pick(P.grass, v));
      t.height[i] = 0.9;
      t.smooth[i] = 0.22;
      t.sss[i] = 0.3;
    });
  },
  grass_side_snowy: (t) => {
    const depth = fringe(t.seed, 6, 3, 4);
    overhangSide(t, depth, (x, y, i, fromEdge) => {
      const v = 0.45 + rnd(x, y, t.seed) * 0.4 - (fromEdge === 1 ? 0.35 : 0);
      t.set(i, pick(P.snow, v));
      t.height[i] = 0.95;
      t.smooth[i] = 0.45;
      t.sss[i] = 0.4;
    });
  },
  podzol_top: (t) => {
    dirtBase(t, t.seed, pal(0x3b2616, 0x46301b, 0x523820, 0x5c4025, 0x68492b, 0x73522f));
    // Fallen needles: short diagonal orange-brown strokes.
    const r = t.rand;
    const needle = pal(0x6b4221, 0x8a5a2b, 0xa06c33);
    for (let k = 0; k < 42; k++) {
      let x = Math.floor(r() * N), y = Math.floor(r() * N);
      const dx = r() < 0.5 ? 1 : -1, len = 2 + Math.floor(r() * 3), c = pick(needle, r());
      for (let j = 0; j < len; j++, x += dx, y += j & 1) {
        const i = wrapi(y, N) * N + wrapi(x, N);
        t.set(i, c);
        t.height[i] = 0.9;
      }
    }
  },
  podzol_side: (t) => {
    const depth = fringe(t.seed, 3, 3, 3);
    const p = pal(0x3b2616, 0x4a311c, 0x5c4025, 0x6e4c2a, 0x8a5a2b);
    overhangSide(t, depth, (x, y, i) => {
      t.set(i, pick(p, rnd(x, y, t.seed) * 0.9 + (y === 0 ? 0.1 : 0)));
      t.height[i] = 0.9;
    });
  },
  snow: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const v = contrast(fbm(px, py, 4, 3, s), 1.6) * 0.7 + rnd(x, y, s + 1) * 0.3;
      t.set(i, pick(P.snow, 0.2 + v * 0.8));
      t.height[i] = 0.7 + v * 0.2;
      const sparkle = rnd(x, y, s + 2) > 0.965;
      t.smooth[i] = sparkle ? 0.95 : 0.42;
      t.sss[i] = 0.45;
    });
    t.bump = 1;
  },
  sand: (t) => granular(t, P.sand, { sparkle: 0.5, smooth: 0.2, contrast: 1.6, lowW: 0.45 }),
  red_sand: (t) => granular(t, P.redSand, { sparkle: 0.4, smooth: 0.2, contrast: 1.6, lowW: 0.45 }),
  clay: (t) => {
    granular(t, P.clay, { freq: 2, contrast: 2, lowW: 0.75, smooth: 0.35, bump: 0.9, heightAmp: 0.25, porosity: 0.1 });
    const r = t.rand;
    for (let k = 0; k < 10; k++) {
      const i = Math.floor(r() * PX);
      t.set(i, hex(0xc3cad6));
    }
  },
  terracotta: (t) => {
    granular(t, P.terracotta, { freq: 4, contrast: 1.8, lowW: 0.7, smooth: 0.3, bump: 0.8, heightAmp: 0.2 });
    const r = t.rand;
    for (let k = 0; k < 16; k++) t.shade(Math.floor(r() * PX), r() < 0.5 ? 0.85 : 1.12);
  },
  gravel: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const w = worley(px, py, 8, 8, s, 0.95);
      const tone = hash32(w.id, s + 1) / 4294967296;
      const d = clamp(w.edge / 1.8, 0, 1);
      const warm = (hash32(w.id, s + 2) & 3) === 0;
      let c = pick(P.gravel, tone * 0.7 + d * 0.3 + (rnd(x, y, s + 3) - 0.5) * 0.15);
      if (warm) c = mixc(c, hex(0x8a6d58), 0.4);
      if (w.edge < 0.5) c = hex(0x3b3735);
      t.set(i, c);
      t.height[i] = w.edge < 0.5 ? 0.1 : 0.35 + d * 0.6;
      t.smooth[i] = 0.3 + tone * 0.15;
    });
    t.bump = 3;
    t.relief = 0.3;
  },
  sandstone: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const layer = fbm(px, py, 1, 3, s, 10);
      let v = 0.3 + contrast(layer, 2.5) * 0.45 + rnd(x, y, s + 1) * 0.2;
      let h = 0.8 + (layer - 0.5) * 0.2;
      if (y < 5) { v = 0.62 + rnd(x, y, s + 2) * 0.25; h = 0.95; }
      if (y === 5) { v = 0.05; h = 0.5; }
      if (y >= 26) {
        // Eroded base course with wavy grooves.
        const wave = Math.sin(px * 0.8 + Math.floor(y / 2) * 1.7) > 0.55;
        v = 0.35 + rnd(x, y, s + 3) * 0.3 - (wave ? 0.25 : 0);
        h = wave ? 0.6 : 0.85;
      }
      if (y === 25) { v = 0.1; h = 0.55; }
      t.set(i, pick(P.sandstone, v));
      t.height[i] = h;
      t.smooth[i] = 0.25;
      t.sss[i] = 0.05;
    });
    t.bump = 2;
  },
  sandstone_top: (t) => {
    granular(t, P.sandstone, { freq: 2, contrast: 1.6, lowW: 0.55, smooth: 0.26, bump: 0.8, heightAmp: 0.2 });
    bevel(t, 1, 0.05, 0.12, 0.1);
  },
  sandstone_bottom: (t) => {
    granular(t, P.sandstone, { freq: 4, contrast: 2, lowW: 0.5, smooth: 0.22, bump: 1.4 });
    // Wind-eroded pits.
    const s = t.seed;
    t.each((x, y, i) => {
      if (fbm(x + 0.5, y + 0.5, 16, 1, s + 1) > 0.74) {
        t.shade(i, 0.8);
        t.height[i] = 0.45;
      }
    });
  },
  oak_log: (t) => barkSide(t, P.oakBark),
  spruce_log: (t) => barkSide(t, P.spruceBark, { cols: 6, segment: 8, wobble: 3, bump: 3 }),
  birch_log: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const n = fbm(px, py, 4, 3, s, 2);
      t.set(i, pick(P.birchBark, 0.3 + contrast(n, 1.8) * 0.5 + rnd(x, y, s + 1) * 0.2));
      t.height[i] = 0.85 + (n - 0.5) * 0.1;
      t.smooth[i] = 0.35;
    });
    // Dark lenticels: horizontal dashes spaced apart so no clusters form glyph-like shapes.
    const r = t.rand;
    const dark = pal(0x1e1c19, 0x2b2824, 0x3c3832, 0x57524a);
    const placed = [];
    for (let k = 0, tries = 0; k < 14 && tries < 300; tries++) {
      const x = Math.floor(r() * N), y = Math.floor(r() * N), len = 2 + Math.floor(r() * (r() < 0.25 ? 9 : 5));
      const clash = placed.some((q) => {
        const dy = Math.abs(wrapi(y - q.y + N / 2, N) - N / 2);
        const dx = Math.abs(wrapi(x + len / 2 - (q.x + q.len / 2) + N / 2, N) - N / 2);
        return dy < 4 && dx < (len + q.len) / 2 + 2;
      });
      if (clash) continue;
      placed.push({ x, y, len });
      k++;
      const thick = len > 6 && r() < 0.5 ? 2 : 1;
      for (let j = 0; j < len; j++) {
        for (let d = 0; d < thick; d++) {
          const i = wrapi(y + d, N) * N + wrapi(x + j, N);
          t.set(i, pick(dark, (j === 0 || j === len - 1 ? 0.7 : 0) + (d ? 0.4 : 0) + r() * 0.3));
          t.height[i] = 0.55;
          t.smooth[i] = 0.15;
        }
      }
    }
    t.bump = 2;
  },
  oak_log_top: (t) => logTop(t, P.oakWood, P.oakBark),
  birch_log_top: (t) => logTop(t, P.birchWood, P.birchBark, { crackAngle: -2.2 }),
  spruce_log_top: (t) => logTop(t, P.spruceWood, P.spruceBark, { ringPx: 2.5, crackAngle: 2.4 }),
  oak_planks: (t) => planksBase(t, P.oakPlanks),
  spruce_planks: (t) => planksBase(t, P.sprucePlanks),
  birch_planks: (t) => planksBase(t, P.birchPlanks),
  oak_leaves: (t) => leavesBase(t, P.oakLeaves, LEAF_SHAPES.broad, { holes: 0.3 }),
  birch_leaves: (t) => leavesBase(t, P.birchLeaves, LEAF_SHAPES.small, { holes: 0.28 }),
  spruce_leaves: (t) => leavesBase(t, P.spruceLeaves, LEAF_SHAPES.needles, { holes: 0.32 }),

  glass: (t) => glass(t, hex(0xd4e6ec)),
  red_stained_glass: (t) => glass(t, hex(0xb3312c), { alpha: 0.45, frameAlpha: 0.9, streakAlpha: 0.6, frameLight: 0.25 }),
  blue_stained_glass: (t) => glass(t, hex(0x2f4fb8), { alpha: 0.45, frameAlpha: 0.9, streakAlpha: 0.6, frameLight: 0.25 }),
  green_stained_glass: (t) => glass(t, hex(0x4c8f2a), { alpha: 0.45, frameAlpha: 0.9, streakAlpha: 0.6, frameLight: 0.25 }),
  ice: (t) => {
    const s = t.seed;
    const p = pal(0x7fa9e0, 0x8db4e8, 0x9dc0ef, 0xadcbf4, 0xbfd8f8);
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const n = fbm(px, py, 2, 3, s);
      const w = worley(px, py, 3, 3, s + 1, 0.9);
      const crack = w.edge < 0.6 && fbm(px, py, 4, 2, s + 2) > 0.42;
      t.set(i, crack ? hex(0xe6f1fc) : pick(p, contrast(n, 2) * 0.8 + rnd(x, y, s + 3) * 0.2));
      t.alpha[i] = crack ? 0.82 : 0.62 + (n - 0.5) * 0.1;
      t.height[i] = crack ? 0.7 : 0.95;
      t.smooth[i] = crack ? 0.6 : 0.95;
      t.f0[i] = 0.02;
      t.sss[i] = 0.25;
    });
    // Trapped air bubbles.
    const r = t.rand;
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(r() * PX);
      t.set(i, hex(0xf4f9ff));
      t.alpha[i] = 0.8;
    }
    t.bump = 1.2;
  },
  water: (t) => {
    const s = t.seed;
    const base = [0.13, 0.32, 0.45];
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const q = fbm(px, py, 2, 2, s + 1);
      const n = fbm(px + q * 10, py + q * 6, 4, 3, s);
      const ripple = 0.5 + 0.5 * Math.sin((n * 3 + py / N * 2) * Math.PI * 2);
      t.set(i, base, 0.94 + ripple * 0.12);
      t.alpha[i] = 0.55;
      t.height[i] = 0.55 + (ripple - 0.5) * 0.3;
      t.smooth[i] = 1;
      t.f0[i] = 0.02;
    });
    t.bump = 0.8;
  },
  lava: (t) => {
    const s = t.seed;
    const hot = pal(0xd4400c, 0xef6a16, 0xfb9424, 0xffb938, 0xffd766, 0xffefa6);
    const crust = pal(0x3c0b02, 0x5a1304, 0x7a1d06, 0x9a2a09);
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const q = fbm(px, py, 2, 2, s + 1), r2 = fbm(px, py, 2, 2, s + 2);
      const heat = contrast(fbm(px + q * 9, py + r2 * 9, 6, 3, s), 2.2) * 0.8 + 0.2 * (1 - clamp(worley(px, py, 5, 5, s + 5).edge / 2, 0, 1));
      if (heat > 0.42) {
        const k = (heat - 0.42) / 0.58;
        t.set(i, pick(hot, k * 0.9 + rnd(x, y, s + 3) * 0.1));
        t.emit[i] = 0.75 + k * 0.25;
        t.height[i] = 0.45 - k * 0.15;
        t.smooth[i] = 0.62;
      } else {
        const k = heat / 0.42;
        t.set(i, pick(crust, k * 0.85 + rnd(x, y, s + 4) * 0.15));
        t.emit[i] = 0.12 + k * 0.3;
        t.height[i] = 0.6 + (1 - k) * 0.35;
        t.smooth[i] = 0.2;
      }
    });
    t.bump = 2;
  },

  coal_ore: (t) => ore(t, pal(0x121212, 0x1d1d1e, 0x28282a, 0x363638, 0x4a4a4d), { smooth: 0.45, clusters: 6 }),
  iron_ore: (t) => ore(t, pal(0x8a6149, 0xa8795c, 0xc49476, 0xd8ae93, 0xe8c9b3), { smooth: 0.45, f0: 0.08 }),
  gold_ore: (t) => ore(t, P.gold, { smooth: 0.55, f0: 1, glint: 0.85 }),
  diamond_ore: (t) => ore(t, P.diamond, { smooth: 0.8, f0: 0.17, glint: 0.95, clusters: 4 }),

  gold_block: (t) => metalBlock(t, P.gold, { smooth: 0.82 }),
  iron_block: (t) => {
    metalBlock(t, P.iron, { smooth: 0.72 });
    // Two riveted plates.
    t.each((x, y, i) => {
      if ((y === 15 || y === 16) && x > 1 && x < N - 2) {
        t.shade(i, y === 15 ? 0.7 : 1.1);
        t.height[i] = 0.7;
      }
      for (const [rx, ry] of [[5, 5], [26, 5], [5, 26], [26, 26], [5, 10], [26, 10], [5, 21], [26, 21]]) {
        const d = Math.hypot(x - rx, y - ry);
        if (d < 1.3) {
          t.shade(i, x < rx || y < ry ? 1.15 : 0.8);
          t.height[i] = 1;
        }
      }
    });
  },
  diamond_block: (t) => brilliantBlock(t, P.diamond),
  emerald_block: (t) => stepCutBlock(t, P.emerald),
  lapis_block: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const n = contrast(fbm(px, py, 4, 3, s), 2);
      const g = rnd(x, y, s + 1);
      t.set(i, pick(P.lapis, n * 0.7 + g * 0.3));
      t.height[i] = 0.85 + (n - 0.5) * 0.1;
      t.smooth[i] = 0.55;
      if (g > 0.975) {
        t.set(i, hex(0xe0c05a)); // pyrite fleck
        t.f0[i] = 1;
        t.smooth[i] = 0.8;
      } else if (g < 0.03) t.set(i, hex(0xb5c4e8));
    });
    bevel(t, 2, 0.15, 0.25, 0.2);
    t.bump = 1.6;
  },
  coal_block: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const w = worley(px, py, 6, 6, s, 0.9);
      const tone = hash32(w.id, s) / 4294967296;
      let v = 0.15 + tone * 0.4 + clamp(((w.px - px) + (w.py - py)) * 0.08, -0.2, 0.2);
      if (w.edge < 0.6) v = 0.9;
      t.set(i, pick(P.coal, v));
      t.height[i] = w.edge < 0.6 ? 0.55 : 0.8 + tone * 0.15;
      t.smooth[i] = 0.55 + tone * 0.15;
    });
    bevel(t, 1, 0.3, 0.3, 0.15);
    t.bump = 2;
  },
  quartz_block_side: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const vein = fbm(px, py, 6, 3, s, 1);
      t.set(i, pick(P.quartz, 0.35 + contrast(vein, 1.8) * 0.45 + rnd(x, y, s + 1) * 0.15));
      t.height[i] = 0.92;
      t.smooth[i] = 0.8;
    });
    bevel(t, 1, 0.04, 0.15, 0.12);
    t.bump = 1;
  },
  quartz_block_top: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const n = fbm(px, py, 3, 3, s);
      let v = 0.4 + contrast(n, 1.6) * 0.4 + rnd(x, y, s + 1) * 0.15;
      const e = Math.min(x, y, N - 1 - x, N - 1 - y);
      let h = 0.92;
      if (e === 3) { v -= 0.25; h = 0.8; }
      t.set(i, pick(P.quartz, v));
      t.height[i] = h;
      t.smooth[i] = 0.8;
    });
    bevel(t, 1, 0.04, 0.15, 0.12);
    t.bump = 1.2;
  },

  glowstone: (t) => {
    const s = t.seed;
    const glow = pal(0xa8702c, 0xcf973f, 0xe8b852, 0xf7d672, 0xffeaa0, 0xfff7d6);
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const w = worley(px, py, 6, 6, s, 0.95);
      const tone = hash32(w.id, s + 1) / 4294967296;
      const core = clamp(w.edge / 3, 0, 1);
      if (w.edge < 0.7) {
        t.set(i, hex(rnd(x, y, s + 2) > 0.5 ? 0x5c3a18 : 0x6e4820));
        t.emit[i] = 0.25;
        t.height[i] = 0.35;
      } else {
        const v = 0.2 + core * 0.55 + tone * 0.25 + (rnd(x, y, s + 3) - 0.5) * 0.1;
        t.set(i, pick(glow, v));
        t.emit[i] = 0.85 + core * 0.15;
        t.height[i] = 0.6 + core * 0.35;
      }
      t.smooth[i] = 0.55;
      t.sss[i] = 0.3;
    });
    t.bump = 2.2;
  },
  sea_lantern: (t) => {
    const s = t.seed;
    const frame = pal(0x3f6f6c, 0x4d807c, 0x5d938e, 0x6fa7a1);
    const glow = pal(0x8ccfc2, 0xacdfd3, 0xc9ece3, 0xe2f7f1, 0xf6fffc);
    t.each((x, y, i) => {
      const e = Math.min(x, y, N - 1 - x, N - 1 - y);
      const onGrid = x === 15 || x === 16 || y === 15 || y === 16;
      if (e < 2 || onGrid) {
        t.set(i, pick(frame, rnd(x, y, s) * 0.6 + (e === 0 || x === 16 || y === 16 ? 0 : 0.4)));
        t.emit[i] = 0.25;
        t.height[i] = 0.95;
        t.smooth[i] = 0.7;
        return;
      }
      // Four glowing panes, brightest in their centres.
      const cx = x < 16 ? 8.5 : 23.5, cy = y < 16 ? 8.5 : 23.5;
      const d = Math.max(Math.abs(x + 0.5 - cx), Math.abs(y + 0.5 - cy)) / 6.5;
      const v = 1 - d * 0.75 + (rnd(x, y, s + 1) - 0.5) * 0.15 + (fbm(x + 0.5, y + 0.5, 4, 2, s + 2) - 0.5) * 0.3;
      t.set(i, pick(glow, v));
      t.emit[i] = 0.75 + (1 - d) * 0.25;
      t.height[i] = 0.8;
      t.smooth[i] = 0.9;
      t.sss[i] = 0.35;
    });
    t.bump = 2;
  },

  torch: (t) => {
    t.clear();
    const wood = pal(0x4a3219, 0x6b4a28, 0x8a6238, 0xa27844);
    const flame = pal(0xffa726, 0xffcc4a, 0xffe78a, 0xfff8d8);
    for (let y = 12; y < N; y++) {
      for (let x = 14; x < 18; x++) {
        const across = [0.9, 0.65, 0.4, 0.15][x - 14];
        if (y < 16) {
          const core = (x === 15 || x === 16) && (y === 13 || y === 14);
          t.plot(x, y, pick(flame, core ? 1 : 0.35 + (1 - across) * 0.1 + (y === 12 ? 0.25 : 0)), 0.9);
          t.emit[y * N + x] = 1;
        } else {
          const v = across * 0.75 + rnd(x, y, t.seed) * 0.25 - (y === 16 ? 0.3 : 0);
          t.plot(x, y, pick(wood, v), 0.5 + across * 0.3);
          if (y === 16) t.emit[y * N + x] = 0.25; // charred, glowing tip
        }
      }
    }
    t.material({ smooth: 0.2 });
    t.bump = 1.2;
  },

  short_grass: (t) => {
    t.clear();
    const r = t.rand;
    for (let k = 0; k < 14; k++) {
      const x0 = 3 + r() * 26, top = 8 + r() * 16, lean = (r() - 0.5) * 10;
      blade(t, x0, N - 1, x0 + lean, top, (r() - 0.5) * 5, P.grass, { base: 0.05, range: 0.9, width: 0.25 });
    }
    t.material({ smooth: 0.3, sss: 0.7 });
  },
  tall_grass_bottom: (t) => tallGrass(t, 'bottom'),
  tall_grass_top: (t) => tallGrass(t, 'top'),
  fern: (t) => {
    t.clear();
    const p = pal(0x1f4a18, 0x2a5e1f, 0x376f28, 0x458233, 0x55963f);
    const r = t.rand;
    const fronds = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
    for (const a0 of fronds) {
      const len = 20 + r() * 9;
      const a = a0 + (r() - 0.5) * 0.2;
      // Stem arcs outward and droops at the tip.
      for (let k = 0; k <= len; k++) {
        const u = k / len;
        const ang = a * (0.55 + u * 0.7);
        const x = C + Math.sin(ang) * k * 0.95;
        const y = N - 1 - Math.cos(ang) * k * 0.95 + u * u * 3;
        t.plot(x, y, pick(p, 0.25 + u * 0.4), 0.6);
        if (k > 2 && k % 2 === 0) {
          // Leaflets: pairs perpendicular to the stem, shrinking to the tip.
          const leaf = Math.round((1 - u) * 3.2);
          const nx = Math.cos(ang), ny = Math.sin(ang);
          for (let j = 1; j <= leaf; j++) {
            t.plot(x + nx * j, y + ny * j - j * 0.4, pick(p, 0.5 + j * 0.12), 0.5);
            t.plot(x - nx * j, y - ny * j - j * 0.4, pick(p, 0.35 + j * 0.1), 0.5);
          }
        }
      }
    }
    t.material({ smooth: 0.3, sss: 0.7 });
  },
  dandelion: (t) => {
    t.clear();
    const stem = pal(0x2e6a1f, 0x3d7f28, 0x4f9433);
    blade(t, 15, 31, 15, 18, 1.5, stem, { base: 0.1, range: 0.6 });
    blade(t, 15, 31, 9, 25, -1, stem, { base: 0.2, range: 0.7 });
    blade(t, 16, 31, 22, 26, 1, stem, { base: 0.2, range: 0.7 });
    const head = pal(0xc9920c, 0xe7b516, 0xf7d330, 0xfde767);
    for (let y = 12; y <= 18; y++) {
      for (let x = 12; x <= 19; x++) {
        const d = Math.hypot((x - 15.5) / 3.8, (y - 15) / 3.2);
        if (d > 1) continue;
        const v = 1 - d * 0.6 - (y - 12) * 0.05 + (rnd(x, y, t.seed) - 0.5) * 0.3;
        t.plot(x, y, pick(head, v), 0.9);
      }
    }
    t.material({ smooth: 0.3, sss: 0.65 });
  },
  poppy: (t) => {
    t.clear();
    const stem = pal(0x2e6a1f, 0x3d7f28, 0x4f9433);
    blade(t, 16, 31, 15, 16, -1.5, stem, { base: 0.1, range: 0.6 });
    blade(t, 16, 30, 10, 23, 1, stem, { base: 0.2, range: 0.7 });
    blade(t, 16, 31, 21, 27, -1, stem, { base: 0.2, range: 0.7 });
    const petal = pal(0x8e0f0a, 0xb3190f, 0xd42a1c, 0xec4a36, 0xf77a62);
    for (let y = 8; y <= 16; y++) {
      for (let x = 10; x <= 21; x++) {
        const d = Math.hypot((x - 15.5) / 5.2, (y - 12) / 4.2);
        if (d > 1) continue;
        const lobe = Math.abs(Math.sin(Math.atan2(y - 12, x - 15.5) * 2.5));
        if (d > 0.82 && lobe < 0.3) continue; // notches between petals
        let c = pick(petal, 0.95 - d * 0.55 - (y - 8) * 0.04 + (rnd(x, y, t.seed) - 0.5) * 0.2);
        if (d < 0.25) c = hex(0x1c1712);
        t.plot(x, y, c, 0.9 - d * 0.2);
      }
    }
    t.material({ smooth: 0.35, sss: 0.65 });
  },
  blue_orchid: (t) => {
    t.clear();
    const stem = pal(0x2e6a1f, 0x3d7f28, 0x4f9433);
    blade(t, 15, 31, 12, 12, -2, stem, { base: 0.1, range: 0.6 });
    blade(t, 16, 31, 21, 17, 1.5, stem, { base: 0.1, range: 0.6 });
    blade(t, 16, 31, 9, 25, 1, stem, { base: 0.2, range: 0.7 });
    const petal = pal(0x2078b8, 0x2f97cf, 0x4db6e6, 0x7dd0f5, 0xb5e8fc);
    const flower = (cx, cy, rad) => {
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
        for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) / rad;
          if (d > 1) continue;
          const lobe = Math.abs(Math.cos(Math.atan2(dy, dx) * 2.5));
          if (d > 0.6 && lobe < 0.35) continue;
          let c = pick(petal, 1 - d * 0.6 - dy * 0.05 + (rnd(x, y, t.seed) - 0.5) * 0.2);
          if (d < 0.2) c = hex(0xeae3f7);
          t.plot(x, y, c, 0.9);
        }
      }
    };
    flower(12, 10, 3.6);
    flower(21, 15.5, 3.1);
    t.material({ smooth: 0.35, sss: 0.65 });
  },
  dead_bush: (t) => {
    t.clear();
    const p = pal(0x4a2f15, 0x5e3d1c, 0x734c25, 0x8a5e30, 0x9e6f3b);
    const r = t.rand;
    const branch = (x, y, ang, len, depth) => {
      const steps = Math.ceil(len * 2);
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        t.plot(x + Math.sin(ang) * len * u, y - Math.cos(ang) * len * u, pick(p, 0.3 + u * 0.5 + (r() - 0.5) * 0.2), 0.6);
      }
      if (depth <= 0) return;
      const ex = x + Math.sin(ang) * len, ey = y - Math.cos(ang) * len;
      branch(ex, ey, ang - 0.4 - r() * 0.4, len * (0.55 + r() * 0.2), depth - 1);
      branch(ex, ey, ang + 0.4 + r() * 0.4, len * (0.55 + r() * 0.2), depth - 1);
    };
    branch(C, N - 1, -0.55, 8, 2);
    branch(C, N - 1, 0.5, 8.5, 2);
    branch(C, N - 1, 0.02, 7, 2);
    t.material({ smooth: 0.2, sss: 0.6 });
  },
  sugar_cane: (t) => {
    t.clear();
    const p = pal(0x5f8f35, 0x77a843, 0x8fc052, 0xa7d466, 0xbde27f);
    for (const [sx, off] of [[5, 0], [15, 5], [25, 2]]) {
      for (let y = 0; y < N; y++) {
        const node = (y + off) % 10 === 0;
        t.plot(sx, y, pick(p, node ? 0.95 : 0.7), 0.8);
        t.plot(sx + 1, y, pick(p, node ? 0.7 : 0.35), 0.7);
      }
    }
    // Leaves sprouting from nodes.
    blade(t, 6, 10, 11, 3, 1, p, { base: 0.2, range: 0.6 });
    blade(t, 15, 25, 10, 16, -1, p, { base: 0.2, range: 0.6 });
    blade(t, 26, 18, 30, 11, 1, p, { base: 0.2, range: 0.6 });
    blade(t, 16, 5, 21, 0, 0.5, p, { base: 0.2, range: 0.6 });
    t.material({ smooth: 0.35, sss: 0.6 });
    t.wrap = true;
  },
  red_mushroom: (t) => {
    t.clear();
    const stemP = pal(0xb8ad96, 0xd2c8b2, 0xe6dfcd);
    for (let y = 22; y < N; y++) for (let x = 14; x <= 17; x++) t.plot(x, y, pick(stemP, x === 14 ? 0.9 : x === 17 ? 0.1 : 0.55), 0.6);
    const cap = pal(0x7c120c, 0x9c1a11, 0xbf2718, 0xd83a26);
    for (let y = 13; y <= 22; y++) {
      for (let x = 8; x <= 23; x++) {
        const d = Math.hypot((x - 15.5) / 7.6, (y - 22) / 9);
        if (d > 1 || y > 22) continue;
        let c = pick(cap, 1 - d * 0.7 - (x - 8) * 0.02);
        const spot = [[11, 16], [17, 14], [14, 19], [20, 18]].some(([sx, sy]) => x >= sx && x <= sx + 1 && y >= sy && y <= sy + 1);
        if (spot) c = hex(0xf3ede1);
        if (y === 22) c = hex(0x5e0d08);
        t.plot(x, y, c, 0.9);
      }
    }
    t.material({ smooth: 0.45, sss: 0.6 });
  },
  brown_mushroom: (t) => {
    t.clear();
    const stemP = pal(0xa99b82, 0xc7baa1, 0xdcd2bc);
    for (let y = 24; y < N; y++) for (let x = 14; x <= 17; x++) t.plot(x, y, pick(stemP, x === 14 ? 0.9 : x === 17 ? 0.1 : 0.55), 0.6);
    const cap = pal(0x6b4a33, 0x7f5a3f, 0x94694b, 0xa97c5c);
    for (let y = 18; y <= 24; y++) {
      for (let x = 7; x <= 24; x++) {
        const d = Math.hypot((x - 15.5) / 8.6, (y - 24) / 6);
        if (d > 1) continue;
        let c = pick(cap, 1 - d * 0.6 + (rnd(x, y, t.seed) - 0.5) * 0.25);
        if (y === 24) c = hex(0x4a3222);
        t.plot(x, y, c, 0.9);
      }
    }
    t.material({ smooth: 0.3, sss: 0.6 });
  },
  lily_pad: (t) => {
    t.clear();
    const p = pal(0x1f5218, 0x2a661f, 0x357a27, 0x428e31, 0x52a13c);
    const notch = -0.9; // angle of the wedge cut
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - C, dy = y + 0.5 - C;
        const d = Math.hypot(dx, dy);
        const r = 13.5 + (fbm(x + 0.5, y + 0.5, 4, 1, t.seed) - 0.5) * 2;
        if (d > r) continue;
        const ang = Math.atan2(dy, dx);
        if (Math.abs(ang - notch) < 0.18 + 1.2 / (d + 1) && d > 1.5) continue;
        // Radial veins.
        const vein = Math.abs(Math.sin(ang * 5)) < 0.12 && d > 2;
        let v = 0.55 + (d / r) * 0.2 + (rnd(x, y, t.seed + 1) - 0.5) * 0.25;
        if (vein) v -= 0.3;
        if (d > r - 1.2) v -= 0.35;
        t.plot(x, y, pick(p, v), vein ? 0.6 : 0.8);
      }
    }
    t.material({ smooth: 0.55, sss: 0.6 });
  },

  white_wool: (t) => wool(t, 0xe7ebeb),
  red_wool: (t) => wool(t, 0xa3282a),
  orange_wool: (t) => wool(t, 0xe8731a),
  yellow_wool: (t) => wool(t, 0xf4c52e),
  lime_wool: (t) => wool(t, 0x6eb51f),
  cyan_wool: (t) => wool(t, 0x178a92),
  blue_wool: (t) => wool(t, 0x363b9e),
  purple_wool: (t) => wool(t, 0x7a2cab),
  black_wool: (t) => wool(t, 0x19191d),

  bookshelf: (t) => {
    planksBase(t, P.oakPlanks, { seed: seedFrom('oak_planks') });
    const r = t.rand;
    const books = pal(0x7a2a22, 0x2d4f7c, 0x3e6b34, 0x8a6a2e, 0x5a3a6e, 0x2f6f6a, 0x9b4a1f, 0x6b6b5e);
    for (const [y0, y1] of [[3, 14], [18, 29]]) {
      // Dark cavity behind the books.
      for (let y = y0; y <= y1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = y * N + x;
          t.set(i, hex(0x2a1d10));
          t.height[i] = 0.1;
        }
      }
      let x = 1;
      while (x < N - 2) {
        const w = 2 + Math.floor(r() * 3);
        const top = y0 + Math.floor(r() * 4);
        const c = pick(books, r());
        const band = top + 2 + Math.floor(r() * 4);
        for (let bx = x; bx < Math.min(x + w, N - 1); bx++) {
          for (let y = top; y <= y1; y++) {
            const i = y * N + bx;
            let k = bx === x ? 1.15 : bx === x + w - 1 ? 0.7 : 1;
            if (y === band || y === band + 3) k *= 1.35; // gilded spine bands
            if (y === top) k *= 1.2;
            t.set(i, c, k);
            t.height[i] = 0.75 - (bx === x + w - 1 ? 0.1 : 0);
            t.smooth[i] = 0.3;
          }
        }
        x += w + (r() < 0.15 ? 1 : 0);
      }
    }
  },
  crafting_table_top: (t) => {
    // Solid worktop (no board gaps) with a dark rim and an engraved 3×3 grid.
    const s = seedFrom('oak_planks');
    t.each((x, y, i) => {
      const px = x + 0.5, py = y + 0.5;
      const e = Math.min(x, y, N - 1 - x, N - 1 - y);
      const grain = fbm(px, py, 2, 3, s, 16);
      if (e < 2) {
        t.set(i, pick(P.oakBark, 0.35 + rnd(x, y, t.seed) * 0.35 + (e === 1 ? 0.25 : 0)));
        t.height[i] = 1;
        t.smooth[i] = 0.2;
        return;
      }
      const groove = x === 11 || x === 20 || y === 11 || y === 20;
      const v = 0.35 + contrast(grain, 2.5) * 0.45 + (rnd(x, y, s) - 0.5) * 0.15 - (groove ? 0.45 : 0) + (x === 12 || x === 21 || y === 12 || y === 21 ? 0.1 : 0);
      t.set(i, pick(P.oakPlanks, v));
      t.height[i] = groove ? 0.55 : 0.85 + (grain - 0.5) * 0.1;
      t.smooth[i] = 0.35;
    });
    t.bump = 2;
  },
  crafting_table_side: (t) => craftingSide(t, false),
  crafting_table_front: (t) => craftingSide(t, true),
  furnace_top: (t) => {
    stoneBase(t, pal(0x6f6f72, 0x7a7a7d, 0x858588, 0x909093, 0x9b9b9e), { strata: 0.1, cracks: 2, smooth: 0.35 });
    bevel(t, 2, 0.15, 0.3, 0.25);
  },
  furnace_side: (t) => {
    GEN.furnace_top(t);
    t.each((x, y, i) => {
      if (y === 9 || y === 10) {
        t.shade(i, y === 9 ? 0.6 : 1.15);
        t.height[i] = 0.6;
      }
    });
  },
  furnace_front: (t) => {
    GEN.furnace_top(t);
    const s = t.seed;
    t.each((x, y, i) => {
      // Firebox mouth with grate bars and a dim ember bed.
      if (x >= 8 && x <= 23 && y >= 16 && y <= 27) {
        const rim = x === 8 || x === 23 || y === 16 || y === 27;
        if (rim) {
          t.set(i, hex(0x3a3a3c));
          t.height[i] = 0.55;
          return;
        }
        const ember = y >= 23;
        const bar = (x - 8) % 4 === 0 && y >= 18 && y <= 22;
        if (bar) {
          t.set(i, hex(0x4a4a4e));
          t.height[i] = 0.5;
          t.f0[i] = 0.9;
          t.smooth[i] = 0.5;
        } else if (ember) {
          const v = rnd(x, y, s);
          t.set(i, hex(v > 0.6 ? 0xff8a2a : v > 0.3 ? 0xc84a14 : 0x5a1c0a));
          t.emit[i] = v > 0.6 ? 0.55 : v > 0.3 ? 0.35 : 0.1;
          t.height[i] = 0.2;
        } else {
          t.set(i, hex(0x141212));
          t.height[i] = 0.05;
        }
      } else if (x >= 10 && x <= 21 && y >= 6 && y <= 9) {
        // Vent slit above the mouth.
        t.set(i, hex(y === 6 ? 0x3a3a3c : 0x1c1b1b));
        t.height[i] = 0.2;
      }
    });
  },
  pumpkin_side: (t) => pumpkinSide(t),
  pumpkin_top: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const dx = x + 0.5 - C, dy = y + 0.5 - C;
      const ang = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
      const rib = Math.abs(Math.sin(ang * 5));
      const v = 0.2 + rib * 0.55 + (rnd(x, y, s) - 0.5) * 0.15 - clamp((d - 14) * 0.15, 0, 0.3);
      t.set(i, pick(P.pumpkin, v));
      t.height[i] = 0.55 + rib * 0.4;
      t.smooth[i] = 0.45;
      if (d < 3.2) {
        t.set(i, pick(pal(0x3d3a17, 0x4f4a1f, 0x635d28, 0x7a7233), 1 - d / 3.2 + (rnd(x, y, s + 1) - 0.5) * 0.3));
        t.height[i] = 1;
        t.smooth[i] = 0.25;
      }
    });
    t.bump = 2;
  },
  jack_o_lantern: (t) => {
    pumpkinSide(t);
    const face = [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '.....#.................#........',
      '....###...............###.......',
      '...#####.............#####......',
      '..#######...........#######.....',
      '.#########.........#########....',
      '................................',
      '...............##...............',
      '..............####..............',
      '................................',
      '................................',
      '...##........................##.',
      '...####....................####.',
      '....######..##......##..######..',
      '.....###########################',
      '......#########################.',
      '.......######..######..#######..',
      '........####....####....####....',
      '................................',
    ];
    const lit = (x, y) => y >= 0 && y < face.length && face[y][x] === '#';
    const glow = pal(0xf08a14, 0xffb62a, 0xffd34f, 0xffea8a);
    t.each((x, y, i) => {
      if (lit(x, y)) {
        // Carved opening: hottest in the middle, cut wall shadow along the top edge.
        const wall = !lit(x, y - 1);
        t.set(i, wall ? hex(0x7a3b08) : pick(glow, 0.5 + rnd(x, y, t.seed) * 0.5));
        t.emit[i] = wall ? 0.4 : 1;
        t.height[i] = 0.15;
        t.smooth[i] = 0.3;
      } else if (lit(x, y + 1) || lit(x + 1, y) || lit(x - 1, y)) {
        t.shade(i, 0.75);
      }
    });
  },
  cactus_side: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const lx = x & 7;
      const profile = Math.sin((lx + 0.5) / 8 * Math.PI);
      let v = 0.1 + profile * 0.65 + (rnd(x, y, s) - 0.5) * 0.18;
      let h = 0.4 + profile * 0.5;
      // Spines sit on the rib crests at irregular heights per rib.
      const rib = x >> 3;
      const phase = (y + (hash32(rib, s) % 7)) % 7;
      const spine = lx === 4 && phase === 0;
      if (spine) { t.set(i, hex(0xe8e4b0)); h = 1; }
      else if (lx === 4 && phase === 1) { t.set(i, hex(0x0a3a12)); h = 0.6; }
      else if ((lx === 3 || lx === 5) && phase === 0) { t.set(i, pick(P.cactus, v + 0.2)); }
      else t.set(i, pick(P.cactus, v));
      t.height[i] = h;
      t.smooth[i] = 0.4;
      t.sss[i] = 0.3;
    });
    t.bump = 2.5;
  },
  cactus_top: (t) => {
    const s = t.seed;
    t.each((x, y, i) => {
      const dx = x + 0.5 - C, dy = y + 0.5 - C;
      const e = Math.min(x, y, N - 1 - x, N - 1 - y);
      const ang = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
      const rib = Math.abs(Math.cos(ang * 4));
      let v = 0.2 + rib * 0.4 + (rnd(x, y, s) - 0.5) * 0.2 + (d < 4 ? 0.2 : 0);
      if (e === 0) v = 0.05;
      else if (e === 1) v = 0.85;
      t.set(i, pick(P.cactus, v));
      t.height[i] = 0.6 + rib * 0.3 + (e === 1 ? 0.1 : 0);
      if (rib > 0.97 && d > 5 && d < 13 && rnd(x, y, s + 1) > 0.5) {
        t.set(i, hex(0xe8e4b0));
        t.height[i] = 1;
      }
      t.smooth[i] = 0.4;
      t.sss[i] = 0.3;
    });
    t.bump = 2;
  },
  cactus_bottom: (t) => {
    const s = t.seed;
    const p = pal(0x5d7a33, 0x6f8e3e, 0x83a24b, 0x98b65b, 0xadc86d);
    t.each((x, y, i) => {
      const dx = x + 0.5 - C, dy = y + 0.5 - C;
      const e = Math.min(x, y, N - 1 - x, N - 1 - y);
      const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.6 + Math.hypot(dx, dy) * 0.4;
      const ring = 0.5 + 0.5 * Math.cos(d * 1.9);
      let v = 0.35 + ring * 0.35 + (rnd(x, y, s) - 0.5) * 0.2;
      if (e === 0) v = 0.05;
      t.set(i, e === 0 ? pick(P.cactus, 0.1) : pick(p, v));
      t.height[i] = 0.7 + ring * 0.15;
      t.smooth[i] = 0.3;
      t.sss[i] = 0.3;
    });
    t.bump = 1.5;
  },
};

/** Pumpkin rind: vertical ribs with rounded shading. */
function pumpkinSide(t) {
  const s = seedFrom('pumpkin_side');
  t.each((x, y, i) => {
    const lx = (x + 3) & 7;
    const profile = Math.sin((lx + 0.5) / 8 * Math.PI);
    const v = 0.1 + profile * 0.7 + (fbm(x + 0.5, y + 0.5, 2, 2, s, 8) - 0.5) * 0.4 + (rnd(x, y, s + 1) - 0.5) * 0.12;
    t.set(i, pick(P.pumpkin, v - (y < 2 ? 0.15 : 0)));
    t.height[i] = 0.4 + profile * 0.55;
    t.smooth[i] = 0.45;
    t.sss[i] = 0.1;
  });
  t.bump = 2.4;
}

/** Crafting table side/front: table-top band over planks, with hanging tools. */
function craftingSide(t, front) {
  planksBase(t, P.oakPlanks, { seed: seedFrom('oak_planks') });
  t.each((x, y, i) => {
    if (y < 5) {
      t.set(i, pick(P.oakBark, 0.35 + rnd(x, y, t.seed) * 0.35 + (y === 0 ? 0.3 : 0) - (y === 4 ? 0.3 : 0)));
      t.height[i] = y === 4 ? 0.5 : 1;
    }
    if (x === 0 || x === N - 1) {
      t.set(i, pick(P.oakBark, 0.3 + rnd(x, y, t.seed + 1) * 0.3));
      t.height[i] = 1;
    }
  });
  const metal = hex(0x9ea3a8), metalDark = hex(0x62676c), handle = hex(0x5a3b1f), handleLit = hex(0x7a5530);
  const colors = { m: metal, d: metalDark, h: handle, l: handleLit };
  const heights = { m: 1, d: 0.95, h: 1, l: 1 };
  if (front) {
    stamp(t, 4, 9, [
      '.dmmmmmmmd.',
      'dm...l...md',
      'd....l....d',
      '.....lh....',
      '.....lh....',
      '.....lh....',
      '.....lh....',
      '.....lh....',
      '.....lh....',
    ], colors, heights);
    stamp(t, 19, 9, [
      '..dmm..',
      '.dmmmlh',
      'dmmmmlh',
      '.dmmmlh',
      '..dd.lh',
      '.....lh',
      '.....lh',
      '.....lh',
      '.....lh',
    ], colors, heights);
  } else {
    stamp(t, 3, 10, [
      'lhh...........',
      'lhhmmmmmmmmmmd',
      'lh.mmmmmmmmmmd',
      'lh.mmmmmmmmmd.',
      '...dmdmdmdmd..',
    ], colors, heights);
    stamp(t, 20, 16, [
      'dmmmmmd',
      'mmmmmmd',
      '..lh...',
      '..lh...',
      '..lh...',
      '..lh...',
      '..lh...',
    ], colors, heights);
  }
  for (let i = 0; i < PX; i++) if (t.height[i] === 1 && t.col[i * 3] > 0.55) { t.f0[i] = 0.95; t.smooth[i] = 0.6; }
}

// ------------------------------------------------------------------ public API

/** Magenta/black checker for a texture name without a generator. */
function missing(t) {
  t.each((x, y, i) => t.set(i, ((x >> 3) + (y >> 3)) & 1 ? hex(0xff00ff) : hex(0x000000)));
}

/**
 * Generate every texture in TEXTURE_NAMES.
 * @returns {{size:number, layers:number, albedo:Uint8Array, normal:Uint8Array, specular:Uint8Array}}
 */
export function generateTextures() {
  const layers = TEXTURE_NAMES.length;
  const out = {
    size: N,
    layers,
    albedo: new Uint8Array(layers * PX * 4),
    normal: new Uint8Array(layers * PX * 4),
    specular: new Uint8Array(layers * PX * 4),
  };
  TEXTURE_NAMES.forEach((name, layer) => {
    const t = new Tex(name);
    const gen = GEN[name];
    if (gen) gen(t);
    else {
      console.warn(`textures: no generator for "${name}"`);
      missing(t);
    }
    t.finish(out, layer);
  });
  return out;
}

// ------------------------------------------------------------------ inventory icons
const iconCache = new WeakMap();

/** Face shading of the isometric icon: top, left (+Z south), right (+X east). */
const ICON_SHADE = [1.0, 0.78, 0.6];
const ICON_SS = 3; // supersamples per axis

/**
 * Inventory icon for a block (cached per texture set, block and size).
 * Cube blocks render as a crisp isometric cube, plants/torches/flat blocks as
 * a sprite of their texture, liquids as a slightly lowered cube.
 * @returns {HTMLCanvasElement}
 */
export function makeBlockIcon(tex, blockId, sizePx = 48) {
  let perTex = iconCache.get(tex);
  if (!perTex) iconCache.set(tex, (perTex = new Map()));
  const key = blockId + ':' + sizePx;
  const cached = perTex.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const block = BLOCKS[blockId];
  if (block && block.model !== MODEL.NONE) {
    const img = ctx.createImageData(sizePx, sizePx);
    if (block.model === MODEL.CUBE || block.model === MODEL.LIQUID) drawIsoCube(img.data, sizePx, tex, block);
    else drawSprite(img.data, sizePx, tex, block);
    ctx.putImageData(img, 0, 0);
  }
  perTex.set(key, canvas);
  return canvas;
}

function sampleLayer(tex, layer, u, v) {
  const s = tex.size;
  const x = clamp(Math.floor(u * s), 0, s - 1), y = clamp(Math.floor(v * s), 0, s - 1);
  return (layer * s * s + y * s + x) * 4;
}

/** Flat sprite icon, zoomed to the opaque bounding box of the texture (torches, flowers...). */
function drawSprite(data, size, tex, block) {
  const layer = block.faces[0];
  const A = tex.albedo, s = tex.size, base = layer * s * s * 4;
  let x0 = s, y0 = s, x1 = -1, y1 = -1;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (A[base + (y * s + x) * 4 + 3] < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return;
  // Square window around the sprite with a one-texel margin, never smaller than half the tile.
  const side = Math.max(s / 2, x1 - x0 + 3, y1 - y0 + 3);
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const u0 = (cx - side / 2) / s, v0 = (cy - side / 2) / s, span = side / s;
  const ss = ICON_SS;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = u0 + ((px + (sx + 0.5) / ss) / size) * span, v = v0 + ((py + (sy + 0.5) / ss) / size) * span;
          if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
          const o = sampleLayer(tex, layer, u, v);
          if (A[o + 3] < 128) continue;
          r += A[o]; g += A[o + 1]; b += A[o + 2]; a++;
        }
      }
      if (!a) continue;
      const p = (py * size + px) * 4;
      data[p] = r / a; data[p + 1] = g / a; data[p + 2] = b / a;
      data[p + 3] = (a / (ss * ss)) * 255;
    }
  }
}

function drawIsoCube(data, size, tex, block) {
  const liquid = block.model === MODEL.LIQUID;
  const translucent = block.layer === LAYER.TRANSLUCENT;
  const top = liquid ? 0.875 : 1; // liquid surface sits a little lower
  const A = tex.albedo;
  // Projection: yaw 45°, pitch 30°. Screen images of the unit cube axes
  // x → (ax, ay), z → (-ax, ay), y → (0, -hy).
  const k = size / 1.68;
  const ax = 0.7071 * k, ay = 0.3536 * k, hy = 0.866 * k;
  // Centre the silhouette between the top-back and bottom-front corners.
  const ox = size / 2, oy = size / 2 - (2 * ay - hy * top) / 2;
  const tl = block.faces[2], sl = block.faces[4], el = block.faces[0];
  const ss = ICON_SS;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const X = px + (sx + 0.5) / ss - ox, Y = py + (sy + 0.5) / ss - oy;
          let layer, u, v, shade;
          // Top face (y = top): X = (x - z)·ax, Y = (x + z)·ay − top·hy.
          const tx = X / ax, ty = (Y + top * hy) / ay;
          const fx = (tx + ty) / 2, fz = (ty - tx) / 2;
          if (fx >= 0 && fx < 1 && fz >= 0 && fz < 1) {
            layer = tl; u = fx; v = fz; shade = ICON_SHADE[0];
          } else {
            // South face (z = 1): X = (x − 1)·ax, Y = (x + 1)·ay − y·hy.
            const sxv = X / ax + 1, syv = ((sxv + 1) * ay - Y) / hy;
            if (sxv >= 0 && sxv < 1 && syv >= 0 && syv < top) {
              layer = sl; u = sxv; v = 1 - syv; shade = ICON_SHADE[1];
            } else {
              // East face (x = 1): X = (1 − z)·ax, Y = (1 + z)·ay − y·hy.
              const ez = 1 - X / ax, eyv = ((1 + ez) * ay - Y) / hy;
              if (ez < 0 || ez >= 1 || eyv < 0 || eyv >= top) continue;
              layer = el; u = 1 - ez; v = 1 - eyv; shade = ICON_SHADE[2];
            }
          }
          const o = sampleLayer(tex, layer, u, v);
          let al = A[o + 3] / 255;
          if (block.leaves && al < 0.5) {
            al = 1; // leaf holes read as deeper foliage, like a filled canopy
            shade *= 0.55;
          } else if (liquid) al = Math.max(al, 0.88);
          else if (translucent) al = 0.3 + al * 0.7;
          else if (al < 0.5) continue;
          else al = 1;
          r += A[o] * shade * al; g += A[o + 1] * shade * al; b += A[o + 2] * shade * al; a += al;
        }
      }
      if (a <= 0) continue;
      const p = (py * size + px) * 4;
      data[p] = Math.min(255, r / a); data[p + 1] = Math.min(255, g / a); data[p + 2] = Math.min(255, b / a);
      data[p + 3] = (a / (ss * ss)) * 255;
    }
  }
}
