// Keyboard / mouse / pointer-lock input, with a drag-to-look fallback when
// pointer lock is unavailable (sandboxed iframes, some browsers) and on-screen
// touch controls for phones and tablets.
//
// Gameplay queries (isDown, mouseDown, consumeClick, consumeMouseDelta,
// consumeWheel) return nothing while `enabled` is false; edge-triggered key
// presses (consumePressed) always work so menus can use F1-F3 / Escape / E.

const MAX_MOUSE_DELTA = 250; // clamp per-event spikes some browsers emit on lock
const DRAG_CLICK_PX = 6; // drag-look: less movement than this counts as a click
const TOUCH_LOOK_SCALE = 2.2;
const COMPAT_MOUSE_MS = 800; // ignore emulated mouse events right after touches
const LOCK_COOLDOWN_MS = 1500; // browsers refuse re-locking right after Esc

const PREVENT_ALWAYS = new Set(['F1', 'F2', 'F3']);
const PREVENT_PLAYING = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote', 'Backspace',
]);
// Game keys that collide with browser shortcuts when Ctrl/Cmd is held.
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'KeyF', 'Space',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
]);

const TOUCH_CSS = `
.touch-root{position:fixed;inset:0;pointer-events:none;z-index:5;user-select:none;-webkit-user-select:none;touch-action:none}
.touch-root[hidden]{display:none}
.touch-stick{position:absolute;left:calc(28px + env(safe-area-inset-left));bottom:calc(110px + env(safe-area-inset-bottom));width:132px;height:132px;border-radius:50%;
  background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.28);pointer-events:auto;touch-action:none}
.touch-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;
  background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.55);transition:transform .06s linear}
.touch-btn{position:absolute;width:62px;height:62px;border-radius:16px;display:flex;align-items:center;justify-content:center;
  font:600 13px/1 system-ui,sans-serif;color:#fff;background:rgba(20,24,32,.45);border:2px solid rgba(255,255,255,.3);
  pointer-events:auto;touch-action:none;text-shadow:0 1px 2px #000;backdrop-filter:blur(2px)}
.touch-btn.touch-on{background:rgba(255,255,255,.3)}
.touch-small{width:48px;height:40px;border-radius:12px;font-size:12px}
`;

