// Frame uniform buffer (std140, binding point 0). The GLSL declaration is
// generated from FIELDS so the JS writer and the shaders can never disagree.

/** [name, type, comment]. Only mat4 and vec4 are used, so std140 packing is tight. */
const FIELDS = [
  ['u_view', 'mat4', 'rotation-only view matrix (camera-relative)'],
  ['u_proj', 'mat4', 'jittered projection'],
  ['u_viewProj', 'mat4', 'u_proj * u_view (jittered)'],
  ['u_invView', 'mat4', ''],
  ['u_invProj', 'mat4', 'inverse jittered projection'],
  ['u_invViewProj', 'mat4', 'clip → camera-relative world'],
  ['u_prevViewProj', 'mat4', 'current camera-relative pos → previous frame unjittered clip'],
  ['u_viewProjUnjittered', 'mat4', 'u_projUnjittered * u_view'],
  ['u_shadowViewProj', 'mat4', 'camera-relative pos → shadow clip (before distortion)'],
  ['u_cameraPos', 'vec4', 'xyz absolute eye position, w = time in seconds (wraps every hour)'],
  ['u_sunDir', 'vec4', 'xyz unit vector toward the sun, w = daylight factor 0..1'],
  ['u_moonDir', 'vec4', 'xyz unit vector toward the moon, w = moon brightness 0..1'],
  ['u_lightDir', 'vec4', 'xyz toward the shadow-casting light (sun or moon), w = 1 sun / 0 moon'],
  ['u_sunColor', 'vec4', 'rgb irradiance of the shadow light at the surface, w = unused'],
  ['u_skyAmbient', 'vec4', 'rgb sky irradiance on an up-facing surface, w = unused'],
  ['u_fogColor', 'vec4', 'rgb horizon/fog colour, w = fog density'],
  ['u_resolution', 'vec4', 'xy internal render size, zw = 1/size'],
  ['u_jitter', 'vec4', 'xy current TAA jitter (NDC units), zw previous'],
  ['u_params', 'vec4', 'x frame index, y rain 0..1, z underwater 0/1, w near plane'],
  ['u_params2', 'vec4', 'x far plane, y render distance (blocks), z cloud coverage 0..1, w in lava 0/1'],
  ['u_cameraDelta', 'vec4', 'xyz cameraPos - prevCameraPos, w = dt seconds'],
  ['u_shadowParams', 'vec4', 'x shadow half-extent (blocks), y map size, z 1/size, w depth range (blocks)'],
  ['u_dayParams', 'vec4', 'x dayFraction, y night factor 0..1, z moon phase 0..1, w sunset factor 0..1'],
];

const SIZES = { mat4: 16, vec4: 4 };

/** Float offsets of each field inside the buffer. */
export const FRAME_OFFSETS = {};
let offset = 0;
for (const [name, type] of FIELDS) {
  FRAME_OFFSETS[name] = offset;
  offset += SIZES[type];
}
export const FRAME_FLOATS = offset;

/** GLSL declaration of the Frame block (included in every shader via common.js). */
export const FRAME_GLSL =
  'layout(std140) uniform Frame {\n' +
  FIELDS.map(([n, t, c]) => `  ${t} ${n};${c ? ' // ' + c : ''}`).join('\n') +
  '\n};\n';

/**
 * CPU-side mirror of the Frame UBO.
 * `frame.data` is a Float32Array; use set()/setMat() then upload() once per frame.
 */
export class FrameUniforms {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl;
    this.data = new Float32Array(FRAME_FLOATS);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.buffer);
  }

  setMat(name, m) {
    this.data.set(m, FRAME_OFFSETS[name]);
  }

  set(name, x = 0, y = 0, z = 0, w = 0) {
    const o = FRAME_OFFSETS[name];
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = w;
  }

  get(name) {
    const o = FRAME_OFFSETS[name];
    return this.data.subarray(o, o + 4);
  }

  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.data);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.buffer);
  }
}
