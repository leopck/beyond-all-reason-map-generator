import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import { inflate } from 'pako';
import { build } from 'esbuild';

const SMF_HEADER_BYTES = 80;
const MINIMAP_BYTES = 699048;

function parseHeader(buffer) {
  if (buffer.length < SMF_HEADER_BYTES) throw new Error('file is too small to be SMF');
  const magic = buffer.subarray(0, 16).toString('ascii').replace(/\0+$/, '');
  if (magic !== 'spring map file') throw new Error(`invalid SMF magic: ${JSON.stringify(magic)}`);
  return {
    version: buffer.readInt32LE(16),
    mapId: buffer.readUInt32LE(20),
    mapX: buffer.readInt32LE(24),
    mapY: buffer.readInt32LE(28),
    squareSize: buffer.readInt32LE(32),
    texelPerSquare: buffer.readInt32LE(36),
    tileSize: buffer.readInt32LE(40),
    minHeight: buffer.readFloatLE(44),
    maxHeight: buffer.readFloatLE(48),
    heightmapPtr: buffer.readInt32LE(52),
    typeMapPtr: buffer.readInt32LE(56),
    tilesPtr: buffer.readInt32LE(60),
    minimapPtr: buffer.readInt32LE(64),
    metalmapPtr: buffer.readInt32LE(68),
    featurePtr: buffer.readInt32LE(72),
    numExtraHeaders: buffer.readInt32LE(76),
  };
}

function heightStats(buffer, header) {
  const width = header.mapX + 1;
  const height = header.mapY + 1;
  const count = width * height;
  const end = header.heightmapPtr + count * 2;
  if (header.heightmapPtr < SMF_HEADER_BYTES || end > buffer.length) {
    throw new Error(`heightmap range ${header.heightmapPtr}..${end} is outside file`);
  }

  let min = 65535;
  let max = 0;
  let sum = 0;
  let maxStep = 0;
  let extremeSteps = 0;
  let compared = 0;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const index = z * width + x;
      const value = buffer.readUInt16LE(header.heightmapPtr + index * 2);
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      if (x > 0) {
        const left = buffer.readUInt16LE(header.heightmapPtr + (index - 1) * 2);
        const delta = Math.abs(value - left);
        maxStep = Math.max(maxStep, delta);
        if (delta > 8192) extremeSteps++;
        compared++;
      }
      if (z > 0) {
        const up = buffer.readUInt16LE(header.heightmapPtr + (index - width) * 2);
        const delta = Math.abs(value - up);
        maxStep = Math.max(maxStep, delta);
        if (delta > 8192) extremeSteps++;
        compared++;
      }
    }
  }
  return {
    width,
    height,
    min,
    max,
    mean: sum / count,
    maxStep,
    extremeStepFraction: compared ? extremeSteps / compared : 0,
  };
}

function minimapStats(buffer, header) {
  const end = header.minimapPtr + MINIMAP_BYTES;
  if (header.minimapPtr < SMF_HEADER_BYTES || end > buffer.length) {
    return { present: false, uniqueBytes: 0, nonZeroFraction: 0 };
  }
  const minimap = buffer.subarray(header.minimapPtr, end);
  const unique = new Set(minimap);
  let nonZero = 0;
  for (const value of minimap) if (value !== 0) nonZero++;
  return {
    present: true,
    uniqueBytes: unique.size,
    nonZeroFraction: nonZero / minimap.length,
  };
}

