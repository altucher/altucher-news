// STUB — flat-colour textures (real procedural generator replaces this).
import { TEXTURE_NAMES, BLOCKS } from './blocks.js';
import { TEX_SIZE } from './config.js';
import { hash32 } from './math.js';

export function generateTextures() {
  const size = TEX_SIZE, layers = TEXTURE_NAMES.length, px = size * size;
  const albedo = new Uint8Array(layers * px * 4);
  const normal = new Uint8Array(layers * px * 4);
  const specular = new Uint8Array(layers * px * 4);
  TEXTURE_NAMES.forEach((name, L) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = hash32(h, name.charCodeAt(i));
    const r = 60 + (h & 127), g = 60 + ((h >> 8) & 127), b = 60 + ((h >> 16) & 127);
    for (let i = 0; i < px; i++) {
      const o = (L * px + i) * 4, n = (hash32(i, L) & 31) - 16;
      albedo[o] = r + n; albedo[o + 1] = g + n; albedo[o + 2] = b + n; albedo[o + 3] = 255;
      normal[o] = 128; normal[o + 1] = 128; normal[o + 2] = 255; normal[o + 3] = 255;
      specular[o] = 40; specular[o + 1] = 10; specular[o + 2] = 0; specular[o + 3] = 0;
    }
  });
  return { size, layers, albedo, normal, specular };
}

/** Block icon for UI (canvas). */
export function makeBlockIcon(tex, blockId, sizePx = 48) {
  const c = document.createElement('canvas');
  c.width = c.height = sizePx;
  const ctx = c.getContext('2d');
  const L = BLOCKS[blockId] ? BLOCKS[blockId].faces[2] : 0;
  const o = L * tex.size * tex.size * 4;
  ctx.fillStyle = `rgb(${tex.albedo[o]},${tex.albedo[o + 1]},${tex.albedo[o + 2]})`;
  ctx.fillRect(4, 4, sizePx - 8, sizePx - 8);
  return c;
}
