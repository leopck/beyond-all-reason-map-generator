/**
 * Seeded pseudo-random number generation.
 *
 * We avoid Math.random() for generation so a `seed` reproduces a map exactly.
 * mulberry32 is fast and statistically adequate for terrain; xmur3 hashes a
 * string/number seed into a 32-bit integer. (App-level "randomize" may still
 * pull a seed from Math.random() at runtime — that's fine, it is then fixed.)
 */

/** xmur3 string → 32-bit seed mixer. Returns a function producing successive 32-bit ints. */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 PRNG: (seed) => () => float in [0, 1). */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A small RNG helper with convenience sampling methods. All state derives
 * from the seed, so re-creating with the same seed reproduces every draw.
 */
export class RNG {
  private next: () => number;
  readonly seed: string;

  constructor(seed: string | number) {
    this.seed = String(seed);
    const h = xmur3(this.seed)();
    this.next = mulberry32(h);
  }

  /** float in [0, 1) */
  unit(): number {
    return this.next();
  }
  /** float in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  /** true with probability p */
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** pick one element */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** standard-normal-ish via Box-Muller (two uniforms) */
  gaussian(mean = 0, stddev = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * stddev;
  }
}
