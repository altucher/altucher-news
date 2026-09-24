// Procedural WebAudio sound: block/material effects, UI blips and ambience.
//
// Everything is synthesized from noise buffers, filters, oscillators and
// envelopes — no audio files. The AudioContext is created by resume() on the
// first user gesture; until then (or if WebAudio is unavailable) every call is
// a silent no-op. Public methods never throw.
//
// Graph: voices → sfx bus ─┐
//        ambience beds ────┼→ world filter (underwater low-pass) → master → compressor → out
//        UI blips ─────────┘ (UI bypasses the world filter)

import { BLOCK, IS_LEAVES } from './blocks.js';
import { clamp, smoothstep } from './math.js';

const MAX_VOICES = 24;
const SCAN_INTERVAL = 0.35; // seconds between environment scans
const KIND_GAIN = { step: 0.3, land: 0.85, place: 0.75, break: 1 };

const rand = (a, b) => a + Math.random() * (b - a);

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.voices = 0;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.env = { water: 0, leaves: 0, grass: 0, underground: 0, scanAt: 0 };
    this.nextBird = 0;
    this.nextCricket = 0;
    this.nextGust = 0;
    this.gust = 1;
  }

  // ------------------------------------------------------------------ public API

  /** Create or resume the AudioContext. Call from a user gesture. */
  resume() {
    try {
      if (!this.ctx) this._init();
      if (this.ctx && this.ctx.state === 'suspended') {
        const p = this.ctx.resume(); // older Safari returns undefined
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {
      this.ctx = null;
    }
  }

  setVolume(v) {
    this.volume = clamp(Number(v) || 0, 0, 1);
    if (!this.ctx) return;
    try {
      // Perceptual (squared) curve so the slider feels linear.
      this.master.gain.setTargetAtTime(this.volume * this.volume, this.ctx.currentTime, 0.05);
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * One-shot effect: 'click' | 'pop' | 'splash' | 'levelup'.
   * opts.pos = [x,y,z] for spatialized sounds, opts.gain to scale.
   */
  play(name, opts = {}) {
    if (!this._ready()) return;
    try {
      const t = this.ctx.currentTime + 0.005;
      const g = opts.gain ?? 1;
      switch (name) {
        case 'click': {
          const out = this._voice(0.12, 0.05, 0, this.ui);
          if (!out) return;
          this._tone(out, t, { freq: 1500, freqEnd: 900, decay: 0.018, gain: 0.6 * g });
          this._grain(out, t, { type: 'white', filter: 'highpass', freq: 4000, decay: 0.006, gain: 0.25 * g });
          break;
        }
        case 'pop': {
          const out = this._voice(0.2, 0.12, 0, this.ui);
          if (!out) return;
          this._tone(out, t, { freq: 320, freqEnd: 980, sweep: 0.06, decay: 0.035, gain: 0.7 * g });
          break;
        }
        case 'splash':
          this._liquid(this._spatial(opts.pos, 0.55 * g, 1), t, 1.3);
          break;
        case 'levelup': {
          const out = this._voice(0.9, 0.15, 0, this.ui);
          if (!out) return;
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
            this._tone(out, t + i * 0.09, { type: 'triangle', freq: f, attack: 0.01, decay: 0.22, gain: 0.5 * g });
          });
          break;
        }
        default:
          break;
      }
    } catch (e) {
      /* never throw from audio */
    }
  }

  /**
   * Material sound for a block interaction.
   * @param {'break'|'place'|'step'|'land'} kind
   * @param {string} group SOUND value from blocks.js (stone, grass, wood, ...)
   * @param {number[]|{x:number,y:number,z:number}} [pos] world position (block centre or feet)
   */
  playBlock(kind, group, pos) {
    if (!this._ready()) return;
    try {
      const k = KIND_GAIN[kind] ?? 0.8;
      const out = this._spatial(pos, k, 1.2); // long enough for metal rings and shatters
      if (!out) return;
      const t = this.ctx.currentTime + 0.005;
      const recipe = MATERIALS[group] || MATERIALS.stone;
      recipe(this, out, t, kind, rand(0.92, 1.08));
    } catch (e) {
      /* never throw from audio */
    }
  }

  /** Called every frame: follows the listener and steers the ambience beds. */
  updateAmbient({ player, world, dayFraction, playing }) {
    if (!this.ctx || this.ctx.state !== 'running' || !player) return;
    try {
      const p = player.position;
      const L = this.listener;
      L.x = p[0]; L.y = p[1] + 1.6; L.z = p[2]; L.yaw = player.yaw || 0;
      const now = this.ctx.currentTime;
      const env = this.env;
      if (world && now - env.scanAt > SCAN_INTERVAL) {
        env.scanAt = now;
        this._scan(world);
      }
      const wet = !!player.eyeInWater, lava = !!player.eyeInLava;
      // Muffle the whole world under water (and in lava).
      const cutoff = lava ? 380 : wet ? 650 : this.openCutoff;
      this.worldFilter.frequency.setTargetAtTime(cutoff, now, wet || lava ? 0.05 : 0.15);
      this.ambBus.gain.setTargetAtTime(playing ? 1 : 0.35, now, 0.3);

      // Wind: stronger with altitude, gusting, mostly blocked underground.
      if (now > this.nextGust) {
        this.nextGust = now + rand(2.5, 7);
        this.gust = rand(0.55, 1.45);
        this.windFilter.frequency.setTargetAtTime(rand(260, 820), now, 1.4);
      }
      const altitude = smoothstep(62, 150, L.y);
      const wind = (0.012 + altitude * 0.085) * this.gust * (1 - env.underground * 0.85) * (wet ? 0 : 1);
      this.windGain.gain.setTargetAtTime(wind, now, 1.2);

      // Water: lapping near water, a deep rumble when submerged.
      const water = wet ? 0.11 : 0.07 * env.water;
      this.waterGain.gain.setTargetAtTime(water, now, 0.4);
      this.waterFilter.frequency.setTargetAtTime(wet ? 320 : 950, now, 0.3);

      // Birds by day near trees, crickets at night near grass (not underground or submerged).
      const day = dayFraction > 0.02 && dayFraction < 0.46;
      const night = dayFraction > 0.54 && dayFraction < 0.96;
      const outdoors = !wet && env.underground < 0.5 && playing;
      if (outdoors && day && env.leaves > 0.05 && now > this.nextBird) {
        this.nextBird = now + rand(2, 7) / (0.4 + env.leaves);
        this._bird(now + 0.02, 0.35 + env.leaves * 0.65);
      }
      if (outdoors && night && env.grass > 0.05 && now > this.nextCricket) {
        this.nextCricket = now + rand(0.5, 1.4);
        this._cricket(now + 0.02, 0.4 + env.grass * 0.6);
      }
    } catch (e) {
      /* never throw from audio */
    }
  }

  // ------------------------------------------------------------------ graph

  _init() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * this.volume;
    this.master.connect(this.compressor);
    this.worldFilter = ctx.createBiquadFilter();
    this.worldFilter.type = 'lowpass';
    this.openCutoff = Math.min(20000, ctx.sampleRate * 0.45);
    this.worldFilter.frequency.value = this.openCutoff;
    this.worldFilter.Q.value = 0.7;
    this.worldFilter.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.worldFilter);
    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.worldFilter);
    this.ui = ctx.createGain();
    this.ui.connect(this.master);

    this.noise = {
      white: this._noiseBuffer('white'),
      pink: this._noiseBuffer('pink'),
      brown: this._noiseBuffer('brown'),
    };
    // Looping ambience beds (silent until updateAmbient raises them).
    [this.windFilter, this.windGain] = this._bed('brown', 'bandpass', 450, 0.6);
    [this.waterFilter, this.waterGain] = this._bed('pink', 'lowpass', 950, 0.5);
  }

  _ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  _noiseBuffer(kind) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        // Paul Kellet's economy pink filter.
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  _bed(noise, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise[noise];
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.ambBus);
    src.start(0, Math.random() * 2);
    return [f, g];
  }

  /**
   * Allocate a voice: a gain (and stereo pan) node that disconnects itself when done.
   * Returns null when the voice budget is exhausted.
   */
  _voice(duration, gain, pan = 0, bus = this.sfx) {
    if (this.voices >= MAX_VOICES) return null;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    let head = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      head = p;
    }
    head.connect(bus);
    this.voices++;
    setTimeout(() => {
      this.voices--;
      head.disconnect();
    }, (duration + 0.3) * 1000);
    return g;
  }

  /** Voice positioned relative to the listener (distance attenuation + pan). */
  _spatial(pos, gain, duration) {
    let pan = 0, att = 1;
    if (pos) {
      const L = this.listener;
      const x = Array.isArray(pos) ? pos[0] : pos.x, y = Array.isArray(pos) ? pos[1] : pos.y, z = Array.isArray(pos) ? pos[2] : pos.z;
      const dx = x - L.x, dy = y - L.y, dz = z - L.z;
      const d = Math.hypot(dx, dy, dz);
      att = 1 / (1 + Math.max(0, d - 1.5) * 0.18);
      if (d > 0.5) pan = ((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d) * 0.8; // right = (cos yaw, 0, −sin yaw)
    }
    return this._voice(duration, gain * att, pan);
  }

  // ------------------------------------------------------------------ building blocks

  /** Filtered noise burst. */
  _grain(out, t, { type = 'white', filter = 'bandpass', freq = 2000, q = 1, attack = 0.002, decay = 0.05, gain = 0.5, rate = 1 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise[type];
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 3);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5, attack + decay * 2.5 + 0.02);
    return f;
  }

  /** Enveloped oscillator with an optional pitch sweep. */
  _tone(out, t, { type = 'sine', freq = 440, freqEnd, sweep, attack = 0.002, decay = 0.1, gain = 0.3 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + (sweep ?? attack + decay));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + decay * 2.5 + 0.02);
  }

  /** Scatter `n` short grains over `spread` seconds (rustles and crunches). */
  _scatter(out, t, n, spread, grain) {
    for (let i = 0; i < n; i++) {
      this._grain(out, t + Math.random() * spread, {
        ...grain,
        freq: grain.freq * rand(0.75, 1.3),
        gain: grain.gain * rand(0.5, 1),
      });
    }
  }

  _liquid(out, t, size) {
    if (!out) return;
    const f = this._grain(out, t, { type: 'white', filter: 'bandpass', freq: 1600, q: 0.9, attack: 0.01, decay: 0.28 * size, gain: 0.6 });
    f.frequency.exponentialRampToValueAtTime(380, t + 0.3 * size);
    for (let i = 0; i < 4; i++) {
      const s = t + rand(0.03, 0.28) * size;
      this._tone(out, s, { freq: rand(420, 700), freqEnd: rand(1100, 1700), sweep: 0.04, decay: 0.03, gain: 0.12 });
    }
  }

  // ------------------------------------------------------------------ ambience

  /** Sample blocks around the listener: water/leaves/grass density and cover overhead. */
  _scan(world) {
    const L = this.listener, env = this.env;
    const bx = Math.floor(L.x), by = Math.floor(L.y), bz = Math.floor(L.z);
    let water = 0, leaves = 0, grass = 0, n = 0;
    for (let dx = -8; dx <= 8; dx += 2) {
      for (let dz = -8; dz <= 8; dz += 2) {
        for (let dy = -5; dy <= 7; dy += 2) {
          const id = world.getBlock(bx + dx, by + dy, bz + dz);
          n++;
          if (id === BLOCK.water) water++;
          else if (IS_LEAVES[id]) leaves++;
          else if (id === BLOCK.grass_block || id === BLOCK.short_grass || id === BLOCK.tall_grass || id === BLOCK.fern) grass++;
        }
      }
    }
    env.water = clamp((water / n) * 6, 0, 1);
    env.leaves = clamp((leaves / n) * 10, 0, 1);
    env.grass = clamp((grass / n) * 8, 0, 1);
    // Underground when solid terrain is well above the head.
    const surface = typeof world.surfaceHeight === 'function' ? world.surfaceHeight(bx, bz) : 0;
    env.underground = clamp((surface - L.y - 2) / 6, 0, 1);
  }

  _bird(t, level) {
    const pan = rand(-0.8, 0.8);
    const notes = 2 + Math.floor(Math.random() * 5);
    const base = rand(2300, 3900);
    const out = this._voice(notes * 0.16 + 0.3, 0.05 * level, pan, this.ambBus);
    if (!out) return;
    let s = t;
    for (let i = 0; i < notes; i++) {
      const f = base * rand(0.85, 1.3);
      this._tone(out, s, { freq: f, freqEnd: f * rand(0.7, 1.45), sweep: rand(0.04, 0.09), attack: 0.006, decay: rand(0.04, 0.08), gain: rand(0.5, 1) });
      s += rand(0.08, 0.16);
    }
  }

  _cricket(t, level) {
    const pan = rand(-0.9, 0.9);
    const f = rand(4200, 4900);
    const out = this._voice(0.4, 0.022 * level, pan, this.ambBus);
    if (!out) return;
    const pulses = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < pulses; i++) this._tone(out, t + i * 0.034, { freq: f, attack: 0.003, decay: 0.014, gain: 1 });
  }
}

