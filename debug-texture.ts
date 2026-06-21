/** Quantify terrain-class distribution and render a small texture preview. */
import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from './src/params.ts';
import { generateMap } from './src/gen/pipeline.ts';
import { classify, TERRAIN } from './src/gen/biomes.ts';
import { shadeColor } from './src/gen/texture.ts';
import { sampleHeightElmo } from './src/gen/dims.ts';
import { encodePngBuffer } from './src/export/png.ts';

const params = { ...DEFAULT_PARAMS };
const data = generateMap(params);
const dims = data.dims;
const wl = data.waterLevelNorm;

// height field stats
let hmin = Infinity, hmax = -Infinity;
for (const v of data.height) { if (v < hmin) hmin = v; if (v > hmax) hmax = v; }
console.log(`waterLevelNorm=${wl.toFixed(3)}  field norm range [${hmin.toFixed(3)}, ${hmax.toFixed(3)}]`);

// class distribution over the whole height field
const names = ['DEEP_WATER', 'SHALLOW_WATER', 'BEACH', 'LOWLAND', 'MIDLAND', 'HIGHLAND', 'MOUNTAIN', 'PEAK'];
const counts = new Array(8).fill(0);
for (const v of data.height) counts[classify(v, wl)]++;
const total = data.height.length;
console.log('terrain-class distribution:');
for (let i = 0; i < 8; i++) console.log(`  ${names[i].padEnd(14)} ${(counts[i] / total * 100).toFixed(1)}%`);
const land = counts[3] + counts[4] + counts[5] + counts[6] + counts[7];
const green = counts[3] + counts[4];
console.log(`LAND total ${(land / total * 100).toFixed(1)}%  of which green(low+mid) ${(green / land * 100).toFixed(1)}%, brown+(high+) ${((land - green) / land * 100).toFixed(1)}%`);

// render 512x512 downscale of the real texture (shadeColor over worldElmos)
const S = 512;
const buf = new Uint8Array(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const ex = ((x + 0.5) / S) * dims.worldElmos;
    const ez = ((y + 0.5) / S) * dims.worldElmos;
    const h = sampleHeightElmo(data.height, dims, ex, ez);
    const c = shadeColor(data.shade, ex, ez, h);
    const i = (y * S + x) * 4;
    buf[i] = c.r; buf[i + 1] = c.g; buf[i + 2] = c.b; buf[i + 3] = 255;
  }
}
writeFileSync('debug-texture.png', encodePngBuffer(S, S, 8, 6, buf));
console.log('wrote debug-texture.png (512x512 downscale of the real terrain texture)');
