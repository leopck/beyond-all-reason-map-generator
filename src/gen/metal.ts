/**
 * Metal/resource layer.
 *
 * Two outputs (research RESEARCH.md §4.3):
 *  1. Continuous metalmap — 8-bit, RED channel = metal density at (xsize/2)².
 *  2. Discrete mex spots — world-elmo coordinates for map_metal_layout.lua.
 *
 * Spots are placed on land with min-distance rejection, then mirrored under the
 * metal-symmetry group so resources are fair even on asymmetric terrain.
 */
import type { MapParams } from '../params';
import type { MapDims } from './dims';
import type { MapData, MexSpot, StartBox } from '../types';
import { RNG } from '../rng';
import { METAL_DENSITY_MULT } from '../params';
import { metalSymmetry, orbit, type Pt } from '../sym/symmetry';
import { sampleHeightElmo } from './dims';
import { isLand } from './biomes';

export interface MetalResult {
  metalMap: Uint8Array;
  mexSpots: MexSpot[];
}

export const __debug = { landFail: 0, distFail: 0, attempts: 0, target: 0, minDist: 0 };

export function generateMetal(
  params: MapParams,
  dims: MapDims,
  height: Float32Array,
  waterLevelNorm: number,
  startBoxes: StartBox[],
): MetalResult {
  const rng = new RNG(params.seed + '::metal');
  const mSym = metalSymmetry(params);
  const W = dims.worldElmos;
  const { metalW, metalH } = dims;

  const metalMap = new Uint8Array(metalW * metalH);
  __debug.landFail = 0; __debug.distFail = 0; __debug.attempts = 0;

  // Total mex spots wanted across the whole map, scaled by map size (game units)
  // and the density knob. Real BAR maps run ~8–40 spots total — NOT hundreds.
  // tryPlace() emits one canonical spot plus all its symmetry images, so the
  // canonical target is desiredTotal / orbitSize (else a mirror map gets double).
  const orbitSize = Math.max(1, orbit({ x: W * 0.3, z: W * 0.37 }, W, mSym).length);
  const desiredTotal = Math.max(
    8,
    Math.min(48, Math.round(dims.N * 1.5 * METAL_DENSITY_MULT[params.metalDensity])),
  );
  const target = Math.max(2, Math.round(desiredTotal / orbitSize));

  // min distance between mex spots (elmos) — large enough that spots are
  // distinct, playable extractor sites rather than a metal carpet.
  const minDist =
    params.metalDistribution === 'clustered'
      ? W * 0.07
      : params.metalDistribution === 'spread'
        ? W * 0.14
        : W * 0.10;
  const clusterRadius = W * 0.08;
  __debug.target = target; __debug.minDist = minDist;

  const placed: Pt[] = []; // canonical representatives (full map, deduped)
  const mexSpots: MexSpot[] = [];

  // a few guaranteed starting-metal spots near each startbox
  const startingPerBox = 2;

  const tryPlace = (cx: number, cz: number): boolean => {
    __debug.attempts++;
    const h = sampleHeightElmo(height, dims, cx, cz);
    if (!isLand(h, waterLevelNorm, 0.004)) {
      __debug.landFail++;
      return false;
    }
    // Build this candidate's full orbit (canonical + every mirror image) and
    // reject if ANY image is too close to ANY already-placed mex image. The old
    // code only checked the canonical reps, so a mirror of spot A could land on
    // top of spot B (or B's mirror) — that was the "overlapping metal" bug.
    const imgs = orbit({ x: cx, z: cz }, W, mSym).map((p) => ({
      x: clampElmo(p.x, W),
      z: clampElmo(p.z, W),
      amount: 1,
    }));
    const md2 = minDist * minDist;
    for (const img of imgs) {
      for (const m of mexSpots) {
        if (dist2(img, m) < md2) { __debug.distFail++; return false; }
      }
    }
    // also reject if the candidate's own images collide (spot near a symmetry
    // axis/centre maps close to its own mirror)
    for (let i = 0; i < imgs.length; i++) {
      for (let j = i + 1; j < imgs.length; j++) {
        if (dist2(imgs[i], imgs[j]) < md2) { __debug.distFail++; return false; }
      }
    }
    for (const p of imgs) mexSpots.push(p);
    placed.push({ x: cx, z: cz });
    return true;
  };

  // starting metal near each startbox center
  for (const sb of startBoxes) {
    const ccx = (sb.x1 + sb.x2) / 2;
    const ccz = (sb.z1 + sb.z2) / 2;
    for (let i = 0; i < startingPerBox; i++) {
      for (let a = 0; a < 12; a++) {
        const ang = rng.range(0, Math.PI * 2);
        const rad = rng.range(0, (sb.x2 - sb.x1) * 0.6);
        if (
          tryPlace(
            clampElmo(ccx + Math.cos(ang) * rad, W),
            clampElmo(ccz + Math.sin(ang) * rad, W),
          )
        ) {
          break;
        }
      }
    }
  }

  // fill the rest: clustered → few cluster centers; spread → jittered grid; mixed
  const remaining = target - placed.length;
  if (params.metalDistribution === 'clustered') {
    const clusters = Math.max(2, Math.round(remaining / 5));
    for (let c = 0; c < clusters && placed.length < target; c++) {
      const cx = rng.range(0.1, 0.9) * W;
      const cz = rng.range(0.1, 0.9) * W;
      for (let i = 0; i < 60 && placed.length < target; i++) {
        const ang = rng.range(0, Math.PI * 2);
        const rad = rng.range(0, clusterRadius);
        tryPlace(clampElmo(cx + Math.cos(ang) * rad, W), clampElmo(cczWrap(cz, ang, rad, W), W));
      }
    }
  } else {
    // spread / mixed: jittered grid over the primary region
    const grid = Math.max(2, Math.ceil(Math.sqrt(remaining)));
    const step = W / grid;
    for (let gy = 0; gy < grid && placed.length < target; gy++) {
      for (let gx = 0; gx < grid && placed.length < target; gx++) {
        const jx = params.metalDistribution === 'spread' ? rng.range(0, step * 0.5) : rng.range(0, step);
        const jz = rng.range(0, step * 0.6);
        tryPlace(gx * step + jx + step * 0.25, gy * step + jz + step * 0.25);
      }
    }
  }

  // paint continuous metalmap (red channel): Gaussian blob per mex spot
  for (const m of mexSpots) {
    const mx = m.x / 16; // metalmap cell = 16 elmos
    const mz = m.z / 16;
    const r = 1.6; // cells
    const x0 = Math.max(0, Math.floor(mx - r));
    const x1 = Math.min(metalW - 1, Math.ceil(mx + r));
    const y0 = Math.max(0, Math.floor(mz - r));
    const y1 = Math.min(metalH - 1, Math.ceil(mz + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - mx;
        const dy = y - mz;
        const d2 = dx * dx + dy * dy;
        const v = Math.exp(-d2 / (2 * 0.7 * 0.7)) * 255;
        const idx = y * metalW + x;
        if (v > metalMap[idx]) metalMap[idx] = Math.round(v);
      }
    }
  }

  return { metalMap, mexSpots };
}

function clampElmo(v: number, W: number): number {
  return Math.max(8, Math.min(W - 8, v));
}

function cczWrap(cz: number, ang: number, rad: number, W: number): number {
  return clampElmo(cz + Math.sin(ang) * rad, W);
}

function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export default generateMetal;
