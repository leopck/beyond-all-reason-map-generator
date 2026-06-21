/**
 * Node smoke test — exercises generateMap + buildBundle (PNG/Lua/JSZip) without
 * a browser. Bundled with esbuild and run in Node to validate the runtime path.
 *   npx esbuild scripts/test-gen.ts --bundle --platform=node --format=esm --outfile=scripts/test-gen.mjs && node scripts/test-gen.mjs
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS } from '../src/params';
import { generateMap } from '../src/gen/pipeline';
import { buildBundle } from '../src/export/bundle';
import { mapinfoLua, metalLayoutLua, startBoxesLua } from '../src/export/lua';
import { __debug as metalDebug } from '../src/gen/metal';
import { sampleHeightElmo } from '../src/gen/dims';

async function main() {
  const sizes = [6, 8];
  for (const mapSize of sizes) {
    const params = { ...DEFAULT_PARAMS, mapSize, seed: `test-${mapSize}` };
    console.log(`\n=== mapSize ${mapSize} (${params.terrainType}/${params.biome}/${params.symmetry}) ===`);
    const t0 = Date.now();
    const data = generateMap(params);
    const t1 = Date.now();
    console.log(`  generate: ${t1 - t0} ms`);
    console.log(`  dims: tex=${data.dims.texture} height=${data.dims.heightW} metal=${data.dims.metalW} feature=${data.dims.featureW}`);
    console.log(`  stats: water=${(data.stats.waterFraction * 100).toFixed(0)}% mex=${data.stats.mexCount} features=${data.stats.featureCount} teams=${data.stats.teamCount}`);
    console.log(`  est .sd7: ${(data.stats.estSd7Bytes / 1024).toFixed(0)} KB`);
    console.log(`  metal.debug: attempts=${metalDebug.attempts} landFail=${metalDebug.landFail} distFail=${metalDebug.distFail} target=${metalDebug.target} minDist=${metalDebug.minDist.toFixed(0)} placed=${data.mexSpots.length}`);
    if (mapSize === 6) {
      let mn = Infinity, mx = -Infinity, sum = 0;
      for (let i = 0; i < data.height.length; i++) { const v = data.height[i]; if (v<mn)mn=v; if (v>mx)mx=v; sum+=v; }
      console.log(`  height: min=${mn.toFixed(3)} max=${mx.toFixed(3)} mean=${(sum/data.height.length).toFixed(3)} waterLevelNorm=${data.waterLevelNorm.toFixed(3)}`);
      const W = data.dims.worldElmos;
      let landCnt = 0; const N = 50;
      for (let i = 0; i < N*N; i++) {
        const ex = (i % N + 0.5) / N * W;
        const ez = (Math.floor(i / N) + 0.5) / N * W;
        const h = sampleHeightElmo(data.height, data.dims, ex, ez);
        if (h > data.waterLevelNorm + 0.015) landCnt++;
      }
      console.log(`  sampled land fraction (uniform grid): ${(landCnt/(N*N)*100).toFixed(0)}%`);
    }

    const t2 = Date.now();
    const blob = await buildBundle(data, (p) => {
      if (p.stage === 'done' || p.h === 0) return;
    });
    const t3 = Date.now();
    console.log(`  bundle: ${t3 - t2} ms, zip size: ${(blob.size / 1024).toFixed(0)} KB`);

    writeFileSync(`scripts/test-output-${mapSize}.zip`, Buffer.from(await blob.arrayBuffer()));

    // print a snippet of generated Lua
    if (mapSize === 8) {
      console.log('  --- mapinfo.lua (head) ---');
      console.log(mapinfoLua(data).split('\n').slice(0, 8).join('\n'));
      console.log('  --- map_metal_layout.lua (head) ---');
      console.log(metalLayoutLua(data).split('\n').slice(0, 6).join('\n'));
      console.log('  --- map_startboxes.lua (head) ---');
      console.log(startBoxesLua(data).split('\n').slice(0, 6).join('\n'));
    }
  }
  console.log('\nOK');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
