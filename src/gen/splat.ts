/**
 * Per-map SSMF splat distribution texture.
 *
 * The detail-normal materials are the official map_blueprint DDS assets injected
 * by the server. Only the distribution is map-specific: an RGBA texture whose
 * channels are the blend weights for splatDetailNormalTex1..4. Channel order
 * matches the blueprint mapinfo ("cliffs, pebbles, grass, metalspots"):
 *   R = cliffs (Rock_Brown), G = pebbles/rocky dirt (LargeScaleRockyDirt),
 *   B = grass (GrassThickGreen), A = bare earth (earth_NORM).
 */
import type { MapData } from '../types';
import type { MapDims } from './dims';
import { sampleHeightElmo } from './dims';
import { classify, TERRAIN } from './biomes';

export function makeSplatDistribution(data: MapData, dims: MapDims, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const cell = dims.worldElmos / size;
  const range = data.maxHeight - data.minHeight;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ex = (x + 0.5) * cell;
      const ez = (y + 0.5) * cell;
      const hh = sampleHeightElmo(data.height, dims, ex, ez);
      const hN = sampleHeightElmo(data.height, dims, ex + cell, ez);
      const hE = sampleHeightElmo(data.height, dims, ex, ez + cell);
      const slope = (Math.max(Math.abs(hh - hN), Math.abs(hh - hE)) * range) / cell; // rise:run
      const c = classify(hh, data.waterLevelNorm);

      let cliff = 0, pebbles = 0, grass = 0, earth = 0;
      if (c === TERRAIN.LOWLAND || c === TERRAIN.MIDLAND) grass = 1;
      else if (c === TERRAIN.BEACH) earth = 1;          // shorelines → bare earth/sand
      else pebbles = 1;                                  // highland → rocky dirt

      // steepness overrides flat materials with cliff rock
      const steep = Math.max(0, Math.min(1, (slope - 0.4) / 0.45));
      cliff = steep;
      grass *= 1 - steep;
      pebbles = Math.max(pebbles * (1 - steep), 0);
      // mild rocky-dirt fringe between grass and cliffs
      pebbles = Math.max(pebbles, steep * 0.4);

      const i = (y * size + x) * 4;
      out[i] = Math.round(cliff * 255);
      out[i + 1] = Math.round(pebbles * 255);
      out[i + 2] = Math.round(grass * 255);
      out[i + 3] = Math.round(earth * 255);
    }
  }
  return out;
}
