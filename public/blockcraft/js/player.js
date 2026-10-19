// Player: mouse look, movement modes (walk / sprint / sneak / swim / fly),
// AABB collision against the voxel world, and block interaction.

import { PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_EYE, PLAYER_EYE_SNEAK, REACH, WORLD_HEIGHT } from './config.js';
import { BLOCKS, BLOCK, IS_SOLID, IS_REPLACEABLE, DEFAULT_HOTBAR, INVENTORY_BLOCKS } from './blocks.js';
import { DEG, TAU, clamp, forwardFromYawPitch } from './math.js';

// Minecraft-like tuning (blocks, seconds).
const GRAVITY = 32;
const AIR_DRAG = 0.4; // terminal fall speed ≈ GRAVITY / AIR_DRAG
const JUMP_VELOCITY = 9.6; // ≈ 1.25 block jump (with air drag)
const WALK = 4.317, SPRINT = 5.612, SNEAK = 1.31;
const FLY = 10.9, FLY_SPRINT = 21.6, FLY_VERTICAL = 7.5;
const SWIM = 2.2, SWIM_SPRINT = 3.4, LAVA_SPEED = 1.0;
const ACCEL_GROUND = 14, ACCEL_AIR = 2.2, ACCEL_FLY = 5, ACCEL_LIQUID = 5;
const WATER_SINK = 5, WATER_SWIM_UP = 14, WATER_DRAG = 3, LAVA_DRAG = 5;
const WATER_CLIMB = 8.5; // push out of water up a bank
const PITCH_LIMIT = 89.5 * DEG;
const MOUSE_RADIANS_PER_PX = 0.0022;
const DOUBLE_TAP = 0.3;
const ACTION_REPEAT = 0.25;
const PHYSICS_STEP = 1 / 60;
const HALF_W = PLAYER_WIDTH / 2;
const EPS = 1e-7;
const SNEAK_PROBE = 0.6; // sneaking never walks off a drop deeper than this
const VOID_Y = -20;

export class Player {
  /**
   * @param {import('./world/world.js').World} world
   * @param {import('./input.js').Input} input
   * @param {{playBlock:Function, play:Function}} audio
   */
  constructor(world, input, audio) {
    this.world = world;
    this.input = input;
    this.audio = audio;
    this.position = [0, 80, 0];
    this.velocity = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.flying = false;
    this.onGround = false;
    this.inWater = false;
    this.inLava = false;
    this.eyeInWater = false;
    this.eyeInLava = false;
    this.sprinting = false;
    this.sneaking = false;
    this.hotbar = DEFAULT_HOTBAR.slice();
    this.selectedSlot = 0;
    this.target = null;
    this.breakProgress = 0;

    this._time = 0;
    this._lastSpaceTap = -1;
    this._lastWTap = -1;
    this._sprintLatch = false;
    this._breakTimer = 0;
    this._placeTimer = 0;
    this._eyeHeight = PLAYER_EYE;
    this._bobPhase = 0;
    this._bobAmp = 0;
    this._bob = [0, 0, 0];
    this._stepDist = 0;
    this._hitWall = false;
  }

  // ------------------------------------------------------------------ public
  /** Eye position (feet + eye height, plus view bobbing). */
  eyePosition() {
    const p = this.position;
    return [p[0] + this._bob[0], p[1] + this._eyeHeight + this._bob[1], p[2] + this._bob[2]];
  }

  teleport(x, y, z) {
    this.position[0] = x;
    this.position[1] = y;
    this.position[2] = z;
    this.velocity[0] = this.velocity[1] = this.velocity[2] = 0;
    // Pop up out of terrain (only where chunks exist; unloaded space is not solid here).
    for (let guard = 0; guard < WORLD_HEIGHT && this._collides(false) && this.position[1] < WORLD_HEIGHT; guard++) {
      this.position[1] = Math.floor(this.position[1]) + 1;
    }
    this.onGround = false;
  }

  serialize() {
    return { position: this.position.slice(), yaw: this.yaw, pitch: this.pitch, flying: this.flying };
  }

