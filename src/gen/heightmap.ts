/**
 * Heightmap generator.
 *
 * Pipeline: warped fbm + ridged mountains → terrain-type shaping →
 * choke-point carving → (optional) hydraulic erosion → symmetry mirroring →
 * normalization. Output is a normalized [0,1] Float32Array at heightW×heightH.
 */
import type { MapParams } from '../params';
import type { MapDims } from './dims';
import { Noise } from '../noise';
import { RNG } from '../rng';
import { symmetrizeField, terrainSymmetry } from '../sym/symmetry';

/** quantile via sorting a small sample (good enough for sea-level target) */
function sampleQuantile(field: Float32Array, q: number): number {
  const n = field.length;
  const step = Math.max(1, Math.floor(n / 4096));
  const sample: number[] = [];
  for (let i = 0; i < n; i += step) sample.push(field[i]);
  sample.sort((a, b) => a - b);
  const idx = Math.min(sample.length - 1, Math.floor(q * sample.length));
  return sample[idx];
}

export interface HeightResult {
  height: Float32Array;
  waterLevelNorm: number;
}

export function generateHeightmap(
  params: MapParams,
  dims: MapDims,
): HeightResult {
  const { heightW: W, heightH: H, worldElmos } = dims;
  const noise = new Noise(params.seed);
  const rng = new RNG(params.seed + '::height');

  const height = new Float32Array(W * H);

  // Use elmo coordinates so noise spans several periods across the map.
  // (heightmap vertex (x,z) sits at elmo (x*8, z*8); baseFreq gives ~5 features.)
  const baseFreq = (params.noiseFrequency * 5) / worldElmos;
  const oct = params.noiseOctaves;
  const persist = params.persistence;
  const lacun = params.lacunarity;
  const warp = 0.35;
  const detailFreq = baseFreq * 12;

  const difficulty = params.terrainDifficulty; // 0..1
  const mountainWeight = 0.2 + difficulty * 0.8;

  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const ex = x * 8; // world elmos
      const ez = z * 8;

      // base landmass in [0,1] (fbm remapped); mean ~0.5 → real land area
      const base = noise.warpedFbm(ex, ez, oct, baseFreq, persist, lacun, warp);
      const fbm01 = base * 0.5 + 0.5;
      const ridge = noise.ridged2(ex, ez, Math.max(3, oct - 1), baseFreq * 1.7, persist, lacun);

      // mountains grow on already-elevated terrain (concentrated ridges)
      const elev = smoothstep(0.35, 0.75, fbm01);
      const mountains = (ridge * ridge) * elev * mountainWeight * 0.6;

      let h: number;
      switch (params.terrainType) {
        case 'metal': // flat metal/space floor with faint relief
          h = 0.34 + base * 0.03 + ridge * 0.01;
          break;
        case 'air': // very flat, air-focused
          h = 0.42 + base * 0.02 + ridge * 0.005;
          break;
        case 'islands': // distinct landmasses (sharper coastlines)
          h = smoothstep(0.45, 0.62, fbm01) + mountains * 0.5;
          break;
        case 'water': // naval: lower base, smoother
          h = fbm01 * 0.75 - 0.12 + mountains * 0.6;
          break;
        case 'mixed':
          h = fbm01 + mountains * 0.7 - 0.05;
          break;
        case 'land':
        default:
          h = fbm01 + mountains;
          break;
      }

      // small-scale detail (high frequency)
      h += noise.raw2(ex * detailFreq, ez * detailFreq) * 0.02 * params.detailNoise;

      height[z * W + x] = h;
    }
  }

  // choke points: carve traversable passes through ridges to improve land pathing
  if (params.chokePoints && params.terrainType !== 'metal' && params.terrainType !== 'air') {
    carveChokePoints(height, W, H, worldElmos, params, rng);
  }

  // normalize to [0,1]
  normalize(height);

  // Flat presets still need normalized source data, but must not be stretched
  // back into a full mountain range by normalization.
  if (params.terrainType === 'metal') remapRange(height, 0.38, 0.5);
  if (params.terrainType === 'air') remapRange(height, 0.46, 0.49);

  // erosion (after normalization so droplets act on 0..1 field)
  if (params.erosion !== 'none' && params.terrainType !== 'metal' && params.terrainType !== 'air') {
    const iterations = params.erosion === 'heavy' ? 6 : 2;
    const strength = params.erosion === 'heavy' ? 0.32 : 0.2;
    smoothErosion(height, W, H, iterations, strength);
    normalize(height);
  }

  // symmetry mirroring (terrain) — exact invariance under the group
  symmetrizeField(height, W, H, worldElmos, terrainSymmetry(params));

  // Water level must be computed BEFORE limitSlopes so we know the full elmo
  // range (which includes the negative underwater portion). The terrain TYPE
  // sets the base water fraction (a "water/naval" map is mostly sea, "land" is
  // mostly land); the Water-amount knob fine-tunes within that band.
  let waterLevelNorm: number;
  if (params.terrainType === 'metal' || params.terrainType === 'air') {
    waterLevelNorm = 0;
  } else {
    waterLevelNorm = sampleQuantile(height, effectiveSeaQuantile(params));
  }

  // Total elmo range = maxHeight - minHeight.
  // minHeight = -(waterLevelNorm / (1 - waterLevelNorm)) * maxHeight (see pipeline.ts).
  // So totalElmoRange = maxHeight / (1 - waterLevelNorm).
  const totalElmoRange = waterLevelNorm > 0 && waterLevelNorm < 1
    ? params.maxHeight / (1 - waterLevelNorm)
    : params.maxHeight;

  // PLAYABILITY: cap terrain slope to a sane maximum. The metric that matters
  // is the real-world slope angle: slope° = atan(Δheight_elmos / squareSize).
  // The old "40 elmos / 8-elmo step" cap was atan(40/8)=atan(5)=78.7° — a
  // near-vertical cliff — which is why maps rendered as a field of needles even
  // though the heightmap was "smooth" by that bogus measure. We now (a) smooth
  // out high-frequency oscillation so the terrain rolls, then (b) hard-cap the
  // adjacent-vertex slope at MAX_SLOPE_DEG.
  const square = 8;
  const maxSlopeDeg = envNum('BARGEN_MAXSLOPE', 34); // ~34° steepest face
  // Light low-pass only. With 4 octaves the terrain has little high-frequency
  // noise to begin with, so a heavy blur (the old 40 passes) just dissolved the
  // terrain-type character — coastlines, island gaps, water basins — into one
  // uniform mush. 14 passes removes residual bumps while keeping islands islands.
  const smoothPasses = envNum('BARGEN_SMOOTH', 14);
  if (params.terrainType !== 'metal' && params.terrainType !== 'air') {
    smoothErosion(height, W, H, smoothPasses, 0.5);
    // re-derive water level on the smoothed field (smoothing shifts the median)
    waterLevelNorm = sampleQuantile(height, effectiveSeaQuantile(params));
  }
  const totalElmoRange2 = waterLevelNorm > 0 && waterLevelNorm < 1
    ? params.maxHeight / (1 - waterLevelNorm)
    : params.maxHeight;
  const maxStepElmos = Math.tan((maxSlopeDeg * Math.PI) / 180) * square;
  const maxNormalizedStep = maxStepElmos / Math.max(1, totalElmoRange2);
  // hard slope cap, then restore exact symmetry (cap can perturb it slightly)
  limitSlopes(height, W, H, maxNormalizedStep);
  symmetrizeField(height, W, H, worldElmos, terrainSymmetry(params));
  void totalElmoRange;

  return { height, waterLevelNorm };
}

