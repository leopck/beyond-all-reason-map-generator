/**
 * App entry — wires the knob panel, live preview, stats and export buttons.
 */
import { DEFAULT_PARAMS, type MapParams } from './params';
import { generateMap } from './gen/pipeline';
import { renderPreview, type PreviewToggles } from './ui/preview';
import { renderKnobs } from './ui/knobs';
import type { BundleProgress } from './export/bundle';
import type { MapData } from './types';
import './style.css';

/**
 * Build the source bundle in a Web Worker so the heavy texture encoding never
 * blocks the UI (previously froze the page for ~30s). Generation is deterministic
 * from `params`, so the worker reproduces the exact map the preview showed.
 */
function buildBundleAsync(
  params: MapParams,
  onProgress: (p: BundleProgress) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./export/bundle.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'progress') onProgress({ stage: m.stage, y: m.y, h: m.h });
      else if (m.type === 'done') { resolve(new Blob([m.buffer])); worker.terminate(); }
      else if (m.type === 'error') { reject(new Error(m.message)); worker.terminate(); }
    };
    worker.onerror = (e) => { reject(new Error(e.message || 'worker failed')); worker.terminate(); };
    worker.postMessage(params);
  });
}

const app = document.getElementById('app')!;

app.innerHTML = `
  <header class="topbar">
    <div class="brand">🗺️ BAR Procedural Map Generator</div>
    <div class="top-actions">
      <button id="randomize" title="Randomize seed">🎲 Randomize</button>
      <button id="regen" class="primary">⟳ Regenerate</button>
    </div>
  </header>
  <main class="layout">
    <aside class="panel panel-knobs" id="knobs"></aside>
    <section class="panel panel-view">
      <div class="view-bar">
        <label class="toggle"><input type="checkbox" id="tg-metal" checked> Metal</label>
        <label class="toggle"><input type="checkbox" id="tg-mex" checked> Mex spots</label>
        <label class="toggle"><input type="checkbox" id="tg-start" checked> Startboxes</label>
        <label class="toggle"><input type="checkbox" id="tg-feat" checked> Features</label>
      </div>
      <div class="canvas-wrap"><canvas id="preview"></canvas></div>
      <div class="stats" id="stats"></div>
    </section>
    <aside class="panel panel-export">
      <h3>Export</h3>
      <p class="muted">Phase 1: source bundle (PNGs + Lua + fs.txt). Compile to .sd7 with MapConv.</p>
      <button id="download-zip" class="primary block">⬇ Download .zip (source)</button>
      <div class="progress" id="progress" hidden>
        <div class="bar"><div class="fill" id="progress-fill"></div></div>
        <div class="progress-label" id="progress-label"></div>
      </div>
      <hr>
      <h3>One-click .sd7</h3>
      <p class="muted">Server-side compile via SpringMapConvNG. <span id="sd7-status">Ready.</span></p>
      <button id="download-sd7" class="primary block">⬇ Download .sd7 (playable)</button>
      <div id="validation" hidden></div>
    </aside>
  </main>
`;

const params: MapParams = { ...DEFAULT_PARAMS };
const toggles: PreviewToggles = {
  metal: true,
  mex: true,
  startboxes: true,
  features: true,
};

let mapData: MapData | null = null;
let regenTimer: ReturnType<typeof setTimeout> | null = null;

const knobsEl = document.getElementById('knobs')!;
const canvas = document.getElementById('preview') as HTMLCanvasElement;
const statsEl = document.getElementById('stats')!;
const progressEl = document.getElementById('progress')!;
const progressFill = document.getElementById('progress-fill')!;
const progressLabel = document.getElementById('progress-label')!;

renderKnobs(knobsEl, params, () => scheduleRegen(150));

// toggle wiring
const toggleIds: [keyof PreviewToggles, string][] = [
  ['metal', 'tg-metal'],
  ['mex', 'tg-mex'],
  ['startboxes', 'tg-start'],
  ['features', 'tg-feat'],
];
for (const [key, id] of toggleIds) {
  const el = document.getElementById(id) as HTMLInputElement;
  el.addEventListener('change', () => {
    toggles[key] = el.checked;
    if (mapData) renderPreview(canvas, mapData, toggles);
  });
}

