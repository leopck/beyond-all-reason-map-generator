/**
 * Bundle worker — runs the expensive source-bundle build (generate + encode the
 * 8192² texture, heightmap, minimap, … + zip) OFF the main thread so the page
 * never freezes. Generation is pure and deterministic from `params`, so the
 * worker only needs the param snapshot; it reproduces the exact same map the
 * preview showed.
 *
 * Protocol:
 *   main → worker: MapParams
 *   worker → main: { type:'progress', stage, y, h }   (repeated)
 *                  { type:'done', buffer:ArrayBuffer } (transferred)
 *                  { type:'error', message }
 */
import type { MapParams } from '../params';
import { generateMap } from '../gen/pipeline';
import { buildBundle } from './bundle';

self.onmessage = async (e: MessageEvent<MapParams>) => {
  const params = e.data;
  try {
    const data = generateMap(params);
    const blob = await buildBundle(data, (p) => {
      (self as unknown as Worker).postMessage({ type: 'progress', stage: p.stage, y: p.y, h: p.h });
    });
    const buffer = await blob.arrayBuffer();
    (self as unknown as Worker).postMessage({ type: 'done', buffer }, [buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: (err as Error).message });
  }
};
