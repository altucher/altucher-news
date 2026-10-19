// Game: owns every subsystem and runs the main loop.
//
// States: 'title' → 'loading' → 'playing' ⇄ 'paused' | 'inventory' | 'settings'

import { DEFAULT_SETTINGS, QUALITY_PRESETS, DAY_LENGTH_SECONDS } from './config.js';
import { DEG, seedFrom, clamp } from './math.js';
import { BLOCKS, DEFAULT_HOTBAR } from './blocks.js';
import { Renderer } from './render/renderer.js';
import { generateTextures } from './textures.js';
import { World } from './world/world.js';
import { WorkerPool } from './world/workerpool.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { UI } from './ui/ui.js';
import { SoundEngine } from './audio.js';
import { SaveStore } from './save.js';

const SETTINGS_KEY = 'blockcraft.settings.v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    /* ignore */
  }
}

function parseParams() {
  const p = new URLSearchParams(location.search);
  const num = (k) => (p.has(k) && p.get(k) !== '' && Number.isFinite(+p.get(k)) ? +p.get(k) : undefined);
  const list = (k) => (p.has(k) ? p.get(k).split(',').map(Number) : undefined);
  return {
    autostart: p.get('autostart') === '1',
    seed: p.get('seed') ?? undefined,
    preset: p.get('preset') ?? undefined,
    time: num('time'),
    pos: list('pos'),
    rot: list('rot'),
    rd: num('rd'),
    nosave: p.get('nosave') === '1',
    freeze: p.get('freeze') === '1',
    scale: num('scale'),
  };
}

export class Game {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.params = parseParams();
    this.settings = loadSettings();
    if (this.params.preset && QUALITY_PRESETS[this.params.preset]) {
      this.settings = { ...this.settings, preset: this.params.preset, ...QUALITY_PRESETS[this.params.preset] };
    }
    if (this.params.rd) this.settings.renderDistance = clamp(this.params.rd | 0, 2, 32);
    if (this.params.scale) this.settings.renderScale = clamp(this.params.scale, 0.25, 2);
    if (this.params.freeze) this.settings.dayCycle = false;

    this.state = 'boot';
    this.dayFraction = this.params.time ?? 0.08;
    this.timeSeconds = 0;
    this.lastTime = 0;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.hudVisible = true;
    this.debugVisible = false;
    this.world = null;
    this.player = null;
    this.saveTimer = 0;
    this._frameDrawn = false;
    let resolveReady;
    this.ready = new Promise((r) => (resolveReady = r));
    this._resolveReady = resolveReady;

