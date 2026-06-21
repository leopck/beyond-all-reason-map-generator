import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/params';
import { generateMap } from '../src/gen/pipeline';
import { buildBundle } from '../src/export/bundle';

const params = {
  ...DEFAULT_PARAMS,
  mapSize: 6,
  seed: 'closed-loop-validation',
  mapName: 'BAR_Generator_Validation',
  erosion: 'light' as const,
  detailNoise: 0.65,
};

function roughness(height: Float32Array, width: number): object {
  let maxStep = 0;
  let extreme = 0;
  let compared = 0;
  for (let index = 0; index < height.length; index++) {
    if (index % width) {
      const delta = Math.abs(height[index] - height[index - 1]);
      maxStep = Math.max(maxStep, delta);
      if (delta > 0.125) extreme++;
      compared++;
    }
    if (index >= width) {
      const delta = Math.abs(height[index] - height[index - width]);
      maxStep = Math.max(maxStep, delta);
      if (delta > 0.125) extreme++;
      compared++;
    }
  }
  return { maxStep, extremeStepFraction: extreme / compared };
}

const variants = [
  { erosion: 'none' as const, detailNoise: 0 },
  { erosion: 'none' as const, detailNoise: 0.65 },
  { erosion: 'light' as const, detailNoise: 0 },
  { erosion: 'light' as const, detailNoise: 0.65 },
];
for (const variant of variants) {
  const candidate = generateMap({ ...params, ...variant });
  console.log(JSON.stringify({ variant, roughness: roughness(candidate.height, candidate.dims.heightW) }));
}

const map = generateMap(params);
const bundle = await buildBundle(map);
writeFileSync('scripts/validation-source.zip', Buffer.from(await bundle.arrayBuffer()));
console.log(JSON.stringify({
  output: 'scripts/validation-source.zip',
  dimensions: map.dims,
  features: map.features.length,
  waterFraction: map.stats.waterFraction,
}));
