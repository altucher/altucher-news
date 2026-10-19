// STUB — minimal deferred lighting (real implementation replaces this).
import { Program, FULLSCREEN_VS } from '../gl.js';

const FS = `
uniform sampler2D u_albedo, u_normal, u_material, u_depth;
in vec2 v_uv; out vec4 o_color;
void main() {
  float d = texture(u_depth, v_uv).r;
  vec3 dir = viewRayDir(v_uv);
  if (d >= 1.0) { o_color = vec4(mix(vec3(0.6, 0.75, 1.0), vec3(0.2, 0.4, 0.9), saturate(dir.y)) * u_sunDir.w + 0.02, 1.0); return; }
  vec3 alb = texture(u_albedo, v_uv).rgb;
  vec3 n = octDecode(texture(u_normal, v_uv).xy);
  vec4 m = texture(u_material, v_uv);
  vec3 light = u_sunColor.rgb * max(dot(n, u_lightDir.xyz), 0.0) * m.r + u_skyAmbient.rgb * m.r * m.r + blockLightColor(m.g);
  o_color = vec4(alb * light * mix(0.4, 1.0, m.b), 1.0);
}`;

export class DeferredPass {
  constructor(renderer) {
    this.r = renderer;
    this.prog = new Program(renderer.gl, FULLSCREEN_VS, FS, { label: 'deferred-stub' });
  }
  onSettings() {}
  resize() {}
  render(ctx) {
    const r = this.r, T = r.targets;
    r.fbos.scene.bind();
    this.prog.use().tex('u_albedo', T.gAlbedo).tex('u_normal', T.gNormal).tex('u_material', T.gMaterial).tex('u_depth', T.depth);
    r.fullscreen.draw();
  }
  dispose() { this.prog.dispose(); }
}
