/** Report the heightmap slope distribution in DEGREES (the honest metric). */
import { DEFAULT_PARAMS } from './src/params.ts';
import { makeDims } from './src/gen/dims.ts';
import { generateHeightmap } from './src/gen/heightmap.ts';

const params = { ...DEFAULT_PARAMS };
if (process.env.BARGEN_MAXHEIGHT) params.maxHeight = Number(process.env.BARGEN_MAXHEIGHT);
if (process.env.BARGEN_FREQ) params.noiseFrequency = Number(process.env.BARGEN_FREQ);
if (process.env.BARGEN_OCT) params.noiseOctaves = Number(process.env.BARGEN_OCT);
if (process.env.BARGEN_PERSIST) params.persistence = Number(process.env.BARGEN_PERSIST);
const dims = makeDims(params.mapSize);
const { height, waterLevelNorm } = generateHeightmap(params, dims);
const W = dims.heightW, H = dims.heightH;
const maxHeight = params.maxHeight;
const minHeight = waterLevelNorm > 0 && waterLevelNorm < 1
  ? -(waterLevelNorm / (1 - waterLevelNorm)) * maxHeight : 0;
const range = maxHeight - minHeight;
const square = 8;

const buckets = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const counts = new Array(buckets.length + 1).fill(0);
let total = 0, maxDeg = 0;
for (let z = 0; z < H - 1; z++) {
  for (let x = 0; x < W - 1; x++) {
    const a = height[z * W + x];
    const r = height[z * W + x + 1];
    const d = height[(z + 1) * W + x];
    const dh = Math.max(Math.abs(a - r), Math.abs(a - d)) * range; // elmos per 8-elmo step
    const deg = Math.atan2(dh, square) * 180 / Math.PI;
    if (deg > maxDeg) maxDeg = deg;
    let b = buckets.findIndex(t => deg <= t);
    if (b < 0) b = buckets.length;
    counts[b]++;
    total++;
  }
}
console.log(`max slope ${maxDeg.toFixed(1)}°   (height range ${range.toFixed(0)} elmos)`);
let lo = 0;
for (let i = 0; i < buckets.length; i++) {
  console.log(`  ${String(lo).padStart(2)}–${String(buckets[i]).padStart(2)}°: ${(counts[i] / total * 100).toFixed(2)}%`);
  lo = buckets[i];
}
console.log(`  >${buckets[buckets.length - 1]}°: ${(counts[buckets.length] / total * 100).toFixed(2)}%`);
