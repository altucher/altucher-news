# BlockCraft — architecture & module contracts

A Minecraft-style voxel sandbox that runs in the browser on raw **WebGL2**, with a
shader-pack-grade deferred renderer (shadows, PBR, volumetric clouds and light,
SSR water, SSAO, TAA, bloom, auto exposure, ACES tonemapping).

* Plain modern JavaScript ES modules. **No build step, no dependencies.**
* Served statically from `public/blockcraft/` (Next.js serves it as-is;
  `/blockcraft` and `/minecraft` redirect to `/blockcraft/index.html`).
* All paths inside the game are **relative** so it also works from any static host.
* Modules imported by the worker (`config.js`, `math.js`, `blocks.js`,
  `world/worldgen.js`, `world/lighting.js`, `world/mesher.js`) must never touch
  `window`, `document`, or the DOM at module top level.

## File map

```
index.html            DOM: canvas, HUD, menus. Loads js/main.js (type=module)
style.css
js/main.js            bootstrap: capability checks, create Game, fatal-error screen
js/game.js            Game: owns everything, main loop, settings, URL params, test hook
js/config.js          constants, quality presets, default settings            [core]
js/math.js            mat4/vec3, seeded simplex noise, fbm, hashes, PRNG      [core]
js/blocks.js          block registry, texture-name list, face→layer tables   [core]
js/textures.js        procedural 32×32 albedo/normal/specular + UI icons
js/input.js           keyboard/mouse/pointer-lock (+ drag-look fallback, touch)
js/player.js          player physics, collision, movement modes, interaction
js/audio.js           procedural WebAudio sound effects & ambience
js/save.js            IndexedDB persistence
js/ui/ui.js           HUD (hotbar, crosshair, debug), menus, inventory, settings
js/world/chunk.js     Chunk data container                                   [core]
js/world/worldgen.js  terrain/biomes/caves/ores/trees (pure, deterministic)
js/world/lighting.js  sky + block light flood fill over a 3×3 chunk region
js/world/mesher.js    chunk → packed vertex buffers (AO, smooth light)
js/world/worker.js    Web Worker entry (generate / mesh jobs)
js/world/workerpool.js worker pool with main-thread fallback
js/world/world.js     World: chunk map, streaming, get/setBlock, raycast, edits
js/render/gl.js       GL helpers: programs, textures, FBOs, fullscreen tri   [core]
js/render/frame.js    Frame UBO (std140) layout + writer                      [core]
js/render/camera.js   camera matrices, TAA jitter, frustum                   [core]
js/render/renderer.js Renderer: targets, chunk meshes, pass orchestration   [core]
js/render/sky.js      CPU atmosphere model (sun/moon/ambient colors)
js/render/passes/*.js one class per render pass (see "Passes")
js/render/shaders/*.js GLSL sources exported as JS strings
```

`[core]` files are the shared contract. Change them only additively and keep
every consumer consistent.

## Coordinates & conventions

* Right-handed, **+Y up**. Faces: `0:+X(east) 1:-X(west) 2:+Y(top) 3:-Y(bottom) 4:+Z(south) 5:-Z(north)`.
* World height `WORLD_HEIGHT = 256` (y ∈ [0,255]). Chunks are 16×256×16 columns
  keyed by `(cx, cz)` = `floor(x/16), floor(z/16)`. Meshes are split into 16
  sections of 16³ (`sy` = 0..15).
* Block index inside a chunk: `i = x | (z << 4) | (y << 8)` (x,z ∈ 0..15).
* Camera: `yaw` (radians, 0 looks toward −Z / north, increasing turns toward −X
  i.e. left), `pitch` (radians, + looks up). Forward vector:
  `[-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch)]`.
* Day time `dayFraction ∈ [0,1)`: 0 = sunrise (sun at +X horizon), 0.25 = noon,
  0.5 = sunset, 0.75 = midnight. Sun path is tilted by `SUN_PATH_TILT` toward +Z
  (see `sunDirection()` in `math.js`). Moon = −sun.
* **Camera-relative rendering**: all world-space positions on the GPU are
  relative to the camera (`relPos = worldPos − cameraPos`). The view matrix is
  rotation-only. Absolute position = `relPos + u_cameraPos.xyz`.

## Blocks & textures

`blocks.js` exports `BLOCKS` (array indexed by id), `BLOCK` (name → id),
`TEXTURE_NAMES` (ordered, deduped list of every texture a block uses; the
layer index of a texture in the texture arrays is its index in this list),
`FACE_LAYER` (`Uint16Array(256*6)`: `FACE_LAYER[id*6+face]` = layer), plus
per-id property tables (`IS_OPAQUE`, `IS_SOLID`, `RENDER_LAYER`, `MODEL`,
`LIGHT_EMIT`, `LIGHT_OPACITY`, `WAVE`, ...). See the file for the full list.

