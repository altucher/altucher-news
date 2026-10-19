// Block registry. Imported by the worker: no DOM access.
//
// Every block lists the textures of its six faces by name; the ordered, deduped
// list of all names is TEXTURE_NAMES and a texture's index in it is its layer in
// the GPU texture arrays. textures.js must implement a generator for each name.

// Faces: 0:+X east, 1:-X west, 2:+Y top, 3:-Y bottom, 4:+Z south, 5:-Z north.
export const FACE = { EAST: 0, WEST: 1, TOP: 2, BOTTOM: 3, SOUTH: 4, NORTH: 5 };
export const FACE_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

// Models.
export const MODEL = { NONE: 0, CUBE: 1, CROSS: 2, TORCH: 3, LIQUID: 4 };
// Render layers.
export const LAYER = { NONE: 0, OPAQUE: 1, CUTOUT: 2, TRANSLUCENT: 3 };
// Wave types (vertex animation).
export const WAVE = { NONE: 0, LEAVES: 1, PLANT: 2, LIQUID: 3 };
// Sound groups.
export const SOUND = {
  STONE: 'stone', GRASS: 'grass', DIRT: 'dirt', WOOD: 'wood', SAND: 'sand',
  GRAVEL: 'gravel', GLASS: 'glass', SNOW: 'snow', CLOTH: 'cloth', LIQUID: 'liquid', METAL: 'metal',
};

/**
 * Block definition shorthand.
 * tex: string (all faces) | { top, bottom, side, front? , east, west, north, south }
 * front: face index that uses tex.front (default 4 = south).
 */
const DEFS = [];
function def(id, name, displayName, tex, props = {}) {
  DEFS[id] = { id, name, displayName, tex, ...props };
}

const SOLID = { model: MODEL.CUBE, layer: LAYER.OPAQUE, solid: true, opaque: true, lightOpacity: 15 };
const PLANT = {
  model: MODEL.CROSS, layer: LAYER.CUTOUT, solid: false, opaque: false, lightOpacity: 0,
  wave: WAVE.PLANT, replaceable: true, sound: SOUND.GRASS, hitbox: [0.15, 0, 0.15, 0.85, 0.8, 0.85],
};
const LEAVES = {
  model: MODEL.CUBE, layer: LAYER.CUTOUT, solid: true, opaque: false, lightOpacity: 1,
  wave: WAVE.LEAVES, sound: SOUND.GRASS, leaves: true,
};
const GLASSY = {
  model: MODEL.CUBE, layer: LAYER.TRANSLUCENT, solid: true, opaque: false, lightOpacity: 0,
  sound: SOUND.GLASS,
};

