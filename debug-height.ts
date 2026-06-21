/**
 * Ground-truth heightmap analysis. Runs the real generation pipeline and
 * checks EVERY adjacent vertex pair (no subsampling) on the raw Float32Array,
 * then verifies the PNG encode/decode round-trips losslessly.
 */
import { DEFAULT_PARAMS } from './src/params.ts';
import { makeDims } from './src/gen/dims.ts';
import { generateHeightmap } from './src/gen/heightmap.ts';
import { encodeHeightmapPng } from './src/export/png.ts';
import { inflate } from 'pako';
import { writeFileSync } from 'node:fs';

const params = { ...DEFAULT_PARAMS };
const dims = makeDims(params.mapSize);
const { height, waterLevelNorm } = generateHeightmap(params, dims);
const W = dims.heightW, H = dims.heightH;

// height-range as pipeline computes it
const maxHeight = params.maxHeight;
const minHeight = waterLevelNorm > 0 && waterLevelNorm < 1
  ? -(waterLevelNorm / (1 - waterLevelNorm)) * maxHeight : 0;
const range = maxHeight - minHeight;
const square = 8;

console.log(`dims ${W}x${H}  waterLevelNorm=${waterLevelNorm.toFixed(4)}  height range ${minHeight.toFixed(1)}..${maxHeight} (${range.toFixed(1)} elmos)`);

// --- 1. FULL-RES adjacent-slope scan on the raw Float32Array ---
function scan(field: Float32Array, label: string) {
  let maxRatio = 0, maxAt = -1;
  let n5 = 0, n8 = 0, n15 = 0, total = 0;
  for (let z = 0; z < H - 1; z++) {
    for (let x = 0; x < W - 1; x++) {
      const a = field[z * W + x];
      const r = field[z * W + x + 1];
      const d = field[(z + 1) * W + x];
      const ratio = Math.max(Math.abs(a - r), Math.abs(a - d)) * range / square;
      if (ratio > maxRatio) { maxRatio = ratio; maxAt = z * W + x; }
      if (ratio > 5) n5++;
      if (ratio > 8) n8++;
      if (ratio > 15) n15++;
      total++;
    }
  }
  console.log(`[${label}] FULL-RES max slope ${maxRatio.toFixed(2)}:1 at idx ${maxAt} (x=${maxAt%W},z=${(maxAt/W)|0})`);
  console.log(`         >5:1 ${(n5/total*100).toFixed(2)}%  >8:1 ${(n8/total*100).toFixed(2)}%  >15:1 ${(n15/total*100).toFixed(2)}%`);
  return maxRatio;
}
scan(height, 'raw Float32');

// --- 2. encode PNG, decode it back, check round-trip ---
const heightU16 = new Uint16Array(W * H);
for (let i = 0; i < height.length; i++) {
  heightU16[i] = Math.max(0, Math.min(65535, Math.round(height[i] * 65535)));
}
const png = encodeHeightmapPng(W, H, heightU16);
writeFileSync('debug-heightmap.png', png);
console.log(`wrote debug-heightmap.png (${png.length} bytes)`);

// decode: find IDAT, inflate, un-filter, read 16-bit BE samples
function decodePng16Gray(buf: Uint8Array): { w: number; h: number; vals: Uint16Array } {
  let p = 8; // skip sig
  let w = 0, hh = 0;
  const idatParts: Uint8Array[] = [];
  while (p < buf.length) {
    const len = (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
      hh = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
    } else if (type === 'IDAT') idatParts.push(data.slice());
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  let tot = 0; for (const a of idatParts) tot += a.length;
  const idat = new Uint8Array(tot); let o = 0;
  for (const a of idatParts) { idat.set(a, o); o += a.length; }
  const raw = inflate(idat);
  const rowBytes = w * 2;
  const vals = new Uint16Array(w * hh);
  for (let y = 0; y < hh; y++) {
    const filter = raw[y * (rowBytes + 1)];
    if (filter !== 0) throw new Error(`row ${y} filter ${filter} (expected 0)`);
    const base = y * (rowBytes + 1) + 1;
    for (let x = 0; x < w; x++) {
      vals[y * w + x] = (raw[base + x * 2] << 8) | raw[base + x * 2 + 1];
    }
  }
  return { w, h: hh, vals };
}

const dec = decodePng16Gray(png);
let mismatch = 0, maxDiff = 0;
for (let i = 0; i < heightU16.length; i++) {
  const d = Math.abs(dec.vals[i] - heightU16[i]);
  if (d !== 0) { mismatch++; if (d > maxDiff) maxDiff = d; }
}
console.log(`PNG round-trip: ${dec.w}x${dec.h}  mismatches=${mismatch}  maxDiff=${maxDiff}`);

// --- 3. scan the DECODED u16 as a field (same as what compiler ingests) ---
const decF = new Float32Array(W * H);
for (let i = 0; i < decF.length; i++) decF[i] = dec.vals[i] / 65535;
scan(decF, 'decoded PNG');
