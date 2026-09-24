// WebGL2 helpers: program building (with shared GLSL prelude), textures,
// framebuffers and a fullscreen triangle. Every pass uses these.

import { COMMON_GLSL } from './shaders/common.js';

const PRECISION = `precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
precision highp sampler3D;
precision highp sampler2DShadow;
precision highp usampler2D;
`;

/**
 * Build the final GLSL source: version, defines, precision, common prelude, body.
 * @param {string} body
 * @param {Record<string, string|number|boolean>} defines
 * @param {boolean} includeCommon
 */
export function buildSource(body, defines = {}, includeCommon = true) {
  let head = '#version 300 es\n';
  for (const [k, v] of Object.entries(defines)) {
    if (v === false || v === undefined || v === null) continue;
    head += v === true ? `#define ${k}\n` : `#define ${k} ${v}\n`;
  }
  return head + PRECISION + (includeCommon ? COMMON_GLSL : '') + '\n#line 1\n' + body;
}

function annotate(src, log) {
  const lines = src.split('\n');
  // Find the '#line 1' marker so error line numbers map to the body.
  const marker = lines.findIndex((l) => l.startsWith('#line 1'));
  const out = [];
  const re = /ERROR:\s*\d+:(\d+):/g;
  let m;
  while ((m = re.exec(log))) {
    const n = parseInt(m[1], 10);
    const idx = marker >= 0 ? marker + n : n - 1;
    out.push(`  line ${n}: ${(lines[idx] || '').trim()}`);
  }
  return out.join('\n');
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '';
    gl.deleteShader(sh);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`[${label}] ${kind} shader compile error:\n${log}\n${annotate(src, log)}`);
  }
  return sh;
}

/**
 * A linked program with cached uniform locations and helpers.
 */
export class Program {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {string} vsBody vertex shader body (no #version / prelude)
   * @param {string} fsBody fragment shader body
   * @param {{defines?: object, label?: string, common?: boolean}} opts
   */
  constructor(gl, vsBody, fsBody, opts = {}) {
    const label = opts.label || 'program';
    const common = opts.common !== false;
    const defines = opts.defines || {};
    this.gl = gl;
    this.label = label;
    const vs = compile(gl, gl.VERTEX_SHADER, buildSource(vsBody, defines, common), label);
    const fs = compile(gl, gl.FRAGMENT_SHADER, buildSource(fsBody, defines, common), label);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(`[${label}] link error:\n${log}`);
    }
    this.program = p;
    this.uniforms = new Map();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      this.uniforms.set(name, { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size });
    }
    // Bind the Frame UBO if the program uses it.
    const blockIndex = gl.getUniformBlockIndex(p, 'Frame');
    if (blockIndex !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, blockIndex, 0);
    this._unit = 0;
  }

  use() {
    this.gl.useProgram(this.program);
    this._unit = 0;
    return this;
  }

  has(name) {
    return this.uniforms.has(name);
  }

  loc(name) {
    const u = this.uniforms.get(name);
    return u ? u.loc : null;
  }

  /** Bind a texture to the next free unit and point the sampler uniform at it. */
  tex(name, texture, target) {
    const u = this.uniforms.get(name);
    if (!u) return this; // uniform optimised out: ignore
    const gl = this.gl;
    const unit = this._unit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target || texture.target || gl.TEXTURE_2D, texture.handle || texture);
    gl.uniform1i(u.loc, unit);
    return this;
  }

  f(name, x) { const l = this.loc(name); if (l) this.gl.uniform1f(l, x); return this; }
  i(name, x) { const l = this.loc(name); if (l) this.gl.uniform1i(l, x); return this; }
  v2(name, x, y) { const l = this.loc(name); if (l) this.gl.uniform2f(l, x, y); return this; }
  v3(name, x, y, z) { const l = this.loc(name); if (l) this.gl.uniform3f(l, x, y, z); return this; }
  v4(name, x, y, z, w) { const l = this.loc(name); if (l) this.gl.uniform4f(l, x, y, z, w); return this; }
  v2a(name, a) { const l = this.loc(name); if (l) this.gl.uniform2fv(l, a); return this; }
  v3a(name, a) { const l = this.loc(name); if (l) this.gl.uniform3fv(l, a); return this; }
  v4a(name, a) { const l = this.loc(name); if (l) this.gl.uniform4fv(l, a); return this; }
  m4(name, m) { const l = this.loc(name); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }

  dispose() {
    this.gl.deleteProgram(this.program);
  }
}

