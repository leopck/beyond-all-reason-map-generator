/**
 * Streaming PNG encoder (8/16-bit, grayscale/RGBA) using pako's incremental
 * Deflate. Rows are pulled via a provider and filtered (filter type 0 = None)
 * one at a time, so the full-res texture (tens of MB) is never materialized.
 *
 * Color types: 0 = grayscale, 2 = RGB, 6 = RGBA.
 */
import { Deflate } from 'pako';

export type RowProvider = (y: number) => Uint8Array; // raw pixel bytes for row y (no filter byte)

export interface PngOpts {
  width: number;
  height: number;
  bitDepth: 8 | 16;
  colorType: 0 | 2 | 6;
  rows: RowProvider;
  level?: number; // 0..9, default 6
  onProgress?: (y: number, h: number) => void;
}

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// CRC32 table (PNG uses the standard zlib CRC)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeChunk(out: Uint8Array[], type: string, data: Uint8Array): void {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  const len = data.length;
  const lenBytes = new Uint8Array(4);
  lenBytes[0] = (len >>> 24) & 0xff;
  lenBytes[1] = (len >>> 16) & 0xff;
  lenBytes[2] = (len >>> 8) & 0xff;
  lenBytes[3] = len & 0xff;

  const crcInput = new Uint8Array(4 + len);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  const crc = crc32(crcInput, 0, crcInput.length);
  const crcBytes = new Uint8Array(4);
  crcBytes[0] = (crc >>> 24) & 0xff;
  crcBytes[1] = (crc >>> 16) & 0xff;
  crcBytes[2] = (crc >>> 8) & 0xff;
  crcBytes[3] = crc & 0xff;

  out.push(lenBytes, typeBytes, data, crcBytes);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Stream-encode a PNG from a row provider (large images). */
export function encodePngStreaming(opts: PngOpts): Uint8Array {
  const { width, height, bitDepth, colorType, rows, onProgress } = opts;
  const level = (opts.level ?? 6) as -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const rowBytes = width * channels * (bitDepth === 16 ? 2 : 1);

  // IHDR
  const ihdr = new Uint8Array(13);
  const w = width;
  const h = height;
  ihdr[0] = (w >>> 24) & 0xff; ihdr[1] = (w >>> 16) & 0xff; ihdr[2] = (w >>> 8) & 0xff; ihdr[3] = w & 0xff;
  ihdr[4] = (h >>> 24) & 0xff; ihdr[5] = (h >>> 16) & 0xff; ihdr[6] = (h >>> 8) & 0xff; ihdr[7] = h & 0xff;
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const out: Uint8Array[] = [PNG_SIG.slice()];
  writeChunk(out, 'IHDR', ihdr);

  // IDAT: stream filtered scanlines into pako Deflate
  const deflator = new Deflate({ level });
  const filtered = new Uint8Array(1 + rowBytes);
  filtered[0] = 0; // filter type None
  for (let y = 0; y < height; y++) {
    const row = rows(y);
    filtered.set(row.subarray(0, rowBytes), 1);
    deflator.push(filtered, false);
    if (onProgress && (y & 0x3f) === 0) onProgress(y, height);
  }
  deflator.push(new Uint8Array(0), true); // finish
  const idatData = deflator.result as Uint8Array;
  if (onProgress) onProgress(height, height);
  writeChunk(out, 'IDAT', idatData);

  // IEND
  writeChunk(out, 'IEND', new Uint8Array(0));

  return concat(out);
}

/** Encode a PNG from a full in-memory buffer (small images only). */
export function encodePngBuffer(
  width: number,
  height: number,
  bitDepth: 8 | 16,
  colorType: 0 | 2 | 6,
  data: Uint8Array, // raw pixel bytes (row-major), length = height * rowBytes
  level = 6,
): Uint8Array {
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const rowBytes = width * channels * (bitDepth === 16 ? 2 : 1);
  const rows: RowProvider = (y) => data.subarray(y * rowBytes, (y + 1) * rowBytes);
  // small → sync deflate is fine
  return encodePngStreaming({ width, height, bitDepth, colorType, rows, level });
}

/** convenience: 16-bit grayscale heightmap (values 0..65535) → 16-bit gray PNG */
export function encodeHeightmapPng(
  width: number,
  height: number,
  values: Uint16Array,
  onProgress?: (y: number, h: number) => void,
): Uint8Array {
  // each row: width * 2 bytes, big-endian per sample (PNG 16-bit is big-endian)
  const rows: RowProvider = (y) => {
    const out = new Uint8Array(width * 2);
    const base = y * width;
    for (let x = 0; x < width; x++) {
      const v = values[base + x];
      out[x * 2] = (v >>> 8) & 0xff;
      out[x * 2 + 1] = v & 0xff;
    }
    return out;
  };
  return encodePngStreaming({ width, height, bitDepth: 16, colorType: 0, rows, onProgress });
}

/** convenience: 8-bit single-channel → grayscale PNG */
export function encodeGray8Png(width: number, height: number, data: Uint8Array): Uint8Array {
  const rows: RowProvider = (y) => data.subarray(y * width, (y + 1) * width);
  return encodePngBuffer(width, height, 8, 0, data);
}

/** 8-bit grayscale uncompressed TGA, top-left origin (for BAR grassDistTGA). */
export function encodeTgaGray(width: number, height: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(18 + width * height);
  out[2] = 3; // image type: uncompressed grayscale
  out[12] = width & 0xff; out[13] = (width >> 8) & 0xff;
  out[14] = height & 0xff; out[15] = (height >> 8) & 0xff;
  out[16] = 8; // bits per pixel
  out[17] = 0x20; // top-left origin (matches our row-major top-down data)
  out.set(data, 18);
  return out;
}
