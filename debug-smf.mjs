/**
 * Direct SMF heightmap dissector — no spring-map-parser.
 * Parses the 80-byte SMF header, reads the raw uint16 heightmap exactly as the
 * engine does, and scans EVERY adjacent vertex pair for spikes.
 *
 * Usage: node debug-smf.mjs <file.smf>
 */
import { readFileSync } from 'node:fs';

const buf = readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

const magic = buf.toString('latin1', 0, 15);
const version       = dv.getInt32(16, true);
const mapid         = dv.getInt32(20, true);
const mapx          = dv.getInt32(24, true);
const mapy          = dv.getInt32(28, true);
const squareSize    = dv.getInt32(32, true);
const texelPerSquare= dv.getInt32(36, true);
const tileSize      = dv.getInt32(40, true);
const minHeight     = dv.getFloat32(44, true);
const maxHeight     = dv.getFloat32(48, true);
const heightmapPtr  = dv.getInt32(52, true);
const typeMapPtr    = dv.getInt32(56, true);
const tilesPtr      = dv.getInt32(60, true);
const minimapPtr    = dv.getInt32(64, true);
const metalmapPtr   = dv.getInt32(68, true);
const featurePtr    = dv.getInt32(72, true);

console.log(`magic="${magic}" version=${version} mapx=${mapx} mapy=${mapy} squareSize=${squareSize} tileSize=${tileSize}`);
console.log(`minHeight=${minHeight} maxHeight=${maxHeight}`);
console.log(`ptrs: height=${heightmapPtr} type=${typeMapPtr} tiles=${tilesPtr} mini=${minimapPtr} metal=${metalmapPtr} feature=${featurePtr}`);

const W = mapx + 1, H = mapy + 1;
const count = W * H;
const expectBytes = count * 2;
console.log(`heightmap: ${W}x${H} = ${count} samples (${expectBytes} bytes), data spans ${heightmapPtr}..${heightmapPtr + expectBytes} of ${buf.length}`);

// read uint16 LE heightmap
const hm = new Uint16Array(count);
for (let i = 0; i < count; i++) hm[i] = dv.getUint16(heightmapPtr + i * 2, true);

const range = maxHeight - minHeight;
const square = squareSize || 8;

// FULL-RES adjacent slope scan
let maxRatio = 0, maxAt = -1;
let n5 = 0, n8 = 0, n15 = 0, n30 = 0, total = 0;
for (let z = 0; z < H - 1; z++) {
  for (let x = 0; x < W - 1; x++) {
    const a = hm[z * W + x] / 65535;
    const r = hm[z * W + x + 1] / 65535;
    const d = hm[(z + 1) * W + x] / 65535;
    const ratio = Math.max(Math.abs(a - r), Math.abs(a - d)) * range / square;
    if (ratio > maxRatio) { maxRatio = ratio; maxAt = z * W + x; }
    if (ratio > 5) n5++;
    if (ratio > 8) n8++;
    if (ratio > 15) n15++;
    if (ratio > 30) n30++;
    total++;
  }
}
console.log(`\nFULL-RES max slope ${maxRatio.toFixed(2)}:1 at idx ${maxAt} (x=${maxAt % W}, z=${(maxAt / W) | 0})`);
console.log(`>5:1 ${(n5 / total * 100).toFixed(2)}%  >8:1 ${(n8 / total * 100).toFixed(2)}%  >15:1 ${(n15 / total * 100).toFixed(2)}%  >30:1 ${(n30 / total * 100).toFixed(2)}%`);

// dump a small patch to see the pattern
console.log('\nfirst 16x4 patch (raw u16):');
for (let z = 0; z < 4; z++) {
  const row = [];
  for (let x = 0; x < 16; x++) row.push(String(hm[z * W + x]).padStart(6));
  console.log(row.join(' '));
}
