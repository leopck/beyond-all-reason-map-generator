/**
 * Noise wrapper over simplex-noise v4 with fractal/ridged/fbm helpers.
 * Seeded via RNG so output reproduces from a seed.
 */
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { RNG } from './rng';

export class Noise {
  private n2: (x: number, y: number) => number;
  private n3: (x: number, y: number, z: number) => number;

  constructor(seed: string) {
    const rng = new RNG('noise::' + seed);
    const r = () => rng.unit();
    this.n2 = createNoise2D(r);
    this.n3 = createNoise3D(r);
  }

  /** single-octave 2D simplex, [-1,1] */
  raw2(x: number, y: number): number {
    return this.n2(x, y);
  }

  /** fractal Brownian motion (sum of octaves), returns ~[-1,1] */
  fbm2(
    x: number,
    y: number,
    octaves: number,
    frequency: number,
    persistence: number,
    lacunarity: number,
  ): number {
    let amp = 1;
    let freq = frequency;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.n2(x * freq, y * freq);
      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** ridged multifractal — sharp mountain ridges, [0,1]-ish */
  ridged2(
    x: number,
    y: number,
    octaves: number,
    frequency: number,
    persistence: number,
    lacunarity: number,
  ): number {
    let amp = 1;
    let freq = frequency;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.n2(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** domain-warped fbm for more natural, less grid-aligned terrain */
  warpedFbm(
    x: number,
    y: number,
    octaves: number,
    frequency: number,
    persistence: number,
    lacunarity: number,
    warp: number,
  ): number {
    const warpScale = warp / Math.max(frequency, 1e-9);
    const wx = this.fbm2(x + 5.2, y + 1.3, 3, frequency * 2, 0.5, 2) * warpScale;
    const wy = this.fbm2(x + 8.3, y + 2.8, 3, frequency * 2, 0.5, 2) * warpScale;
    return this.fbm2(x + wx, y + wy, octaves, frequency, persistence, lacunarity);
  }

  /** 3D simplex (used for moisture/biome fields that should vary independently) */
  raw3(x: number, y: number, z: number): number {
    return this.n3(x, y, z);
  }
}
