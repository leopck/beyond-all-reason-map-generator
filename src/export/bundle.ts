/**
 * Bundle exporter — assembles the BAR-ready source set into a .zip.
 *
 * Generates every PNG (texture streamed row-by-row; heightmap/metalmap/
 * featuremap/typemap from buffers), the Lua configs, fs.txt, mapinfo.lua and a
 * README with the MapConv command, then DEFLATE-compresses via JSZip.
 */
import JSZip from 'jszip';
import type { MapData } from '../types';
import {
  encodeHeightmapPng,
  encodePngStreaming,
  encodePngBuffer,
  encodeGray8Png,
  encodeTgaGray,
  type RowProvider,
} from './png';
import {
  mapinfoLua,
  metalLayoutLua,
  startBoxesLua,
  featurePlacerSetLua,
  readmeTxt,
} from './lua';
import { makeTextureRowProvider, makeMinimapRowProvider } from '../gen/texture';
import { metalCellToElmo, sampleHeightElmo } from '../gen/dims';
import { classify, typemapTile, TERRAIN } from '../gen/biomes';
import { makeSplatDistribution } from '../gen/splat';

export interface BundleProgress {
  stage: string;
  y: number;
  h: number;
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-]/g, '_') || 'ProceduralMap';
}

export async function buildBundle(
  data: MapData,
  onProgress?: (p: BundleProgress) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const root = sanitize(data.params.mapName);
  const folder = zip.folder(root)!;

  const { dims } = data;

  // --- heightmap (16-bit grayscale) ---
  onProgress?.({ stage: 'heightmap', y: 0, h: dims.heightH });
  const heightU16 = new Uint16Array(dims.heightW * dims.heightH);
  for (let i = 0; i < data.height.length; i++) {
    heightU16[i] = Math.max(0, Math.min(65535, Math.round(data.height[i] * 65535)));
  }
  const heightPng = encodeHeightmapPng(dims.heightW, dims.heightH, heightU16, (y, h) =>
    onProgress?.({ stage: 'heightmap', y, h }),
  );
  folder.file('heightmap.png', heightPng);

  // --- texture (RGBA, streamed) ---
  const texProvider: RowProvider = makeTextureRowProvider(data.shade);
  const texturePng = encodePngStreaming({
    width: dims.texture,
    height: dims.texture,
    bitDepth: 8,
    colorType: 6,
    rows: texProvider,
    level: 6,
    onProgress: (y, h) => onProgress?.({ stage: 'texture', y, h }),
  });
  folder.file('texture.png', texturePng);

  onProgress?.({ stage: 'minimap', y: 0, h: 1 });
  const minimapSize = 1024;
  const minimapProvider = makeMinimapRowProvider(data.shade, minimapSize);
  const minimapPng = encodePngStreaming({
    width: minimapSize,
    height: minimapSize,
    bitDepth: 8,
    colorType: 2,
    rows: minimapProvider,
    level: 6,
  });
  folder.file('minimap.png', minimapPng);

  // --- metalmap (8-bit grayscale; red channel IS the only channel) ---
  onProgress?.({ stage: 'metalmap', y: 0, h: dims.metalH });
  const metalPng = encodeGray8Png(dims.metalW, dims.metalH, data.metalMap);
  folder.file('metalmap.png', metalPng);

  // --- featuremap (RGBA) ---
  onProgress?.({ stage: 'featuremap', y: 0, h: dims.featureH });
  const featurePng = encodePngBuffer(dims.featureW, dims.featureH, 8, 6, data.featureMap);
  folder.file('featuremap.png', featurePng);

  // --- typemap (8-bit grayscale, xsize/2) ---
  onProgress?.({ stage: 'typemap', y: 0, h: dims.typeH });
  const typemap = new Uint8Array(dims.typeW * dims.typeH);
  for (let z = 0; z < dims.typeH; z++) {
    for (let x = 0; x < dims.typeW; x++) {
      const ex = metalCellToElmo(x);
      const ez = metalCellToElmo(z);
      const h = sampleHeightElmo(data.height, dims, ex, ez);
      typemap[z * dims.typeW + x] = typemapTile(classify(h, data.waterLevelNorm));
    }
  }
  const typePng = encodeGray8Png(dims.typeW, dims.typeH, typemap);
  folder.file('typemap.png', typePng);

  // --- vegetation/grass map (8-bit luminance, xsize/4; 255 = grass) ---
  // SpringMapConvNG -v writes this into the SMF grass extra-header so the engine
  // renders 3D grass blades. Grass grows on flat lowland/midland of green biomes,
  // gated by moisture noise so it's patchy and natural.
  // Grass via BAR's custom.grassConfig.grassDistTGA system (what real maps use,
  // e.g. crater_islands) — a higher-res, SMOOTH-gradient density map. The engine's
  // native SMF grass map (the old `-v` path) is only mapx/4 and binary, which
  // renders as pixelated 32-elmo blocks. This grassdist is 512² with soft
  // density falloff at slopes and dry edges → smooth grass.
  const GRASS_BIOMES = new Set(['temperate', 'alien', 'arctic']);
  if (GRASS_BIOMES.has(data.params.biome) &&
      data.params.terrainType !== 'metal' && data.params.terrainType !== 'air') {
    const gW = 512, gH = 512;
    const cell = dims.worldElmos / gW;
    const grass = new Uint8Array(gW * gH);
    const ctx = data.shade;
    const moistFreq = 1.5 / dims.worldElmos;
    for (let z = 0; z < gH; z++) {
      for (let x = 0; x < gW; x++) {
        const ex = (x + 0.5) * cell;
        const ez = (z + 0.5) * cell;
        const h = sampleHeightElmo(data.height, dims, ex, ez);
        const c = classify(h, data.waterLevelNorm);
        if (c !== TERRAIN.LOWLAND && c !== TERRAIN.MIDLAND) continue;
        const hN = sampleHeightElmo(data.height, dims, ex + cell, ez);
        const hE = sampleHeightElmo(data.height, dims, ex, ez + cell);
        const slope = Math.max(Math.abs(h - hN), Math.abs(h - hE)) * (data.maxHeight - data.minHeight) / cell;
        // smooth density: full on flat ground, fading out by ~0.55 rise:run
        const slopeFade = Math.max(0, Math.min(1, (0.55 - slope) / 0.25));
        const m = (ctx.moist.raw2(ex * moistFreq, ez * moistFreq) + 1) / 2; // broad patches
        const moistFade = Math.max(0, Math.min(1, (m - 0.2) / 0.4));
        const density = slopeFade * (0.5 + 0.5 * moistFade) * data.params.grassCoverage;
        grass[z * gW + x] = Math.round(Math.max(0, Math.min(1, density)) * 255);
      }
    }
    folder.file('grassdist.tga', encodeTgaGray(gW, gH, grass));
  }

  // --- SSMF splat distribution (per-map; the detail-normal materials it blends
  //     are the map_blueprint DDS assets injected by the server into maps/). ---
  onProgress?.({ stage: 'splat', y: 0, h: 1 });
  const distrSize = 512;
  const distr = makeSplatDistribution(data, dims, distrSize);
  folder.file('splat_distribution.png', encodePngBuffer(distrSize, distrSize, 8, 6, distr));

  // --- Lua configs (official BAR map_blueprint layout) ---
  folder.file('mapinfo.lua', mapinfoLua(data));
  const mapconfig = folder.folder('mapconfig')!;
  // features are placed by the bundled FeaturePlacer gadget reading this file
  mapconfig.folder('featureplacer')!.file('set.lua', featurePlacerSetLua(data));
  mapconfig.file('map_metal_layout.lua', metalLayoutLua(data));
  mapconfig.file('map_startboxes.lua', startBoxesLua(data));

  // --- README ---
  folder.file('README.txt', readmeTxt(data));

  onProgress?.({ stage: 'zipping', y: 0, h: 1 });
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => onProgress?.({ stage: 'zipping', y: Math.round(meta.percent), h: 100 }),
  );
  onProgress?.({ stage: 'done', y: 1, h: 1 });
  return blob;
}
