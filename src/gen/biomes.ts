/**
 * Terrain classification + biome palettes.
 *
 * `classify` maps a normalized height (with water level) to a terrain-class
 * id used by the texture renderer and typemap. Palettes give per-biome colors.
 */
import type { Biome } from '../params';

export const TERRAIN = {
  DEEP_WATER: 0,
  SHALLOW_WATER: 1,
  BEACH: 2,
  LOWLAND: 3,
  MIDLAND: 4,
  HIGHLAND: 5,
  MOUNTAIN: 6,
  PEAK: 7,
} as const;

export type TerrainClass = (typeof TERRAIN)[keyof typeof TERRAIN];

export function classify(h: number, waterLevel: number): TerrainClass {
  if (h < waterLevel - 0.06) return TERRAIN.DEEP_WATER;
  if (h < waterLevel) return TERRAIN.SHALLOW_WATER;
  if (h < waterLevel + 0.02) return TERRAIN.BEACH;
  if (h < 0.45) return TERRAIN.LOWLAND;
  if (h < 0.62) return TERRAIN.MIDLAND;
  if (h < 0.78) return TERRAIN.HIGHLAND;
  if (h < 0.9) return TERRAIN.MOUNTAIN;
  return TERRAIN.PEAK;
}

export function isLand(h: number, waterLevel: number, margin = 0.0): boolean {
  return h > waterLevel + margin;
}

/** typemap tile index (0..31) from terrain class — Spring typemap allows 32 tiles */
export function typemapTile(c: TerrainClass): number {
  // map our 8 classes into 8 distinct tiles (others unused)
  return c;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Per-biome, per-terrain-class color ramps (lowland→peak, plus water). */
export const BIOME_PALETTES: Record<Biome, Record<TerrainClass, RGB>> = {
  temperate: {
    [TERRAIN.DEEP_WATER]: { r: 24, g: 56, b: 96 },
    [TERRAIN.SHALLOW_WATER]: { r: 48, g: 104, b: 148 },
    [TERRAIN.BEACH]: { r: 196, g: 184, b: 140 },
    [TERRAIN.LOWLAND]: { r: 84, g: 130, b: 66 },
    [TERRAIN.MIDLAND]: { r: 72, g: 112, b: 56 },
    [TERRAIN.HIGHLAND]: { r: 104, g: 116, b: 80 },
    [TERRAIN.MOUNTAIN]: { r: 120, g: 116, b: 104 },
    [TERRAIN.PEAK]: { r: 236, g: 240, b: 244 },
  },
  desert: {
    [TERRAIN.DEEP_WATER]: { r: 40, g: 80, b: 110 },
    [TERRAIN.SHALLOW_WATER]: { r: 64, g: 120, b: 150 },
    [TERRAIN.BEACH]: { r: 220, g: 200, b: 150 },
    [TERRAIN.LOWLAND]: { r: 210, g: 186, b: 120 },
    [TERRAIN.MIDLAND]: { r: 196, g: 168, b: 104 },
    [TERRAIN.HIGHLAND]: { r: 176, g: 140, b: 88 },
    [TERRAIN.MOUNTAIN]: { r: 150, g: 116, b: 80 },
    [TERRAIN.PEAK]: { r: 220, g: 210, b: 196 },
  },
  arctic: {
    [TERRAIN.DEEP_WATER]: { r: 30, g: 60, b: 90 },
    [TERRAIN.SHALLOW_WATER]: { r: 90, g: 130, b: 160 },
    [TERRAIN.BEACH]: { r: 200, g: 210, b: 220 },
    [TERRAIN.LOWLAND]: { r: 210, g: 220, b: 226 },
    [TERRAIN.MIDLAND]: { r: 190, g: 205, b: 215 },
    [TERRAIN.HIGHLAND]: { r: 160, g: 180, b: 195 },
    [TERRAIN.MOUNTAIN]: { r: 130, g: 150, b: 170 },
    [TERRAIN.PEAK]: { r: 250, g: 252, b: 255 },
  },
  volcanic: {
    [TERRAIN.DEEP_WATER]: { r: 40, g: 24, b: 24 },
    [TERRAIN.SHALLOW_WATER]: { r: 70, g: 36, b: 30 },
    [TERRAIN.BEACH]: { r: 60, g: 48, b: 40 },
    [TERRAIN.LOWLAND]: { r: 56, g: 40, b: 32 },
    [TERRAIN.MIDLAND]: { r: 80, g: 44, b: 32 },
    [TERRAIN.HIGHLAND]: { r: 110, g: 56, b: 36 },
    [TERRAIN.MOUNTAIN]: { r: 60, g: 40, b: 36 },
    [TERRAIN.PEAK]: { r: 220, g: 110, b: 40 },
  },
  alien: {
    [TERRAIN.DEEP_WATER]: { r: 30, g: 50, b: 40 },
    [TERRAIN.SHALLOW_WATER]: { r: 50, g: 90, b: 70 },
    [TERRAIN.BEACH]: { r: 130, g: 140, b: 90 },
    [TERRAIN.LOWLAND]: { r: 90, g: 130, b: 80 },
    [TERRAIN.MIDLAND]: { r: 110, g: 100, b: 130 },
    [TERRAIN.HIGHLAND]: { r: 130, g: 90, b: 140 },
    [TERRAIN.MOUNTAIN]: { r: 90, g: 70, b: 110 },
    [TERRAIN.PEAK]: { r: 180, g: 160, b: 200 },
  },
  lunar: {
    [TERRAIN.DEEP_WATER]: { r: 40, g: 40, b: 44 },
    [TERRAIN.SHALLOW_WATER]: { r: 60, g: 60, b: 66 },
    [TERRAIN.BEACH]: { r: 110, g: 110, b: 116 },
    [TERRAIN.LOWLAND]: { r: 120, g: 120, b: 126 },
    [TERRAIN.MIDLAND]: { r: 140, g: 140, b: 146 },
    [TERRAIN.HIGHLAND]: { r: 160, g: 160, b: 166 },
    [TERRAIN.MOUNTAIN]: { r: 130, g: 130, b: 136 },
    [TERRAIN.PEAK]: { r: 200, g: 200, b: 206 },
  },
};
