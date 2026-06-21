/**
 * Headless bundle writer — mirrors src/export/bundle.ts but writes raw files
 * to ./debug-out/ instead of a browser zip, so we can compile on the server
 * and dissect the resulting SMF directly.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from './src/params.ts';
import { generateMap } from './src/gen/pipeline.ts';
import {
  encodeHeightmapPng, encodePngStreaming, encodePngBuffer, encodeGray8Png,
  type RowProvider,
} from './src/export/png.ts';
import { mapinfoLua, metalLayoutLua, startBoxesLua, featurePlacerSetLua } from './src/export/lua.ts';
import { makeSplatDistribution } from './src/gen/splat.ts';
import { makeTextureRowProvider, makeMinimapRowProvider } from './src/gen/texture.ts';
import { metalCellToElmo, sampleHeightElmo } from './src/gen/dims.ts';
import { classify, typemapTile } from './src/gen/biomes.ts';

const params = { ...DEFAULT_PARAMS };
const data = generateMap(params);
const dims = data.dims;
const out = 'debug-out';
mkdirSync(out, { recursive: true });

// heightmap
const heightU16 = new Uint16Array(dims.heightW * dims.heightH);
for (let i = 0; i < data.height.length; i++)
  heightU16[i] = Math.max(0, Math.min(65535, Math.round(data.height[i] * 65535)));
writeFileSync(`${out}/heightmap.png`, encodeHeightmapPng(dims.heightW, dims.heightH, heightU16));

// texture
writeFileSync(`${out}/texture.png`, encodePngStreaming({
  width: dims.texture, height: dims.texture, bitDepth: 8, colorType: 6,
  rows: makeTextureRowProvider(data.shade), level: 6,
}));

// minimap
const mmSize = 1024;
writeFileSync(`${out}/minimap.png`, encodePngStreaming({
  width: mmSize, height: mmSize, bitDepth: 8, colorType: 2,
  rows: makeMinimapRowProvider(data.shade, mmSize), level: 6,
}));

// metalmap
writeFileSync(`${out}/metalmap.png`, encodeGray8Png(dims.metalW, dims.metalH, data.metalMap));

// typemap
const typemap = new Uint8Array(dims.typeW * dims.typeH);
for (let z = 0; z < dims.typeH; z++)
  for (let x = 0; x < dims.typeW; x++) {
    const h = sampleHeightElmo(data.height, dims, metalCellToElmo(x), metalCellToElmo(z));
    typemap[z * dims.typeW + x] = typemapTile(classify(h, data.waterLevelNorm));
  }
writeFileSync(`${out}/typemap.png`, encodeGray8Png(dims.typeW, dims.typeH, typemap));

// vegetation/grass map — CONTIGUOUS fill (mirrors bundle.ts)
const gW = dims.xsize / 4, gH = dims.xsize / 4;
const cell = dims.worldElmos / gW;
const grass = new Uint8Array(gW * gH);
let grassCells = 0;
const moistFreq = 1.5 / dims.worldElmos;
for (let z = 0; z < gH; z++) for (let x = 0; x < gW; x++) {
  const ex = (x + 0.5) * cell, ez = (z + 0.5) * cell;
  const h = sampleHeightElmo(data.height, dims, ex, ez);
  const c = classify(h, data.waterLevelNorm);
  if (c !== 3 && c !== 4) continue;
  const hN = sampleHeightElmo(data.height, dims, ex + cell, ez);
  const hE = sampleHeightElmo(data.height, dims, ex, ez + cell);
  const slope = Math.max(Math.abs(h - hN), Math.abs(h - hE)) * (data.maxHeight - data.minHeight) / cell;
  if (slope > 0.55) continue;
  const m = (data.shade.moist.raw2(ex * moistFreq, ez * moistFreq) + 1) / 2;
  if (m < 0.3 * (1 - data.params.grassCoverage)) continue;
  grass[z * gW + x] = 255; grassCells++;
}
writeFileSync(`${out}/vegetationmap.png`, encodeGray8Png(gW, gH, grass));
console.log(`vegetation map ${gW}x${gH}: ${grassCells} grass cells (${(grassCells / (gW * gH) * 100).toFixed(1)}%) [contiguous]`);

// per-map splat distribution (R=cliff G=pebbles B=grass A=earth)
const distr = makeSplatDistribution(data, dims, 512);
writeFileSync(`${out}/splat_distribution.png`, encodePngBuffer(512, 512, 8, 6, distr));

// lua configs (blueprint layout — server places these into the scaffold)
writeFileSync(`${out}/mapinfo.lua`, mapinfoLua(data));
writeFileSync(`${out}/set.lua`, featurePlacerSetLua(data));
writeFileSync(`${out}/map_startboxes.lua`, startBoxesLua(data));
writeFileSync(`${out}/map_metal_layout.lua`, metalLayoutLua(data));

const trees = data.features.filter((f) => f.type.startsWith('tree')).length;
console.log(`wrote ${out}/ : height ${dims.heightW}x${dims.heightH}, tex ${dims.texture}, trees=${trees}`);
console.log(`minHeight=${data.minHeight.toFixed(2)} maxHeight=${data.maxHeight}`);
