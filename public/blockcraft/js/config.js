// Shared constants, quality presets and default settings.
// Imported by the worker too: no DOM access at module level.

export const GAME_NAME = 'BlockCraft';
export const SAVE_VERSION = 1;

export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const WORLD_HEIGHT = 256;
export const SECTION_SIZE = 16;
export const SECTIONS = WORLD_HEIGHT / SECTION_SIZE; // 16
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT; // 65536
export const SEA_LEVEL = 63;

// Texture resolution of every block texture (pixels per block face edge).
export const TEX_SIZE = 32;

// Vertex format (see ARCHITECTURE.md).
export const VERTEX_BYTES = 16;
export const POS_SCALE = 16; // positions & uvs are stored in 1/16 block units
export const MAX_QUADS = 16384; // shared index buffer size (65536 vertices)

// Day cycle.
export const DAY_LENGTH_SECONDS = 20 * 60;
export const SUN_PATH_TILT = 0.45; // radians the sun path is tilted toward +Z

// Rendering.
export const NEAR_PLANE = 0.05;
export const FAR_PLANE = 1600;
export const CLOUD_BOTTOM = 170;
export const CLOUD_TOP = 250;

// Player.
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;
export const PLAYER_EYE_SNEAK = 1.27;
export const REACH = 6;

/** Index of a block inside a chunk. x,z ∈ [0,15], y ∈ [0,255]. */
export function blockIndex(x, y, z) {
  return x | (z << 4) | (y << 8);
}

/** Map key for a chunk column. */
export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

/**
 * Graphics quality presets. Every key is also an individual setting that the
 * settings menu can override (a preset change resets them).
 */
export const QUALITY_PRESETS = {
  low: {
    renderScale: 0.75,
    renderDistance: 6,
    shadows: false,
    shadowMapSize: 1024,
    shadowDistance: 64,
    softShadows: false,
    ssao: false,
    volumetricLight: false,
    volumetricSteps: 0,
    clouds: false,
    cloudSteps: 0,
    ssr: false,
    pom: false,
    taa: false,
    bloom: true,
    autoExposure: true,
    waterQuality: 0,
  },
  medium: {
    renderScale: 0.85,
    renderDistance: 8,
    shadows: true,
    shadowMapSize: 1536,
    shadowDistance: 96,
    softShadows: false,
    ssao: false,
    volumetricLight: false,
    volumetricSteps: 6,
    clouds: true,
    cloudSteps: 18,
    ssr: true,
    pom: false,
    taa: true,
    bloom: true,
    autoExposure: true,
    waterQuality: 1,
  },
  high: {
    renderScale: 1.0,
    renderDistance: 10,
    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 128,
    softShadows: true,
    ssao: true,
    volumetricLight: true,
    volumetricSteps: 10,
    clouds: true,
    cloudSteps: 32,
    ssr: true,
    pom: true,
    taa: true,
    bloom: true,
    autoExposure: true,
    waterQuality: 2,
  },
  ultra: {
    renderScale: 1.0,
    renderDistance: 14,
    shadows: true,
    shadowMapSize: 4096,
    shadowDistance: 160,
    softShadows: true,
    ssao: true,
    volumetricLight: true,
    volumetricSteps: 16,
    clouds: true,
    cloudSteps: 56,
    ssr: true,
    pom: true,
    taa: true,
    bloom: true,
    autoExposure: true,
    waterQuality: 3,
  },
};

export const DEFAULT_SETTINGS = {
  preset: 'high',
  ...QUALITY_PRESETS.high,
  fov: 75, // degrees, vertical
  mouseSensitivity: 1.0,
  invertY: false,
  volume: 0.7,
  showFps: false,
  dayCycle: true,
  viewBobbing: true,
};

/** Human labels for the settings menu (order = display order). */
export const SETTING_LABELS = {
  preset: 'Graphics preset',
  renderDistance: 'Render distance',
  renderScale: 'Resolution scale',
  fov: 'Field of view',
  mouseSensitivity: 'Mouse sensitivity',
  invertY: 'Invert mouse',
  shadows: 'Shadows',
  softShadows: 'Soft shadows (PCSS)',
  ssao: 'Ambient occlusion (SSAO)',
  volumetricLight: 'Volumetric light (god rays)',
  clouds: 'Volumetric clouds',
  ssr: 'Screen-space reflections',
  pom: 'Parallax occlusion mapping',
  taa: 'Temporal anti-aliasing',
  bloom: 'Bloom',
  autoExposure: 'Auto exposure',
  dayCycle: 'Day/night cycle',
  viewBobbing: 'View bobbing',
  volume: 'Volume',
};