`textures.js` must generate a texture for **every** name in `TEXTURE_NAMES`
at `TEX_SIZE`×`TEX_SIZE` (32) and return
`{ size, layers, albedo, normal, specular }` (three `Uint8Array`s of
`layers*size*size*4`, layer-major, row 0 = top of the texture):

| map      | GPU format      | channels |
|----------|-----------------|----------|
| albedo   | `SRGB8_ALPHA8`  | rgb = sRGB colour, a = coverage (cutout < 0.5 discards) / opacity for translucent |
| normal   | `RGBA8`         | rgb = tangent-space normal·0.5+0.5 (x = +u, y = +v i.e. *down* the image, z = out of surface); a = height (1 = top, 0 = deepest) for POM |
| specular | `RGBA8`         | r = smoothness (roughness = (1−s)²), g = F0 (< 0.9 dielectric reflectance, ≥ 0.9 = metal, use albedo as F0), b = subsurface/porosity, a = emission strength (0 none … 1 full) |

Tangent frames per face (UVs produced by the mesher **must** follow this; `v`
grows downward on side faces):

| face | T (+u)   | B (+v)   |
|------|----------|----------|
| 0 +X | (0,0,−1) | (0,−1,0) |
| 1 −X | (0,0,+1) | (0,−1,0) |
| 2 +Y | (+1,0,0) | (0,0,+1) |
| 3 −Y | (+1,0,0) | (0,0,−1) |
| 4 +Z | (+1,0,0) | (0,−1,0) |
| 5 −Z | (−1,0,0) | (0,−1,0) |

Mapped normal = `T*n.x + B*n.y + N*n.z`. (Table lives in GLSL as
`faceTangent()/faceBitangent()/faceNormal()` in `shaders/common.js`.)

## Vertex format (16 bytes, quads of 4 vertices, shared index buffer)

| loc | attribute | type                     | meaning |
|-----|-----------|--------------------------|---------|
| 0   | `a_pos`   | `uvec4` ← `UNSIGNED_SHORT×4` @0  | x, y, z in **1/16 block** units relative to the chunk origin (y absolute: 0..4096); w = texture layer |
| 1   | `a_data`  | `uvec4` ← `UNSIGNED_BYTE×4` @8   | x = u, y = v (1/16 units, 0..16, v=0 is the top of the texture); z = face (0..5; 6 = cross/plant, lit as +Y); w = `ao | (wave << 2)` |
| 2   | `a_light` | `uvec4` ← `UNSIGNED_BYTE×4` @12  | x = sky light (0..255 = level·17, smooth-lit average), y = block light (same), z = block id, w = 0 |

* `ao` ∈ 0..3, **3 = unoccluded** (Minecraft vertex AO); quads are
  triangulated along the brighter diagonal by emitting vertices in an order such
  that indices `0,1,2, 0,2,3` pick the right diagonal.
* `wave`: 0 = none, 1 = leaves (all vertices sway), 2 = plant (vertices with
  v == 0 sway), 3 = liquid surface (vertical bob).
