/**
 * Dimension engine — encodes the exact SMF source-image dimension math.
 * Derived from MapConv doc/README.txt (research RESEARCH.md §4.1).
 *
 * Given mapSize = N (game units, even), the layer pixel dimensions are:
 *   texture  = N * 512        (must be a multiple of 1024 → N even)
 *   xsize    = N * 64         (= texture / 8)
 *   heightmap= (xsize + 1)²   (grayscale, (N*64+1)²)
 *   metalmap = (xsize/2)²     (= (N*32)², red channel = metal, 8-bit)
 *   featuremap = xsize²       (= (N*64)²)
 *   typemap  = (xsize/2)²     (= (N*32)²)
 *
 * World (elmo) coordinates: 1 texture pixel = 1 elmo, so world width = texture.
 * Heightmap vertex i sits at elmo i*8; metalmap cell j covers 16 elmos (2 squares);
 * featuremap cell k covers 8 elmos (1 square), centered at k*8 + 4.
 */
import { MAP_SIZE_PRESETS } from '../params';

export interface MapDims {
  N: number;
  texture: number; // world elmos per side
  xsize: number;
  heightW: number; // xsize + 1
  heightH: number;
  metalW: number; // xsize / 2
  metalH: number;
  featureW: number; // xsize
  featureH: number;
  typeW: number; // xsize / 2
  typeH: number;
  worldElmos: number; // == texture
}

export function makeDims(mapSize: number): MapDims {
  if (!MAP_SIZE_PRESETS.includes(mapSize as (typeof MAP_SIZE_PRESETS)[number])) {
    // allow any even N >= 4 as a fallback
    if (mapSize < 4 || mapSize % 1 !== 0) {
      throw new Error(`mapSize ${mapSize} invalid; must be an integer >= 4`);
    }
  }
  if (mapSize % 2 !== 0) {
    throw new Error(
      `mapSize ${mapSize} must be even (so the texture is a multiple of 1024)`,
    );
  }
  const N = mapSize;
  const texture = N * 512;
  const xsize = N * 64;
  return {
    N,
    texture,
    xsize,
    heightW: xsize + 1,
    heightH: xsize + 1,
    metalW: xsize / 2,
    metalH: xsize / 2,
    featureW: xsize,
    featureH: xsize,
    typeW: xsize / 2,
    typeH: xsize / 2,
    worldElmos: texture,
  };
}

// --- coordinate conversions (all in elmos; texture px == elmos) ---

/** heightmap vertex index → world elmo (vertex spans [0, worldElmos] in steps of 8) */
export const heightVertexToElmo = (i: number): number => i * 8;

/** world elmo → heightmap vertex index (nearest) */
export const elmoToHeightVertex = (e: number, dims: MapDims): number =>
  Math.max(0, Math.min(dims.heightW - 1, Math.round(e / 8)));

/** texture pixel index → world elmo (1:1) */
export const texPxToElmo = (px: number): number => px;

/** metalmap cell index → center elmo (covers 2 squares = 16 elmos) */
export const metalCellToElmo = (j: number): number => j * 16 + 8;

/** featuremap cell index → center elmo (covers 1 square = 8 elmos) */
export const featureCellToElmo = (k: number): number => k * 8 + 4;

/** sample a heightmap Float32Array (row-major, width=heightW) with bilinear interp, elmo coords */
export function sampleHeightElmo(
  height: Float32Array,
  dims: MapDims,
  ex: number,
  ez: number,
): number {
  const fx = ex / 8;
  const fz = ez / 8;
  const x0 = Math.max(0, Math.min(dims.heightW - 1, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(dims.heightH - 1, Math.floor(fz)));
  const x1 = Math.min(dims.heightW - 1, x0 + 1);
  const z1 = Math.min(dims.heightH - 1, z0 + 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const h00 = height[z0 * dims.heightW + x0];
  const h10 = height[z0 * dims.heightW + x1];
  const h01 = height[z1 * dims.heightW + x0];
  const h11 = height[z1 * dims.heightW + x1];
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}
