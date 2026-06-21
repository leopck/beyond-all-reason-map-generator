/**
 * Generation pipeline — orchestrates every stage into a single MapData.
 *
 * Order matters: heightmap → water level → startboxes → metal (biased near
 * starts) → features → shade context (texture generated lazily at export).
 * The expensive full-res texture is NOT materialized here; the exporter pulls
 * it row-by-row via the shade context.
 */
import type { MapParams } from '../params';
import type { MapData, MapStats } from '../types';
import { makeDims, sampleHeightElmo } from './dims';
import { generateHeightmap } from './heightmap';
import { generateStartBoxes } from './startboxes';
import { generateMetal } from './metal';
import { generateFeatures } from './features';
import { makeShadeContext } from './texture';

export function generateMap(params: MapParams): MapData {
  const snapshot = { ...params };
  const dims = makeDims(snapshot.mapSize);

  // 1. heightmap + water level
  const { height, waterLevelNorm } = generateHeightmap(snapshot, dims);

  // 2. startboxes (on land, symmetry-aware)
  const { startBoxes } = generateStartBoxes(snapshot, dims, height, waterLevelNorm);

  // 3. metal (discrete mex spots + continuous metalmap), biased near starts
  const { metalMap, mexSpots } = generateMetal(
    snapshot,
    dims,
    height,
    waterLevelNorm,
    startBoxes,
  );

  // 4. features (geovents/trees/rocks/grass) + fs.txt — kept clear of mex spots
  const { featureMap, features, fsList } = generateFeatures(
    snapshot,
    dims,
    height,
    waterLevelNorm,
    mexSpots,
  );

  // 5. shade context (texture/typemap generated lazily by exporter/preview)
  const shade = makeShadeContext(snapshot, dims, height, waterLevelNorm);

  // Anchor the coastline at 0 elmos (Spring water level).
  // waterLevelNorm is the normalized height at which sea meets land; mapping
  // that to 0 elmos requires minHeight to be negative.
  const maxHeight = snapshot.maxHeight;
  const minHeight = waterLevelNorm > 0 && waterLevelNorm < 1
    ? -(waterLevelNorm / (1 - waterLevelNorm)) * maxHeight
    : 0;

  const stats = computeStats(
    height,
    waterLevelNorm,
    mexSpots.length,
    features.length,
    snapshot.teamCount,
    dims.texture,
  );

  return {
    params: snapshot,
    dims,
    height,
    metalMap,
    mexSpots,
    featureMap,
    features,
    fsList,
    startBoxes,
    shade,
    minHeight,
    maxHeight,
    waterLevelNorm,
    stats,
  };
}

function computeStats(
  height: Float32Array,
  waterLevelNorm: number,
  mexCount: number,
  featureCount: number,
  teamCount: number,
  texture: number,
): MapStats {
  let water = 0;
  const step = Math.max(1, Math.floor(Math.sqrt(height.length) / 512));
  let counted = 0;
  for (let i = 0; i < height.length; i += step) {
    if (height[i] < waterLevelNorm) water++;
    counted++;
  }
  // rough .sd7 size estimate: texture RGBA compressed ~0.25 + heightmap + metal
  const rawTexBytes = texture * texture * 4;
  const estSd7Bytes = Math.round(rawTexBytes * 0.22 + height.length * 2 * 0.5 + 65536);
  return {
    waterFraction: counted ? water / counted : 0,
    mexCount,
    featureCount,
    teamCount,
    estSd7Bytes,
  };
}

export { sampleHeightElmo };
