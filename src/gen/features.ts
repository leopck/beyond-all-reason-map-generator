/**
 * Features: geovents, trees, rocks, grass → featuremap + fs.txt (research §4.4).
 *
 * Featuremap (RGBA, xsize × xsize):
 *   R: 255 - index into fs.txt   (255 = first line, 254 = second, …) → rocks/misc
 *   G: 255 = geovent; 200..215 = tree types 1..16 (built-in, no fs.txt entry)
 *   B: 0..255 grass density (per cell)
 * fs.txt: one feature tdfname per line; the R channel indexes these lines.
 *
 * Names are common Spring/BAR feature defs and are adjustable — if a name
 * isn't present in the loaded game the feature simply won't spawn (map loads).
 */
import type { MapParams } from '../params';
import type { MapDims } from './dims';
import type { Feature, MexSpot } from '../types';
import { RNG } from '../rng';
import { Noise } from '../noise';
import { sampleHeightElmo } from './dims';
import { classify, isLand } from './biomes';
import { TERRAIN } from './biomes';

// rocks referenced by fs.txt; index i ↔ red value (255 - i)
const ROCK_FEATURES = ['rock0', 'rock1', 'rock2', 'rock3'];
const TREE_TYPES = 8; // green 200..207

export interface FeatureResult {
  featureMap: Uint8Array;
  features: Feature[];
  fsList: string[];
}

export function generateFeatures(
  params: MapParams,
  dims: MapDims,
  height: Float32Array,
  waterLevelNorm: number,
  mexSpots: MexSpot[] = [],
): FeatureResult {
  const rng = new RNG(params.seed + '::features');
  const moistNoise = new Noise(params.seed + '::grass');
  const { featureW: W, featureH: H, worldElmos } = dims;

  const featureMap = new Uint8Array(W * H * 4); // RGBA, zeroed
  const features: Feature[] = [];
  const fsList = [...ROCK_FEATURES];

  // keep features clear of mex spots so geos/rocks/trees never block extractors.
  // mex extractorRadius in mapinfo is 90; clear a generous radius around each.
  const MEX_CLEAR = 100; // elmos
  const mexClear2 = MEX_CLEAR * MEX_CLEAR;
  const clearOfMex = (ex: number, ez: number): boolean => {
    for (const m of mexSpots) {
      const dx = ex - m.x;
      const dz = ez - m.z;
      if (dx * dx + dz * dz < mexClear2) return false;
    }
    return true;
  };

  // helper: set a featuremap pixel (nearest cell) RGBA
  const setPixel = (elmoX: number, elmoZ: number, r: number, g: number, b: number) => {
    const fx = Math.floor(elmoX / 8); // featuremap cell = 8 elmos
    const fz = Math.floor(elmoZ / 8);
    if (fx < 0 || fz < 0 || fx >= W || fz >= H) return;
    const i = (fz * W + fx) * 4;
    featureMap[i] = r;
    featureMap[i + 1] = g;
    featureMap[i + 2] = b;
    featureMap[i + 3] = 255;
  };

  // grass: per-cell blue from coverage × moisture noise, on lowland only
  const gfreq = (params.noiseFrequency * 6) / worldElmos;
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const ex = x * 8 + 4;
      const ez = z * 8 + 4;
      const h = sampleHeightElmo(height, dims, ex, ez);
      const c = classify(h, waterLevelNorm);
      let grass = 0;
      if (c === TERRAIN.LOWLAND || c === TERRAIN.MIDLAND) {
        const m = (moistNoise.raw2(ex * gfreq, ez * gfreq) + 1) / 2;
        grass = Math.round(params.grassCoverage * m * 255);
      }
      const i = (z * W + x) * 4;
      featureMap[i + 2] = grass;
      featureMap[i + 3] = 255;
    }
  }

  // geovents: on land, clear of mex spots and of each other
  const geoPts: Array<{ x: number; z: number }> = [];
  const geoMinDist2 = (worldElmos * 0.08) * (worldElmos * 0.08);
  for (let n = 0; n < params.geoventCount; n++) {
    for (let a = 0; a < 80; a++) {
      const ex = rng.range(0.08, 0.92) * worldElmos;
      const ez = rng.range(0.08, 0.92) * worldElmos;
      const h = sampleHeightElmo(height, dims, ex, ez);
      if (!isLand(h, waterLevelNorm, 0.01)) continue;
      if (!clearOfMex(ex, ez)) continue;
      if (geoPts.some((g) => (g.x - ex) ** 2 + (g.z - ez) ** 2 < geoMinDist2)) continue;
      setPixel(ex, ez, 0, 255, 0);
      features.push({ type: 'GeoVent', x: ex, z: ez, rot: 0 });
      geoPts.push({ x: ex, z: ez });
      break;
    }
  }

  // trees: scatter on lowland/midland by treeDensity. Each becomes a real
  // CreateFeature via the FeaturePlacer gadget, so keep the count playable
  // (~150–500) rather than carpeting the map with thousands.
  const treeTarget = Math.round((W * H) * 0.0012 * params.treeDensity * (0.75 + params.grassCoverage));
  for (let i = 0; i < treeTarget; i++) {
    const ex = rng.range(0.02, 0.98) * worldElmos;
    const ez = rng.range(0.02, 0.98) * worldElmos;
    const h = sampleHeightElmo(height, dims, ex, ez);
    const c = classify(h, waterLevelNorm);
    if ((c === TERRAIN.LOWLAND || c === TERRAIN.MIDLAND) && clearOfMex(ex, ez)) {
      const t = rng.int(0, TREE_TYPES - 1);
      setPixel(ex, ez, 0, 200 + t, 0);
      features.push({ type: `tree${t + 1}`, x: ex, z: ez, rot: rng.range(0, 360) });
    }
  }

  // rocks: scatter on highland/mountain by rockDensity, via fs.txt index
  const rockTarget = Math.round((W * H) * 0.004 * params.rockDensity);
  for (let i = 0; i < rockTarget; i++) {
    const ex = rng.range(0.02, 0.98) * worldElmos;
    const ez = rng.range(0.02, 0.98) * worldElmos;
    const h = sampleHeightElmo(height, dims, ex, ez);
    const c = classify(h, waterLevelNorm);
    if ((c === TERRAIN.HIGHLAND || c === TERRAIN.MOUNTAIN || c === TERRAIN.PEAK) && clearOfMex(ex, ez)) {
      const ri = rng.int(0, ROCK_FEATURES.length - 1);
      setPixel(ex, ez, 255 - ri, 0, 0);
      features.push({ type: ROCK_FEATURES[ri], x: ex, z: ez, rot: rng.range(0, 360) });
    }
  }

  return { featureMap, features, fsList };
}
