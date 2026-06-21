/**
 * Texture renderer.
 *
 * Produces the color texture image at (N×512)² for MapConv. To avoid holding a
 * giant RGBA buffer for large maps, we expose a row-provider: the PNG encoder
 * pulls one row at a time and streams it into pako's incremental deflater.
 *
 * The same color logic (`shadeColor`) is reused by the preview renderer at a
 * lower resolution.
 */
import type { MapParams } from '../params';
import type { MapDims } from './dims';
import { Noise } from '../noise';
import { sampleHeightElmo } from './dims';
import { classify, BIOME_PALETTES, TERRAIN, type RGB } from './biomes';

const VERT_EXAGGERATION = 14; // relief shading strength
const LIGHT = normalize3(-0.6, 0.9, -0.45); // sun from upper-left

export interface ShadeContext {
  params: MapParams;
  dims: MapDims;
  height: Float32Array;
  waterLevelNorm: number;
  moist: Noise;
  grain: Noise;
  gfreq: number;
}

export function makeShadeContext(
  params: MapParams,
  dims: MapDims,
  height: Float32Array,
  waterLevelNorm: number,
): ShadeContext {
  return {
    params,
    dims,
    height,
    waterLevelNorm,
    moist: new Noise(params.seed + '::texm'),
    grain: new Noise(params.seed + '::grain'),
    gfreq: (params.noiseFrequency * 4) / dims.worldElmos,
  };
}

/** Final shaded RGB for a normalized height + position (shared by texture + preview). */
export function shadeColor(
  ctx: ShadeContext,
  ex: number,
  ez: number,
  h: number,
): RGB {
  const { params, waterLevelNorm } = ctx;
  const c = classify(h, waterLevelNorm);
  const pal = BIOME_PALETTES[params.biome][c];

  // hillshade via finite differences
  const step = 8;
  const hL = sampleHeightElmo(ctx.height, ctx.dims, ex - step, ez);
  const hR = sampleHeightElmo(ctx.height, ctx.dims, ex + step, ez);
  const hU = sampleHeightElmo(ctx.height, ctx.dims, ex, ez - step);
  const hD = sampleHeightElmo(ctx.height, ctx.dims, ex, ez + step);
  const dx = (hR - hL) * VERT_EXAGGERATION;
  const dz = (hD - hU) * VERT_EXAGGERATION;
  const nx = -dx;
  const ny = 1;
  const nz = -dz;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const shade = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl);
  const light = 0.55 + shade * 0.6;

  // moisture tint
  const m = (ctx.moist.raw2(ex * ctx.gfreq, ez * ctx.gfreq) + 1) / 2;
  const organic = params.terrainType !== 'metal' && params.terrainType !== 'air';
  const moistTint = organic && (c === TERRAIN.LOWLAND || c === TERRAIN.MIDLAND) ? 1 - m * 0.25 : 1;

  // grain
  const grainStrength = params.biome === 'lunar' ? 14 : params.terrainType === 'metal' ? 9 : 6;
  const g = ctx.grain.raw2(ex * 0.7, ez * 0.7) * grainStrength;

  let base = pal;
  if (params.terrainType === 'metal') {
    const panel = ((Math.floor(ex / 128) + Math.floor(ez / 128)) & 1) === 0 ? 1 : 0.78;
    const seam = ex % 128 < 3 || ez % 128 < 3 ? 0.42 : 1;
    const tint = params.biome === 'lunar' ? { r: 150, g: 154, b: 164 } : { r: 78, g: 88, b: 104 };
    base = {
      r: (pal.r * 0.3 + tint.r * 0.7) * panel * seam,
      g: (pal.g * 0.3 + tint.g * 0.7) * panel * seam,
      b: (pal.b * 0.3 + tint.b * 0.7) * panel * seam,
    };
  }

  const r = clampByte(base.r * light * moistTint + g);
  const gg = clampByte(base.g * light * moistTint + g);
  const b = clampByte(base.b * light * moistTint + g);
  return { r, g: gg, b };
}

export type RowProvider = (y: number) => Uint8Array;

/** Build a row-provider that yields RGBA rows for the full-res texture. */
export function makeTextureRowProvider(ctx: ShadeContext): RowProvider {
  const { dims } = ctx;
  const tex = dims.texture;
  const row = new Uint8Array(tex * 4);
  return (y: number): Uint8Array => {
    const ez = y + 0.5; // texture px == elmo
    for (let x = 0; x < tex; x++) {
      const ex = x + 0.5;
      const h = sampleHeightElmo(ctx.height, ctx.dims, ex, ez);
      const col = shadeColor(ctx, ex, ez, h);
      const i = x * 4;
      row[i] = col.r;
      row[i + 1] = col.g;
      row[i + 2] = col.b;
      row[i + 3] = 255;
    }
    return row;
  };
}

export function makeMinimapRowProvider(ctx: ShadeContext, size: number): RowProvider {
  const row = new Uint8Array(size * 3);
  return (y: number): Uint8Array => {
    const ez = ((y + 0.5) / size) * ctx.dims.worldElmos;
    for (let x = 0; x < size; x++) {
      const ex = ((x + 0.5) / size) * ctx.dims.worldElmos;
      const h = sampleHeightElmo(ctx.height, ctx.dims, ex, ez);
      const col = shadeColor(ctx, ex, ez, h);
      const index = x * 3;
      row[index] = col.r;
      row[index + 1] = col.g;
      row[index + 2] = col.b;
    }
    return row;
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const n = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / n, y / n, z / n];
}
