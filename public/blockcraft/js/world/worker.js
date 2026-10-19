// Worker entry for chunk jobs (see "Mesh job contract" in ARCHITECTURE.md).
// handleMessage is also imported directly by WorkerPool's main-thread fallback,
// so this module only installs onmessage when it actually runs in a worker.

import { generateChunk } from './worldgen.js';
import { meshChunk } from './mesher.js';

/**
 * Run one job.
 * @param {{type:string, id:number}} msg
 * @returns {{result: object, transfer: ArrayBuffer[]}}
 */
export function handleMessage(msg) {
  switch (msg.type) {
    case 'ping':
      return { result: { type: 'pong', id: msg.id }, transfer: [] };
    case 'generate': {
      const { blocks, maxY } = generateChunk(msg.seed, msg.cx, msg.cz);
      return {
        result: { type: 'generated', id: msg.id, cx: msg.cx, cz: msg.cz, blocks, maxY },
        transfer: [blocks.buffer],
      };
    }
    case 'mesh': {
      const sections = meshChunk(msg.neighbors, msg.cx, msg.cz);
      const transfer = [];
      for (const s of sections) {
        if (s.opaque) transfer.push(s.opaque);
        if (s.cutout) transfer.push(s.cutout);
        if (s.translucent) transfer.push(s.translucent);
      }
      return { result: { type: 'meshed', id: msg.id, cx: msg.cx, cz: msg.cz, sections }, transfer };
    }
    default:
      throw new Error('unknown job type ' + msg.type);
  }
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    const msg = e.data;
    try {
      const { result, transfer } = handleMessage(msg);
      self.postMessage(result, transfer);
    } catch (err) {
      self.postMessage({ type: 'error', id: msg && msg.id, message: String((err && err.stack) || err) });
    }
  };
}
