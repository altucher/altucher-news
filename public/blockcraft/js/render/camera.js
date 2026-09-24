// Camera: camera-relative view/projection matrices, TAA jitter, frustum culling.

import { mat4 } from '../math.js';
import { NEAR_PLANE, FAR_PLANE } from '../config.js';

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}
const JITTER_COUNT = 16;
const JITTER = [];
for (let i = 0; i < JITTER_COUNT; i++) JITTER.push([halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

export class Camera {
  constructor() {
    this.position = [0, 0, 0]; // absolute (double precision)
    this.prevPosition = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.fov = (75 * Math.PI) / 180;
    this.aspect = 1;
    this.near = NEAR_PLANE;
    this.far = FAR_PLANE;
    this.jitter = [0, 0]; // NDC units
    this.prevJitter = [0, 0];
    this.frame = 0;

    this.view = mat4.create();
    this.proj = mat4.create();
    this.projUnjittered = mat4.create();
    this.viewProj = mat4.create();
    this.viewProjUnjittered = mat4.create();
    this.invView = mat4.create();
    this.invProj = mat4.create();
    this.invViewProj = mat4.create();
    this.prevViewProjUnjittered = mat4.create(); // previous frame, its own camera-relative space
    this.prevViewProj = mat4.create(); // previous frame mapped from *current* camera-relative space
    this.frustum = new Float32Array(24); // 6 planes (a,b,c,d), camera-relative
    this._tmp = mat4.create();
    this._first = true;
  }

  /**
   * Update matrices for a new frame.
   * @param {number[]} pos absolute eye position
   * @param {number} yaw
   * @param {number} pitch
   * @param {number} fov vertical radians
   * @param {number} width internal render width (pixels)
   * @param {number} height internal render height
   * @param {boolean} jitterEnabled TAA jitter on/off
   */
  update(pos, yaw, pitch, fov, width, height, jitterEnabled) {
    // Store last frame's state.
    mat4.copy(this.prevViewProjUnjittered, this.viewProjUnjittered);
    this.prevPosition[0] = this.position[0];
    this.prevPosition[1] = this.position[1];
    this.prevPosition[2] = this.position[2];
    this.prevJitter[0] = this.jitter[0];
    this.prevJitter[1] = this.jitter[1];

    this.position[0] = pos[0];
    this.position[1] = pos[1];
    this.position[2] = pos[2];
    this.yaw = yaw;
    this.pitch = pitch;
    this.fov = fov;
    this.aspect = width / Math.max(1, height);
    this.frame++;

    mat4.fromYawPitchView(this.view, yaw, pitch);
    mat4.invert(this.invView, this.view);
    mat4.perspective(this.projUnjittered, fov, this.aspect, this.near, this.far);
    mat4.copy(this.proj, this.projUnjittered);
    if (jitterEnabled) {
      const j = JITTER[this.frame % JITTER_COUNT];
      this.jitter[0] = (j[0] * 2) / width;
      this.jitter[1] = (j[1] * 2) / height;
      // Shift NDC by +jitter: clip.xy += jitter * w, and w = -z_view, so the
      // z-column coefficients get -jitter.
      this.proj[8] -= this.jitter[0];
      this.proj[9] -= this.jitter[1];
    } else {
      this.jitter[0] = this.jitter[1] = 0;
    }
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.multiply(this.viewProjUnjittered, this.projUnjittered, this.view);
    mat4.invert(this.invProj, this.proj);
    mat4.invert(this.invViewProj, this.viewProj);

    if (this._first) {
      mat4.copy(this.prevViewProjUnjittered, this.viewProjUnjittered);
      this.prevPosition[0] = pos[0];
      this.prevPosition[1] = pos[1];
      this.prevPosition[2] = pos[2];
      this._first = false;
    }
    // prevViewProj takes a *current* camera-relative position:
    // prevRel = rel + (cur - prev)  →  prevViewProj = prevVPU * T(cur - prev)
    const d = [
      this.position[0] - this.prevPosition[0],
      this.position[1] - this.prevPosition[1],
      this.position[2] - this.prevPosition[2],
    ];
    mat4.translate(this.prevViewProj, this.prevViewProjUnjittered, d);
    this.delta = d;

    this._extractFrustum(this.viewProjUnjittered);
  }

  /** Reset temporal history (teleport, resize). */
  resetHistory() {
    this._first = true;
  }

  _extractFrustum(m) {
    const p = this.frustum;
    // left, right, bottom, top, near, far
    const rows = [
      [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
      [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
      [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
      [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
      [m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
      [m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
    ];
    for (let i = 0; i < 6; i++) {
      const r = rows[i];
      const l = Math.hypot(r[0], r[1], r[2]) || 1;
      p[i * 4] = r[0] / l;
      p[i * 4 + 1] = r[1] / l;
      p[i * 4 + 2] = r[2] / l;
      p[i * 4 + 3] = r[3] / l;
    }
  }

  /** Is a camera-relative AABB (min/max) at least partially inside the frustum? */
  aabbVisible(minX, minY, minZ, maxX, maxY, maxZ) {
    const p = this.frustum;
    for (let i = 0; i < 6; i++) {
      const a = p[i * 4], b = p[i * 4 + 1], c = p[i * 4 + 2], d = p[i * 4 + 3];
      const x = a >= 0 ? maxX : minX;
      const y = b >= 0 ? maxY : minY;
      const z = c >= 0 ? maxZ : minZ;
      if (a * x + b * y + c * z + d < 0) return false;
    }
    return true;
  }
}
