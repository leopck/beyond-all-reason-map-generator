/**
 * BAR map closed-loop validator.
 * Uses spring-map-parser (official BAR parser lib) to exercise the same map
 * loading path the engine uses. Checks:
 *   - SMF magic / version / squareSize
 *   - Map dimensions vs expected
 *   - Heightmap: not flat, not all-zero, no bone-tumour spikes (slope ratio)
 *   - Minimap: not blank
 *   - Metalmap: has metal
 *
 * Usage:  node validate.mjs <path.sd7> <expectedMapWidth> <minH> <maxH>
 * Stdout: JSON { ok, errors[], warnings[], stats{} }
 * Exit:   0 = ok (may have warnings), 1 = hard errors, 2 = bad args
 */
import { MapParser } from 'spring-map-parser';

function bitmapNonZeroPct(bitmap) {
  if (!bitmap || !bitmap.data) return null;
  const d = bitmap.data;
  let nz = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0) nz++;
  }
  return Math.round(nz / (d.length / 4) * 100);
}

function bitmapChannelSum(bitmap, ch) {
  if (!bitmap || !bitmap.data) return 0;
  const d = bitmap.data;
  let sum = 0;
  for (let i = ch; i < d.length; i += 4) sum += d[i];
  return sum;
}

// Slope in DEGREES is the honest metric. ratio = Δheight_elmos / squareSize is
// rise:run, so angle = atan(ratio). A "5:1" ratio is 78.7° — nearly vertical —
// which is why the old ratio thresholds let needle terrain through.
function slopeCheck(hv, mapWidth, minH, maxH, squareSize) {
  const W = mapWidth + 1;
  const heightRange = maxH - minH;
  // scan EVERY adjacent pair (no subsampling — needles can hide between samples)
  let maxDeg = 0;
  let steepSamples = 0; // > 45°
  let total = 0;
  for (let z = 0; z < W - 1; z++) {
    for (let x = 0; x < W - 1; x++) {
      const a = hv[z * W + x];
      const r = hv[z * W + x + 1];
      const d = hv[(z + 1) * W + x];
      const dh = Math.max(Math.abs(a - r), Math.abs(a - d)) * heightRange; // elmos
      const deg = Math.atan2(dh, squareSize) * 180 / Math.PI;
      if (deg > maxDeg) maxDeg = deg;
      if (deg > 45) steepSamples++;
      total++;
    }
  }
  return { maxDeg, steepPct: total ? steepSamples / total * 100 : 0 };
}

const [,, sd7Path, expectedMapWidthStr, expectedMinHStr, expectedMaxHStr] = process.argv;
if (!sd7Path) {
  process.stderr.write('Usage: validate.mjs <path.sd7> [expectedMapWidth] [minH] [maxH]\n');
  process.exit(2);
}

const expectedMapWidth = expectedMapWidthStr ? parseInt(expectedMapWidthStr, 10) : null;
const expectedMinH = expectedMinHStr !== undefined ? parseFloat(expectedMinHStr) : 0;
const expectedMaxH = expectedMaxHStr !== undefined ? parseFloat(expectedMaxHStr) : 600;

const errors = [];
const warnings = [];
const stats = {};