/**
 * Texture wrapper: {handle, target, width, height, depth, internalFormat}.
 * Use createTexture2D / createTextureArray / createTexture3D.
 */
export class Texture {
  constructor(gl, target, handle, width, height, depth, internalFormat) {
    this.gl = gl;
    this.target = target;
    this.handle = handle;
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.internalFormat = internalFormat;
  }
  dispose() {
    this.gl.deleteTexture(this.handle);
  }
}

/** internalFormat → [format, type] for texImage/texStorage uploads. */
export function formatInfo(gl, internalFormat) {
  switch (internalFormat) {
    case gl.RGBA8: return [gl.RGBA, gl.UNSIGNED_BYTE];
    case gl.SRGB8_ALPHA8: return [gl.RGBA, gl.UNSIGNED_BYTE];
    case gl.R8: return [gl.RED, gl.UNSIGNED_BYTE];
    case gl.RG8: return [gl.RG, gl.UNSIGNED_BYTE];
    case gl.RGBA16F: return [gl.RGBA, gl.HALF_FLOAT];
    case gl.RGB16F: return [gl.RGB, gl.HALF_FLOAT];
    case gl.RG16F: return [gl.RG, gl.HALF_FLOAT];
    case gl.R16F: return [gl.RED, gl.HALF_FLOAT];
    case gl.RGBA32F: return [gl.RGBA, gl.FLOAT];
    case gl.R32F: return [gl.RED, gl.FLOAT];
    case gl.R11F_G11F_B10F: return [gl.RGB, gl.HALF_FLOAT];
    case gl.DEPTH_COMPONENT32F: return [gl.DEPTH_COMPONENT, gl.FLOAT];
    case gl.DEPTH_COMPONENT24: return [gl.DEPTH_COMPONENT, gl.UNSIGNED_INT];
    case gl.DEPTH24_STENCIL8: return [gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8];
    default: throw new Error('unknown internal format ' + internalFormat);
  }
}

function isDepthFormat(gl, f) {
  return f === gl.DEPTH_COMPONENT32F || f === gl.DEPTH_COMPONENT24 || f === gl.DEPTH24_STENCIL8;
}

/**
 * Create a 2D texture.
 * opts: { filter: 'linear'|'nearest', wrap: 'clamp'|'repeat'|'mirror', mips: bool,
 *         data: ArrayBufferView|null, compare: bool (depth compare mode for sampler2DShadow) }
 */
export function createTexture2D(gl, width, height, internalFormat, opts = {}) {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, handle);
  const levels = opts.mips ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, internalFormat, width, height);
  if (opts.data) {
    const [format, type] = formatInfo(gl, internalFormat);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, format, type, opts.data);
  }
  setSampling(gl, gl.TEXTURE_2D, opts, levels > 1);
  if (opts.compare && isDepthFormat(gl, internalFormat)) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  }
  if (opts.mips && opts.data) gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const t = new Texture(gl, gl.TEXTURE_2D, handle, width, height, 1, internalFormat);
  t.levels = levels;
  return t;
}

/** Create a 2D texture array (block textures). data is layer-major. */
export function createTextureArray(gl, width, height, layers, internalFormat, opts = {}) {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
  const levels = opts.mips ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, internalFormat, width, height, layers);
  if (opts.data) {
    const [format, type] = formatInfo(gl, internalFormat);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, width, height, layers, format, type, opts.data);
  }
  setSampling(gl, gl.TEXTURE_2D_ARRAY, opts, levels > 1);
  if (opts.anisotropy) {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) {
      const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(max, opts.anisotropy));
    }
  }
  if (opts.mips && opts.data && opts.generateMips !== false) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  const t = new Texture(gl, gl.TEXTURE_2D_ARRAY, handle, width, height, layers, internalFormat);
  t.levels = levels;
  return t;
}