    this.renderer = new Renderer(canvas, this.settings);
    this.textures = generateTextures();
    this.renderer.setTextures(this.textures);
    this.pool = new WorkerPool();
    this.input = new Input(canvas);
    this.audio = new SoundEngine();
    this.audio.setVolume(this.settings.volume);
    this.store = new SaveStore();
    this.ui = new UI(this);

    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.input.dragLookMode) this.pause();
    };
    this.input.onFirstGesture = () => this.audio.resume();

    window.blockcraft = this;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  async start() {
    await this.store.open().catch(() => {});
    const meta = this.params.nosave ? null : await this.store.loadMeta().catch(() => null);
    this.hasSave = !!meta;
    if (this.params.autostart) {
      const seed = this.params.seed ?? (meta ? undefined : 'blockcraft');
      if (seed === undefined && meta) await this.continueWorld();
      else await this.startNewWorld(seed);
    } else {
      this.setState('title');
    }
  }

  setState(state) {
    this.state = state;
    this.ui.setState(state);
    this.input.enabled = state === 'playing';
  }

  // ------------------------------------------------------------------ worlds
  async startNewWorld(seedInput) {
    const seedStr = seedInput === undefined || seedInput === '' ? String(Math.floor(Math.random() * 1e9)) : String(seedInput);
    const seed = seedFrom(/^-?\d+$/.test(seedStr) ? Number(seedStr) : seedStr);
    if (!this.params.nosave) await this.store.clear().catch(() => {});
    await this._loadWorld({ seed, seedLabel: seedStr, mods: new Map(), meta: null });
  }

  async continueWorld() {
    const meta = await this.store.loadMeta().catch(() => null);
    if (!meta) return this.startNewWorld();
    const mods = await this.store.loadMods().catch(() => new Map());
    await this._loadWorld({ seed: meta.seed, seedLabel: meta.seedLabel ?? String(meta.seed), mods, meta });
  }

  async _loadWorld({ seed, seedLabel, mods, meta }) {
    this.setState('loading');
    this.ui.setLoading(0, 'Generating terrain…');
    if (this.world) this.world.dispose();
    this.renderer.clearChunks();
    this.seed = seed;
    this.seedLabel = seedLabel;
    this.world = new World({ seed, renderer: this.renderer, pool: this.pool, mods, renderDistance: this.settings.renderDistance });
    this.player = new Player(this.world, this.input, this.audio);
    this.player.hotbar = meta?.hotbar?.length === 9 ? meta.hotbar.slice() : DEFAULT_HOTBAR.slice();
    if (meta?.dayFraction !== undefined && this.params.time === undefined) this.dayFraction = meta.dayFraction;

    let spawn;
    if (this.params.pos && this.params.pos.length === 3) spawn = this.params.pos;
    else if (meta?.player) spawn = meta.player.position;
    else spawn = await this.world.findSpawn();
    this.player.teleport(spawn[0], spawn[1], spawn[2]);
    if (meta?.player) {
      this.player.yaw = meta.player.yaw;
      this.player.pitch = meta.player.pitch;
      this.player.flying = !!meta.player.flying;
    }
    if (this.params.rot && this.params.rot.length >= 2) {
      this.player.yaw = this.params.rot[0] * DEG;
      this.player.pitch = this.params.rot[1] * DEG;
    }

    // Stream until the area around the player is meshed.
    const radius = Math.min(3, this.settings.renderDistance);
    await new Promise((resolve) => {
      const tick = () => {
        this.world.update(this.player.position, 0.016, true);
        const p = this.world.spawnProgress(this.player.position[0], this.player.position[2], radius);
        this.ui.setLoading(p, p < 0.5 ? 'Generating terrain…' : 'Building terrain meshes…');
        if (p >= 1) resolve();
        else setTimeout(tick, 16);
      };
      tick();
    });
    if (!meta?.player && !(this.params.pos && this.params.pos.length === 3)) {
      // Drop the player onto the surface now that the chunk exists.
      const top = this.world.surfaceHeight(Math.floor(spawn[0]), Math.floor(spawn[2]));
      this.player.teleport(spawn[0], top + 1.01, spawn[2]);
    }
    this.renderer.camera.resetHistory();
    this.setState('playing');
    this._frameDrawn = false;
    if (!this.input.touchMode) this.input.requestLock();
  }

  async saveNow() {
    if (!this.world || this.params.nosave) return;
    const meta = {
      seed: this.seed,
      seedLabel: this.seedLabel,
      dayFraction: this.dayFraction,
      hotbar: this.player.hotbar,
      player: this.player.serialize(),
      savedAt: Date.now(),
    };
    try {
      await this.store.saveMeta(meta);
      await this.store.saveMods(this.world.getModifications());
      this.hasSave = true;
    } catch (e) {
      console.warn('save failed', e);
    }
  }

  // ------------------------------------------------------------------ menus
  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.input.exitLock();
    this.saveNow();
  }

  resume() {
    if (!this.world) return;
    this.setState('playing');
    if (!this.input.touchMode) this.input.requestLock();
  }

  openInventory() {
    if (this.state !== 'playing') return;
    this.setState('inventory');
    this.input.exitLock();
  }

  async quitToTitle() {
    await this.saveNow();
    if (this.world) this.world.dispose();
    this.world = null;
    this.player = null;
    this.renderer.clearChunks();
    this.setState('title');
  }

  /** Merge settings, persist, and apply to subsystems. */
  updateSettings(partial) {
    const prevRd = this.settings.renderDistance;
    this.settings = { ...this.settings, ...partial };
    if (partial.preset && QUALITY_PRESETS[partial.preset] && Object.keys(partial).length === 1) {
      this.settings = { ...this.settings, ...QUALITY_PRESETS[partial.preset] };
    }
    saveSettings(this.settings);
    this.renderer.applySettings(this.settings);
    this.audio.setVolume(this.settings.volume);
    if (this.world && this.settings.renderDistance !== prevRd) this.world.setRenderDistance(this.settings.renderDistance);
    return this.settings;
  }

  screenshot() {
    // Render synchronously then read the canvas in the same task.
    this._renderFrame(0);
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `blockcraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    this.ui.toast('Screenshot saved');
  }

  // ------------------------------------------------------------------ loop
  _handleGlobalKeys() {
    const inp = this.input;
    if (inp.consumePressed('F1')) this.hudVisible = !this.hudVisible;
    if (inp.consumePressed('F2')) this.screenshot();
    if (inp.consumePressed('F3')) this.debugVisible = !this.debugVisible;
    if (this.state === 'playing') {
      if (inp.consumePressed('KeyE')) this.openInventory();
      if (inp.consumePressed('Escape')) this.pause();
      if (inp.consumePressed('KeyP')) this.updateSettings({ dayCycle: !this.settings.dayCycle });
    }
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const t = now / 1000;
    let dt = this.lastTime ? t - this.lastTime : 1 / 60;
    this.lastTime = t;
    dt = Math.min(dt, 0.1);
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    try {
      this._tick(dt);
    } catch (e) {
      console.error(e);
      if (!this._reportedError) {
        this._reportedError = true;
        this.ui.toast('Error: ' + (e && e.message ? e.message : e));
      }
    }
  }

  _tick(dt) {
    this._handleGlobalKeys();
    if (!this.world || !this.player || this.state === 'loading' || this.state === 'title' || this.state === 'boot') {
      this.input.endFrame();
      return;
    }
    const playing = this.state === 'playing';
    this.timeSeconds += dt;
    if (playing) {
      if (this.settings.dayCycle) this.dayFraction = (this.dayFraction + dt / DAY_LENGTH_SECONDS) % 1;
      // Hold [ or ] to scrub time of day.
      const scrub = (this.input.isDown('BracketRight') ? 1 : 0) - (this.input.isDown('BracketLeft') ? 1 : 0);
      if (scrub) this.dayFraction = (((this.dayFraction + scrub * dt * 0.08) % 1) + 1) % 1;
      this.player.update(dt, this.settings);
    }
    this.world.update(this.player.position, dt, false);
    this.saveTimer += dt;
    if (this.saveTimer > 30) {
      this.saveTimer = 0;
      this.saveNow();
    }
    this._renderFrame(dt);
    this.audio.updateAmbient({
      player: this.player,
      world: this.world,
      dayFraction: this.dayFraction,
      playing,
    });
    this.ui.update({
      fps: this.fps,
      player: this.player,
      world: this.world,
      renderer: this.renderer,
      dayFraction: this.dayFraction,
      hudVisible: this.hudVisible,
      debugVisible: this.debugVisible,
      seed: this.seedLabel,
    });
    this.input.endFrame();
    if (!this._frameDrawn) {
      this._frameDrawn = true;
      this._resolveReady(this);
    }
  }

  _renderFrame(dt) {
    const p = this.player;
    const eye = p.eyePosition();
    const target = p.target;
    let selection = null;
    if (target && this.state === 'playing' && this.hudVisible) {
      const hb = BLOCKS[target.id]?.hitbox || [0, 0, 0, 1, 1, 1];
      selection = {
        x: target.x, y: target.y, z: target.z,
        min: [target.x + hb[0], target.y + hb[1], target.z + hb[2]],
        max: [target.x + hb[3], target.y + hb[4], target.z + hb[5]],
      };
    }
    const fovBoost = p.sprinting && !p.sneaking ? 1.1 : 1.0;
    this._fovCur = this._fovCur ?? this.settings.fov;
    this._fovCur += (this.settings.fov * fovBoost - this._fovCur) * Math.min(1, dt * 10);
    this.renderer.render({
      camPos: eye,
      yaw: p.yaw,
      pitch: p.pitch,
      fov: this._fovCur * DEG,
      dayFraction: this.dayFraction,
      timeSeconds: this.timeSeconds,
      dt,
      underwater: p.eyeInWater,
      inLava: p.eyeInLava,
      selection,
      breakProgress: p.breakProgress || 0,
      rain: 0,
    });
  }
}

