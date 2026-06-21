/**
 * Central generated-map data structure. Every generator stage fills a field
 * here; every exporter (png/lua/bundle/sd7) reads from it. Keeping a single
 * `MapData` lets the .zip (Phase 1) and .sd7 (Phase 2) share one emitter.
 */
import type { MapParams } from './params';
import type { MapDims } from './gen/dims';
import type { ShadeContext } from './gen/texture';

export interface MexSpot {
  x: number; // world elmos
  z: number;
  amount: number; // extraction amount (informational)
}

export interface Feature {
  type: string; // fs.txt tdfname
  x: number; // world elmos
  z: number;
  rot: number; // radians? Spring uses degrees on y-axis; we store degrees
}

export interface StartBox {
  team: number; // 0-based team index
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface MapStats {
  waterFraction: number;
  mexCount: number;
  featureCount: number;
  teamCount: number;
  estSd7Bytes: number;
}

export interface MapData {
  params: MapParams;
  dims: MapDims;

  /** normalized elevation [0,1], dims.heightW × dims.heightH (row-major) */
  height: Float32Array;

  /** continuous metal density 0..255 (red channel), dims.metalW × dims.metalH */
  metalMap: Uint8Array;

  /** discrete mex spots in world elmos (symmetry-locked) */
  mexSpots: MexSpot[];

  /** featuremap RGBA, dims.featureW × dims.featureH
   *  R: feature index (255 - line in fs.txt)
   *  G: 255-geovent / 200..215 trees(types) / 0
   *  B: grass density 0..255
   *  A: unused
   */
  featureMap: Uint8Array;
  features: Feature[]; // parsed list for preview
  fsList: string[]; // feature type names, one per line → fs.txt

  /** team spawn boxes in world elmos */
  startBoxes: StartBox[];

  /** shading context — texture/typemap are generated lazily (streamed) at export */
  shade: ShadeContext;

  /** SMF vertical range (world elmos) */
  minHeight: number;
  maxHeight: number;
  waterLevelNorm: number; // [0,1] in normalized height

  stats: MapStats;
}