/** Create a 3D texture (e.g. cloud noise). */
export function createTexture3D(gl, w, h, d, internalFormat, opts = {}) {
  const handle = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, handle);
  const levels = opts.mips ? Math.floor(Math.log2(Math.max(w, h, d))) + 1 : 1;
  gl.texStorage3D(gl.TEXTURE_3D, levels, internalFormat, w, h, d);
  if (opts.data) {
    const [format, type] = formatInfo(gl, internalFormat);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, w, h, d, format, type, opts.data);
  }
  setSampling(gl, gl.TEXTURE_3D, { wrap: 'repeat', ...opts }, levels > 1);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, wrapMode(gl, opts.wrap || 'repeat'));
  if (opts.mips && opts.data) gl.generateMipmap(gl.TEXTURE_3D);
  gl.bindTexture(gl.TEXTURE_3D, null);
  return new Texture(gl, gl.TEXTURE_3D, handle, w, h, d, internalFormat);
}

function wrapMode(gl, w) {
  return w === 'repeat' ? gl.REPEAT : w === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
}

function setSampling(gl, target, opts, hasMips) {
  const linear = opts.filter !== 'nearest';
  let minFilter;
  if (opts.minFilter) minFilter = opts.minFilter;
  else if (hasMips) minFilter = linear ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_LINEAR;
  else minFilter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, opts.magFilter || (linear ? gl.LINEAR : gl.NEAREST));
  const w = wrapMode(gl, opts.wrap || 'clamp');
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, w);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, w);
}

/**
 * Framebuffer wrapper.
 * colors: Texture[] (attached to COLOR_ATTACHMENT0..n), depth: Texture|null.
 * Use `level`/`layer` options for mip or layered attachments.
 */
export class Framebuffer {
  constructor(gl, colors = [], depth = null, opts = {}) {
    this.gl = gl;
    this.handle = gl.createFramebuffer();
    this.colors = colors;
    this.depth = depth;
    this.level = opts.level || 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.handle);
    const bufs = [];
    colors.forEach((t, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.handle, this.level);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    });
    if (depth) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.handle, 0);
    }
    gl.drawBuffers(bufs.length ? bufs : [gl.NONE]);
    if (!bufs.length) gl.readBuffer(gl.NONE);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`[${opts.label || 'fbo'}] incomplete framebuffer 0x${status.toString(16)}`);
    }
    const src = colors[0] || depth;
    this.width = Math.max(1, (src ? src.width : 1) >> this.level);
    this.height = Math.max(1, (src ? src.height : 1) >> this.level);
  }

  /** Bind for drawing and set the viewport to the attachment size. */
  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.handle);
    gl.viewport(0, 0, this.width, this.height);
    return this;
  }

  dispose() {
    this.gl.deleteFramebuffer(this.handle);
  }
}

/** Bind the default framebuffer (canvas). */
export function bindScreen(gl) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

/**
 * Fullscreen triangle. The vertex shader FULLSCREEN_VS (below) derives the
 * position from gl_VertexID, so no attributes are needed; just bind the empty
 * VAO and draw 3 vertices.
 */
export class FullscreenTriangle {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
  }
  draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}

/** Vertex shader for fullscreen passes. Provides `v_uv` (0..1). */
export const FULLSCREEN_VS = `
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Copy a region between framebuffers with blitFramebuffer. */
export function blit(gl, src, dst, mask, filter) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src ? src.handle : null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst ? dst.handle : null);
  const sw = src ? src.width : gl.drawingBufferWidth;
  const sh = src ? src.height : gl.drawingBufferHeight;
  const dw = dst ? dst.width : gl.drawingBufferWidth;
  const dh = dst ? dst.height : gl.drawingBufferHeight;
  gl.blitFramebuffer(0, 0, sw, sh, 0, 0, dw, dh, mask, filter || gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}