* Winding: counter-clockwise when viewed from outside (front face = the
  face's normal side). Cross plants and the cutout/translucent layers are drawn
  with culling disabled; shaders flip the normal with `gl_FrontFacing`.
* `chunkmesh` index buffer: one shared `Uint16` buffer of `MAX_QUADS` quads
  (`0,1,2,0,2,3` + 4k). A section/layer draw must not exceed 65536 vertices
  (the mesher splits nothing — a 16³ section can never exceed that).

### Mesh job contract (worker ↔ main)

```
generate: { type:'generate', id, seed, cx, cz }
  → { type:'generated', id, cx, cz, blocks: Uint8Array(65536) (transferred), maxY }

mesh:     { type:'mesh', id, cx, cz, seed, neighbors: [9 × Uint8Array|null] }
          neighbors index = (dz+1)*3 + (dx+1); [4] is the chunk itself.
  → { type:'meshed', id, cx, cz, sections: [{ sy, opaque, cutout, translucent }] }
          each layer is an ArrayBuffer (transferred) of packed vertices or null;
          only non-empty sections are listed.
```

The worker computes sky + block light over the whole 48×48 region every time it
meshes (light is never stored), so edits simply remesh the affected chunks.

## Renderer

`new Renderer(canvas, settings)` → `renderer.setTextures(texData)` →
per frame `renderer.render(view)` where

```js
view = {
  camPos: [x, y, z],          // eye position (doubles)
  yaw, pitch, fov,            // radians, fov = vertical
  dayFraction, timeSeconds, dt,
  underwater: bool,           // eye inside water
  inLava: bool,
  selection: {x,y,z,min:[..],max:[..]} | null,   // block outline (world coords)
  breakProgress: 0..1,        // optional crack overlay on selection
  rain: 0..1,
}
```

Chunk meshes: `renderer.setChunkMesh(cx, cz, sections)` (replaces all sections
of that chunk), `renderer.removeChunk(cx, cz)`, `renderer.hasChunk(cx, cz)`.
Settings: `renderer.applySettings(settings)`; `renderer.resize()` is automatic.
Stats: `renderer.stats` (drawCalls, triangles, gpu ms if available).

### Frame UBO (std140, binding 0, block name `Frame`) — `render/frame.js`

See `FRAME_GLSL` in `shaders/common.js` for the authoritative declaration. All
matrices are camera-relative. `u_prevViewProj` maps *current* camera-relative
positions into the previous frame's (unjittered) clip space.

### Render targets (`renderer.targets`, internal resolution `renderer.width × height`)

| name            | format               | notes |
|-----------------|----------------------|-------|
| `gAlbedo`       | SRGB8_ALPHA8         | rgb albedo, a = 1 geometry / 0 sky |
| `gNormal`       | RGBA16F              | xy = oct(mapped normal), zw = oct(geometric normal) — world space |
| `gMaterial`     | RGBA8                | r = sky light, g = block light, b = AO, a = blockId/255 |
| `gSpecular`     | RGBA8                | same channels as the specular texture (r smooth, g F0, b SSS, a emission) |
| `depth`         | DEPTH_COMPONENT32F   | main depth; after the translucent pass it includes water/glass |
| `opaqueDepth`   | DEPTH_COMPONENT32F   | copy of `depth` taken before the translucent pass |
| `sceneHDR`      | RGBA16F              | lit scene (linear, pre-exposure) |
| `sceneCopy`     | RGBA16F              | copy of `sceneHDR` before translucents (SSR/refraction source) |
| `ssao`          | R8 (½ res)           | 1 = unoccluded (white texture when disabled) |
| `clouds`        | RGBA16F (½ res)      | rgb in-scattered light, a = transmittance (1 when disabled) |
| `volumetric`    | RGBA16F (½ res)      | rgb in-scatter, a = transmittance |
| `skyLUT`        | RGBA16F 256×128      | world-space sky radiance; sample with `sampleSkyLUT()` |
| `shadowMap`     | DEPTH_COMPONENT32F   | opaque+cutout casters, distorted projection |
| `shadowMapWater`| DEPTH_COMPONENT32F   | translucent casters (water) → caustics / underwater test |
| `taaOutput`     | RGBA16F              | resolved HDR (history ping-pong owned by TAA pass) |
| `bloom`         | RGBA16F              | bloom result (after upsample chain) |
| `exposure`      | R16F 1×1             | current exposure multiplier |

Texture-less features must bind neutral 1×1 textures (`renderer.white`,
`renderer.black`) instead of branching on missing targets.

### Passes (in order) — `render/passes/*.js`

Every pass is `class X { constructor(renderer); resize(w,h); render(ctx); dispose() }`.
`ctx` is the per-frame object built by the renderer (`view`, `settings`,
`frame`, camera matrices, frustum, time).

1. `ShadowPass`       → `shadowMap`, `shadowMapWater`
2. `GBufferPass`      → g-buffer (opaque, then cutout)
3. `SSAOPass`         → `ssao`
4. `SkyPass`          → `skyLUT` (every frame, cheap)
5. `CloudPass`        → `clouds` (½ res, temporal)
6. `DeferredPass`     → `sceneHDR` (sky, sun/moon/stars, clouds composite, PBR lighting, shadows, SSS, caustics, fog)
7. copies             → `sceneCopy`, `opaqueDepth` (renderer)
8. `TranslucentPass`  → `sceneHDR` + `depth` (water, glass, ice; SSR, refraction, absorption; selection outline)
9. `VolumetricPass`   → `volumetric` then composites into `sceneHDR`
10. `TAAPass`         → `taaOutput`
11. `BloomPass`       → `bloom`
12. `ExposurePass`    → `exposure`
13. `FinalPass`       → canvas (exposure, bloom, tonemap, grading, vignette, sharpen, underwater wobble)

## Game / test hooks

`game.js` reads URL params: `autostart=1`, `seed=<int>`, `preset=low|medium|high|ultra`,
`time=<0..1>`, `pos=x,y,z`, `rot=yaw,pitch` (degrees), `rd=<chunks>`,
`nosave=1`, `freeze=1` (stop the day cycle). It exposes `window.blockcraft = game`
with `game.ready` (Promise resolved when spawn chunks are meshed and the first
frame is drawn) and `game.renderer`, `game.world`, `game.player`.
