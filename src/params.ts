/**
 * Generator input parameters — the full set of tuneable knobs.
 * See PLAN.md "INPUTS". Defaults chosen for a fair, moderate land map.
 */

export type Symmetry =
  | 'none'
  | 'flip' // left↔right mirror (C2 across vertical axis)
  | 'mirror' // point/180° mirror
  | 'rotate2' // C2 rotational (180°)
  | 'rotate4' // C4 rotational (90°)
  | 'teamAsym'; // resources symmetric, terrain asymmetric

export type TerrainType = 'land' | 'water' | 'islands' | 'mixed' | 'metal' | 'air';
export type Biome = 'temperate' | 'desert' | 'arctic' | 'volcanic' | 'alien' | 'lunar';
export type Erosion = 'none' | 'light' | 'heavy';
export type MetalDensity = 'sparse' | 'normal' | 'rich' | 'insane';
export type MetalDistribution = 'clustered' | 'spread' | 'mixed';
export type StartBoxMode = 'symmetric' | 'asymmetric' | 'corners' | 'edges';

export interface MapParams {
  // core
  seed: string;
  mapName: string;
  mapSize: number; // game units, even, in {6,8,10,12,16,20,24,32}

  // symmetry & fairness
  symmetry: Symmetry;
  teamCount: number; // 1,2,4,8
  startBoxMode: StartBoxMode;
  metalSpotSymmetry: boolean;

  // terrain
  terrainType: TerrainType;
  seaLevel: number; // 0..1 water coverage target
  biome: Biome;

  // relief & difficulty
  terrainDifficulty: number; // 0..1 master knob
  maxHeight: number; // world units (elmos) → SMF maxHeight
  erosion: Erosion;
  chokePoints: boolean;
  detailNoise: number; // 0..1 small-scale roughness

  // resources
  metalDensity: MetalDensity;
  metalDistribution: MetalDistribution;
  geoventCount: number;
  windStrength: number; // 0..1 → wind-generator energy (atmosphere minWind/maxWind)
  tidalStrength: number; // 0..1 → tidal-generator energy (mapinfo tidalStrength)

  // features
  treeDensity: number; // 0..1
  rockDensity: number; // 0..1
  grassCoverage: number; // 0..1

  // advanced
  noiseOctaves: number;
  noiseFrequency: number; // base frequency multiplier
  persistence: number;
  lacunarity: number;
}

export const MAP_SIZE_PRESETS = [6, 8, 10, 12, 16, 20, 24, 32] as const;

export const DEFAULT_PARAMS: MapParams = {
  seed: 'bar-001',
  mapName: 'Procedural BAR Map',
  mapSize: 16,

  symmetry: 'mirror',
  teamCount: 2,
  startBoxMode: 'symmetric',
  metalSpotSymmetry: true,

  terrainType: 'land',
  seaLevel: 0.25,
  biome: 'temperate',

  terrainDifficulty: 0.4,
  maxHeight: 180, // elmos. Tuned with octaves/persistence/smoothing below so the
                  // map is ~57% near-flat (walkable plains) + rolling hills, max ~34°.
                  // Higher values stay capped at the slope limit (gen/heightmap).
  erosion: 'light',
  chokePoints: true,
  detailNoise: 0.3,

  metalDensity: 'normal',
  metalDistribution: 'mixed',
  geoventCount: 4,
  windStrength: 0.5,  // → minWind 2, maxWind ~16 (typical BAR range)
  tidalStrength: 0.6, // → tidalStrength ~18 (koom 21, glacial 23)

  treeDensity: 0.4,
  rockDensity: 0.3,
  grassCoverage: 0.5,

  noiseOctaves: 4,    // fewer octaves → fewer "minor hills" (high-freq detail)
  noiseFrequency: 0.8, // broader landmasses → gentler broad slopes (was 1.2, too crumpled)
  persistence: 0.4,   // lower → high octaves contribute less roughness
  lacunarity: 2.0,
};

/** Approximate mex-spot counts per density, scaled by map area. */
export const METAL_DENSITY_MULT: Record<MetalDensity, number> = {
  sparse: 0.6,
  normal: 1.0,
  rich: 1.6,
  insane: 2.6,
};
