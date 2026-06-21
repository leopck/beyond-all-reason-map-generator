/**
 * Startbox (team spawn) generator → mapconfig/map_startboxes.lua.
 *
 * Boxes are placed in world elmos and, in 'symmetric' mode, form a set invariant
 * under the terrain symmetry group so each team gets an equivalent spawn.
 *
 * Lua format (read by BAR's startbox_utilities.lua):
 *   return {
 *     [1] = { {x1=.., z1=.., x2=.., z2=..} },   -- allyteam 1
 *     [2] = { {x1=.., z1=.., x2=.., z2=..} },   -- allyteam 2
 *   }
 */
import type { MapParams } from '../params';
import type { MapDims } from './dims';
import type { StartBox } from '../types';
import { RNG } from '../rng';
import { orbit, terrainSymmetry, type Pt } from '../sym/symmetry';
import { sampleHeightElmo } from './dims';
import { isLand } from './biomes';

export interface StartBoxResult {
  startBoxes: StartBox[];
}

const BOX_FRAC = 0.13; // box side ~13% of map

export function generateStartBoxes(
  params: MapParams,
  dims: MapDims,
  height: Float32Array,
  waterLevelNorm: number,
): StartBoxResult {
  const rng = new RNG(params.seed + '::startbox');
  const W = dims.worldElmos;
  const tSym = params.startBoxMode === 'asymmetric' ? 'none' : terrainSymmetry(params);
  const teamCount = Math.max(1, params.teamCount);
  const boxSide = W * BOX_FRAC;

  // Choose `teamCount` primary centers, each on land, well-spaced.
  const centers: Pt[] = [];
  let attempts = 0;
  while (centers.length < teamCount && attempts < 600) {
    attempts++;
    let cx: number;
    let cz: number;
    if (params.startBoxMode === 'corners') {
      cx = rng.range(0.06, 0.22) * W;
      cz = rng.range(0.06, 0.22) * W;
    } else if (params.startBoxMode === 'edges') {
      cx = rng.range(0.06, 0.22) * W;
      cz = rng.range(0.35, 0.65) * W;
    } else {
      cx = rng.range(0.08, 0.42) * W;
      cz = rng.range(0.12, 0.88) * W;
    }

    const orbitPts = orbit({ x: cx, z: cz }, W, tSym);

    // every image of the candidate must be on land
    let ok = true;
    for (const p of orbitPts) {
      const h = sampleHeightElmo(height, dims, p.x, p.z);
      if (!isLand(h, waterLevelNorm, 0.02)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // spacing from all existing centers (and their orbits)
    let tooClose = false;
    const minD = boxSide * 1.6;
    for (const c of centers) {
      for (const p of orbitPts) {
        if (dist2(c, p) < minD * minD) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) break;
    }
    if (tooClose) continue;

    centers.push({ x: cx, z: cz });
  }

  // Fallback: relax land requirement if we couldn't place enough.
  while (centers.length < teamCount) {
    centers.push({ x: rng.range(0.1, 0.9) * W, z: rng.range(0.1, 0.9) * W });
  }

  // Build one box per team. For symmetric modes the box positions are mirrored
  // images of the primary center; for teamCount > orbit size we add extras.
  const startBoxes: StartBox[] = [];
  for (let i = 0; i < teamCount; i++) {
    const c = centers[i % centers.length];
    // mirror this center so team i's box respects symmetry
    const images = orbit(c, W, tSym);
    const p = images[i % images.length];
    startBoxes.push(boxAround(p, boxSide, W, i));
  }

  return { startBoxes };
}

function boxAround(c: Pt, side: number, world: number, team: number): StartBox {
  const half = side / 2;
  return {
    team,
    x1: clamp(c.x - half, 0, world),
    z1: clamp(c.z - half, 0, world),
    x2: clamp(c.x + half, 0, world),
    z2: clamp(c.z + half, 0, world),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
