// STUB — minimal g-buffer pass (real implementation replaces this).
import { Program } from '../gl.js';
import { LAYER } from '../../blocks.js';

const VS = `
layout(location=0) in uvec4 a_pos;
layout(location=1) in uvec4 a_data;
layout(location=2) in uvec4 a_light;
uniform vec3 u_chunkOffset;
out vec2 v_uv; flat out uint v_layer; flat out uint v_face; out vec3 v_light;
void main() {
  vec3 rel = vec3(a_pos.xyz) / 16.0 + u_chunkOffset;
  v_uv = vec2(a_data.xy) / 16.0;
  v_layer = a_pos.w; v_face = a_data.z & 7u;
  float ao = float(a_data.w & 3u) / 3.0;
  v_light = vec3(float(a_light.x) / 255.0, float(a_light.y) / 255.0, ao);
  gl_Position = u_viewProj * vec4(rel, 1.0);
}`;
const FS = `
uniform sampler2DArray u_albedo;
in vec2 v_uv; flat in uint v_layer; flat in uint v_face; in vec3 v_light;
layout(location=0) out vec4 o_albedo; layout(location=1) out vec4 o_normal;
layout(location=2) out vec4 o_material; layout(location=3) out vec4 o_specular;
void main() {
  vec4 a = texture(u_albedo, vec3(v_uv, float(v_layer)));
  if (a.a < 0.5) discard;
  vec3 n = faceNormal(v_face);
  if (!gl_FrontFacing && v_face != 6u) n = -n;
  o_albedo = vec4(a.rgb, 1.0);
  o_normal = vec4(octEncode(n), octEncode(n));
  o_material = vec4(v_light, 0.0);
  o_specular = vec4(0.0);
}`;

export class GBufferPass {
  constructor(renderer) {
    this.r = renderer;
    this.prog = new Program(renderer.gl, VS, FS, { label: 'gbuffer-stub' });
  }
  onSettings() {}
  resize() {}
  render(ctx) {
    const r = this.r, gl = r.gl;
    r.fbos.gbuffer.bind();
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    this.prog.use().tex('u_albedo', r.textures.albedo);
    r.drawChunks(LAYER.OPAQUE, this.prog);
    gl.disable(gl.CULL_FACE);
    r.drawChunks(LAYER.CUTOUT, this.prog);
    gl.disable(gl.DEPTH_TEST);
  }
  dispose() { this.prog.dispose(); }
}