/**
 * Water-coverage quantile per terrain type. The type sets the base fraction of
 * the map that sits below sea level; the seaLevel knob (0..0.8) fine-tunes it.
 * This is what actually makes land / islands / water / mixed look different.
 */
function effectiveSeaQuantile(params: MapParams): number {
  const s = params.seaLevel; // default 0.25
  let q: number;
  switch (params.terrainType) {
    case 'land':    q = s * 0.5;        break; // mostly land (~0.12)
    case 'islands': q = 0.34 + s * 0.7; break; // distinct islands (~0.51)
    case 'water':   q = 0.5 + s * 0.6;  break; // mostly sea (~0.65)
    case 'mixed':   q = 0.18 + s * 0.7; break; // balanced (~0.35)
    default:        q = s;              break;
  }
  return Math.max(0.03, Math.min(0.88, q));
}

/** Optional numeric override from env (Node only; ignored in browser). */
function envNum(key: string, fallback: number): number {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const v = g.process?.env?.[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalize(field: Float32Array): void {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) / range;
}

function remapRange(field: Float32Array, min: number, max: number): void {
  const range = max - min;
  for (let i = 0; i < field.length; i++) field[i] = min + field[i] * range;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function smoothErosion(
  height: Float32Array,
  W: number,
  H: number,
  iterations: number,
  strength: number,
): void {
  const next = new Float32Array(height.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    next.set(height);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const index = y * W + x;
        const neighbors =
          height[index - 1] + height[index + 1] +
          height[index - W] + height[index + W] +
          height[index - W - 1] + height[index - W + 1] +
          height[index + W - 1] + height[index + W + 1];
        const average = neighbors / 8;
        next[index] = height[index] + (average - height[index]) * strength;
      }
    }
    height.set(next);
  }
}

