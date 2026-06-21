/**
 * Render a low-res preview PNG of a generated map (no browser/canvas) so we can
 * visually verify terrain, metal, mex, startboxes and features look right.
 *   npx esbuild scripts/render-preview.ts --bundle --platform=node --format=esm --outfile=scripts/render-preview.mjs && node scripts/render-preview.mjs
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/params';
import { generateMap } from '../src/gen/pipeline';
import { shadeColor } from '../src/gen/texture';
import { sampleHeightElmo } from '../src/gen/dims';
import { encodePngBuffer } from '../src/export/png';

const R = 768;

function render(name: string, overrides: Partial<typeof DEFAULT_PARAMS>): void {
  const params = { ...DEFAULT_PARAMS, ...overrides };
  const data = generateMap(params);
  const buf = new Uint8Array(R * R * 4);
  const world = data.dims.worldElmos;
  for (let z = 0; z < R; z++) {
    for (let x = 0; x < R; x++) {
      const ex = ((x + 0.5) / R) * world;
      const ez = ((z + 0.5) / R) * world;
      const h = sampleHeightElmo(data.height, data.dims, ex, ez);
      const col = shadeColor(data.shade, ex, ez, h);
      let r = col.r, g = col.g, b = col.b;
      // metal overlay
      const mx = Math.floor(ex / 16), mz = Math.floor(ez / 16);
      if (mx >= 0 && mz >= 0 && mx < data.dims.metalW && mz < data.dims.metalH) {
        const m = data.metalMap[mz * data.dims.metalW + mx];
        if (m > 16) { const a = Math.min(1, m / 255); r = Math.round(r*(1-a)+255*a); g = Math.round(g*(1-a)+40*a); b = Math.round(b*(1-a)+40*a); }
      }
      const i = (z * R + x) * 4;
      buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = 255;
    }
  }
  // startboxes overlay
  const tc = ['#ff5555', '#5577ff', '#55dd55', '#ffaa22'];
  const px = (e: number) => Math.floor((e / world) * R);
  // draw boxes by filling outline pixels
  for (const sb of data.startBoxes) {
    const c = tc[sb.team % tc.length];
    const [cr, cg, cb] = hexRgb(c);
    for (let yy = px(sb.z1); yy <= px(sb.z2); yy++) {
      for (let xx = px(sb.x1); xx <= px(sb.x2); xx++) {
        if (xx < 0 || yy < 0 || xx >= R || yy >= R) continue;
        // outline only (1px border)
        const onEdge = xx === px(sb.x1) || xx === px(sb.x2) || yy === px(sb.z1) || yy === px(sb.z2);
        if (onEdge) { const i = (yy * R + xx) * 4; buf[i]=cr; buf[i+1]=cg; buf[i+2]=cb; buf[i+3]=255; }
      }
    }
  }
  // mex spots
  for (const m of data.mexSpots) {
    const xx = px(m.x), yy = px(m.z);
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
      const ax=xx+dx, ay=yy+dy; if (ax<0||ay<0||ax>=R||ay>=R) continue;
      const i=(ay*R+ax)*4; buf[i]=255; buf[i+1]=255; buf[i+2]=80; buf[i+3]=255;
    }
  }
  const png = encodePngBuffer(R, R, 8, 6, buf);
  writeFileSync(`scripts/preview-${name}.png`, png);
  console.log(`  ${name}: water=${(data.stats.waterFraction*100).toFixed(0)}% mex=${data.stats.mexCount} feats=${data.stats.featureCount} teams=${data.stats.teamCount} -> preview-${name}.png`);
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

console.log('Rendering previews...');
render('land-mirror', { mapSize: 8, terrainType: 'land', biome: 'temperate', symmetry: 'mirror', seed: 'p1' });
render('water-naval', { mapSize: 8, terrainType: 'water', biome: 'temperate', seaLevel: 0.45, symmetry: 'flip', seed: 'p2' });
render('islands', { mapSize: 8, terrainType: 'islands', biome: 'desert', seaLevel: 0.4, symmetry: 'rotate4', teamCount: 4, seed: 'p3' });
render('volcanic-rotate4', { mapSize: 8, terrainType: 'mixed', biome: 'volcanic', symmetry: 'rotate4', teamCount: 4, seed: 'p4' });
render('metal-lunar', { mapSize: 8, terrainType: 'metal', biome: 'lunar', symmetry: 'rotate2', seed: 'p5' });
console.log('Done.');
