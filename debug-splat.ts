import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from './src/params.ts';
import { generateMap } from './src/gen/pipeline.ts';
import { makeSplatDetailNormals, makeDetailTex, makeSplatDistribution } from './src/gen/splat.ts';
import { encodePngBuffer } from './src/export/png.ts';

const data = generateMap({ ...DEFAULT_PARAMS });
const dnts = makeSplatDetailNormals(data.params.seed);
dnts.forEach((t, i) => writeFileSync(`debug-dnt${i + 1}.png`, encodePngBuffer(t.size, t.size, 8, 6, t.rgba)));
const detail = makeDetailTex(data.params.seed);
writeFileSync('debug-detailtex.png', encodePngBuffer(detail.size, detail.size, 8, 6, detail.rgba));
const distr = makeSplatDistribution(data, data.dims, 512);
writeFileSync('debug-distr.png', encodePngBuffer(512, 512, 8, 6, distr));

// channel coverage of the distribution
let cliff = 0, rock = 0, grass = 0, sand = 0, n = 512 * 512;
for (let i = 0; i < n; i++) {
  if (distr[i * 4] > 64) cliff++;
  if (distr[i * 4 + 1] > 64) rock++;
  if (distr[i * 4 + 2] > 64) grass++;
  if (distr[i * 4 + 3] > 64) sand++;
}
console.log(`splat distribution coverage (>25%): cliff ${(cliff/n*100).toFixed(1)}%  rock ${(rock/n*100).toFixed(1)}%  grass ${(grass/n*100).toFixed(1)}%  sand ${(sand/n*100).toFixed(1)}%`);
console.log('wrote debug-dnt1..4.png, debug-detailtex.png, debug-distr.png');
