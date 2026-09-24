// Chunk column: 16×256×16 block ids. Index: x | z << 4 | y << 8.

import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../config.js';

export class Chunk {
  /**
   * @param {number} cx
   * @param {number} cz
   * @param {Uint8Array} [blocks]
   */
  constructor(cx, cz, blocks) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = blocks || new Uint8Array(CHUNK_VOLUME);
    this.maxY = 0; // highest non-air y + 1 (upper bound for meshing/lighting)
    this.generated = !!blocks;
    this.meshed = false; // a mesh has been uploaded at least once
    this.dirty = false; // needs a remesh
    this.meshing = false; // a mesh job is in flight
    this.meshVersion = 0; // bumps on every edit; stale mesh results are dropped
    this.modified = null; // Map<index, id> of player edits (for saving)
    if (blocks) this.recomputeMaxY();
  }

  get(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.blocks[x | (z << 4) | (y << 8)];
  }

  set(x, y, z, id) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.blocks[x | (z << 4) | (y << 8)] = id;
    if (id !== 0 && y + 1 > this.maxY) this.maxY = y + 1;
  }

  recomputeMaxY() {
    const b = this.blocks;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const base = y << 8;
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        if (b[base + i] !== 0) {
          this.maxY = y + 1;
          return this.maxY;
        }
      }
    }
    this.maxY = 0;
    return 0;
  }
}