function isEditable(t) {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

function clampDelta(v) {
  return v > MAX_MOUSE_DELTA ? MAX_MOUSE_DELTA : v < -MAX_MOUSE_DELTA ? -MAX_MOUSE_DELTA : v;
}

export class Input {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.locked = false;
    this.touchMode = false;
    this.dragLookMode = false;
    /** @type {((locked:boolean)=>void)|null} */
    this.onPointerLockChange = null;
    /** @type {(()=>void)|null} */
    this.onFirstGesture = null;
    /** Touch stick: [strafe right, forward] in [-1, 1]. */
    this.touchMove = [0, 0];
    /** Stick pushed past its rim (sprint). */
    this.touchSprint = false;

    this._enabled = false;
    this._down = new Set();
    this._virtualDown = new Set(); // held touch buttons
    this._pressed = new Set();
    this._buttons = [false, false, false];
    this._clicks = [false, false, false];
    this._dx = 0;
    this._dy = 0;
    this._wheelSteps = 0;
    this._wheelAcc = 0;
    this._gestured = false;
    this._lastGesture = -1e9;
    this._lastTouch = -1e9;
    this._unlockTime = -1e9;
    this._lockPending = false;
    this._lockWithGesture = false;
    this._lockFailures = 0;
    this._drag = null; // drag-look: { button, moved }
    this._touchUI = null;
    this._lookTouch = null; // { id, x, y }
    this._stickTouch = null; // { id, cx, cy }
    this._bind();
  }

  // ------------------------------------------------------------------ state
  get enabled() {
    return this._enabled;
  }

  set enabled(v) {
    v = !!v;
    if (v === this._enabled) return;
    this._enabled = v;
    if (!v) this._releaseAll();
    this._updateTouchUI();
  }

  isDown(code) {
    return this._enabled && (this._down.has(code) || this._virtualDown.has(code));
  }

  /** True once per key press (since the last endFrame). Works while disabled. */
  consumePressed(code) {
    if (!this._pressed.has(code)) return false;
    this._pressed.delete(code);
    return true;
  }

  /** Mouse movement since the last call, in pixels ([0,0] while disabled). */
  consumeMouseDelta() {
    const d = [this._dx, this._dy];
    this._dx = 0;
    this._dy = 0;
    return this._enabled ? d : [0, 0];
  }

  /** Whether a mouse button (0 left, 1 middle, 2 right) is held. */
  mouseDown(button) {
    return this._enabled && this._buttons[button];
  }

  /** True once per click of `button`. */
  consumeClick(button) {
    const c = this._clicks[button];
    this._clicks[button] = false;
    return this._enabled && c;
  }

  /** Wheel steps since the last call (+ = scroll down / next slot). */
  consumeWheel() {
    const s = this._wheelSteps;
    this._wheelSteps = 0;
    return this._enabled ? s : 0;
  }

  /** Clear per-frame edges. Call once at the end of every frame. */
  endFrame() {
    this._pressed.clear();
    this._clicks[0] = this._clicks[1] = this._clicks[2] = false;
    this._dx = 0;
    this._dy = 0;
    this._wheelSteps = 0;
  }

  // ------------------------------------------------------------------ pointer lock
  requestLock() {
    if (this.touchMode || this.dragLookMode || this.locked) return;
    const c = this.canvas;
    if (!c.requestPointerLock) {
      this._switchToDragLook('pointer lock is not supported');
      return;
    }
    this._lockPending = true;
    const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
    this._lockWithGesture = ua ? ua.isActive : performance.now() - this._lastGesture < 1000;
    try {
      const p = c.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch((e) => this._lockFailed(e));
    } catch (e) {
      this._lockFailed(e);
    }
  }

  exitLock() {
    this._drag = null;
    if (document.pointerLockElement === this.canvas && document.exitPointerLock) document.exitPointerLock();
  }

  _lockFailed(err) {
    if (!this._lockPending) return; // promise rejection and error event both report one failure
    this._lockPending = false;
    if (err && err.name === 'NotSupportedError') {
      this._switchToDragLook(err.message);
      return;
    }
    // Requests without a user gesture, or right after leaving the lock, are
    // expected to fail; only repeated gesture-backed refusals mean "blocked".
    if (!this._lockWithGesture || performance.now() - this._unlockTime < LOCK_COOLDOWN_MS) return;
    if (++this._lockFailures >= 2) this._switchToDragLook('pointer lock was refused');
  }

  _switchToDragLook(reason) {
    if (this.dragLookMode) return;
    this.dragLookMode = true;
    console.info('[Input] using drag-to-look controls:', reason);
  }

  // ------------------------------------------------------------------ events
  _bind() {
    const c = this.canvas;
    const opts = { passive: false };
    window.addEventListener('keydown', (e) => this._onKeyDown(e), opts);
    window.addEventListener('keyup', (e) => {
      this._down.delete(e.code);
    });
    window.addEventListener('blur', () => this._releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._releaseAll();
    });

    c.addEventListener('mousedown', (e) => this._onMouseDown(e));
    document.addEventListener('mousemove', (e) => this._onMouseMove(e));
    document.addEventListener('mouseup', (e) => this._onMouseUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => {
      if (this._enabled) e.preventDefault();
    });
    c.addEventListener('wheel', (e) => this._onWheel(e), opts);

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (locked === this.locked) return;
      this.locked = locked;
      this._lockPending = false;
      if (locked) this._lockFailures = 0;
      else {
        this._unlockTime = performance.now();
        this._buttons[0] = this._buttons[1] = this._buttons[2] = false;
      }
      if (this.onPointerLockChange) this.onPointerLockChange(locked);
    });
    document.addEventListener('pointerlockerror', () => this._lockFailed(null));

    window.addEventListener('touchstart', (e) => this._onTouchStart(e), opts);
    window.addEventListener('touchmove', (e) => this._onTouchMove(e), opts);
    window.addEventListener('touchend', (e) => this._onTouchEnd(e), opts);
    window.addEventListener('touchcancel', (e) => this._onTouchEnd(e), opts);
  }

  _gesture() {
    this._lastGesture = performance.now();
    if (this._gestured) return;
    this._gestured = true;
    if (this.onFirstGesture) this.onFirstGesture();
  }

  _releaseAll() {
    this._down.clear();
    this._virtualDown.clear();
    this._buttons[0] = this._buttons[1] = this._buttons[2] = false;
    this._drag = null;
    this._lookTouch = null;
    this._stickTouch = null;
    this.touchMove[0] = this.touchMove[1] = 0;
    this.touchSprint = false;
    if (this._touchUI) {
      this._touchUI.knob.style.transform = '';
      for (const b of this._touchUI.buttons) b.classList.remove('touch-on');
    }
  }

  _onKeyDown(e) {
    if (isEditable(e.target)) return;
    this._gesture();
    if (!e.repeat) this._pressed.add(e.code);
    this._down.add(e.code);
    if (PREVENT_ALWAYS.has(e.code)) e.preventDefault();
    else if (this._enabled && (PREVENT_PLAYING.has(e.code) || ((e.ctrlKey || e.metaKey) && GAME_KEYS.has(e.code)))) {
      e.preventDefault(); // e.g. Ctrl+W while sprinting (where the browser allows it)
    }
  }

  _onMouseDown(e) {
    if (performance.now() - this._lastTouch < COMPAT_MOUSE_MS) return;
    this._gesture();
    if (!this._enabled || e.button > 2) return;
    e.preventDefault();
    if (this.locked) {
      this._buttons[e.button] = true;
      this._clicks[e.button] = true;
    } else if (this.dragLookMode) {
      this._drag = { button: e.button, moved: 0 };
    } else {
      this.requestLock(); // this click only captures the mouse
    }
  }

  _onMouseMove(e) {
    if (this.locked) {
      this._dx += clampDelta(e.movementX || 0);
      this._dy += clampDelta(e.movementY || 0);
    } else if (this._drag) {
      const mx = e.movementX || 0, my = e.movementY || 0;
      this._drag.moved += Math.abs(mx) + Math.abs(my);
      this._dx += clampDelta(mx);
      this._dy += clampDelta(my);
    }
  }

  _onMouseUp(e) {
    if (e.button > 2) return;
    if (this.locked) {
      this._buttons[e.button] = false;
    } else if (this._drag && this._drag.button === e.button) {
      if (this._drag.moved < DRAG_CLICK_PX) this._clicks[e.button] = true;
      this._drag = null;
    }
  }

  _onWheel(e) {
    if (!this._enabled) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1;
    const d = e.deltaY * scale;
    if (Math.abs(d) >= 50) {
      this._wheelSteps += Math.sign(d); // one notch of a wheel mouse
      this._wheelAcc = 0;
    } else {
      this._wheelAcc += d; // trackpad: accumulate small deltas
      while (Math.abs(this._wheelAcc) >= 60) {
        const s = Math.sign(this._wheelAcc);
        this._wheelSteps += s;
        this._wheelAcc -= s * 60;
      }
    }
  }

  // ------------------------------------------------------------------ touch
  _onTouchStart(e) {
    this._lastTouch = performance.now();
    this._gesture();
    if (!this.touchMode) {
      this.touchMode = true;
      this._createTouchUI();
      this._updateTouchUI();
    }
    if (!this._enabled) return;
    for (const t of e.changedTouches) {
      if (t.target === this.canvas && !this._lookTouch) {
        this._lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        e.preventDefault();
      }
    }
  }

  _onTouchMove(e) {
    this._lastTouch = performance.now();
    if (!this._enabled) return;
    for (const t of e.changedTouches) {
      const look = this._lookTouch;
      if (look && t.identifier === look.id) {
        this._dx += (t.clientX - look.x) * TOUCH_LOOK_SCALE;
        this._dy += (t.clientY - look.y) * TOUCH_LOOK_SCALE;
        look.x = t.clientX;
        look.y = t.clientY;
        e.preventDefault();
      }
      const st = this._stickTouch;
      if (st && t.identifier === st.id) {
        this._moveStick(t.clientX - st.cx, t.clientY - st.cy);
        e.preventDefault();
      }
    }
  }

  _onTouchEnd(e) {
    this._lastTouch = performance.now();
    for (const t of e.changedTouches) {
      if (this._lookTouch && t.identifier === this._lookTouch.id) this._lookTouch = null;
      if (this._stickTouch && t.identifier === this._stickTouch.id) {
        this._stickTouch = null;
        this._moveStick(0, 0);
      }
    }
  }

  _moveStick(ox, oy) {
    const R = 52;
    const dist = Math.hypot(ox, oy);
    const k = dist > R ? R / dist : 1;
    this.touchMove[0] = (ox * k) / R;
    this.touchMove[1] = (-oy * k) / R;
    this.touchSprint = dist > R * 1.25 && -oy > Math.abs(ox);
    if (this._touchUI) this._touchUI.knob.style.transform = `translate(${ox * k}px, ${oy * k}px)`;
  }

  _createTouchUI() {
    if (this._touchUI) return;
    const style = document.createElement('style');
    style.textContent = TOUCH_CSS;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.className = 'touch-root';
    root.hidden = true;

    const stick = document.createElement('div');
    stick.className = 'touch-stick';
    const knob = document.createElement('div');
    knob.className = 'touch-knob';
    stick.appendChild(knob);
    stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      const r = stick.getBoundingClientRect();
      this._stickTouch = { id: t.identifier, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      this._moveStick(t.clientX - this._stickTouch.cx, t.clientY - this._stickTouch.cy);
    }, { passive: false });
    root.appendChild(stick);

    const buttons = [];
    const safeR = 'env(safe-area-inset-right)';
    const button = (label, cls, right, bottom, onDown, onUp) => {
      const b = document.createElement('div');
      b.className = 'touch-btn ' + cls;
      b.textContent = label;
      b.style.right = `calc(${right}px + ${safeR})`;
      b.style.bottom = `calc(${bottom}px + env(safe-area-inset-bottom))`;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._lastTouch = performance.now();
        b.classList.add('touch-on');
        if (this._enabled) onDown();
      }, { passive: false });
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('touch-on');
        if (onUp) onUp();
      };
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      buttons.push(b);
      root.appendChild(b);
      return b;
    };
    const hold = (code) => [() => { this._virtualDown.add(code); this._pressed.add(code); }, () => this._virtualDown.delete(code)];
    const mouse = (btn) => [() => { this._buttons[btn] = true; this._clicks[btn] = true; }, () => { this._buttons[btn] = false; }];
    const tap = (code) => [() => this._pressed.add(code), null];

    button('Jump', 'touch-jump', 28, 118, ...hold('Space'));
    button('Sneak', 'touch-sneak', 28, 188, ...hold('ShiftLeft'));
    button('Break', 'touch-break', 100, 150, ...mouse(0));
    button('Place', 'touch-place', 100, 220, ...mouse(2));
    button('Fly', 'touch-fly touch-small', 28, 262, ...tap('FlyToggle'));
    const inv = button('Inv', 'touch-inventory touch-small', 84, 12, ...tap('KeyE'));
    inv.style.top = 'calc(12px + env(safe-area-inset-top))';
    inv.style.bottom = 'auto';
    const pause = button('II', 'touch-pause touch-small', 28, 12, ...tap('Escape'));
    pause.style.top = 'calc(12px + env(safe-area-inset-top))';
    pause.style.bottom = 'auto';

    document.body.appendChild(root);
    this._touchUI = { root, knob, buttons };
  }

  _updateTouchUI() {
    if (this._touchUI) this._touchUI.root.hidden = !(this.touchMode && this._enabled);
  }
}
