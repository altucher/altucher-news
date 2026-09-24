// STUB — shared atmosphere GLSL (the real implementation replaces the bodies but
// MUST keep these exact signatures; the translucent pass and others call them).
//
//   vec3 applyFog(vec3 color, vec3 rel, sampler2D skyLUT)
//       Air fog / aerial perspective for a surface at camera-relative position
//       `rel`, seen from a camera in air. Also hides the render-distance edge.
//   vec3 skyWithSun(vec3 dir, sampler2D skyLUT)
//       Sky radiance in direction `dir` including the sun (and moon) disc but
//       without clouds — used for reflections.

export const ATMOSPHERE_GLSL = /* glsl */ `
vec3 skyWithSun(vec3 dir, sampler2D skyLUT) {
  vec3 sky = sampleSkyLUT(skyLUT, dir);
  float sd = dot(dir, u_sunDir.xyz);
  sky += u_sunColor.rgb * 40.0 * smoothstep(0.9995, 0.99975, sd) * u_lightDir.w;
  return sky;
}
vec3 applyFog(vec3 color, vec3 rel, sampler2D skyLUT) {
  float dist = length(rel);
  vec3 dir = rel / max(dist, 1e-4);
  float edge = smoothstep(u_params2.y * 0.75, u_params2.y, dist);
  float f = max(1.0 - exp(-dist * u_fogColor.w), edge);
  return mix(color, sampleSkyLUT(skyLUT, dir), f);
}
`;