  /**
   * @param {number} dt seconds
   * @param {{mouseSensitivity:number, invertY:boolean, viewBobbing:boolean}} settings
   */
  update(dt, settings) {
    this._time += dt;
    const input = this.input;
    this._look(settings);
    this._hotbarInput();
    this._modeInput();
    this._updateMedium();

    // Movement intent (keyboard + touch stick), relative to yaw.
    let fwd = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0) + input.touchMove[1];
    let strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0) + input.touchMove[0];
    fwd = clamp(fwd, -1, 1);
    strafe = clamp(strafe, -1, 1);
    const len = Math.hypot(fwd, strafe);
    if (len > 1) {
      fwd /= len;
      strafe /= len;
    }
    const jump = input.isDown('Space');
    const down = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    this.sneaking = down && !this.flying;
    const sprintKey = input.isDown('ControlLeft') || input.isDown('ControlRight') || this._sprintLatch || input.touchSprint;
    this.sprinting = fwd > 0 && !this.sneaking && !this.inLava && (sprintKey || this.sprinting) && !this._hitWall;

    let speed;
    if (this.flying) speed = this.sprinting ? FLY_SPRINT : FLY;
    else if (this.inLava) speed = LAVA_SPEED;
    else if (this.inWater) speed = this.sprinting ? SWIM_SPRINT : SWIM;
    else speed = this.sneaking ? SNEAK : this.sprinting ? SPRINT : WALK;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    const wishX = (-sy * fwd + cy * strafe) * speed;
    const wishZ = (-cy * fwd - sy * strafe) * speed;

    const wasOnGround = this.onGround;
    const fallSpeed = this.velocity[1];
    const wasInWater = this.inWater;
    const x0 = this.position[0], z0 = this.position[2];

    let remaining = dt;
    this._hitWall = false;
    while (remaining > 1e-6) {
      const h = Math.min(remaining, PHYSICS_STEP);
      remaining -= h;
      this._integrate(h, wishX, wishZ, jump, down);
      this._move(this.velocity[0] * h, this.velocity[1] * h, this.velocity[2] * h);
      if (this.flying && this.onGround) this.flying = false; // touching down ends flight
    }
    this._updateMedium();

    if (this.position[1] < VOID_Y) {
      const p = this.position;
      this.teleport(p[0], this.world.surfaceHeight(p[0], p[2]) + 1.01, p[2]);
    }

    this._sounds(wasOnGround, fallSpeed, wasInWater, x0, z0);
    this._updateView(dt, settings, x0, z0);
    this._interact(dt);
  }

  // ------------------------------------------------------------------ input
  _look(settings) {
    const [mx, my] = this.input.consumeMouseDelta();
    const sens = MOUSE_RADIANS_PER_PX * (settings.mouseSensitivity ?? 1);
    this.yaw -= mx * sens;
    this.yaw -= Math.floor((this.yaw + Math.PI) / TAU) * TAU; // keep in [-π, π)
    this.pitch = clamp(this.pitch - my * sens * (settings.invertY ? -1 : 1), -PITCH_LIMIT, PITCH_LIMIT);
  }

  _hotbarInput() {
    const input = this.input;
    for (let d = 1; d <= 9; d++) if (input.consumePressed('Digit' + d)) this.selectedSlot = d - 1;
    const steps = input.consumeWheel();
    if (steps) this.selectedSlot = (((this.selectedSlot + steps) % 9) + 9) % 9;
  }

  _modeInput() {
    const input = this.input;
    if (!input.enabled) return;
    if (input.consumePressed('Space')) {
      if (this._time - this._lastSpaceTap < DOUBLE_TAP) {
        this._toggleFlying();
        this._lastSpaceTap = -1;
      } else {
        this._lastSpaceTap = this._time;
      }
    }
    if (input.consumePressed('FlyToggle')) this._toggleFlying();
    if (input.consumePressed('KeyW')) {
      if (this._time - this._lastWTap < DOUBLE_TAP) this._sprintLatch = true;
      this._lastWTap = this._time;
    }
    if (!input.isDown('KeyW')) this._sprintLatch = false;
  }

  _toggleFlying() {
    this.flying = !this.flying;
    if (this.flying) this.velocity[1] = 0;
  }

  // ------------------------------------------------------------------ physics
  _integrate(h, wishX, wishZ, jump, down) {
    const v = this.velocity;
    let accel;
    if (this.flying) accel = ACCEL_FLY;
    else if (this.inWater || this.inLava) accel = ACCEL_LIQUID;
    else accel = this.onGround ? ACCEL_GROUND : ACCEL_AIR;
    const k = 1 - Math.exp(-accel * h);
    v[0] += (wishX - v[0]) * k;
    v[2] += (wishZ - v[2]) * k;

    if (this.flying) {
      const wishY = ((jump ? 1 : 0) - (down ? 1 : 0)) * FLY_VERTICAL;
      v[1] += (wishY - v[1]) * (1 - Math.exp(-12 * h));
    } else if (this.inWater || this.inLava) {
      const lava = this.inLava;
      let a = -WATER_SINK - (down ? 8 : 0);
      if (jump) a += lava ? WATER_SWIM_UP * 0.6 : WATER_SWIM_UP;
      v[1] += a * h;
      v[1] *= Math.exp(-(lava ? LAVA_DRAG : WATER_DRAG) * h);
      // At the surface, swimming into a bank climbs out of the water.
      if (jump && this._hitWall && !this.eyeInWater && !lava) v[1] = Math.max(v[1], WATER_CLIMB);
    } else {
      if (jump && this.onGround) {
        v[1] = JUMP_VELOCITY;
        this.onGround = false;
      }
      v[1] -= GRAVITY * h;
      v[1] *= Math.exp(-AIR_DRAG * h);
    }
  }

  /** Move by (dx,dy,dz) with per-axis collision, in sub-steps small enough not to tunnel. */
  _move(dx, dy, dz) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
    dx /= steps;
    dy /= steps;
    dz /= steps;
    for (let s = 0; s < steps; s++) {
      this._moveAxis(1, dy);
      let mx = dx, mz = dz;
      if (this.sneaking && this.onGround) {
        mx = this._edgeClamp(mx, 0);
        mz = this._edgeClamp(0, mz);
        if (mx !== 0 && mz !== 0 && !this._hasSupport(mx, mz)) mz = 0;
      }
      if (this._moveAxis(0, mx) !== mx) this._hitWall = true;
      if (this._moveAxis(2, mz) !== mz) this._hitWall = true;
    }
  }

  /** Shrink a sneaking step until the player keeps ground under their feet. */
  _edgeClamp(dx, dz) {
    let d = dx || dz;
    while (d !== 0 && !this._hasSupport(dx ? d : 0, dz ? d : 0)) {
      d = Math.abs(d) < 0.05 ? 0 : d - Math.sign(d) * 0.05;
    }
    return d;
  }

  _hasSupport(ox, oz) {
    const p = this.position;
    return this._boxHitsSolid(
      p[0] - HALF_W + ox, p[1] - SNEAK_PROBE, p[2] - HALF_W + oz,
      p[0] + HALF_W + ox, p[1], p[2] + HALF_W + oz, true,
    );
  }

  /**
   * Move along one axis (0 x, 1 y, 2 z); stops flush against solid blocks.
   * @returns {number} distance actually moved
   */
  _moveAxis(axis, d) {
    if (d === 0) return 0;
    const p = this.position;
    const min = [p[0] - HALF_W, p[1], p[2] - HALF_W];
    const max = [p[0] + HALF_W, p[1] + PLAYER_HEIGHT, p[2] + HALF_W];
    const a1 = axis === 0 ? 1 : 0, a2 = axis === 2 ? 1 : 2;
    const lo1 = Math.floor(min[a1] + EPS), hi1 = Math.floor(max[a1] - EPS);
    const lo2 = Math.floor(min[a2] + EPS), hi2 = Math.floor(max[a2] - EPS);
    // Cells entered by the leading face during this move.
    let c0, c1;
    if (d > 0) {
      c0 = Math.ceil(max[axis] - EPS);
      c1 = Math.ceil(max[axis] + d) - 1;
    } else {
      c0 = Math.floor(min[axis] + d);
      c1 = Math.floor(min[axis] + EPS) - 1;
    }
    let allowed = d;
    const cell = [0, 0, 0];
    const first = d > 0 ? c0 : c1, last = d > 0 ? c1 : c0, step = d > 0 ? 1 : -1;
    // Walk cells nearest-first so the first solid layer decides.
    for (let c = first; d > 0 ? c <= last : c >= last; c += step) {
      let hit = false;
      cell[axis] = c;
      for (let i = lo1; i <= hi1 && !hit; i++) {
        cell[a1] = i;
        for (let j = lo2; j <= hi2; j++) {
          cell[a2] = j;
          if (this._solid(cell[0], cell[1], cell[2], true)) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        allowed = d > 0 ? c - max[axis] : c + 1 - min[axis];
        break;
      }
    }
    p[axis] += allowed;
    if (allowed !== d) {
      this.velocity[axis] = 0;
      if (axis === 1 && d < 0) this.onGround = true;
    } else if (axis === 1) {
      this.onGround = false;
    }
    return allowed;
  }

  /** Solid for collision. Unloaded chunks count as solid while playing. */
  _solid(x, y, z, unloadedSolid) {
    if (y < 0) return true;
    if (y >= WORLD_HEIGHT) return false;
    if (!this.world.isLoaded(x, z)) return unloadedSolid;
    return IS_SOLID[this.world.getBlock(x, y, z)] === 1;
  }

  _boxHitsSolid(x0, y0, z0, x1, y1, z1, unloadedSolid) {
    const bx1 = Math.floor(x1 - EPS), by1 = Math.floor(y1 - EPS), bz1 = Math.floor(z1 - EPS);
    for (let y = Math.floor(y0 + EPS); y <= by1; y++) {
      for (let z = Math.floor(z0 + EPS); z <= bz1; z++) {
        for (let x = Math.floor(x0 + EPS); x <= bx1; x++) if (this._solid(x, y, z, unloadedSolid)) return true;
      }
    }
    return false;
  }

  _collides(unloadedSolid) {
    const p = this.position;
    return this._boxHitsSolid(p[0] - HALF_W, p[1], p[2] - HALF_W, p[0] + HALF_W, p[1] + PLAYER_HEIGHT, p[2] + HALF_W, unloadedSolid);
  }

  /** Which liquids the body and the eye are in. */
  _updateMedium() {
    const w = this.world, p = this.position;
    let water = false, lava = false;
    const y0 = Math.floor(p[1] + 0.1), y1 = Math.floor(p[1] + 0.9);
    for (let y = y0; y <= y1; y++) {
      for (let z = Math.floor(p[2] - HALF_W); z <= Math.floor(p[2] + HALF_W); z++) {
        for (let x = Math.floor(p[0] - HALF_W); x <= Math.floor(p[0] + HALF_W); x++) {
          const id = w.getBlock(x, y, z);
          if (id === BLOCK.water) water = true;
          else if (id === BLOCK.lava) lava = true;
        }
      }
    }
    this.inWater = water;
    this.inLava = lava;
    const ex = p[0], ey = p[1] + this._eyeHeight, ez = p[2];
    const id = w.getBlock(ex, ey, ez);
    // A liquid block's surface is 2/16 below its top unless more liquid sits above.
    const submerged = id !== 0 && (ey - Math.floor(ey) < 0.875 || w.getBlock(ex, ey + 1, ez) === id);
    this.eyeInWater = submerged && id === BLOCK.water;
    this.eyeInLava = submerged && id === BLOCK.lava;
  }

  // ------------------------------------------------------------------ feedback
  _sounds(wasOnGround, fallSpeed, wasInWater, x0, z0) {
    const audio = this.audio;
    if (!audio) return;
    const p = this.position;
    const pos = [p[0], p[1], p[2]];
    if (this.inWater && !wasInWater && fallSpeed < -3) audio.play('splash', { pos });
    const under = this._blockUnderFeet();
    if (this.onGround && !wasOnGround && fallSpeed < -7 && under) {
      audio.playBlock('land', BLOCKS[under].sound, pos);
    }
    if (this.onGround && !this.flying && !this.inWater) {
      this._stepDist += Math.hypot(p[0] - x0, p[2] - z0);
      const stride = this.sprinting ? 2.0 : 1.6;
      if (this._stepDist > stride) {
        this._stepDist = 0;
        if (under && !this.sneaking) audio.playBlock('step', BLOCKS[under].sound, pos);
      }
    }
  }

  _blockUnderFeet() {
    const p = this.position;
    const y = Math.floor(p[1] - 0.05);
    let id = this.world.getBlock(p[0], y, p[2]);
    if (IS_SOLID[id]) return id;
    // Standing on an edge: look under the corners of the box.
    for (const [ox, oz] of [[-HALF_W, -HALF_W], [HALF_W, -HALF_W], [-HALF_W, HALF_W], [HALF_W, HALF_W]]) {
      id = this.world.getBlock(p[0] + ox, y, p[2] + oz);
      if (IS_SOLID[id]) return id;
    }
    return 0;
  }

  _updateView(dt, settings, x0, z0) {
    const target = this.sneaking ? PLAYER_EYE_SNEAK : PLAYER_EYE;
    this._eyeHeight += (target - this._eyeHeight) * (1 - Math.exp(-12 * dt));
    const p = this.position;
    const moved = Math.hypot(p[0] - x0, p[2] - z0);
    const walking = settings.viewBobbing && this.onGround && !this.flying && !this.inWater;
    const ampTarget = walking ? Math.min(1, moved / Math.max(dt, 1e-4) / WALK) : 0;
    this._bobAmp += (ampTarget - this._bobAmp) * (1 - Math.exp(-10 * dt));
    if (walking) this._bobPhase += moved * 1.9;
    const a = this._bobAmp;
    const side = Math.cos(this._bobPhase) * 0.035 * a;
    this._bob[0] = Math.cos(this.yaw) * side;
    this._bob[1] = (Math.abs(Math.sin(this._bobPhase)) - 0.5) * 0.08 * a;
    this._bob[2] = -Math.sin(this.yaw) * side;
  }

  // ------------------------------------------------------------------ interaction
  _interact(dt) {
    const input = this.input;
    this.target = this.world.raycast(this.eyePosition(), forwardFromYawPitch(this.yaw, this.pitch), REACH);
    if (!input.enabled) {
      this.breakProgress = 0;
      return;
    }
    if (input.consumeClick(0)) {
      this._break();
      this._breakTimer = ACTION_REPEAT;
    } else if (input.mouseDown(0)) {
      this._breakTimer -= dt;
      if (this._breakTimer <= 0) {
        this._break();
        this._breakTimer = ACTION_REPEAT;
      }
    }
    this.breakProgress = input.mouseDown(0) && this.target ? clamp(1 - this._breakTimer / ACTION_REPEAT, 0, 1) : 0;

    if (input.consumeClick(2)) {
      this._place();
      this._placeTimer = ACTION_REPEAT;
    } else if (input.mouseDown(2)) {
      this._placeTimer -= dt;
      if (this._placeTimer <= 0) {
        this._place();
        this._placeTimer = ACTION_REPEAT;
      }
    }
    if (input.consumeClick(1)) this._pick();
  }

  _break() {
    const t = this.target;
    if (!t || BLOCKS[t.id].unbreakable) return;
    if (this.world.setBlock(t.x, t.y, t.z, 0)) {
      this.audio?.playBlock('break', BLOCKS[t.id].sound, [t.x + 0.5, t.y + 0.5, t.z + 0.5]);
    }
  }

  _place() {
    const t = this.target;
    const id = this.hotbar[this.selectedSlot];
    if (!t || !id) return;
    // Clicking a plant replaces it; otherwise build against the hit face.
    const [x, y, z] = IS_REPLACEABLE[t.id] && t.id !== id ? [t.x, t.y, t.z] : t.place;
    const w = this.world;
    const cur = w.getBlock(x, y, z);
    if (!IS_REPLACEABLE[cur] || cur === id || !w.canPlace(x, y, z, id)) return;
    if (IS_SOLID[id] && this._intersectsCell(x, y, z)) return;
    if (w.setBlock(x, y, z, id)) this.audio?.playBlock('place', BLOCKS[id].sound, [x + 0.5, y + 0.5, z + 0.5]);
  }

  _intersectsCell(x, y, z) {
    const p = this.position;
    return (
      p[0] + HALF_W > x && p[0] - HALF_W < x + 1 &&
      p[1] + PLAYER_HEIGHT > y && p[1] < y + 1 &&
      p[2] + HALF_W > z && p[2] - HALF_W < z + 1
    );
  }

  /** Middle click: put the targeted block in the hotbar (or select it if present). */
  _pick() {
    const t = this.target;
    if (!t) return;
    const id = t.id === BLOCK.tall_grass_top ? BLOCK.tall_grass : t.id;
    if (!INVENTORY_BLOCKS.includes(id)) return;
    const slot = this.hotbar.indexOf(id);
    if (slot >= 0) this.selectedSlot = slot;
    else this.hotbar[this.selectedSlot] = id;
  }
}