function limitSlopes(
  height: Float32Array,
  W: number,
  H: number,
  maxStep: number,
): void {
  // Bidirectional sweep: each forward+backward pair propagates the slope
  // constraint across the full field in O(n). The naive per-cell iteration
  // would need ~W/2 passes to converge; 4 pass-pairs here handles spikes
  // up to ~8 vertices wide (64 elmos) which covers all procedural peaks.
  for (let pass = 0; pass < 4; pass++) {
    // Forward (TL→BR): cap each vertex by its left and top neighbours.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = height[i];
        if (x > 0 && height[i - 1] + maxStep < v) v = height[i - 1] + maxStep;
        if (y > 0 && height[i - W] + maxStep < v) v = height[i - W] + maxStep;
        height[i] = v;
      }
    }
    // Backward (BR→TL): cap each vertex by its right and bottom neighbours.
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x;
        let v = height[i];
        if (x < W - 1 && height[i + 1] + maxStep < v) v = height[i + 1] + maxStep;
        if (y < H - 1 && height[i + W] + maxStep < v) v = height[i + W] + maxStep;
        height[i] = v;
      }
    }
  }
}

/** Carve a few Gaussian-width valleys crossing the map so land is traversable. */
function carveChokePoints(
  height: Float32Array,
  W: number,
  H: number,
  worldElmos: number,
  params: MapParams,
  rng: RNG,
): void {
  const count = 2 + Math.floor(params.terrainDifficulty * 3);
  for (let i = 0; i < count; i++) {
    // random line crossing the map; choose horizontal/vertical/diagonal
    const axis = rng.int(0, 2);
    const width = Math.max(2, Math.floor(W * (0.02 + rng.unit() * 0.04)));
    const along = rng.range(0.2, 0.8) * worldElmos; // elmo offset across the axis
    const target = 0.35 + rng.unit() * 0.1; // carve down to this normalized-ish band

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const ex = (x / W) * worldElmos;
        const ez = (z / H) * worldElmos;
        let dist = Infinity;
        if (axis === 0) dist = Math.abs(ez - along); // horizontal band
        else if (axis === 1) dist = Math.abs(ex - along); // vertical band
        else dist = Math.abs(ex - ez - (along - worldElmos / 2)) / Math.SQRT2; // diagonal
        const g = Math.exp(-(dist * dist) / (2 * width * width));
        const idx = z * W + x;
        // only carve if currently above target (don't dig below valleys)
        if (height[idx] > target) {
          height[idx] = height[idx] * (1 - g * 0.6) + target * (g * 0.6);
        }
      }
    }
  }
}

/**
 * Simplified hydraulic erosion (droplet deposition/erosion) after
 * Hans Theobald Beyer / Sébastien Lague. Operates on a normalized field.
 */
function hydraulicErosion(
  height: Float32Array,
  W: number,
  H: number,
  numDroplets: number,
  rng: RNG,
): void {
  const inertia = 0.05;
  const sedimentCapacityFactor = 4;
  const minSedimentCapacity = 0.01;
  const erodeSpeed = 0.18;
  const depositSpeed = 0.3;
  const evaporateSpeed = 0.03;
  const startSpeed = 1;
  const startWater = 1;
  const maxLifetime = 30;

  for (let d = 0; d < numDroplets; d++) {
    let posX = rng.range(1, W - 2);
    let posY = rng.range(1, H - 2);
    let dirX = 0;
    let dirY = 0;
    let speed = startSpeed;
    let water = startWater;
    let sediment = 0;

    for (let step = 0; step < maxLifetime; step++) {
      const nodeX = Math.floor(posX);
      const nodeY = Math.floor(posY);
      const cellOffsetX = posX - nodeX;
      const cellOffsetY = posY - nodeY;

      const { heightDelta, gradientX, gradientZ } = heightAndGradient(
        height,
        W,
        H,
        posX,
        posY,
        nodeX,
        nodeY,
        cellOffsetX,
        cellOffsetY,
      );

      // update direction (inertia)
      dirX = dirX * inertia - gradientX * (1 - inertia);
      dirY = dirY * inertia - gradientZ * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len !== 0) {
        dirX /= len;
        dirY /= len;
      }
      posX += dirX;
      posY += dirY;

      if (
        (dirX === 0 && dirY === 0) ||
        posX < 0 || posX >= W - 1 ||
        posY < 0 || posY >= H - 1
      ) {
        break;
      }

      const newHeight = bilinearHeight(height, W, posX, posY);
      const deltaHeight = newHeight - heightDelta;

      const carryCapacity = Math.max(
        minSedimentCapacity,
        -deltaHeight * speed * water * sedimentCapacityFactor,
      );

      if (sediment > carryCapacity || deltaHeight > 0) {
        // deposit
        const amount =
          deltaHeight > 0 ? Math.min(deltaHeight, sediment) : (sediment - carryCapacity) * depositSpeed;
        sediment -= amount;
        depositHeight(height, W, posX, posY, amount);
      } else {
        // erode (don't erode below the new height difference)
        const amount = Math.min((carryCapacity - sediment) * erodeSpeed, -deltaHeight);
        // credit only the sediment actually removed (mass-conserving)
        const removed = erodeHeight(height, W, posX, posY, amount);
        sediment += removed;
      }

      speed = Math.sqrt(Math.max(0, speed * speed + -deltaHeight * 50));
      water *= 1 - evaporateSpeed;
    }

    // Mass conservation: deposit any sediment still carried when the droplet
    // dies (lifetime end / leaves map). Without this, eroded mass vanishes and
    // the whole field collapses toward zero.
    if (sediment > 0) {
      const cx = Math.max(0, Math.min(W - 2, Math.floor(posX))) + 0.5;
      const cy = Math.max(0, Math.min(H - 2, Math.floor(posY))) + 0.5;
      depositSedimentSpread(height, W, H, cx, cy, sediment, 4);
      sediment = 0;
    }
  }
}

