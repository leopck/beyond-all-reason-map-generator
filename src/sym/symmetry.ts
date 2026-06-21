/**
 * Symmetry engine — the competitive-fairness layer.
 *
 * BAR maps are competitive; teams must get mirrored/rotated terrain & resources
 * or the map is unfair. The research confirmed NO prior Spring/BAR generator
 * implements symmetry mirroring — we build it here.
 *
 * Two surfaces:
 *  1. Coordinate transforms: given a point in world elmos, enumerate its orbit
 *     under the symmetry group (used to mirror discrete placements: mex spots,
 *     features, startboxes).
 *  2. Field symmetrizer: average a continuous field (heightmap, metalmap,
 *     texture) across its orbit so the field is invariant under the group.
 */
import type { MapParams, Symmetry } from '../params';
import type { MapDims } from '../gen/dims';

export interface Pt {
  x: number;
  z: number;
}

/** The symmetry applied to TERRAIN. teamAsym → no terrain symmetry. */
export function terrainSymmetry(p: MapParams): Symmetry {
  return p.symmetry === 'teamAsym' ? 'none' : p.symmetry;
}

/** The symmetry applied to RESOURCES (mex/geo). teamAsym → resources still mirror. */
export function metalSymmetry(p: MapParams): Symmetry {
  if (p.symmetry === 'teamAsym') return 'mirror';
  return p.metalSpotSymmetry ? p.symmetry : 'none';
}

/**
 * Enumerate all image points of `p` under the symmetry group, including itself.
 * Coordinates are world elmos in [0, worldElmos].
 */
export function orbit(p: Pt, worldElmos: number, sym: Symmetry): Pt[] {
  const W = worldElmos;
  const x = p.x;
  const z = p.z;
  switch (sym) {
    case 'none':
      return [{ x, z }];
    case 'flip': // left↔right across vertical center axis
      return [
        { x, z },
        { x: W - x, z },
      ];
    case 'mirror': // point / 180°
    case 'rotate2':
      return [
        { x, z },
        { x: W - x, z: W - z },
      ];
    case 'rotate4': // C4, 90° rotations about center
      return [
        { x, z }, // 0°
        { x: W - z, z: x }, // 90°
        { x: W - x, z: W - z }, // 180°
        { x: z, z: W - x }, // 270°
      ];
    default:
      return [{ x, z }];
  }
}

/** Number of images in the orbit (1,2,2,4 for none/flip/mirror/rotate4). */
export function orbitSize(sym: Symmetry): number {
  switch (sym) {
    case 'none':
      return 1;
    case 'flip':
    case 'mirror':
    case 'rotate2':
      return 2;
    case 'rotate4':
      return 4;
    default:
      return 1;
  }
}

/**
 * Symmetrize a continuous field in-place by averaging across the orbit.
 * Works for Float32Array (heightmap) — exact invariance under the group.
 */
export function symmetrizeField(
  field: Float32Array,
  W: number,
  H: number,
  worldElmos: number,
  sym: Symmetry,
): void {
  if (sym === 'none') return;
  const out = new Float32Array(field.length);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      // Height fields are vertex grids: endpoints sit exactly at 0 and worldElmos.
      const ex = (x / (W - 1)) * worldElmos;
      const ez = (z / (H - 1)) * worldElmos;
      const pts = orbit({ x: ex, z: ez }, worldElmos, sym);
      let acc = 0;
      for (const p of pts) {
        const sx = Math.min(W - 1, Math.max(0, Math.round((p.x / worldElmos) * (W - 1))));
        const sz = Math.min(H - 1, Math.max(0, Math.round((p.z / worldElmos) * (H - 1))));
        acc += field[sz * W + sx];
      }
      out[z * W + x] = acc / pts.length;
    }
  }
  field.set(out);
}

/**
 * Symmetrize an 8-bit field (metalmap, typemap). Averages then clamps/rounds.
 */
export function symmetrizeByteField(
  field: Uint8Array,
  W: number,
  H: number,
  worldElmos: number,
  sym: Symmetry,
): void {
  if (sym === 'none') return;
  const out = new Uint8Array(field.length);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const ex = ((x + 0.5) / W) * worldElmos;
      const ez = ((z + 0.5) / H) * worldElmos;
      const pts = orbit({ x: ex, z: ez }, worldElmos, sym);
      let acc = 0;
      for (const p of pts) {
        const sx = Math.min(W - 1, Math.max(0, Math.floor((p.x / worldElmos) * W)));
        const sz = Math.min(H - 1, Math.max(0, Math.floor((p.z / worldElmos) * H)));
        acc += field[sz * W + sx];
      }
      out[z * W + x] = Math.round(acc / pts.length);
    }
  }
  field.set(out);
}
