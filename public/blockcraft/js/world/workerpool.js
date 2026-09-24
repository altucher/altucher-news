// Pool of module workers running generate/mesh jobs, with a priority queue.
// When module workers are unavailable (old browser, blocked, file://), the
// same job code runs on the main thread in small time slices.

import { clamp } from '../math.js';

const PING_TIMEOUT_MS = 4000;
const SLICE_MS = 8; // main-thread fallback: work per setTimeout slice
// Jobs posted ahead to each worker. Results are only handled when the main
// thread is free (often once per frame), so a worker with a single job would
// idle most of the frame; a short pipeline keeps it busy while still letting
// urgent jobs overtake the rest of the queue.
const PIPELINE = 3;

function defaultThreads() {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  return clamp(hc - 1, 1, 4);
}

/** Resolve once the worker answers a ping; reject on load error or timeout. */
function ping(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker ping timed out')), PING_TIMEOUT_MS);
    worker.onmessage = (e) => {
      if (e.data && e.data.type === 'pong') {
        clearTimeout(timer);
        resolve();
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      e.preventDefault?.();
      reject(new Error(e.message || 'worker failed to load'));
    };
    worker.postMessage({ type: 'ping', id: 0 });
  });
}

export class WorkerPool {
  /** @param {number} [n] number of worker threads */
  constructor(n = defaultThreads()) {
    this.size = n;
    /** 'starting' | 'workers' | 'main' | 'disposed' */
    this.mode = 'starting';
    this._queue = []; // { msg, priority, seq, owner, resolve, reject }
    this._seq = 0;
    this._nextId = 1;
    this._slots = []; // { worker, jobs: in-flight FIFO }
    this._inflight = 0;
    this._handle = null; // handleMessage for main-thread execution
    this._sliceTimer = 0;
    this._runSlice = this._runSlice.bind(this);
    this.ready = this._start(n);
  }

  /** Jobs waiting for a thread. */
  get queued() {
    return this._queue.length;
  }

  /** Jobs currently executing. */
  get busy() {
    return this._inflight;
  }

  /**
   * Queue a job. Lower priority numbers run sooner (FIFO among equals).
   * Resolves with the worker's reply, or null if the job was cancelled.
   * @param {object} msg job message (an `id` is assigned)
   * @param {number} [priority]
   * @param {*} [owner] opaque tag used by cancel()
   * @returns {Promise<object|null>}
   */
  submit(msg, priority = 0, owner = null) {
    return new Promise((resolve, reject) => {
      if (this.mode === 'disposed') {
        resolve(null);
        return;
      }
      msg.id = this._nextId++;
      this._queue.push({ msg, priority, seq: this._seq++, owner, resolve, reject });
      this._pump();
    });
  }

  /**
   * Drop queued (not yet running) jobs matching predicate(msg, owner); their
   * promises resolve with null. Returns the number of cancelled jobs.
   */
  cancel(predicate) {
    let n = 0;
    const keep = [];
    for (const job of this._queue) {
      if (predicate(job.msg, job.owner)) {
        job.resolve(null);
        n++;
      } else {
        keep.push(job);
      }
    }
    this._queue = keep;
    return n;
  }

  dispose() {
    this.mode = 'disposed';
    for (const s of this._slots) {
      s.worker.terminate();
      for (const job of s.jobs) job.resolve(null);
    }
    this._slots = [];
    for (const job of this._queue) job.resolve(null);
    this._queue = [];
    clearTimeout(this._sliceTimer);
  }

  // ------------------------------------------------------------------ startup
  async _start(n) {
    const workers = [];
    try {
      if (typeof Worker === 'undefined') throw new Error('Web Workers are not supported');
      for (let i = 0; i < n; i++) {
        workers.push(new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'blockcraft-' + i }));
      }
      await Promise.all(workers.map(ping));
    } catch (e) {
      for (const w of workers) w.terminate();
      if (this.mode === 'disposed') return;
      console.warn('[WorkerPool] workers unavailable, running jobs on the main thread:', e.message);
      await this._useMainThread();
      return;
    }
    if (this.mode === 'disposed') {
      for (const w of workers) w.terminate();
      return;
    }
    this._slots = workers.map((worker) => {
      const slot = { worker, jobs: [] };
      worker.onmessage = (e) => this._onResult(slot, e.data);
      worker.onerror = (e) => this._onWorkerError(slot, e);
      return slot;
    });
    this.mode = 'workers';
    this._pump();
  }

  async _useMainThread() {
    const mod = await import('./worker.js');
    if (this.mode === 'disposed') return;
    this._handle = mod.handleMessage;
    this.mode = 'main';
    this._pump();
  }

  // ------------------------------------------------------------------ dispatch
  _takeBest() {
    const q = this._queue;
    if (q.length === 0) return null;
    let best = 0;
    for (let i = 1; i < q.length; i++) {
      const a = q[i], b = q[best];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    const job = q[best];
    q[best] = q[q.length - 1];
    q.pop();
    return job;
  }

  _pump() {
    if (this.mode === 'workers') {
      while (this._queue.length) {
        let slot = null;
        for (const s of this._slots) if (s.jobs.length < PIPELINE && (!slot || s.jobs.length < slot.jobs.length)) slot = s;
        if (!slot) break;
        const job = this._takeBest();
        slot.jobs.push(job);
        this._inflight++;
        slot.worker.postMessage(job.msg);
      }
    } else if (this.mode === 'main' && this._queue.length && !this._sliceTimer) {
      this._sliceTimer = setTimeout(this._runSlice, 0);
    }
  }

  _onResult(slot, data) {
    const job = slot.jobs.shift(); // a worker answers its jobs in order
    if (job) {
      this._inflight--;
      if (data && data.type === 'error') job.reject(new Error(data.message));
      else job.resolve(data);
    }
    this._pump();
  }

  /** A worker crashed outside a job's try/catch: fail its jobs and retire it. */
  _onWorkerError(slot, e) {
    e.preventDefault?.();
    console.error('[WorkerPool] worker error:', e.message);
    slot.worker.terminate();
    this._slots = this._slots.filter((s) => s !== slot);
    for (const job of slot.jobs) {
      this._inflight--;
      job.reject(new Error(e.message || 'worker crashed'));
    }
    slot.jobs = [];
    if (this._slots.length === 0 && this.mode === 'workers') this._useMainThread();
    else this._pump();
  }

  _runSlice() {
    this._sliceTimer = 0;
    if (this.mode !== 'main') return;
    const t0 = performance.now();
    while (this._queue.length && performance.now() - t0 < SLICE_MS) {
      const job = this._takeBest();
      this._inflight++;
      try {
        job.resolve(this._handle(job.msg).result);
      } catch (e) {
        job.reject(e);
      }
      this._inflight--;
    }
    this._pump();
  }
}
