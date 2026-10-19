// STUB — minimal tonemap to screen (real implementation replaces this).
import { Program, FULLSCREEN_VS, bindScreen } from '../gl.js';

const FS = `
uniform sampler2D u_scene;
in vec2 v_uv; out vec4 o_color;
void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  c = c / (1.0 + c);
  o_color = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

export class FinalPass {
  constructor(renderer) {
    this.r = renderer;
    this.prog = new Program(renderer.gl, FULLSCREEN_VS, FS, { label: 'final-stub' });
  }
  onSettings() {}
  resize() {}
  render(ctx) {
    const r = this.r;
    bindScreen(r.gl);
    this.prog.use().tex('u_scene', r.input('resolved'));
    r.fullscreen.draw();
  }
  dispose() { this.prog.dispose(); }
}