// ------------------------------------------------------------------ material recipes
// (engine, out, t, kind, pitch) → schedules the sound on `out`.
const MATERIALS = {
  stone(s, out, t, kind, p) {
    if (kind === 'step') {
      s._grain(out, t, { freq: 2300 * p, q: 1.1, decay: 0.03, gain: 0.5 });
      return;
    }
    s._tone(out, t, { freq: 150 * p, freqEnd: 80, decay: 0.06, gain: kind === 'land' ? 0.7 : 0.45 });
    s._grain(out, t, { freq: 1800 * p, q: 1.3, decay: 0.05, gain: 0.7 });
    if (kind === 'break') {
      s._grain(out, t + 0.03, { freq: 1200 * p, q: 1.5, decay: 0.07, gain: 0.5 });
      s._scatter(out, t + 0.04, 4, 0.12, { freq: 2600 * p, q: 2, decay: 0.02, gain: 0.3 });
    }
  },
  dirt(s, out, t, kind, p) {
    s._grain(out, t, { type: 'pink', filter: 'lowpass', freq: 900 * p, q: 0.8, decay: kind === 'step' ? 0.05 : 0.08, gain: 0.9 });
    if (kind !== 'step') s._tone(out, t, { freq: 95 * p, freqEnd: 60, decay: 0.07, gain: 0.35 });
    if (kind === 'break') s._scatter(out, t + 0.03, 4, 0.12, { type: 'pink', freq: 800 * p, q: 1.2, decay: 0.03, gain: 0.4 });
  },
  grass(s, out, t, kind, p) {
    const n = kind === 'step' ? 4 : kind === 'break' ? 9 : 6;
    s._scatter(out, t, n, kind === 'step' ? 0.06 : 0.13, { filter: 'bandpass', freq: 4200 * p, q: 0.8, decay: 0.03, gain: 0.45 });
    s._grain(out, t, { type: 'pink', filter: 'lowpass', freq: 700, decay: 0.05, gain: kind === 'step' ? 0.3 : 0.5 });
  },
  wood(s, out, t, kind, p) {
    const knock = (at, f, g) => {
      s._grain(out, at, { freq: f, q: 9, decay: 0.05, gain: g * 2.2 });
      s._tone(out, at, { type: 'triangle', freq: f * 0.48, decay: 0.06, gain: g * 0.35 });
    };
    knock(t, 520 * p, kind === 'step' ? 0.55 : 0.8);
    if (kind === 'break') {
      knock(t + 0.07, 430 * p, 0.6);
      s._grain(out, t + 0.02, { filter: 'highpass', freq: 2200, decay: 0.04, gain: 0.35 });
    }
  },
  sand(s, out, t, kind, p) {
    const n = kind === 'step' ? 6 : 12;
    s._scatter(out, t, n, kind === 'step' ? 0.08 : 0.15, { filter: 'highpass', freq: 3200 * p, q: 0.7, decay: 0.016, gain: 0.32 });
    s._grain(out, t, { type: 'pink', filter: 'lowpass', freq: 1200, decay: 0.05, gain: 0.25 });
  },
  gravel(s, out, t, kind, p) {
    const n = kind === 'step' ? 6 : 11;
    s._scatter(out, t, n, kind === 'step' ? 0.09 : 0.17, { filter: 'bandpass', freq: 1500 * p, q: 2.2, decay: 0.028, gain: 0.85 });
    if (kind !== 'step') s._tone(out, t, { freq: 120 * p, freqEnd: 70, decay: 0.05, gain: 0.25 });
  },
  glass(s, out, t, kind, p) {
    if (kind === 'break') {
      s._grain(out, t, { filter: 'highpass', freq: 2800, decay: 0.14, gain: 0.5 });
      for (let i = 0; i < 10; i++) {
        s._tone(out, t + rand(0, 0.16), { freq: rand(1900, 6400), decay: rand(0.05, 0.2), gain: rand(0.05, 0.12) });
      }
      return;
    }
    const g = kind === 'step' ? 0.5 : 1;
    s._grain(out, t, { filter: 'highpass', freq: 5000, decay: 0.008, gain: 0.3 * g });
    s._tone(out, t, { freq: 2650 * p, decay: 0.13, gain: 0.13 * g });
    s._tone(out, t, { freq: 4150 * p, decay: 0.08, gain: 0.08 * g });
  },
  snow(s, out, t, kind, p) {
    const n = kind === 'step' ? 4 : 7;
    s._scatter(out, t, n, kind === 'step' ? 0.07 : 0.12, { type: 'pink', filter: 'lowpass', freq: 1700 * p, q: 0.8, decay: 0.04, gain: 0.5 });
  },
  cloth(s, out, t, kind, p) {
    s._grain(out, t, { type: 'pink', filter: 'lowpass', freq: 520 * p, q: 0.7, decay: 0.06, gain: 0.8 });
    if (kind !== 'step') s._grain(out, t + 0.04, { type: 'pink', filter: 'lowpass', freq: 420 * p, q: 0.7, decay: 0.05, gain: 0.5 });
  },
  metal(s, out, t, kind, p) {
    const len = kind === 'step' ? 0.35 : 1;
    s._grain(out, t, { freq: 3200, q: 1.5, decay: 0.012, gain: 0.45 });
    [[1, 0.45, 0.14], [2.63, 0.3, 0.08], [4.3, 0.18, 0.05]].forEach(([m, d, g]) => {
      s._tone(out, t, { freq: 510 * p * m, decay: d * len, gain: g * (kind === 'step' ? 0.6 : 1) });
    });
  },
  liquid(s, out, t, kind) {
    s._liquid(out, t, kind === 'step' ? 0.5 : 1);
  },
};