def(0, 'air', 'Air', null, { model: MODEL.NONE, layer: LAYER.NONE, solid: false, opaque: false, lightOpacity: 0, inventory: false });
def(1, 'stone', 'Stone', 'stone', { ...SOLID, sound: SOUND.STONE });
def(2, 'grass_block', 'Grass Block', { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, { ...SOLID, sound: SOUND.GRASS });
def(3, 'dirt', 'Dirt', 'dirt', { ...SOLID, sound: SOUND.DIRT });
def(4, 'cobblestone', 'Cobblestone', 'cobblestone', { ...SOLID, sound: SOUND.STONE });
def(5, 'oak_planks', 'Oak Planks', 'oak_planks', { ...SOLID, sound: SOUND.WOOD });
def(6, 'bedrock', 'Bedrock', 'bedrock', { ...SOLID, sound: SOUND.STONE, unbreakable: true });
def(7, 'sand', 'Sand', 'sand', { ...SOLID, sound: SOUND.SAND });
def(8, 'gravel', 'Gravel', 'gravel', { ...SOLID, sound: SOUND.GRAVEL });
def(9, 'oak_log', 'Oak Log', { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, { ...SOLID, sound: SOUND.WOOD });
def(10, 'oak_leaves', 'Oak Leaves', 'oak_leaves', { ...LEAVES });
def(11, 'glass', 'Glass', 'glass', { ...GLASSY });
def(12, 'water', 'Water', 'water', {
  model: MODEL.LIQUID, layer: LAYER.TRANSLUCENT, solid: false, opaque: false, lightOpacity: 2,
  liquid: true, wave: WAVE.LIQUID, sound: SOUND.LIQUID, replaceable: true, inventory: true,
});
def(13, 'lava', 'Lava', 'lava', {
  model: MODEL.LIQUID, layer: LAYER.OPAQUE, solid: false, opaque: false, lightOpacity: 15,
  liquid: true, light: 15, sound: SOUND.LIQUID, replaceable: true,
});
def(14, 'coal_ore', 'Coal Ore', 'coal_ore', { ...SOLID, sound: SOUND.STONE });
def(15, 'iron_ore', 'Iron Ore', 'iron_ore', { ...SOLID, sound: SOUND.STONE });
def(16, 'gold_ore', 'Gold Ore', 'gold_ore', { ...SOLID, sound: SOUND.STONE });
def(17, 'diamond_ore', 'Diamond Ore', 'diamond_ore', { ...SOLID, sound: SOUND.STONE });
def(18, 'birch_log', 'Birch Log', { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log' }, { ...SOLID, sound: SOUND.WOOD });
def(19, 'birch_leaves', 'Birch Leaves', 'birch_leaves', { ...LEAVES });
def(20, 'spruce_log', 'Spruce Log', { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log' }, { ...SOLID, sound: SOUND.WOOD });
def(21, 'spruce_leaves', 'Spruce Leaves', 'spruce_leaves', { ...LEAVES });
def(22, 'snow_block', 'Snow Block', 'snow', { ...SOLID, sound: SOUND.SNOW });
def(23, 'snowy_grass_block', 'Snowy Grass', { top: 'snow', bottom: 'dirt', side: 'grass_side_snowy' }, { ...SOLID, sound: SOUND.SNOW });
def(24, 'ice', 'Ice', 'ice', { ...GLASSY, lightOpacity: 2 });
def(25, 'cactus', 'Cactus', { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, { ...SOLID, sound: SOUND.CLOTH });
def(26, 'clay', 'Clay', 'clay', { ...SOLID, sound: SOUND.DIRT });
def(27, 'sandstone', 'Sandstone', { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, { ...SOLID, sound: SOUND.STONE });
def(28, 'bricks', 'Bricks', 'bricks', { ...SOLID, sound: SOUND.STONE });
def(29, 'stone_bricks', 'Stone Bricks', 'stone_bricks', { ...SOLID, sound: SOUND.STONE });
def(30, 'mossy_cobblestone', 'Mossy Cobblestone', 'mossy_cobblestone', { ...SOLID, sound: SOUND.STONE });
def(31, 'obsidian', 'Obsidian', 'obsidian', { ...SOLID, sound: SOUND.STONE });
def(32, 'glowstone', 'Glowstone', 'glowstone', { ...SOLID, sound: SOUND.GLASS, light: 15 });
def(33, 'torch', 'Torch', 'torch', {
  model: MODEL.TORCH, layer: LAYER.CUTOUT, solid: false, opaque: false, lightOpacity: 0,
  light: 14, sound: SOUND.WOOD, hitbox: [0.4, 0, 0.4, 0.6, 0.625, 0.6],
});
def(34, 'short_grass', 'Grass', 'short_grass', { ...PLANT });
def(35, 'fern', 'Fern', 'fern', { ...PLANT });
def(36, 'dandelion', 'Dandelion', 'dandelion', { ...PLANT, hitbox: [0.3, 0, 0.3, 0.7, 0.6, 0.7] });
def(37, 'poppy', 'Poppy', 'poppy', { ...PLANT, hitbox: [0.3, 0, 0.3, 0.7, 0.6, 0.7] });
def(38, 'blue_orchid', 'Blue Orchid', 'blue_orchid', { ...PLANT, hitbox: [0.3, 0, 0.3, 0.7, 0.6, 0.7] });
def(39, 'dead_bush', 'Dead Bush', 'dead_bush', { ...PLANT, wave: WAVE.NONE });
def(40, 'sugar_cane', 'Sugar Cane', 'sugar_cane', { ...PLANT, replaceable: false, hitbox: [0.125, 0, 0.125, 0.875, 1, 0.875] });
def(41, 'white_wool', 'White Wool', 'white_wool', { ...SOLID, sound: SOUND.CLOTH });
def(42, 'red_wool', 'Red Wool', 'red_wool', { ...SOLID, sound: SOUND.CLOTH });
def(43, 'orange_wool', 'Orange Wool', 'orange_wool', { ...SOLID, sound: SOUND.CLOTH });
def(44, 'yellow_wool', 'Yellow Wool', 'yellow_wool', { ...SOLID, sound: SOUND.CLOTH });
def(45, 'lime_wool', 'Lime Wool', 'lime_wool', { ...SOLID, sound: SOUND.CLOTH });
def(46, 'cyan_wool', 'Cyan Wool', 'cyan_wool', { ...SOLID, sound: SOUND.CLOTH });
def(47, 'blue_wool', 'Blue Wool', 'blue_wool', { ...SOLID, sound: SOUND.CLOTH });
def(48, 'purple_wool', 'Purple Wool', 'purple_wool', { ...SOLID, sound: SOUND.CLOTH });
def(49, 'black_wool', 'Black Wool', 'black_wool', { ...SOLID, sound: SOUND.CLOTH });
def(50, 'gold_block', 'Block of Gold', 'gold_block', { ...SOLID, sound: SOUND.METAL });
def(51, 'iron_block', 'Block of Iron', 'iron_block', { ...SOLID, sound: SOUND.METAL });
def(52, 'diamond_block', 'Block of Diamond', 'diamond_block', { ...SOLID, sound: SOUND.METAL });
def(53, 'emerald_block', 'Block of Emerald', 'emerald_block', { ...SOLID, sound: SOUND.METAL });
def(54, 'bookshelf', 'Bookshelf', { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, { ...SOLID, sound: SOUND.WOOD });
def(55, 'crafting_table', 'Crafting Table', { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, { ...SOLID, sound: SOUND.WOOD });
def(56, 'furnace', 'Furnace', { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, { ...SOLID, sound: SOUND.STONE });
def(57, 'jack_o_lantern', "Jack o'Lantern", { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, { ...SOLID, sound: SOUND.WOOD, light: 15 });
def(58, 'pumpkin', 'Pumpkin', { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' }, { ...SOLID, sound: SOUND.WOOD });
def(59, 'sea_lantern', 'Sea Lantern', 'sea_lantern', { ...SOLID, sound: SOUND.GLASS, light: 15 });
def(60, 'quartz_block', 'Block of Quartz', { top: 'quartz_block_top', bottom: 'quartz_block_top', side: 'quartz_block_side' }, { ...SOLID, sound: SOUND.STONE });
def(61, 'granite', 'Granite', 'granite', { ...SOLID, sound: SOUND.STONE });
def(62, 'diorite', 'Diorite', 'diorite', { ...SOLID, sound: SOUND.STONE });
def(63, 'andesite', 'Andesite', 'andesite', { ...SOLID, sound: SOUND.STONE });
def(64, 'terracotta', 'Terracotta', 'terracotta', { ...SOLID, sound: SOUND.STONE });
def(65, 'red_sand', 'Red Sand', 'red_sand', { ...SOLID, sound: SOUND.SAND });
def(66, 'podzol', 'Podzol', { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, { ...SOLID, sound: SOUND.DIRT });
def(67, 'mossy_stone_bricks', 'Mossy Stone Bricks', 'mossy_stone_bricks', { ...SOLID, sound: SOUND.STONE });
def(68, 'red_stained_glass', 'Red Stained Glass', 'red_stained_glass', { ...GLASSY });
def(69, 'blue_stained_glass', 'Blue Stained Glass', 'blue_stained_glass', { ...GLASSY });
def(70, 'green_stained_glass', 'Green Stained Glass', 'green_stained_glass', { ...GLASSY });
def(71, 'spruce_planks', 'Spruce Planks', 'spruce_planks', { ...SOLID, sound: SOUND.WOOD });
def(72, 'birch_planks', 'Birch Planks', 'birch_planks', { ...SOLID, sound: SOUND.WOOD });
def(73, 'red_mushroom', 'Red Mushroom', 'red_mushroom', { ...PLANT, wave: WAVE.NONE, hitbox: [0.3, 0, 0.3, 0.7, 0.4, 0.7] });
def(74, 'brown_mushroom', 'Brown Mushroom', 'brown_mushroom', { ...PLANT, wave: WAVE.NONE, hitbox: [0.3, 0, 0.3, 0.7, 0.4, 0.7] });
def(75, 'coal_block', 'Block of Coal', 'coal_block', { ...SOLID, sound: SOUND.STONE });
def(76, 'lapis_block', 'Block of Lapis', 'lapis_block', { ...SOLID, sound: SOUND.STONE });
def(77, 'polished_andesite', 'Polished Andesite', 'polished_andesite', { ...SOLID, sound: SOUND.STONE });
def(78, 'smooth_stone', 'Smooth Stone', 'smooth_stone', { ...SOLID, sound: SOUND.STONE });
def(79, 'tall_grass_top', 'Tall Grass', 'tall_grass_top', { ...PLANT, inventory: false });
def(80, 'tall_grass', 'Tall Grass', 'tall_grass_bottom', { ...PLANT, doubleTop: 79 });
def(81, 'lily_pad', 'Lily Pad', 'lily_pad', {
  model: MODEL.CROSS, layer: LAYER.CUTOUT, solid: false, opaque: false, lightOpacity: 0,
  flat: true, replaceable: false, sound: SOUND.GRASS, hitbox: [0, 0, 0, 1, 0.1, 1],
});

export const BLOCK_COUNT = DEFS.length;

// ---------------------------------------------------------------------------
// Normalise definitions & build lookup tables.
// ---------------------------------------------------------------------------
export const BLOCKS = [];
export const BLOCK = {};
export const TEXTURE_NAMES = [];
const texIndex = new Map();
function layerOf(name) {
  let i = texIndex.get(name);
  if (i === undefined) {
    i = TEXTURE_NAMES.length;
    TEXTURE_NAMES.push(name);
    texIndex.set(name, i);
  }
  return i;
}

export const FACE_LAYER = new Uint16Array(256 * 6);
export const IS_SOLID = new Uint8Array(256); // collides with the player
export const IS_OPAQUE = new Uint8Array(256); // full opaque cube: culls neighbour faces
export const RENDER_LAYER = new Uint8Array(256);
export const MODEL_OF = new Uint8Array(256);
export const LIGHT_EMIT = new Uint8Array(256);
export const LIGHT_OPACITY = new Uint8Array(256); // light lost when passing through (≥1 always applied by BFS)
export const WAVE_OF = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
export const IS_REPLACEABLE = new Uint8Array(256); // placing a block replaces it (air, plants, liquids)
export const IS_LEAVES = new Uint8Array(256);

for (let id = 0; id < DEFS.length; id++) {
  const d = DEFS[id];
  if (!d) continue;
  const b = {
    id,
    name: d.name,
    displayName: d.displayName,
    model: d.model ?? MODEL.CUBE,
    layer: d.layer ?? LAYER.OPAQUE,
    solid: d.solid ?? true,
    opaque: d.opaque ?? true,
    lightOpacity: d.lightOpacity ?? 15,
    light: d.light ?? 0,
    wave: d.wave ?? WAVE.NONE,
    liquid: !!d.liquid,
    replaceable: id === 0 || !!d.replaceable,
    leaves: !!d.leaves,
    sound: d.sound ?? SOUND.STONE,
    unbreakable: !!d.unbreakable,
    inventory: d.inventory ?? id !== 0,
    hitbox: d.hitbox ?? [0, 0, 0, 1, 1, 1],
    flat: !!d.flat,
    doubleTop: d.doubleTop ?? 0,
    faces: [0, 0, 0, 0, 0, 0], // texture layer per face
    textureNames: [],
  };
  if (d.tex) {
    const t = typeof d.tex === 'string' ? { all: d.tex } : d.tex;
    const frontFace = d.frontFace ?? FACE.SOUTH;
    for (let f = 0; f < 6; f++) {
      let name;
      if (t.all) name = t.all;
      else if (f === FACE.TOP) name = t.top;
      else if (f === FACE.BOTTOM) name = t.bottom;
      else if (f === frontFace && t.front) name = t.front;
      else name = t.side;
      b.textureNames[f] = name;
      b.faces[f] = layerOf(name);
      FACE_LAYER[id * 6 + f] = b.faces[f];
    }
  }
  BLOCKS[id] = b;
  BLOCK[b.name] = id;
  IS_SOLID[id] = b.solid ? 1 : 0;
  IS_OPAQUE[id] = b.opaque ? 1 : 0;
  RENDER_LAYER[id] = b.layer;
  MODEL_OF[id] = b.model;
  LIGHT_EMIT[id] = b.light;
  LIGHT_OPACITY[id] = b.lightOpacity;
  WAVE_OF[id] = b.wave;
  IS_LIQUID[id] = b.liquid ? 1 : 0;
  IS_REPLACEABLE[id] = b.replaceable ? 1 : 0;
  IS_LEAVES[id] = b.leaves ? 1 : 0;
}

/** Blocks shown in the creative inventory, in display order. */
export const INVENTORY_BLOCKS = BLOCKS.filter((b) => b && b.inventory).map((b) => b.id);

/** Default hotbar (9 slots). */
export const DEFAULT_HOTBAR = [
  BLOCK.grass_block, BLOCK.stone, BLOCK.oak_planks, BLOCK.oak_log, BLOCK.glass,
  BLOCK.torch, BLOCK.glowstone, BLOCK.water, BLOCK.stone_bricks,
];