function pngHeightStats(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('invalid PNG signature');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  if (bitDepth !== 16 || colorType !== 0) {
    throw new Error(`height PNG must be grayscale16, got bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const raw = Buffer.from(inflate(Buffer.concat(idat)));
  const rowBytes = width * 2;
  const expected = height * (rowBytes + 1);
  if (raw.length !== expected) throw new Error(`unexpected inflated PNG size ${raw.length}, expected ${expected}`);
  const values = new Uint16Array(width * height);
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    const filter = raw[rowOffset];
    const row = Buffer.from(raw.subarray(rowOffset + 1, rowOffset + 1 + rowBytes));
    unfilterRow(row, previous, filter, 2);
    for (let x = 0; x < width; x++) values[y * width + x] = row.readUInt16BE(x * 2);
    previous = row;
  }
  return arrayHeightStats(values, width, height);
}

function unfilterRow(row, previous, filter, bytesPerPixel) {
  for (let index = 0; index < row.length; index++) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previous[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
    if (filter === 1) row[index] = (row[index] + left) & 255;
    else if (filter === 2) row[index] = (row[index] + up) & 255;
    else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[index] = (row[index] + paeth(left, up, upperLeft)) & 255;
    else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
  }
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function arrayHeightStats(values, width, height) {
  let min = 65535;
  let max = 0;
  let sum = 0;
  let maxStep = 0;
  let extremeSteps = 0;
  let compared = 0;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const index = z * width + x;
      const value = values[index];
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      if (x > 0) {
        const delta = Math.abs(value - values[index - 1]);
        maxStep = Math.max(maxStep, delta);
        if (delta > 8192) extremeSteps++;
        compared++;
      }
      if (z > 0) {
        const delta = Math.abs(value - values[index - width]);
        maxStep = Math.max(maxStep, delta);
        if (delta > 8192) extremeSteps++;
        compared++;
      }
    }
  }
  return { width, height, min, max, mean: sum / values.length, maxStep, extremeStepFraction: compared ? extremeSteps / compared : 0 };
}

async function validateSourceZip(filename) {
  const archive = await JSZip.loadAsync(fs.readFileSync(filename));
  const entry = Object.values(archive.files).find((file) => /(^|\/)heightmap\.png$/i.test(file.name));
  if (!entry) throw new Error('source ZIP has no heightmap.png');
  const png = Buffer.from(await entry.async('uint8array'));
  const heights = pngHeightStats(png);
  const entries = [];
  for (const file of Object.values(archive.files)) {
    if (!file.dir) entries.push({ name: file.name, bytes: (await file.async('uint8array')).length });
  }
  const issues = [];
  if (heights.extremeStepFraction > 0.001) issues.push(`${(heights.extremeStepFraction * 100).toFixed(2)}% of source height steps are extreme`);
  return { filename: path.resolve(filename), kind: 'source-zip', heightEntry: entry.name, entries, heights, issues };
}

export function validateSmf(filename) {
  const buffer = fs.readFileSync(filename);
  const header = parseHeader(buffer);
  const heights = heightStats(buffer, header);
  const minimap = minimapStats(buffer, header);
  const issues = [];
  if (header.version !== 1) issues.push(`unexpected SMF version ${header.version}`);
  if (header.squareSize !== 8) issues.push(`unexpected square size ${header.squareSize}`);
  if (header.minHeight >= header.maxHeight) issues.push('invalid world height range');
  if (heights.max - heights.min < 128) issues.push('heightmap is effectively flat');
  if (heights.extremeStepFraction > 0.001) {
    issues.push(`${(heights.extremeStepFraction * 100).toFixed(2)}% of adjacent heights are extreme spikes`);
  }
  if (!minimap.present || minimap.uniqueBytes < 8 || minimap.nonZeroFraction < 0.01) {
    issues.push('embedded minimap is missing or blank');
  }
  return { filename: path.resolve(filename), bytes: buffer.length, header, heights, minimap, issues };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.slice(1))) {
  const args = process.argv.slice(2);
  if (args[0] === '--patch-minimap') {
    const sourceZip = args[1];
    const smfFile = args[2];
    if (!sourceZip || !smfFile) throw new Error('usage: --patch-minimap <source.zip> <map.smf>');
    const archive = await JSZip.loadAsync(fs.readFileSync(sourceZip));
    const entry = Object.values(archive.files).find((file) => /(^|\/)minimap\.bin$/i.test(file.name));
    if (!entry) throw new Error('source ZIP has no minimap.bin');
    const minimap = Buffer.from(await entry.async('uint8array'));
    const smf = fs.readFileSync(smfFile);
    const minimapPtr = smf.readInt32LE(64);
    if (minimap.length !== MINIMAP_BYTES || minimapPtr < SMF_HEADER_BYTES || minimapPtr + minimap.length > smf.length) {
      throw new Error('invalid minimap payload or SMF offset');
    }
    minimap.copy(smf, minimapPtr);
    fs.writeFileSync(smfFile, smf);
    console.log(JSON.stringify({ sourceZip, smfFile, minimapBytes: minimap.length, minimapPtr }));
    process.exit(0);
  }
  if (args[0] === '--extract') {
    const archive = path.resolve(args[1] ?? '');
    const output = path.resolve(args[2] ?? '');
    if (!args[1] || !args[2]) throw new Error('usage: --extract <map.sd7> <output-dir>');
    const sevenZip = String.raw`C:\Program Files\Beyond-All-Reason\resources\app.asar.unpacked\node_modules\7zip-bin\win\x64\7za.exe`;
    const result = spawnSync(sevenZip, ['x', '-y', `-o${output}`, archive], { stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
  if (args[0] === '--pack') {
    const inputDir = path.resolve(args[1] ?? '');
    const archive = path.resolve(args[2] ?? '');
    if (!args[1] || !args[2]) throw new Error('usage: --pack <input-dir> <map.sd7>');
    fs.rmSync(archive, { force: true });
    const sevenZip = String.raw`C:\Program Files\Beyond-All-Reason\resources\app.asar.unpacked\node_modules\7zip-bin\win\x64\7za.exe`;
    const result = spawnSync(sevenZip, ['a', '-t7z', '-mx=5', archive, '.'], { cwd: inputDir, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
  if (args[0] === '--unitsync') {
    const map = args[1];
    const archive = path.resolve(args[2] ?? '');
    if (!map || !args[2]) throw new Error('usage: --unitsync <map-name> <archive.sd7>');
    const engine = String.raw`C:\Program Files\Beyond-All-Reason\data\engine\recoil_2025.06.24`;
    const dataDir = String.raw`C:\Program Files\Beyond-All-Reason\data`;
    const result = spawnSync('python', [
      'scripts/validate-unitsync.py',
      map,
      '--archive', archive,
      '--bar-data', dataDir,
      '--engine', engine,
      '--cleanup-staged',
    ], { stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
  if (args[0] === '--strip-minimap') {
    const input = args[1];
    const output = args[2];
    if (!input || !output) throw new Error('usage: --strip-minimap <input.zip> <output.zip>');
    const archive = await JSZip.loadAsync(fs.readFileSync(input));
    for (const file of Object.values(archive.files)) {
      if (/(^|\/)minimap\.png$/i.test(file.name)) archive.remove(file.name);
    }
    const data = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    fs.writeFileSync(output, data);
    console.log(JSON.stringify({ input, output, bytes: data.length }));
    process.exit(0);
  }
  if (args[0] === '--generate') {
    const output = path.resolve('scripts/.validation-fixture.mjs');
    await build({
      entryPoints: ['scripts/generate-validation-fixture.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: output,
      logLevel: 'silent',
    });
    await import(`${pathToFileURL(output).href}?t=${Date.now()}`);
    args.shift();
  }
  const files = args;
  if (!files.length) {
    console.error('usage: node scripts/validate-smf.mjs <map.smf> [...]');
    process.exit(2);
  }
  let failed = false;
  for (const filename of files) {
    try {
      const result = filename.toLowerCase().endsWith('.zip')
        ? await validateSourceZip(filename)
        : validateSmf(filename);
      console.log(JSON.stringify(result, null, 2));
      if (result.issues.length) failed = true;
    } catch (error) {
      failed = true;
      console.error(`${filename}: ${error.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}
