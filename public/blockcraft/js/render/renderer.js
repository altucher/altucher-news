// Renderer: owns the WebGL2 context, shared render targets, block textures,
// chunk meshes and the frame uniforms, and runs the passes in order.
//
// Passes (render/passes/*.js) receive the renderer in their constructor and a
// per-frame `ctx` in render(ctx). They may register their own outputs in
// `renderer.targets` so later passes can read them (see ARCHITECTURE.md).

import {
  Framebuffer, FullscreenTriangle, createTexture2D, createTextureArray, blit,
} from './gl.js';
import { FrameUniforms } from './frame.js';
import { Camera } from './camera.js';
import { computeSkyState } from './sky.js';
import { mat4, sunDirection } from '../math.js';
import { MAX_QUADS, VERTEX_BYTES, CHUNK_SIZE, SECTION_SIZE } from '../config.js';
import { LAYER } from '../blocks.js';

import { ShadowPass } from './passes/shadow.js';
import { GBufferPass } from './passes/gbuffer.js';
import { SSAOPass } from './passes/ssao.js';
import { SkyPass } from './passes/sky.js';
import { CloudPass } from './passes/clouds.js';
import { DeferredPass } from './passes/deferred.js';
import { TranslucentPass } from './passes/translucent.js';
import { VolumetricPass } from './passes/volumetric.js';
import { TAAPass } from './passes/taa.js';
import { BloomPass } from './passes/bloom.js';
import { ExposurePass } from './passes/exposure.js';
import { FinalPass } from './passes/final.js';

