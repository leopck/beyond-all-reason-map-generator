/**
 * Live preview renderer — paints a downsampled hillshaded view of the map plus
 * optional overlays (metal heat, mex spots, startboxes, features).
 *
 * Renders at <=1024px regardless of map size so it stays fast on every knob
 * change; the full-res texture is only generated at export time.
 */
import type { MapData } from '../types';
import { shadeColor } from '../gen/texture';
import { sampleHeightElmo } from '../gen/dims';

export interface PreviewToggles {
  metal: boolean;
  mex: boolean;
  startboxes: boolean;
  features: boolean;
}

const TEAM_COLORS = [
  '#ff5555',
  '#5577ff',
  '#55dd55',
  '#ffaa22',
  '#cc55ff',
  '#22dddd',
  '#ff66cc',
  '#dddd33',
];

export function renderPreview(
  canvas: HTMLCanvasElement,
  data: MapData,
  toggles: PreviewToggles,
): void {
  const { dims, shade } = data;
  const R = Math.max(256, Math.min(1024, dims.xsize));
  canvas.width = R;
  canvas.height = R;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(R, R);
  const px = img.data;

  const world = dims.worldElmos;
  // downsampled metal lookup (nearest)
  const showMetal = toggles.metal;

  for (let z = 0; z < R; z++) {
    for (let x = 0; x < R; x++) {
      const ex = ((x + 0.5) / R) * world;
      const ez = ((z + 0.5) / R) * world;
      const h = sampleHeightElmo(data.height, dims, ex, ez);
      const col = shadeColor(shade, ex, ez, h);
      let r = col.r;
      let g = col.g;
      let b = col.b;

      if (showMetal) {
        const mx = Math.floor(ex / 16);
        const mz = Math.floor(ez / 16);
        if (mx >= 0 && mz >= 0 && mx < dims.metalW && mz < dims.metalH) {
          const m = data.metalMap[mz * dims.metalW + mx];
          if (m > 16) {
            const a = Math.min(1, m / 255);
            r = Math.round(r * (1 - a) + 255 * a);
            g = Math.round(g * (1 - a) + 40 * a);
            b = Math.round(b * (1 - a) + 40 * a);
          }
        }
      }

      if (toggles.features) {
        const fx = Math.min(dims.featureW - 1, Math.floor(ex / 8));
        const fz = Math.min(dims.featureH - 1, Math.floor(ez / 8));
        const grass = data.featureMap[(fz * dims.featureW + fx) * 4 + 2] / 255;
        if (grass > 0.08) {
          const alpha = grass * 0.22;
          r = Math.round(r * (1 - alpha) + 45 * alpha);
          g = Math.round(g * (1 - alpha) + 125 * alpha);
          b = Math.round(b * (1 - alpha) + 42 * alpha);
        }
      }

      const i = (z * R + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // vector overlays (in canvas px)
  const toCanvas = (e: number) => (e / world) * R;

  // startboxes
  if (toggles.startboxes) {
    for (const sb of data.startBoxes) {
      ctx.strokeStyle = TEAM_COLORS[sb.team % TEAM_COLORS.length];
      ctx.lineWidth = 2;
      ctx.fillStyle = TEAM_COLORS[sb.team % TEAM_COLORS.length] + '33';
      const x = toCanvas(sb.x1);
      const y = toCanvas(sb.z1);
      const w = toCanvas(sb.x2) - x;
      const h2 = toCanvas(sb.z2) - y;
      ctx.fillRect(x, y, w, h2);
      ctx.strokeRect(x, y, w, h2);
    }
  }

  // features
  if (toggles.features) {
    for (const f of data.features) {
      const x = toCanvas(f.x);
      const y = toCanvas(f.z);
      if (f.type === 'GeoVent') {
        ctx.fillStyle = '#ff8800';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      } else if (f.type.startsWith('tree')) {
        ctx.fillStyle = '#163f16';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      } else {
        ctx.fillStyle = '#b8b8b8';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }

  // mex spots
  if (toggles.mex) {
    ctx.fillStyle = '#ffff66';
    for (const m of data.mexSpots) {
      const x = toCanvas(m.x);
      const y = toCanvas(m.z);
      ctx.fillRect(x - 1, y - 1, 3, 3);
    }
  }
}