try {
  const parser = new MapParser({ verbose: false, mipmapSize: 0, skipSmt: true });
  const map = await parser.parseMap(sd7Path);
  const smf = map.smf;
  if (!smf) { errors.push('parser returned no smf block'); throw new Error('abort'); }

  if (!smf.magic || !smf.magic.startsWith('spring map file')) {
    errors.push('bad SMF magic: ' + JSON.stringify(smf.magic));
  }
  if (smf.version !== 1) warnings.push('SMF version ' + smf.version + ' (expected 1)');
  if (smf.squareSize !== 8) warnings.push('squareSize=' + smf.squareSize + ' (expected 8)');

  stats.mapWidth  = smf.mapWidth;
  stats.mapHeight = smf.mapHeight;
  stats.smfMinH   = smf.minDepth;
  stats.smfMaxH   = smf.maxDepth;

  if (smf.mapWidth !== smf.mapHeight)
    warnings.push('non-square map (' + smf.mapWidth + 'x' + smf.mapHeight + ')');
  if (expectedMapWidth !== null && expectedMapWidth !== 0 && smf.mapWidth !== expectedMapWidth)
    errors.push('mapWidth=' + smf.mapWidth + ' expected=' + expectedMapWidth);

  const minH = smf.minDepth ?? 0;
  const maxH = smf.maxDepth ?? 600;
  // minH is negative for maps with water (Spring water level = 0 elmos)
  if (Math.abs(minH - expectedMinH) > 10) warnings.push('SMF minDepth=' + minH + ' vs expected=' + expectedMinH);
  if (Math.abs(maxH - expectedMaxH) > 10) warnings.push('SMF maxDepth=' + maxH + ' vs expected=' + expectedMaxH);

  const miSmf = map.mapInfo && map.mapInfo.smf;
  if (miSmf) {
    stats.mapinfoMinH = miSmf.minheight;
    stats.mapinfoMaxH = miSmf.maxheight;
    if (Math.abs((miSmf.minheight || 0) - minH) > 5)
      warnings.push('mapinfo minheight=' + miSmf.minheight + ' vs SMF minDepth=' + minH);
    if (Math.abs((miSmf.maxheight || 0) - maxH) > 5)
      warnings.push('mapinfo maxheight=' + miSmf.maxheight + ' vs SMF maxDepth=' + maxH);
  } else {
    warnings.push('mapinfo.lua smf block not parsed');
  }

  const hv = smf.heightMapValues;
  if (!hv || !hv.length) {
    errors.push('heightMapValues missing — compiler may not have loaded the heightmap PNG');
  } else {
    let hvMin = Infinity, hvMax = -Infinity, hvSum = 0;
    for (let i = 0; i < hv.length; i++) {
      if (hv[i] < hvMin) hvMin = hv[i];
      if (hv[i] > hvMax) hvMax = hv[i];
      hvSum += hv[i];
    }
    stats.heightNormMin  = +hvMin.toFixed(4);
    stats.heightNormMax  = +hvMax.toFixed(4);
    stats.heightNormMean = +(hvSum / hv.length).toFixed(4);

    if (hvMax < 0.001) {
      errors.push('heightmap is all-zero — no terrain data in compiled map');
    } else if (hvMax - hvMin < 0.01) {
      warnings.push('heightmap nearly flat (range ' + ((hvMax - hvMin) * 100).toFixed(1) + '%)');
    }

    const sq = smf.squareSize || 8;
    const { maxDeg, steepPct } = slopeCheck(hv, smf.mapWidth, minH, maxH, sq);
    stats.maxSlopeDeg = +maxDeg.toFixed(1);
    stats.steepPct = +steepPct.toFixed(2);

    if (maxDeg > 65) {
      errors.push('bone-tumour spikes: max slope ' + maxDeg.toFixed(0) + 'deg (near-vertical, expected <=45deg)');
    } else if (maxDeg > 50) {
      warnings.push('steep terrain: max slope ' + maxDeg.toFixed(0) + 'deg (some near-impassable faces)');
    }
    if (steepPct > 8) {
      warnings.push(steepPct.toFixed(1) + '% of terrain steeper than 45deg (may hinder pathing)');
    }
  }

  const mmPct = bitmapNonZeroPct(smf.miniMap && smf.miniMap.bitmap);
  stats.minimapNonZeroPct = mmPct;
  if (mmPct === null) {
    warnings.push('minimap bitmap not returned by parser');
  } else if (mmPct === 0) {
    errors.push('minimap is entirely blank — SpringMapConvNG did not embed a minimap image');
  } else if (mmPct < 5) {
    warnings.push('minimap mostly blank (' + mmPct + '% non-zero pixels)');
  } else {
    stats.minimapOk = true;
  }

  const metalSum = bitmapChannelSum(smf.metalMap && smf.metalMap.bitmap, 0);
  stats.metalSum = metalSum;
  if (metalSum === 0) {
    warnings.push('metalmap is empty — no mex spots will appear in game');
  } else {
    stats.metalmapOk = true;
  }

} catch (e) {
  if (e.message !== 'abort') errors.push('parser error: ' + e.message);
}

const result = { ok: errors.length === 0, errors, warnings, stats };
process.stdout.write(JSON.stringify(result) + '\n');
process.exit(result.ok ? 0 : 1);