document.getElementById('randomize')!.addEventListener('click', () => {
  randomizeParams(params);
  // re-render the whole knob panel so sliders/selects reflect the new values
  renderKnobs(knobsEl, params, () => scheduleRegen(150));
  scheduleRegen(0);
});

document.getElementById('regen')!.addEventListener('click', () => scheduleRegen(0));

document.getElementById('download-zip')!.addEventListener('click', async () => {
  if (!mapData) return;
  const btn = document.getElementById('download-zip') as HTMLButtonElement;
  progressEl.hidden = false;
  btn.disabled = true;
  try {
    const blob = await buildBundleAsync(mapData.params, (p) => {
      const pct = p.h > 0 ? (p.y / p.h) * 100 : 0;
      progressFill.style.width = pct.toFixed(1) + '%';
      progressLabel.textContent = `${p.stage} ${Math.round(pct)}%`;
    });
    triggerDownload(blob, `${sanitize(params.mapName)}_src.zip`);
    progressLabel.textContent = 'Done ✓';
  } catch (e) {
    progressLabel.textContent = 'Error: ' + (e as Error).message;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('download-sd7')!.addEventListener('click', async () => {
  if (!mapData) return;
  const btn = document.getElementById('download-sd7') as HTMLButtonElement;
  const status = document.getElementById('sd7-status')!;
  progressEl.hidden = false;
  btn.disabled = true;
  status.textContent = 'Packing source…';
  try {
    // 1. build the source bundle off-thread (keeps the page responsive)
    const blob = await buildBundleAsync(mapData.params, (p) => {
      const pct = p.h > 0 ? (p.y / p.h) * 100 : 0;
      progressFill.style.width = (pct / 2).toFixed(1) + '%';
      progressLabel.textContent = `packing ${p.stage} ${Math.round(pct)}%`;
    });
    // 2. server-side compile → .sd7
    status.textContent = 'Compiling on server…';
    progressFill.style.width = '55%';
    progressLabel.textContent = 'Compiling .sd7 (this can take a moment)…';
    const resp = await fetch('/api/compile', {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': 'application/zip' },
    });
    const valHeader = resp.headers.get('X-Map-Validation');
    const valResult = valHeader ? (() => { try { return JSON.parse(valHeader); } catch { return null; } })() : null;
    if (!resp.ok) {
      if (resp.status === 422 && valResult) {
        renderValidation(valResult);
        throw new Error('map failed engine validation — see details below');
      }
      const txt = await resp.text();
      throw new Error('server: ' + txt);
    }
    const sd7 = await resp.blob();
    triggerDownload(sd7, `${sanitize(params.mapName)}.sd7`);
    progressLabel.textContent = 'Done ✓ .sd7 ready';
    status.textContent = 'Ready.';
    if (valResult) renderValidation(valResult);
  } catch (e) {
    progressLabel.textContent = 'Error: ' + (e as Error).message;
    status.textContent = 'Error.';
  } finally {
    btn.disabled = false;
  }
});

/**
 * Randomize into the ranges that real BAR maps (and our verified-good terrain
 * settings) live in — so the dice always yield a playable map, never a crumpled
 * or barren one. Gameplay structure (size, teams, symmetry, name) is preserved.
 */
function randomizeParams(p: MapParams): void {
  const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  p.seed = String(Math.floor(Math.random() * 1_000_000_000));
  // weighted toward playable land maps; islands/water appear sometimes
  p.terrainType = pick(['land', 'land', 'land', 'mixed', 'mixed', 'islands', 'water']);
  p.biome = pick(['temperate', 'temperate', 'desert', 'arctic', 'volcanic', 'alien', 'lunar']);
  p.seaLevel = r2(rand(0.12, 0.38));
  p.terrainDifficulty = r2(rand(0.25, 0.65));
  p.maxHeight = Math.round(rand(150, 280) / 10) * 10;
  p.erosion = pick(['light', 'light', 'heavy']);
  p.chokePoints = Math.random() < 0.7;
  p.detailNoise = r2(rand(0.2, 0.5));
  p.metalDensity = pick(['sparse', 'normal', 'normal', 'rich']);
  p.metalDistribution = pick(['clustered', 'spread', 'mixed', 'mixed']);
  p.geoventCount = Math.floor(rand(0, 8));
  p.windStrength = r2(rand(0.2, 0.9));
  p.tidalStrength = r2(rand(0.3, 0.8));
  p.treeDensity = r2(rand(0.2, 0.7));
  p.rockDensity = r2(rand(0.15, 0.6));
  p.grassCoverage = r2(rand(0.3, 0.8));
  // keep noise in the band that yields smooth, walkable relief (never crumpled)
  p.noiseOctaves = pick([4, 4, 5]);
  p.noiseFrequency = r2(rand(0.6, 1.0));
  p.persistence = r2(rand(0.35, 0.48));
}

function scheduleRegen(delay: number): void {
  if (regenTimer) clearTimeout(regenTimer);
  regenTimer = setTimeout(() => {
    regenTimer = null;
    runGenerate();
  }, delay);
}

function runGenerate(): void {
  // large maps / heavy erosion take a moment — show a spinner state
  statsEl.textContent = 'Generating…';
  // let the UI paint before the heavy synchronous work
  requestAnimationFrame(() => {
    try {
      const t0 = performance.now();
      mapData = generateMap(params);
      const t1 = performance.now();
      renderPreview(canvas, mapData, toggles);
      renderStats(mapData, t1 - t0);
    } catch (e) {
      statsEl.textContent = 'Error: ' + (e as Error).message;
    }
  });
}

function renderStats(data: MapData, genMs: number): void {
  const s = data.stats;
  const kb = (n: number) => (n / 1024).toFixed(0);
  statsEl.innerHTML = `
    <div><b>Size</b> ${data.dims.texture}×${data.dims.texture} elmos (${data.dims.N}×${data.dims.N})</div>
    <div><b>Water</b> ${(s.waterFraction * 100).toFixed(0)}% · <b>Mex</b> ${s.mexCount} · <b>Teams</b> ${s.teamCount}</div>
    <div><b>Features</b> ${s.featureCount} · <b>Height range</b> ${data.minHeight}–${data.maxHeight} elmos</div>
    <div><b>Est. .sd7</b> ~${kb(s.estSd7Bytes)} KB · <b>Generated in</b> ${genMs.toFixed(0)} ms</div>
  `;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-]/g, '_') || 'ProceduralMap';
}

function renderValidation(v: { ok: boolean; errors: string[]; warnings: string[]; stats: Record<string, unknown> }): void {
  const el = document.getElementById('validation')!;
  el.hidden = false;
  const color = v.ok ? (v.warnings.length ? '#b8860b' : '#2a7a2a') : '#8b0000';
  const icon = v.ok ? (v.warnings.length ? '⚠' : '✓') : '✗';
  const s = v.stats as Record<string, unknown>;
  const statsLines = [
    s.maxSlopeDeg !== undefined ? `max slope ${s.maxSlopeDeg}°` : '',
    s.minimapNonZeroPct !== undefined ? `minimap ${s.minimapNonZeroPct}% filled` : '',
    s.metalSum !== undefined ? `metal sum ${s.metalSum}` : '',
    s.mapWidth !== undefined ? `map ${s.mapWidth}×${s.mapHeight} sq` : '',
  ].filter(Boolean).join(' · ');
  el.innerHTML = `
    <div style="border:1px solid ${color};border-radius:4px;padding:8px;margin-top:8px;font-size:12px">
      <div style="color:${color};font-weight:bold">${icon} Engine validation ${v.ok ? 'passed' : 'failed'}</div>
      ${v.errors.map(e => `<div style="color:#c00">✗ ${e}</div>`).join('')}
      ${v.warnings.map(w => `<div style="color:#a60">⚠ ${w}</div>`).join('')}
      ${statsLines ? `<div style="color:#555;margin-top:4px">${statsLines}</div>` : ''}
    </div>`;
}

// initial generate
scheduleRegen(0);