const MAX_INTERNAL_PIXELS = 1920 * 1200 * 1.15;

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} settings (see DEFAULT_SETTINGS in config.js)
   */
  constructor(canvas, settings) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const cbf = gl.getExtension('EXT_color_buffer_float');
    const cbhf = gl.getExtension('EXT_color_buffer_half_float');
    if (!cbf && !cbhf) throw new Error('This GPU/browser cannot render to floating-point targets (EXT_color_buffer_float).');
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('EXT_float_blend');
    this.anisotropy = !!gl.getExtension('EXT_texture_filter_anisotropic');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

    this.settings = { ...settings };
    this.frame = new FrameUniforms(gl);
    this.camera = new Camera();
    this.fullscreen = new FullscreenTriangle(gl);
    this.targets = {};
    this.fbos = {};
    this.textures = null; // { albedo, normal, specular } texture arrays
    this.chunks = new Map(); // key -> { cx, cz, sections: [...] }
    this.frameIndex = 0;
    this.width = 1;
    this.height = 1;
    this.stats = { drawCalls: 0, triangles: 0, sections: 0, frameMs: 0 };
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });

    this._createNeutralTextures();
    this._createQuadIndexBuffer();

    // A pass that throws (e.g. a shader that fails to compile on some GPU) is
    // disabled and reported instead of taking the whole frame down.
    this.failedPasses = new Map(); // name -> error message
    const PASSES = {
      shadow: ShadowPass, gbuffer: GBufferPass, ssao: SSAOPass, sky: SkyPass, clouds: CloudPass,
      deferred: DeferredPass, translucent: TranslucentPass, volumetric: VolumetricPass, taa: TAAPass,
      bloom: BloomPass, exposure: ExposurePass, final: FinalPass,
    };
    this.passes = {};
    for (const [name, Cls] of Object.entries(PASSES)) {
      try {
        this.passes[name] = new Cls(this);
      } catch (e) {
        this._passFailed(name, e);
      }
    }
    this.applySettings(this.settings);
    this._resize(true);
  }

  // ------------------------------------------------------------------ setup
  _createNeutralTextures() {
    const gl = this.gl;
    const px = (r, g, b, a) => new Uint8Array([r, g, b, a]);
    this.white = createTexture2D(gl, 1, 1, gl.RGBA8, { data: px(255, 255, 255, 255), filter: 'nearest' });
    this.black = createTexture2D(gl, 1, 1, gl.RGBA8, { data: px(0, 0, 0, 0), filter: 'nearest' });
    this.blackOpaque = createTexture2D(gl, 1, 1, gl.RGBA8, { data: px(0, 0, 0, 255), filter: 'nearest' });
    // 1×1 depth texture at depth 1.0 → every shadow lookup is "lit".
    this.shadowDummy = createTexture2D(gl, 1, 1, gl.DEPTH_COMPONENT32F, { filter: 'nearest', compare: true });
    const fb = new Framebuffer(gl, [], this.shadowDummy, { label: 'shadowDummy' });
    fb.bind();
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fb.dispose();
  }

  _createQuadIndexBuffer() {
    const gl = this.gl;
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0, i = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      idx[i++] = v; idx[i++] = v + 1; idx[i++] = v + 2;
      idx[i++] = v; idx[i++] = v + 2; idx[i++] = v + 3;
    }
    this.quadIndexBuffer = gl.createBuffer();
    // Bind through a throwaway VAO so the default VAO state stays clean.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    gl.deleteVertexArray(vao);
  }

  /**
   * Upload block textures produced by textures.js.
   * @param {{size:number, layers:number, albedo:Uint8Array, normal:Uint8Array, specular:Uint8Array}} t
   */
  setTextures(t) {
    const gl = this.gl;
    if (this.textures) for (const k in this.textures) this.textures[k].dispose();
    const common = { mips: true, wrap: 'repeat', magFilter: gl.NEAREST, minFilter: gl.LINEAR_MIPMAP_LINEAR };
    this.textures = {
      albedo: createTextureArray(gl, t.size, t.size, t.layers, gl.SRGB8_ALPHA8, { ...common, data: t.albedo, anisotropy: 8 }),
      normal: createTextureArray(gl, t.size, t.size, t.layers, gl.RGBA8, { ...common, data: t.normal, anisotropy: 8 }),
      specular: createTextureArray(gl, t.size, t.size, t.layers, gl.RGBA8, { ...common, data: t.specular, anisotropy: 8 }),
    };
    this.textureSize = t.size;
    this.textureLayers = t.layers;
  }

  // ------------------------------------------------------------------ settings & size
  applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
    for (const [name, p] of Object.entries(this.passes)) {
      if (!p.onSettings) continue;
      try {
        p.onSettings(this.settings);
      } catch (e) {
        this._passFailed(name, e);
      }
    }
    this._resize(true);
  }

  _passFailed(name, e) {
    console.error(`[renderer] pass "${name}" failed and was disabled:`, e);
    this.failedPasses.set(name, String(e && e.message ? e.message : e));
    delete this.passes[name];
  }

  /** Run pass `name` if it exists; disable it if it throws. */
  _run(name, ctx) {
    const p = this.passes[name];
    if (!p) return;
    try {
      p.render(ctx);
    } catch (e) {
      this._passFailed(name, e);
    }
  }

  _computeSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const cw = Math.max(1, Math.round(cssW * dpr));
    const ch = Math.max(1, Math.round(cssH * dpr));
    let scale = this.settings.renderScale || 1;
    const area = cw * ch * scale * scale;
    if (area > MAX_INTERNAL_PIXELS) scale *= Math.sqrt(MAX_INTERNAL_PIXELS / area);
    return { cw, ch, w: Math.max(2, Math.round(cw * scale)), h: Math.max(2, Math.round(ch * scale)) };
  }

  _resize(force = false) {
    const { cw, ch, w, h } = this._computeSize();
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this._createMainTargets();
    for (const [name, p] of Object.entries(this.passes)) {
      try {
        p.resize(w, h);
      } catch (e) {
        this._passFailed(name, e);
      }
    }
    this.camera.resetHistory();
  }

  _createMainTargets() {
    const gl = this.gl;
    const { width: w, height: h } = this;
    const names = ['gAlbedo', 'gNormal', 'gMaterial', 'gSpecular', 'depth', 'opaqueDepth', 'sceneHDR', 'sceneCopy'];
    for (const n of names) if (this.targets[n]) this.targets[n].dispose();
    for (const k of ['gbuffer', 'scene', 'sceneDepth', 'sceneCopy', 'opaqueDepth', 'depthOnly']) {
      if (this.fbos[k]) this.fbos[k].dispose();
    }
    const T = this.targets;
    const nearest = { filter: 'nearest' };
    T.gAlbedo = createTexture2D(gl, w, h, gl.SRGB8_ALPHA8, nearest);
    T.gNormal = createTexture2D(gl, w, h, gl.RGBA16F, nearest);
    T.gMaterial = createTexture2D(gl, w, h, gl.RGBA8, nearest);
    T.gSpecular = createTexture2D(gl, w, h, gl.RGBA8, nearest);
    T.depth = createTexture2D(gl, w, h, gl.DEPTH_COMPONENT32F, nearest);
    T.opaqueDepth = createTexture2D(gl, w, h, gl.DEPTH_COMPONENT32F, nearest);
    T.sceneHDR = createTexture2D(gl, w, h, gl.RGBA16F, { filter: 'linear' });
    T.sceneCopy = createTexture2D(gl, w, h, gl.RGBA16F, { filter: 'linear' });

    const F = this.fbos;
    F.gbuffer = new Framebuffer(gl, [T.gAlbedo, T.gNormal, T.gMaterial, T.gSpecular], T.depth, { label: 'gbuffer' });
    F.scene = new Framebuffer(gl, [T.sceneHDR], null, { label: 'scene' });
    F.sceneDepth = new Framebuffer(gl, [T.sceneHDR], T.depth, { label: 'sceneDepth' });
    F.sceneCopy = new Framebuffer(gl, [T.sceneCopy], null, { label: 'sceneCopy' });
    F.opaqueDepth = new Framebuffer(gl, [], T.opaqueDepth, { label: 'opaqueDepth' });
    F.depthOnly = new Framebuffer(gl, [], T.depth, { label: 'depthOnly' });
  }

  /**
   * Resolve a named input honouring disabled features (neutral textures instead).
   * names: ssao, clouds, volumetric, shadowMap, shadowMapWater, bloom, resolved, skyLUT, exposure
   */
  input(name) {
    const s = this.settings;
    const T = this.targets;
    switch (name) {
      case 'ssao': return s.ssao && T.ssao ? T.ssao : this.white;
      case 'clouds': return s.clouds && T.clouds ? T.clouds : this.blackOpaque;
      case 'volumetric': return s.volumetricLight && T.volumetric ? T.volumetric : this.blackOpaque;
      case 'shadowMap': return s.shadows && T.shadowMap ? T.shadowMap : this.shadowDummy;
      case 'shadowMapWater': return s.shadows && T.shadowMapWater ? T.shadowMapWater : this.shadowDummy;
      case 'bloom': return s.bloom && T.bloom ? T.bloom : this.black;
      case 'resolved': return s.taa && T.taaOutput && this.passes.taa ? T.taaOutput : T.sceneHDR;
      default: return T[name] || this.black;
    }
  }

  // ------------------------------------------------------------------ chunk meshes
  hasChunk(cx, cz) {
    return this.chunks.has(cx + ',' + cz);
  }

  /**
   * Replace every section mesh of a chunk.
   * @param {Array<{sy:number, opaque:ArrayBuffer|null, cutout:ArrayBuffer|null, translucent:ArrayBuffer|null}>} sections
   */
  setChunkMesh(cx, cz, sections) {
    const gl = this.gl;
    this.removeChunk(cx, cz);
    const chunk = { cx, cz, sections: [] };
    for (const s of sections) {
      const sec = { sy: s.sy, layers: [null, null, null, null] };
      let any = false;
      const src = [null, s.opaque, s.cutout, s.translucent];
      for (let L = LAYER.OPAQUE; L <= LAYER.TRANSLUCENT; L++) {
        const data = src[L];
        if (!data || data.byteLength === 0) continue;
        const verts = data.byteLength / VERTEX_BYTES;
        const vao = gl.createVertexArray();
        const vbo = gl.createBuffer();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, data instanceof ArrayBuffer ? new Uint8Array(data) : data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_SHORT, VERTEX_BYTES, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_BYTE, VERTEX_BYTES, 8);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, VERTEX_BYTES, 12);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndexBuffer);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        sec.layers[L] = { vao, vbo, count: (verts / 4) * 6 };
        any = true;
      }
      if (any) chunk.sections.push(sec);
    }
    this.chunks.set(cx + ',' + cz, chunk);
  }

  removeChunk(cx, cz) {
    const key = cx + ',' + cz;
    const c = this.chunks.get(key);
    if (!c) return;
    const gl = this.gl;
    for (const s of c.sections) {
      for (const l of s.layers) {
        if (!l) continue;
        gl.deleteVertexArray(l.vao);
        gl.deleteBuffer(l.vbo);
      }
    }
    this.chunks.delete(key);
  }

  clearChunks() {
    for (const c of [...this.chunks.values()]) this.removeChunk(c.cx, c.cz);
  }

  /** Visibility test against the main camera (camera-relative AABB). */
  cameraVisible = (x0, y0, z0, x1, y1, z1) => this.camera.aabbVisible(x0, y0, z0, x1, y1, z1);

  /** Visibility test against the shadow frustum (camera-relative AABB). */
  shadowVisible = (x0, y0, z0, x1, y1, z1) => {
    const m = this.shadowViewProj;
    const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5, cz = (z0 + z1) * 0.5;
    const ex = (x1 - x0) * 0.5, ey = (y1 - y0) * 0.5, ez = (z1 - z0) * 0.5;
    for (let r = 0; r < 3; r++) {
      const c = m[r] * cx + m[4 + r] * cy + m[8 + r] * cz + m[12 + r];
      const e = Math.abs(m[r]) * ex + Math.abs(m[4 + r]) * ey + Math.abs(m[8 + r]) * ez;
      if (c - e > 1 || c + e < -1) return false;
    }
    return true;
  };

  /**
   * Draw every visible section of one layer with `program` (already in use).
   * Sets `u_chunkOffset` (vec3, camera-relative chunk origin) per section.
   * @param {number} layer LAYER.OPAQUE | LAYER.CUTOUT | LAYER.TRANSLUCENT
   * @param {import('./gl.js').Program} program
   * @param {(x0,y0,z0,x1,y1,z1)=>boolean} visible culling test (camera-relative)
   * @param {'front'|'back'|null} sort front-to-back, back-to-front or none
   */
  drawChunks(layer, program, visible = this.cameraVisible, sort = 'front') {
    const gl = this.gl;
    const cam = this.camera.position;
    const loc = program.loc('u_chunkOffset');
    const list = this._drawList || (this._drawList = []);
    list.length = 0;
    for (const c of this.chunks.values()) {
      const ox = c.cx * CHUNK_SIZE - cam[0];
      const oz = c.cz * CHUNK_SIZE - cam[2];
      for (const s of c.sections) {
        const l = s.layers[layer];
        if (!l) continue;
        const oy = s.sy * SECTION_SIZE - cam[1];
        if (!visible(ox, oy, oz, ox + CHUNK_SIZE, oy + SECTION_SIZE, oz + CHUNK_SIZE)) continue;
        const dx = ox + 8, dy = oy + 8, dz = oz + 8;
        list.push({ l, ox, oy: -cam[1], oz, d: dx * dx + dy * dy + dz * dz });
      }
    }
    if (sort === 'front') list.sort((a, b) => a.d - b.d);
    else if (sort === 'back') list.sort((a, b) => b.d - a.d);
    for (const it of list) {
      if (loc) gl.uniform3f(loc, it.ox, it.oy, it.oz);
      gl.bindVertexArray(it.l.vao);
      gl.drawElements(gl.TRIANGLES, it.l.count, gl.UNSIGNED_SHORT, 0);
      this.stats.drawCalls++;
      this.stats.triangles += it.l.count / 3;
    }
    gl.bindVertexArray(null);
    return list.length;
  }

  // ------------------------------------------------------------------ frame
  _updateShadowMatrices(lightDir) {
    const s = this.settings;
    const half = s.shadowDistance || 128;
    const range = 512;
    // Snap the shadow camera to a 2-block grid in absolute space to limit shimmer.
    const cam = this.camera.position;
    const snap = 2;
    const center = [
      Math.round(cam[0] / snap) * snap - cam[0],
      Math.round(cam[1] / snap) * snap - cam[1],
      Math.round(cam[2] / snap) * snap - cam[2],
    ];
    const eye = [center[0] + lightDir[0] * range * 0.5, center[1] + lightDir[1] * range * 0.5, center[2] + lightDir[2] * range * 0.5];
    const up = Math.abs(lightDir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    const view = this._shadowView || (this._shadowView = mat4.create());
    const proj = this._shadowProj || (this._shadowProj = mat4.create());
    this.shadowViewProj = this.shadowViewProj || mat4.create();
    mat4.lookAt(view, eye, center, up);
    mat4.ortho(proj, -half, half, -half, half, 0, range);
    mat4.multiply(this.shadowViewProj, proj, view);
    this.shadowInfo = { half, range, center, lightDir, size: s.shadowMapSize || 2048 };
  }

  _fillFrame(view, sky) {
    const f = this.frame;
    const cam = this.camera;
    f.setMat('u_view', cam.view);
    f.setMat('u_proj', cam.proj);
    f.setMat('u_viewProj', cam.viewProj);
    f.setMat('u_invView', cam.invView);
    f.setMat('u_invProj', cam.invProj);
    f.setMat('u_invViewProj', cam.invViewProj);
    f.setMat('u_prevViewProj', cam.prevViewProj);
    f.setMat('u_viewProjUnjittered', cam.viewProjUnjittered);
    f.setMat('u_shadowViewProj', this.shadowViewProj);
    const p = cam.position;
    f.set('u_cameraPos', p[0], p[1], p[2], (view.timeSeconds || 0) % 3600);
    const sd = sky.sunDir;
    f.set('u_sunDir', sd[0], sd[1], sd[2], sky.daylight);
    f.set('u_moonDir', -sd[0], -sd[1], -sd[2], sky.moonBrightness);
    const ld = sky.lightDir;
    f.set('u_lightDir', ld[0], ld[1], ld[2], sky.lightIsSun ? 1 : 0);
    f.set('u_sunColor', sky.lightColor[0], sky.lightColor[1], sky.lightColor[2], 0);
    f.set('u_skyAmbient', sky.skyAmbient[0], sky.skyAmbient[1], sky.skyAmbient[2], 0);
    f.set('u_fogColor', sky.fogColor[0], sky.fogColor[1], sky.fogColor[2], sky.fogDensity);
    f.set('u_resolution', this.width, this.height, 1 / this.width, 1 / this.height);
    f.set('u_jitter', cam.jitter[0], cam.jitter[1], cam.prevJitter[0], cam.prevJitter[1]);
    f.set('u_params', this.frameIndex, view.rain || 0, view.underwater ? 1 : 0, cam.near);
    f.set('u_params2', cam.far, (this.settings.renderDistance || 8) * CHUNK_SIZE, sky.cloudCoverage ?? 0.45, view.inLava ? 1 : 0);
    f.set('u_cameraDelta', cam.delta[0], cam.delta[1], cam.delta[2], view.dt || 0.016);
    const si = this.shadowInfo;
    f.set('u_shadowParams', si.half, si.size, 1 / si.size, si.range);
    f.set('u_dayParams', view.dayFraction, sky.night, sky.moonPhase ?? 0, sky.sunset);
    f.upload();
  }

  /**
   * Render one frame.
   * @param {object} view see ARCHITECTURE.md
   */
  render(view) {
    if (this.lost || !this.textures) return;
    const t0 = performance.now();
    const gl = this.gl;
    this._resize();
    const s = this.settings;
    this.stats.drawCalls = 0;
    this.stats.triangles = 0;

    this.camera.update(view.camPos, view.yaw, view.pitch, view.fov, this.width, this.height, !!s.taa);
    const sunDir = sunDirection(view.dayFraction);
    const sky = computeSkyState(view.dayFraction, sunDir, view.rain || 0);
    sky.sunDir = sunDir;
    this._updateShadowMatrices(sky.lightDir);
    this._fillFrame(view, sky);

    const ctx = {
      view,
      settings: s,
      camera: this.camera,
      frame: this.frame,
      sky,
      shadow: this.shadowInfo,
      time: view.timeSeconds || 0,
      frameIndex: this.frameIndex,
      width: this.width,
      height: this.height,
    };

    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
    if (s.shadows) this._run('shadow', ctx);
    this._run('gbuffer', ctx);
    if (s.ssao) this._run('ssao', ctx);
    this._run('sky', ctx);
    if (s.clouds) this._run('clouds', ctx);
    this._run('deferred', ctx);

    // Snapshot opaque colour + depth for refraction / SSR / water absorption.
    blit(gl, this.fbos.scene, this.fbos.sceneCopy, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    blit(gl, this.fbos.depthOnly, this.fbos.opaqueDepth, gl.DEPTH_BUFFER_BIT, gl.NEAREST);

    this._run('translucent', ctx);
    this._run('volumetric', ctx); // also applies underwater/lava fog when VL is off
    if (s.taa) this._run('taa', ctx);
    if (s.bloom) this._run('bloom', ctx);
    this._run('exposure', ctx);
    this._run('final', ctx);

    gl.bindVertexArray(null);
    this.frameIndex++;
    this.stats.frameMs = performance.now() - t0;
  }

  dispose() {
    this.clearChunks();
    for (const p of Object.values(this.passes)) p.dispose && p.dispose();
    for (const t of Object.values(this.targets)) t && t.dispose && t.dispose();
    for (const f of Object.values(this.fbos)) f && f.dispose && f.dispose();
  }
}