interface GradInfo {
  heightDelta: number;
  gradientX: number;
  gradientZ: number;
}

function heightAndGradient(
  height: Float32Array,
  W: number,
  H: number,
  posX: number,
  posY: number,
  nodeX: number,
  nodeY: number,
  offX: number,
  offY: number,
): GradInfo {
  const idx = (nx: number, ny: number) => ny * W + nx;
  const h00 = height[idx(nodeX, nodeY)];
  const h10 = height[idx(nodeX + 1, nodeY)];
  const h01 = height[idx(nodeX, nodeY + 1)];
  const h11 = height[idx(nodeX + 1, nodeY + 1)];

  const gradientX = (h10 - h00) * (1 - offY) + (h11 - h01) * offY;
  const gradientZ = (h01 - h00) * (1 - offX) + (h11 - h10) * offX;
  const heightDelta = h00 * (1 - offX) * (1 - offY) + h10 * offX * (1 - offY) + h01 * (1 - offX) * offY + h11 * offX * offY;
  void posX;
  void posY;
  void H;
  return { heightDelta, gradientX, gradientZ };
}

function bilinearHeight(height: Float32Array, W: number, posX: number, posY: number): number {
  const xi = Math.floor(posX);
  const yi = Math.floor(posY);
  const fx = posX - xi;
  const fy = posY - yi;
  const h00 = height[yi * W + xi];
  const h10 = height[yi * W + xi + 1];
  const h01 = height[(yi + 1) * W + xi];
  const h11 = height[(yi + 1) * W + xi + 1];
  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

function depositHeight(height: Float32Array, W: number, posX: number, posY: number, amount: number): void {
  const xi = Math.floor(posX);
  const yi = Math.floor(posY);
  const fx = posX - xi;
  const fy = posY - yi;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  height[yi * W + xi] += amount * w00;
  height[yi * W + xi + 1] += amount * w10;
  height[(yi + 1) * W + xi] += amount * w01;
  height[(yi + 1) * W + xi + 1] += amount * w11;
}

function depositSedimentSpread(
  height: Float32Array,
  W: number,
  H: number,
  posX: number,
  posY: number,
  amount: number,
  radius: number,
): void {
  const centerX = Math.round(posX);
  const centerY = Math.round(posY);
  const cells: Array<{ index: number; weight: number }> = [];
  let weightSum = 0;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = centerX + dx;
      const y = centerY + dz;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > radius * radius) continue;
      const weight = Math.exp(-distanceSq / (radius * radius * 0.65));
      cells.push({ index: y * W + x, weight });
      weightSum += weight;
    }
  }
  if (!weightSum) return;
  for (const cell of cells) height[cell.index] += amount * (cell.weight / weightSum);
}

function erodeHeight(height: Float32Array, W: number, posX: number, posY: number, amount: number): number {
  const xi = Math.floor(posX);
  const yi = Math.floor(posY);
  const fx = posX - xi;
  const fy = posY - yi;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const i00 = yi * W + xi;
  const i10 = yi * W + xi + 1;
  const i01 = (yi + 1) * W + xi;
  const i11 = (yi + 1) * W + xi + 1;
  const d00 = height[i00] * w00;
  const d10 = height[i10] * w10;
  const d01 = height[i01] * w01;
  const d11 = height[i11] * w11;
  const sum = d00 + d10 + d01 + d11 || 1;
  const k = Math.min(1, amount / sum);
  height[i00] -= d00 * k;
  height[i10] -= d10 * k;
  height[i01] -= d01 * k;
  height[i11] -= d11 * k;
  return k * sum; // actual mass removed
}
