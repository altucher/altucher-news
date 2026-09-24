// GLSL prelude injected into every program after #version/precision/defines.
// Keep functions here small and shared; pass-specific code lives in its pass.

import { FRAME_GLSL } from '../frame.js';

export const COMMON_GLSL = /* glsl */ `
${FRAME_GLSL}
#define PI 3.14159265359
#define TAU 6.28318530718
#define INV_PI 0.31830988618

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
float sq(float x) { return x * x; }
float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float timeSeconds() { return u_cameraPos.w; }
float frameIndex() { return u_params.x; }
float nearPlane() { return u_params.w; }
float farPlane() { return u_params2.x; }
bool isUnderwater() { return u_params.z > 0.5; }

// ---------------------------------------------------------------- encoding
vec2 octWrap(vec2 v) { return (1.0 - abs(v.yx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0); }
vec2 octEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  n.xy = n.z >= 0.0 ? n.xy : octWrap(n.xy);
  return n.xy;
}
vec3 octDecode(vec2 f) {
  vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  float t = saturate(-n.z);
  n.xy += vec2(n.x >= 0.0 ? -t : t, n.y >= 0.0 ? -t : t);
  return normalize(n);
}

// ---------------------------------------------------------------- noise
// Interleaved gradient noise (Jimenez 2014); animate with frame index for TAA.
float ign(vec2 pixel) { return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715)))); }
float ignAnimated(vec2 pixel) { return ign(pixel + 5.588238 * mod(frameIndex(), 64.0)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
// Value noise 2D / 3D in [0,1].
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}

// ---------------------------------------------------------------- depth & positions
// Standard (non-reversed) depth, [0,1] window depth.
float linearizeDepth(float d) {
  float z = d * 2.0 - 1.0;
  float n = nearPlane(), f = farPlane();
  return (2.0 * n * f) / (f + n - z * (f - n));
}
// View-space position from uv (0..1) and window depth (uses jittered inverse projection).
vec3 viewPosFromDepth(vec2 uv, float depth) {
  vec4 p = u_invProj * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
// Camera-relative world position from uv and depth.
vec3 relPosFromDepth(vec2 uv, float depth) {
  vec4 p = u_invViewProj * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
// World-space (camera-relative) view ray direction for a screen uv.
vec3 viewRayDir(vec2 uv) {
  vec4 p = u_invViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(p.xyz / p.w);
}
// Project a camera-relative position to uv + window depth (jittered, current frame).
vec3 projectRelPos(vec3 rel) {
  vec4 c = u_viewProj * vec4(rel, 1.0);
  return c.xyz / c.w * 0.5 + 0.5;
}
// Previous-frame uv for a camera-relative position (for TAA / temporal passes).
vec2 reprojectRelPos(vec3 rel) {
  vec4 c = u_prevViewProj * vec4(rel, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}

// ---------------------------------------------------------------- faces
vec3 faceNormal(uint f) {
  if (f == 0u) return vec3(1, 0, 0);
  if (f == 1u) return vec3(-1, 0, 0);
  if (f == 3u) return vec3(0, -1, 0);
  if (f == 4u) return vec3(0, 0, 1);
  if (f == 5u) return vec3(0, 0, -1);
  return vec3(0, 1, 0); // 2 (top) and 6 (cross plants)
}
vec3 faceTangent(uint f) {
  if (f == 0u) return vec3(0, 0, -1);
  if (f == 1u) return vec3(0, 0, 1);
  if (f == 5u) return vec3(-1, 0, 0);
  return vec3(1, 0, 0);
}
vec3 faceBitangent(uint f) {
  if (f == 2u || f == 6u) return vec3(0, 0, 1);
  if (f == 3u) return vec3(0, 0, -1);
  return vec3(0, -1, 0);
}

// ---------------------------------------------------------------- shadows
// Minecraft-shaderpack style distortion: more shadow texels near the player.
#define SHADOW_DISTORT 0.85
float shadowDistortFactor(vec2 p) { return length(p) * SHADOW_DISTORT + (1.0 - SHADOW_DISTORT); }
vec2 distortShadow(vec2 p) { return p / shadowDistortFactor(p); }
// Camera-relative position → shadow map coords (xy uv, z depth 0..1), distorted.
vec3 shadowCoords(vec3 rel) {
  vec4 c = u_shadowViewProj * vec4(rel, 1.0);
  c.xy = distortShadow(c.xy);
  return c.xyz * 0.5 + 0.5;
}

// ---------------------------------------------------------------- sky LUT
// World-space sky radiance LUT (256x128, RGBA16F) written by SkyPass.
// u = azimuth, v = sqrt-warped elevation (more texels near the horizon).
vec2 skyLUTUv(vec3 dir) {
  float az = atan(dir.z, dir.x) / TAU + 0.5;
  float el = clamp(dir.y, -1.0, 1.0);
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el));
  return vec2(az, v);
}
vec3 skyLUTDir(vec2 uv) {
  float az = (uv.x - 0.5) * TAU;
  float s = uv.y * 2.0 - 1.0;
  float el = sign(s) * s * s;
  float c = sqrt(max(0.0, 1.0 - el * el));
  return vec3(cos(az) * c, el, sin(az) * c);
}
vec3 sampleSkyLUT(sampler2D lut, vec3 dir) { return textureLod(lut, skyLUTUv(dir), 0.0).rgb; }

// ---------------------------------------------------------------- lighting helpers
float henyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5));
}
float rayleighPhase(float cosTheta) { return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta); }
vec3 fresnelSchlick(float cosTheta, vec3 f0) { return f0 + (1.0 - f0) * pow(1.0 - saturate(cosTheta), 5.0); }
float distributionGGX(float NdotH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-6);
}
float visibilitySmithGGX(float NdotV, float NdotL, float roughness) {
  float a = roughness * roughness;
  float gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a) + a);
  float gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a) + a);
  return 0.5 / max(gv + gl, 1e-5);
}
// Torch/block light colour (warm) as a function of the 0..1 block-light value.
vec3 blockLightColor(float level) {
  float l = level * level * level * 1.1 + level * 0.1;
  return vec3(1.0, 0.62, 0.32) * l * 3.2;
}
`;
