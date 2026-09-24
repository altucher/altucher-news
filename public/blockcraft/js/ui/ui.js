// DOM user interface: title, loading, HUD (hotbar, crosshair, F3 debug),
// pause, settings, controls, inventory and toasts.
//
// game.js drives it through setState(state), setLoading(p, label), update(hud)
// (every frame — it only touches the DOM when something changed) and toast().
// The UI calls back into the game for everything that changes game state.

import { BLOCKS, INVENTORY_BLOCKS, TEXTURE_NAMES } from '../blocks.js';
import { GAME_NAME, SETTING_LABELS, QUALITY_PRESETS, CHUNK_SIZE } from '../config.js';
import { makeBlockIcon } from '../textures.js';

const PRESETS = ['low', 'medium', 'high', 'ultra'];
const GRAPHICS_KEYS = new Set(Object.keys(QUALITY_PRESETS.high)); // editing one makes the preset 'custom'
const GRAPHICS_TOGGLES = ['shadows', 'softShadows', 'ssao', 'volumetricLight', 'clouds', 'ssr', 'pom', 'taa', 'bloom', 'autoExposure'];
const SLIDERS = {
  renderDistance: { min: 2, max: 20, step: 1, fmt: (v) => `${v} chunks` },
  renderScale: { min: 0.5, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  fov: { min: 50, max: 110, step: 1, fmt: (v) => `${Math.round(v)}°` },
  mouseSensitivity: { min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
  volume: { min: 0, max: 1, step: 0.01, fmt: (v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Muted') },
};
const FEATURE_SHORT = {
  shadows: 'shadows', softShadows: 'pcss', ssao: 'ssao', volumetricLight: 'godrays', clouds: 'clouds',
  ssr: 'ssr', pom: 'pom', taa: 'taa', bloom: 'bloom', autoExposure: 'autoexp',
};
const CONTROLS = [
  ['Move', ['W', 'A', 'S', 'D']],
  ['Jump · double-tap to fly', ['Space']],
  ['Sneak · fly down', ['Shift']],
  ['Sprint', ['Ctrl']],
  ['Look around', ['Mouse']],
  ['Break block', ['Left click']],
  ['Place block', ['Right click']],
  ['Pick block', ['Middle click']],
  ['Select hotbar slot', ['1–9', 'Wheel']],
  ['Inventory', ['E']],
  ['Pause', ['Esc']],
  ['Hide HUD', ['F1']],
  ['Screenshot', ['F2']],
  ['Debug info', ['F3']],
  ['Time of day (hold)', ['[', ']']],
  ['Pause day cycle', ['P']],
];
const TIPS = [
  'Double-tap Space to start flying; hold Shift to descend.',
  'Press F3 for coordinates, biome, and renderer stats.',
  'Hold [ or ] to scrub the time of day and watch the light change.',
  'Glowstone, torches, lava and sea lanterns light up caves.',
  'Middle-click any block to put it in your hand.',
  'Water reflects the sky and refracts what lies beneath.',
  'Press E to pick any block for your hotbar.',
  'Lower the graphics preset in Settings if the frame rate drops.',
  'Press F2 to save a screenshot of your view.',
  'Your world is saved automatically while you play.',
  'Sunsets and sunrises bring god rays through the trees.',
  'Press P to freeze the day cycle at the perfect moment.',
];
const ICON_PX = 64;

// 5×7 capitals for the voxel logo.
const GLYPHS = {
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
};

/** Tiny DOM builder: el('div', {className, onclick, ...}, ...children). */
function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

const fmtCount = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const pad2 = (n) => String(n).padStart(2, '0');

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.state = null;
    this.panel = null; // 'settings' | 'controls' sub-panel over title/pause
    this.stateAt = 0;
    this.icons = new Map(); // block id → data URL
    this.hud = { key: '', visible: null, crosshair: null, ind: '', lockHint: null, touch: null, debugAt: 0, debugOn: null, lastSel: -1, lastId: 0 };
    this.hoverBlock = 0;
    this._tipTimer = 0;
    this._build();
    this.titleBg.classList.add('is-active'); // backdrop while the game boots (no black flash)
    window.addEventListener('keydown', (e) => this._onKey(e), true);
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this._drawLogo(), 150);
    });
  }

  // ------------------------------------------------------------------ public API
  setState(state) {
    const prev = this.state;
    this.state = state;
    this.stateAt = performance.now();
    this.root.dataset.state = state;
    if (state !== 'title' && state !== 'paused') this._closePanel(true);
    for (const [name, node] of Object.entries(this.screens)) node.classList.toggle('is-active', name === state);
    this.titleBg.classList.toggle('is-active', state === 'title' || state === 'loading');

    if (state === 'title') {
      this.continueBtn.hidden = !this.game.hasSave;
      this.newBtn.classList.toggle('btn-primary', !this.game.hasSave);
      this.quitBtn.disabled = false;
      this._drawLogo();
    }
    if (state === 'loading') this._startTips();
    else this._stopTips();
    if (state === 'paused') this._focus(this.resumeBtn);
    if (state === 'inventory') this._openInventory();
    if (state === 'playing' && prev === 'loading') this._prewarmIcons();
    const hud = this.hud;
    if (state === 'title' || state === 'loading') {
      // update() is not called outside a world, so hide in-world overlays here.
      hud.visible = hud.lockHint = false;
      this.hudEl.classList.add('is-hidden');
      this.lockHint.classList.remove('is-active');
    } else {
      hud.visible = null; // force a HUD refresh on the next update()
    }
  }

  setLoading(progress, label) {
    const p = Math.max(0, Math.min(1, progress || 0));
    this.loadBar.style.width = `${(p * 100).toFixed(1)}%`;
    this.loadPct.textContent = `${Math.round(p * 100)}%`;
    if (label && this.loadLabel.textContent !== label) this.loadLabel.textContent = label;
  }

  update(h) {
    const hud = this.hud;
    const playing = this.state === 'playing';
    const visible = h.hudVisible && (playing || this.state === 'paused');
    if (visible !== hud.visible) {
      hud.visible = visible;
      this.hudEl.classList.toggle('is-hidden', !visible);
    }
    const crosshair = visible && playing;
    if (crosshair !== hud.crosshair) {
      hud.crosshair = crosshair;
      this.crosshair.classList.toggle('is-hidden', !crosshair);
    }
    const input = this.game.input;
    const lockHint = playing && !document.pointerLockElement && !(input && (input.touchMode || input.dragLookMode));
    if (lockHint !== hud.lockHint) {
      hud.lockHint = lockHint;
      this.lockHint.classList.toggle('is-active', lockHint);
    }
    const touch = !!(input && input.touchMode);
    if (touch !== hud.touch) {
      hud.touch = touch;
      this.touchBar.hidden = !touch;
      this.root.classList.toggle('is-touch', touch); // hides keyboard-only hints
    }
    const p = h.player;
    if (!p) return;
    if (visible) {
      this._updateHotbar(p);
      const ind = (p.flying ? 'F' : '') + (this.game.settings.dayCycle ? '' : 'T') + (p.eyeInWater ? 'W' : '');
      if (ind !== hud.ind) {
        hud.ind = ind;
        this.indFly.hidden = !p.flying;
        this.indTime.hidden = this.game.settings.dayCycle;
        this.indWater.hidden = !p.eyeInWater;
      }
    }
    const debugOn = visible && h.debugVisible;
    if (debugOn !== hud.debugOn) {
      hud.debugOn = debugOn;
      this.debugEl.classList.toggle('is-hidden', !debugOn);
      hud.debugAt = 0;
    }
    const now = performance.now();
    if (debugOn && now - hud.debugAt > 100) {
      hud.debugAt = now;
      this._updateDebug(h);
    }
  }

  toast(msg) {
    const t = el('div', { className: 'toast', role: 'status' }, String(msg));
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, 2600);
  }

  // ------------------------------------------------------------------ build
  _build() {
    const r = this.root;
    r.textContent = '';
    this.titleBg = this._buildTitleBackground();
    this.hudEl = this._buildHud();
    this.screens = {
      title: this._buildTitle(),
      loading: this._buildLoading(),
      paused: this._buildPause(),
      inventory: this._buildInventory(),
    };
    this.settingsPanel = this._buildSettings();
    this.controlsPanel = this._buildControls();
    this.toasts = el('div', { className: 'toasts', 'aria-live': 'polite' });
    r.append(this.titleBg, this.hudEl, ...Object.values(this.screens), this.settingsPanel, this.controlsPanel, this.toasts);
  }

  /** Title backdrop: gradient sky, sun, drifting clouds and parallax voxel hills (animated in CSS). */
  _buildTitleBackground() {
    // Deterministic blocky height profile; each strip holds two identical periods so it loops.
    const rand = ((s) => () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296))(20240917);
    const COLS = 48; // blocks per viewport width
    const profile = (base, amp, rough) => {
      const h = [];
      let v = base;
      for (let i = 0; i < COLS; i++) {
        const wave = Math.sin((i / COLS) * Math.PI * 2 * 2 + base) * amp * 0.5 + Math.sin((i / COLS) * Math.PI * 2 * 3 + amp) * amp * 0.3;
        v += (rand() - 0.5) * rough;
        v += (base + wave - v) * 0.35; // pull back toward the smooth shape
        h.push(Math.max(1, Math.round(v)));
      }
      return h;
    };
    const blk = `(100vw / ${COLS})`;
    const polygon = (h) => {
      const pts = ['0% 100%'];
      for (let period = 0; period < 2; period++) {
        h.forEach((v, i) => {
          const x0 = ((period * COLS + i) / (COLS * 2)) * 100, x1 = ((period * COLS + i + 1) / (COLS * 2)) * 100;
          const y = `calc(100% - ${v} * ${blk})`;
          pts.push(`${x0}% ${y}`, `${x1}% ${y}`);
        });
      }
      pts.push('100% 100%');
      return `polygon(${pts.join(',')})`;
    };
    // The silhouette is its own clipped element so trees on the strip are not clipped.
    const layer = (cls, h, extra = []) => {
      const shape = el('div', { className: 'shape' });
      shape.style.clipPath = polygon(h);
      return el('div', { className: `hills ${cls}` }, el('div', { className: 'strip' }, shape, ...extra));
    };
    const far = profile(9, 5, 2.2), mid = profile(6, 4, 1.8), near = profile(3.2, 2.4, 1.2);
    // Near layer: dirt under a grass cap (the same outline, raised a little).
    const nearStrip = el('div', { className: 'strip' });
    const grass = el('div', { className: 'cap' });
    const dirt = el('div', { className: 'body' });
    grass.style.clipPath = polygon(near);
    dirt.style.clipPath = polygon(near.map((v) => v - 0.3));
    nearStrip.append(grass, dirt);
    // Voxel trees standing on the mid layer.
    const trees = [];
    for (const i of [5, 17, 29, 38]) {
      for (let period = 0; period < 2; period++) {
        const tree = el('div', { className: 'tree' }, el('i', { className: 'leaf' }), el('i', { className: 'trunk' }));
        tree.style.left = `calc(${period * COLS + i - 1} * ${blk})`; // trunk stands on column i
        tree.style.bottom = `calc(${mid[i]} * ${blk})`;
        trees.push(tree);
      }
    }
    const clouds = el('div', { className: 'cloud-strip' });
    for (let period = 0; period < 2; period++) {
      for (const [x, y, w] of [[4, 12, 7], [19, 7, 10], [33, 15, 6], [42, 9, 8]]) {
        const c = el('i', { className: 'cloud' });
        c.style.left = `calc(${period * COLS + x} * ${blk})`;
        c.style.top = `${y}%`;
        c.style.width = `calc(${w} * ${blk})`;
        clouds.append(c);
      }
    }
    return el('div', { className: 'title-bg', 'aria-hidden': 'true' },
      el('div', { className: 'sky' }),
      el('div', { className: 'sun' }),
      clouds,
      layer('far', far),
      layer('mid', mid, trees),
      el('div', { className: 'hills near' }, nearStrip),
      el('div', { className: 'haze' }),
    );
  }

  _buildTitle() {
    this.logoCanvas = el('canvas', { className: 'logo-canvas', 'aria-hidden': 'true' });
    this.logoShine = el('div', { className: 'logo-shine', 'aria-hidden': 'true' });
    this.seedInput = el('input', {
      id: 'seed-input', className: 'text-input', type: 'text', placeholder: 'Random seed', maxLength: 32, spellcheck: false,
      autocomplete: 'off', 'aria-label': 'World seed',
      onkeydown: (e) => { if (e.key === 'Enter') this._newWorld(); },
    });
    this.continueBtn = this._button('Continue', () => this.game.continueWorld(), 'btn-primary');
    this.newBtn = this._button('New World', () => this._newWorld());
    return el('section', { className: 'screen screen-title', 'aria-label': 'Title screen' },
      el('div', { className: 'title-wrap' },
        el('h1', { className: 'logo' }, el('span', { className: 'sr-only' }, GAME_NAME), this.logoCanvas, this.logoShine),
        el('p', { className: 'tagline' }, 'A voxel sandbox with shader-pack lighting — right in your browser.'),
        el('div', { className: 'panel menu-card' },
          this.continueBtn,
          el('div', { className: 'seed-row' },
            el('label', { className: 'field-label', htmlFor: 'seed-input' }, 'World seed'),
            this.seedInput,
          ),
          this.newBtn,
          el('div', { className: 'btn-row' },
            this._button('Settings', () => this._openPanel('settings')),
            this._button('Controls', () => this._openPanel('controls')),
          ),
        ),
        el('p', { className: 'footer-note' }, 'WebGL2 · procedural textures · deferred PBR renderer'),
      ),
    );
  }

  _buildLoading() {
    this.loadBar = el('div', { className: 'progress-fill' });
    this.loadPct = el('span', { className: 'progress-pct' }, '0%');
    this.loadLabel = el('div', { className: 'loading-label' }, 'Generating terrain…');
    this.tipEl = el('p', { className: 'tip' });
    return el('section', { className: 'screen screen-loading', 'aria-label': 'Loading', 'aria-live': 'polite' },
      el('div', { className: 'panel loading-card' },
        el('div', { className: 'loading-head' }, el('h2', {}, 'Building your world'), this.loadPct),
        el('div', { className: 'progress' }, this.loadBar),
        this.loadLabel,
        this.tipEl,
      ),
    );
  }

  _buildHud() {
    this.crosshair = el('div', { className: 'crosshair is-hidden', 'aria-hidden': 'true' });
    this.hotbarSel = el('div', { className: 'hotbar-sel' });
    this.hotbarSlots = [];
    const hotbar = el('div', { className: 'hotbar', role: 'toolbar', 'aria-label': 'Hotbar' }, this.hotbarSel);
    for (let i = 0; i < 9; i++) {
      const img = el('img', { alt: '', draggable: false });
      const slot = el('div', { className: 'slot' }, img, el('span', { className: 'slot-key' }, String(i + 1)));
      hotbar.append(slot);
      this.hotbarSlots.push({ slot, img, id: -1 });
    }
    this.blockName = el('div', { className: 'block-name' });
    this.indFly = el('span', { className: 'chip', hidden: true }, 'Flying');
    this.indTime = el('span', { className: 'chip', hidden: true }, 'Time frozen');
    this.indWater = el('span', { className: 'chip chip-water', hidden: true }, 'Underwater');
    this.debugLeft = el('span', { className: 'debug-text' });
    this.debugRight = el('span', { className: 'debug-text' });
    this.debugEl = el('div', { className: 'debug is-hidden' },
      el('div', { className: 'debug-col' }, this.debugLeft),
      el('div', { className: 'debug-col debug-right' }, this.debugRight),
    );
    this.lockHint = el('button', { className: 'lock-hint', type: 'button', onclick: () => this.game.resume() }, 'Click to play');
    this.touchBar = el('div', { className: 'touch-bar', hidden: true },
      this._button('☰', () => this.game.pause(), 'btn-icon', 'Pause'),
      this._button('▦', () => this.game.openInventory(), 'btn-icon', 'Inventory'),
    );
    return el('div', { className: 'hud is-hidden' },
      this.crosshair,
      this.debugEl,
      el('div', { className: 'indicators' }, this.indFly, this.indTime, this.indWater),
      this.touchBar,
      this.lockHint,
      el('div', { className: 'hud-bottom' }, this.blockName, hotbar),
    );
  }

  _buildPause() {
    this.resumeBtn = this._button('Resume', () => this.game.resume(), 'btn-primary');
    this.quitBtn = this._button('Save & Quit to Title', async () => {
      this.quitBtn.disabled = true;
      await this.game.quitToTitle();
    });
    return el('section', { className: 'screen screen-pause', 'aria-label': 'Paused' },
      el('div', { className: 'panel menu-card pause-card' },
        el('h2', { className: 'panel-title' }, 'Paused'),
        this.resumeBtn,
        el('div', { className: 'btn-row' },
          this._button('Settings', () => this._openPanel('settings')),
          this._button('Controls', () => this._openPanel('controls')),
        ),
        this.quitBtn,
        el('p', { className: 'hint kbd-only' }, 'Press ', el('kbd', {}, 'Esc'), ' to resume'),
      ),
    );
  }

  _buildSettings() {
    this.controls = {}; // setting key → { update(settings) }
    const s = this.game.settings;
    this.presetBtns = PRESETS.map((p) => el('button', {
      type: 'button', className: 'seg-btn', dataset: { preset: p },
      onclick: () => this._applySettings({ preset: p }),
    }, p[0].toUpperCase() + p.slice(1)));
    this.customTag = el('span', { className: 'custom-tag', hidden: true }, 'Custom');
    const section = (title, ...rows) => el('div', { className: 'settings-section' }, el('h3', {}, title), ...rows);
    const body = el('div', { className: 'settings-body' },
      section('Graphics',
        el('div', { className: 'setting-row preset-row' },
          el('span', { className: 'setting-label' }, SETTING_LABELS.preset, this.customTag),
          el('div', { className: 'segmented', role: 'group', 'aria-label': SETTING_LABELS.preset }, ...this.presetBtns),
        ),
        this._slider('renderDistance'),
        this._slider('renderScale'),
        el('div', { className: 'toggle-grid' }, ...GRAPHICS_TOGGLES.map((k) => this._toggle(k))),
      ),
      section('Camera & controls',
        this._slider('fov'),
        this._slider('mouseSensitivity'),
        el('div', { className: 'toggle-grid' }, this._toggle('invertY'), this._toggle('viewBobbing')),
      ),
      section('World & audio',
        el('div', { className: 'toggle-grid' }, this._toggle('dayCycle')),
        this._slider('volume'),
      ),
    );
    this.gpuNote = el('p', { className: 'gpu-note' });
    const panel = el('section', { className: 'screen panel-screen', 'aria-label': 'Settings' },
      el('div', { className: 'panel settings-panel' },
        el('div', { className: 'panel-head' },
          el('h2', { className: 'panel-title' }, 'Settings'),
          this._button('Done', () => this._closePanel(), 'btn-primary btn-small'),
        ),
        body,
        this.gpuNote,
      ),
    );
    this._syncSettings(s);
    return panel;
  }

  _slider(key) {
    const cfg = SLIDERS[key];
    const val = el('output', { className: 'setting-value' });
    const input = el('input', {
      type: 'range', min: cfg.min, max: cfg.max, step: cfg.step, className: 'range',
      'aria-label': SETTING_LABELS[key],
      oninput: () => {
        val.textContent = cfg.fmt(+input.value);
        this._rangeFill(input);
      },
      // Commit on release: applying settings reallocates render targets.
      onchange: () => this._applySettings({ [key]: +input.value }),
    });
    this.controls[key] = {
      update: (s) => {
        input.value = s[key];
        val.textContent = cfg.fmt(+s[key]);
        this._rangeFill(input);
      },
    };
    return el('label', { className: 'setting-row slider-row' },
      el('span', { className: 'setting-label' }, SETTING_LABELS[key]), val, input);
  }

  _rangeFill(input) {
    const t = (input.value - input.min) / (input.max - input.min);
    input.style.setProperty('--fill', `${(t * 100).toFixed(1)}%`);
  }

  _toggle(key) {
    const input = el('input', {
      type: 'checkbox', className: 'switch-input', role: 'switch',
      onchange: () => this._applySettings({ [key]: input.checked }),
    });
    this.controls[key] = { update: (s) => { input.checked = !!s[key]; } };
    return el('label', { className: 'toggle' }, input, el('span', { className: 'switch', 'aria-hidden': 'true' }), el('span', {}, SETTING_LABELS[key]));
  }

  _applySettings(partial) {
    const key = Object.keys(partial)[0];
    if (key !== 'preset' && GRAPHICS_KEYS.has(key)) partial.preset = 'custom';
    const s = this.game.updateSettings(partial);
    this._syncSettings(s);
    this._click();
  }

  _syncSettings(s) {
    for (const c of Object.values(this.controls)) c.update(s);
    for (const b of this.presetBtns) {
      const on = b.dataset.preset === s.preset;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on);
    }
    this.customTag.hidden = s.preset !== 'custom';
  }

  _buildControls() {
    const rows = CONTROLS.map(([action, keys]) => el('div', { className: 'control-row' },
      el('span', { className: 'keys' }, ...keys.map((k) => el('kbd', {}, k))),
      el('span', {}, action)));
    return el('section', { className: 'screen panel-screen', 'aria-label': 'Controls' },
      el('div', { className: 'panel controls-panel' },
        el('div', { className: 'panel-head' },
          el('h2', { className: 'panel-title' }, 'Controls'),
          this._button('Done', () => this._closePanel(), 'btn-primary btn-small'),
        ),
        el('div', { className: 'controls-grid' }, ...rows),
      ),
    );
  }

  _buildInventory() {
    this.invGrid = el('div', { className: 'inv-grid', role: 'group', 'aria-label': 'Blocks' });
    this.invHotbar = el('div', { className: 'inv-hotbar', role: 'group', 'aria-label': 'Hotbar' });
    this.invSearch = el('input', {
      className: 'text-input inv-search', type: 'search', placeholder: 'Search blocks…', 'aria-label': 'Search blocks',
      spellcheck: false, autocomplete: 'off', oninput: () => this._filterInventory(),
    });
    this.tooltip = el('div', { className: 'tooltip', 'aria-hidden': 'true' });
    this.invHotbarSlots = [];
    for (let i = 0; i < 9; i++) {
      const img = el('img', { alt: '', draggable: false });
      const slot = el('button', {
        type: 'button', className: 'slot inv-slot', 'aria-label': `Hotbar slot ${i + 1}`,
        onclick: () => {
          this.game.player.selectedSlot = i;
          this._refreshInvHotbar();
          this._click();
        },
      }, img, el('span', { className: 'slot-key' }, String(i + 1)));
      this.invHotbar.append(slot);
      this.invHotbarSlots.push({ slot, img });
    }
    const panel = el('div', { className: 'panel inventory-panel' },
      el('div', { className: 'panel-head' },
        el('h2', { className: 'panel-title' }, 'Blocks'),
        this.invSearch,
        this._button('✕', () => this.game.resume(), 'btn-icon', 'Close inventory'),
      ),
      this.invGrid,
      el('div', { className: 'inv-foot' },
        el('p', { className: 'hint' }, 'Click a block to put it in the selected slot',
          el('span', { className: 'kbd-only' }, ' · hover + ', el('kbd', {}, '1–9'), ' to assign')),
        this.invHotbar,
      ),
    );
    const screen = el('section', {
      className: 'screen screen-inventory', 'aria-label': 'Inventory',
      onclick: (e) => { if (e.target === screen) this.game.resume(); },
    }, panel, this.tooltip);
    return screen;
  }

  _button(label, onClick, cls = '', ariaLabel) {
    return el('button', {
      type: 'button', className: `btn ${cls}`.trim(), 'aria-label': ariaLabel,
      onclick: (e) => {
        this._click();
        onClick(e);
      },
    }, label);
  }

  // ------------------------------------------------------------------ title & panels
  _newWorld() {
    const seed = this.seedInput.value.trim();
    this.game.startNewWorld(seed === '' ? undefined : seed);
  }

  _openPanel(name) {
    this.panel = name;
    const node = name === 'settings' ? this.settingsPanel : this.controlsPanel;
    if (name === 'settings') {
      this._syncSettings(this.game.settings);
      this.gpuNote.textContent = this.game.renderer && this.game.renderer.gpuName ? `GPU: ${this.game.renderer.gpuName}` : '';
    }
    this.root.dataset.panel = name;
    node.classList.add('is-active');
    this._focus(node.querySelector('.btn-primary'));
  }

  _closePanel(silent = false) {
    if (!this.panel) return;
    this.settingsPanel.classList.remove('is-active');
    this.controlsPanel.classList.remove('is-active');
    this.panel = null;
    delete this.root.dataset.panel;
    if (!silent && this.state === 'paused') this._focus(this.resumeBtn);
  }

  _focus(node) {
    // Only move focus for keyboard users; on touch it would pop up keyboards.
    if (node && !(this.game.input && this.game.input.touchMode)) node.focus({ preventScroll: true });
  }

  _drawLogo() {
    if (this.state !== 'title') return;
    const canvas = this.logoCanvas;
    const cssW = canvas.clientWidth || 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // One line on wide screens; split at the inner capital ("Block" / "Craft") on narrow ones.
    const lines = (cssW < 520 ? GAME_NAME.split(/(?=[A-Z])/) : [GAME_NAME]).map((w) => w.toUpperCase());
    const cols = Math.max(...lines.map((w) => w.length * 6 - 1));
    const rows = lines.length * 9 - 2;
    const depth = 0.7; // extrusion, in blocks
    const b = Math.max(4, Math.floor((cssW * dpr) / (cols + depth + 1)));
    canvas.width = Math.ceil((cols + depth + 1) * b);
    canvas.height = Math.ceil((rows + depth + 1) * b);
    const ctx = canvas.getContext('2d');
    // Occupancy grid of the (centred) lines.
    const grid = [];
    for (let y = 0; y < rows; y++) grid.push(new Uint8Array(cols));
    lines.forEach((word, line) => {
      const x0 = Math.floor((cols - (word.length * 6 - 1)) / 2);
      [...word].forEach((ch, li) => {
        const g = GLYPHS[ch];
        if (!g) return;
        for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (g[y][x] === '#') grid[line * 9 + y][x0 + li * 6 + x] = 1;
      });
    });
    const filled = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && grid[y][x] === 1;
    const tex = this.game.textures;
    const layerCanvas = (name) => {
      const L = TEXTURE_NAMES.indexOf(name);
      const s = tex.size;
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const img = new ImageData(s, s);
      img.data.set(tex.albedo.subarray(L * s * s * 4, (L + 1) * s * s * 4));
      c.getContext('2d').putImageData(img, 0, 0);
      return c;
    };
    const grassSide = layerCanvas('grass_side'), grassTop = layerCanvas('grass_top');
    const stone = layerCanvas('stone'), cobble = layerCanvas('cobblestone');
    const ox = b * 0.5, oy = b * 0.5;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = b < tex.size;
    ctx.imageSmoothingQuality = 'high';
    // Dark rim around the letters, then the extrusion toward the bottom-right, darkening with depth.
    const rim = Math.max(1, Math.round(b / 7));
    ctx.fillStyle = 'rgba(12, 16, 24, 0.75)';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (filled(x, y)) ctx.fillRect(ox + x * b - rim, oy + y * b - rim, b + 2 * rim, b + 2 * rim);
    const steps = Math.max(2, Math.round(depth * b));
    for (let k = steps; k >= 1; k--) {
      const d = (k / steps) * depth * b;
      ctx.fillStyle = `rgb(${24 + (1 - k / steps) * 30}, ${20 + (1 - k / steps) * 26}, ${18 + (1 - k / steps) * 22})`;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (filled(x, y)) ctx.fillRect(ox + x * b + d * 0.55, oy + y * b + d, b + 0.5, b + 0.5);
    }
    // Front faces: grass-capped where exposed to the sky, stone (with some cobble) below.
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!filled(x, y)) continue;
        const px = ox + x * b, py = oy + y * b;
        if (!filled(x, y - 1)) {
          // Grass cap: dirt side with a bold turf band so it reads at small sizes.
          ctx.drawImage(grassSide, px, py, b, b);
          ctx.drawImage(grassTop, 0, 0, tex.size, tex.size * 0.3, px, py, b, b * 0.3);
        } else {
          ctx.drawImage((x * 7 + y * 3) % 5 === 0 ? cobble : stone, px, py, b, b);
        }
        // Bevel: light top/left edge, dark bottom/right edge.
        const e = Math.max(1, Math.round(b / 12));
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(px, py, b, e);
        ctx.fillRect(px, py, e, b);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(px, py + b - e, b, e);
        ctx.fillRect(px + b - e, py, e, b);
      }
    }
    // Shine sweep is masked to the logo's shape.
    const url = `url(${canvas.toDataURL()})`;
    this.logoShine.style.maskImage = url;
    this.logoShine.style.webkitMaskImage = url;
  }

  _startTips() {
    let i = Math.floor(Math.random() * TIPS.length);
    const show = () => {
      this.tipEl.classList.remove('show');
      setTimeout(() => {
        this.tipEl.textContent = TIPS[i++ % TIPS.length];
        this.tipEl.classList.add('show');
      }, 250);
    };
    show();
    clearInterval(this._tipTimer);
    this._tipTimer = setInterval(show, 4500);
  }

  _stopTips() {
    clearInterval(this._tipTimer);
    this._tipTimer = 0;
  }

  // ------------------------------------------------------------------ keys
  _onKey(e) {
    if (e.repeat) return;
    const typing = e.target instanceof HTMLInputElement && e.target.type !== 'checkbox' && e.target.type !== 'range';
    const st = this.state;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.code === 'Escape') {
      if (this.panel) {
        this._closePanel();
        return handled();
      }
      // Pointer-lock exit via Esc can also deliver the key: ignore it right after pausing.
      if (st === 'paused' && performance.now() - this.stateAt > 250) {
        this.game.resume();
        return handled();
      }
      if (st === 'inventory') {
        this.game.resume();
        return handled();
      }
      return;
    }
    if (st === 'inventory' && !typing) {
      if (e.code === 'KeyE') {
        this.game.resume();
        return handled();
      }
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && this.hoverBlock) {
        this._assign(+digit[1] - 1, this.hoverBlock);
        return handled();
      }
    }
  }

  // ------------------------------------------------------------------ hotbar & inventory
  _iconURL(id) {
    let u = this.icons.get(id);
    if (!u) {
      u = makeBlockIcon(this.game.textures, id, ICON_PX).toDataURL();
      this.icons.set(id, u);
    }
    return u;
  }

  /** Render inventory icons in small idle batches so opening the inventory is instant. */
  _prewarmIcons() {
    const ids = INVENTORY_BLOCKS.filter((id) => !this.icons.has(id));
    const step = () => {
      const t0 = performance.now();
      while (ids.length && performance.now() - t0 < 6) this._iconURL(ids.shift());
      if (ids.length) setTimeout(step, 30);
    };
    setTimeout(step, 500);
  }

  _setSlotIcon(s, id) {
    if (s.id === id) return;
    s.id = id;
    const b = id ? BLOCKS[id] : null;
    if (b) {
      s.img.src = this._iconURL(id);
      s.img.hidden = false;
      s.slot.title = b.displayName;
    } else {
      s.img.hidden = true;
      s.slot.title = '';
    }
  }

  _updateHotbar(p) {
    const hb = p.hotbar || [];
    const sel = p.selectedSlot | 0;
    const key = hb.join(',') + '|' + sel;
    if (key === this.hud.key) return;
    this.hud.key = key;
    for (let i = 0; i < 9; i++) this._setSlotIcon(this.hotbarSlots[i], hb[i] || 0);
    this.hotbarSel.style.setProperty('--i', sel);
    const id = hb[sel] || 0;
    if (sel !== this.hud.lastSel || id !== this.hud.lastId) {
      const first = this.hud.lastSel === -1;
      this.hud.lastSel = sel;
      this.hud.lastId = id;
      if (!first && id && BLOCKS[id]) {
        this.blockName.textContent = BLOCKS[id].displayName;
        this.blockName.classList.remove('show');
        void this.blockName.offsetWidth; // restart the fade
        this.blockName.classList.add('show');
      }
    }
  }

  _openInventory() {
    if (!this.invGrid.childElementCount) {
      for (const id of INVENTORY_BLOCKS) {
        const b = BLOCKS[id];
        const cell = el('button', {
          type: 'button', className: 'slot inv-item', 'aria-label': b.displayName, dataset: { id, name: b.displayName.toLowerCase() },
          onclick: () => this._assign(this.game.player.selectedSlot | 0, id),
          onpointerenter: (e) => this._showTooltip(e, id),
          onpointermove: (e) => this._moveTooltip(e),
          onpointerleave: () => this._hideTooltip(),
          onfocus: () => { this.hoverBlock = id; },
          onblur: () => { this.hoverBlock = 0; },
        }, el('img', { alt: '', src: this._iconURL(id), draggable: false, loading: 'lazy' }));
        this.invGrid.append(cell);
      }
    }
    this.invSearch.value = '';
    this._filterInventory();
    this._refreshInvHotbar();
    this._hideTooltip();
    this.invGrid.scrollTop = 0;
  }

  _filterInventory() {
    const q = this.invSearch.value.trim().toLowerCase();
    for (const c of this.invGrid.children) c.hidden = q !== '' && !c.dataset.name.includes(q);
  }

  _assign(slot, id) {
    const p = this.game.player;
    if (!p) return;
    p.hotbar[slot] = id;
    p.selectedSlot = slot;
    this._refreshInvHotbar();
    const s = this.invHotbarSlots[slot].slot;
    s.classList.remove('pop');
    void s.offsetWidth;
    s.classList.add('pop');
    this.game.audio && this.game.audio.play('pop');
  }

  _refreshInvHotbar() {
    const p = this.game.player;
    if (!p) return;
    this.invHotbarSlots.forEach((s, i) => {
      const id = p.hotbar[i] || 0;
      s.img.hidden = !id;
      if (id) s.img.src = this._iconURL(id);
      s.slot.classList.toggle('is-sel', i === (p.selectedSlot | 0));
      s.slot.title = id ? BLOCKS[id].displayName : '';
    });
  }

  _showTooltip(e, id) {
    this.hoverBlock = id;
    this.tooltip.textContent = BLOCKS[id].displayName;
    this.tooltip.classList.add('show');
    this._moveTooltip(e);
  }

  _moveTooltip(e) {
    if (e.pointerType === 'touch') return;
    const pad = 14, w = this.tooltip.offsetWidth, h = this.tooltip.offsetHeight;
    const x = Math.min(window.innerWidth - w - 6, e.clientX + pad);
    const y = Math.max(6, e.clientY - h - pad * 0.5);
    this.tooltip.style.transform = `translate(${x}px, ${y}px)`;
  }

  _hideTooltip() {
    this.hoverBlock = 0;
    this.tooltip.classList.remove('show');
  }

  // ------------------------------------------------------------------ debug overlay
  _updateDebug(h) {
    const { player: p, world, renderer: r } = h;
    const g = this.game, s = g.settings;
    const [x, y, z] = p.position;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const cx = Math.floor(bx / CHUNK_SIZE), cz = Math.floor(bz / CHUNK_SIZE);
    const yawDeg = (((p.yaw * 180) / Math.PI) % 360 + 360) % 360;
    const pitchDeg = (p.pitch * 180) / Math.PI;
    // yaw 0 looks north (−Z) and grows turning west (−X).
    const facing = [['north', '−Z'], ['west', '−X'], ['south', '+Z'], ['east', '+X']][Math.round(yawDeg / 90) % 4];
    const hours = ((h.dayFraction * 24 + 6) % 24 + 24) % 24;
    const biome = world && world.biomeAt ? world.biomeAt(bx, bz) : '—';
    const t = p.target;
    const left = [
      `${GAME_NAME}  ${Math.round(h.fps)} fps`,
      `XYZ: ${x.toFixed(3)} / ${y.toFixed(3)} / ${z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}`,
      `Chunk: ${cx} ${cz}  [${bx - cx * CHUNK_SIZE} ${bz - cz * CHUNK_SIZE}]`,
      `Facing: ${facing[0]} (${facing[1]})  ${yawDeg.toFixed(1)}° / ${pitchDeg.toFixed(1)}°`,
      `Biome: ${biome}`,
      `Time: ${pad2(Math.floor(hours))}:${pad2(Math.floor((hours % 1) * 60))}${s.dayCycle ? '' : '  (frozen)'}`,
      `Seed: ${h.seed ?? '—'}`,
      t && BLOCKS[t.id] ? `Looking at: ${BLOCKS[t.id].name} @ ${t.x} ${t.y} ${t.z}` : 'Looking at: —',
      `Mode: ${p.flying ? 'flying' : 'walking'}${p.sprinting ? ', sprinting' : ''}${p.sneaking ? ', sneaking' : ''}`,
    ];
    const st = r.stats || {};
    const ws = world && world.stats ? Object.entries(world.stats).map(([k, v]) => `${k} ${v}`).join(' · ') : '';
    const feats = Object.keys(FEATURE_SHORT).filter((k) => s[k]).map((k) => FEATURE_SHORT[k]);
    const right = [
      `GPU: ${r.gpuName || 'unknown'}`,
      `Internal: ${r.width}×${r.height} (${Math.round((s.renderScale || 1) * 100)}%) · Canvas ${g.canvas.width}×${g.canvas.height}`,
      `Draw calls: ${st.drawCalls ?? 0} · Triangles: ${fmtCount(st.triangles ?? 0)}`,
      `Frame: ${(st.frameMs ?? 0).toFixed(2)} ms CPU${typeof st.gpuMs === 'number' ? ` · ${st.gpuMs.toFixed(2)} ms GPU` : ''}`,
      `Chunks: ${r.chunks ? r.chunks.size : 0} on GPU${ws ? ` · ${ws}` : ''}`,
      `Preset: ${s.preset} · Render distance ${s.renderDistance}`,
      `Features: ${feats.join(' ') || 'none'}`,
    ];
    this.debugLeft.textContent = left.join('\n');
    this.debugRight.textContent = right.join('\n');
  }

  /** UI blip. Clicks are user gestures, so this is also where audio gets unlocked on the title screen. */
  _click() {
    const a = this.game.audio;
    if (!a) return;
    a.resume();
    a.play('click');
  }
}
