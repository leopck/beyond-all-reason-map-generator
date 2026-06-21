/**
 * Schema-driven knob panel. Renders all generator inputs grouped by section
 * and binds them to a params object; any change calls `onChange`.
 */
import type { MapParams } from '../params';

type Opt = { value: string; label: string };

type Knob =
  | { key: keyof MapParams; label: string; type: 'select'; options: Opt[] }
  | { key: keyof MapParams; label: string; type: 'range'; min: number; max: number; step: number }
  | { key: keyof MapParams; label: string; type: 'checkbox' }
  | { key: keyof MapParams; label: string; type: 'text' };

interface Section {
  title: string;
  knobs: Knob[];
}

const MAP_SIZE_OPTS: Opt[] = [6, 8, 10, 12, 16, 20, 24, 32].map((n) => ({
  value: String(n),
  label: `${n}×${n}`,
}));

const SECTIONS: Section[] = [
  {
    title: 'Core',
    knobs: [
      { key: 'seed', label: 'Seed', type: 'text' },
      { key: 'mapName', label: 'Map name', type: 'text' },
      { key: 'mapSize', label: 'Map size', type: 'select', options: MAP_SIZE_OPTS },
    ],
  },
  {
    title: 'Symmetry & fairness',
    knobs: [
      {
        key: 'symmetry',
        label: 'Symmetry',
        type: 'select',
        options: [
          { value: 'none', label: 'None (free-for-all)' },
          { value: 'flip', label: 'Flip (L↔R mirror)' },
          { value: 'mirror', label: 'Point mirror (180°)' },
          { value: 'rotate2', label: 'Rotate C2 (180°)' },
          { value: 'rotate4', label: 'Rotate C4 (90°)' },
          { value: 'teamAsym', label: 'Team-asym (res symmetric, terrain not)' },
        ],
      },
      {
        key: 'teamCount',
        label: 'Teams',
        type: 'select',
        options: [1, 2, 4, 8].map((n) => ({ value: String(n), label: String(n) })),
      },
      {
        key: 'startBoxMode',
        label: 'Start boxes',
        type: 'select',
        options: [
          { value: 'symmetric', label: 'Symmetric' },
          { value: 'asymmetric', label: 'Asymmetric' },
          { value: 'corners', label: 'Corners' },
          { value: 'edges', label: 'Edges' },
        ],
      },
      { key: 'metalSpotSymmetry', label: 'Lock resource symmetry', type: 'checkbox' },
    ],
  },
  {
    title: 'Terrain',
    knobs: [
      {
        key: 'terrainType',
        label: 'Terrain type',
        type: 'select',
        options: [
          { value: 'land', label: 'Land' },
          { value: 'water', label: 'Water (naval)' },
          { value: 'islands', label: 'Islands' },
          { value: 'mixed', label: 'Mixed' },
          { value: 'metal', label: 'Metal (space)' },
          { value: 'air', label: 'Air (flat)' },
        ],
      },
      {
        key: 'biome',
        label: 'Biome',
        type: 'select',
        options: [
          { value: 'temperate', label: 'Temperate' },
          { value: 'desert', label: 'Desert' },
          { value: 'arctic', label: 'Arctic' },
          { value: 'volcanic', label: 'Volcanic' },
          { value: 'alien', label: 'Alien' },
          { value: 'lunar', label: 'Lunar' },
        ],
      },
      { key: 'seaLevel', label: 'Water amount', type: 'range', min: 0, max: 0.8, step: 0.01 },
    ],
  },
  {
    title: 'Relief & difficulty',
    knobs: [
      { key: 'terrainDifficulty', label: 'Terrain difficulty', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'maxHeight', label: 'Mountain height (elmos)', type: 'range', min: 120, max: 360, step: 10 },
      {
        key: 'erosion',
        label: 'Erosion',
        type: 'select',
        options: [
          { value: 'none', label: 'None' },
          { value: 'light', label: 'Light' },
          { value: 'heavy', label: 'Heavy' },
        ],
      },
      { key: 'chokePoints', label: 'Choke points / passes', type: 'checkbox' },
      { key: 'detailNoise', label: 'Detail noise', type: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Resources',
    knobs: [
      {
        key: 'metalDensity',
        label: 'Metal density',
        type: 'select',
        options: [
          { value: 'sparse', label: 'Sparse' },
          { value: 'normal', label: 'Normal' },
          { value: 'rich', label: 'Rich' },
          { value: 'insane', label: 'Insane' },
        ],
      },
      {
        key: 'metalDistribution',
        label: 'Metal distribution',
        type: 'select',
        options: [
          { value: 'clustered', label: 'Clustered (few big)' },
          { value: 'spread', label: 'Spread (many small)' },
          { value: 'mixed', label: 'Mixed' },
        ],
      },
      { key: 'geoventCount', label: 'Geovents', type: 'range', min: 0, max: 40, step: 1 },
      { key: 'windStrength', label: 'Wind energy', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'tidalStrength', label: 'Tidal energy', type: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Features',
    knobs: [
      { key: 'treeDensity', label: 'Tree density', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'rockDensity', label: 'Rock density', type: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'grassCoverage', label: 'Grass coverage', type: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Advanced (noise)',
    knobs: [
      { key: 'noiseOctaves', label: 'Octaves', type: 'range', min: 1, max: 8, step: 1 },
      { key: 'noiseFrequency', label: 'Frequency', type: 'range', min: 0.3, max: 3, step: 0.05 },
      { key: 'persistence', label: 'Persistence', type: 'range', min: 0.2, max: 0.7, step: 0.01 },
      { key: 'lacunarity', label: 'Lacunarity', type: 'range', min: 1.5, max: 3, step: 0.05 },
    ],
  },
];

export function renderKnobs(
  container: HTMLElement,
  params: MapParams,
  onChange: () => void,
): void {
  container.innerHTML = '';
  for (const section of SECTIONS) {
    const sec = document.createElement('section');
    sec.className = 'knob-section';
    const h = document.createElement('h3');
    h.textContent = section.title;
    sec.appendChild(h);
    for (const k of section.knobs) {
      sec.appendChild(makeKnob(k, params, onChange));
    }
    container.appendChild(sec);
  }
}

function makeKnob(k: Knob, params: MapParams, onChange: () => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'knob';
  const label = document.createElement('span');
  label.className = 'knob-label';

  const valueLabel = document.createElement('span');
  valueLabel.className = 'knob-value';

  const setLabel = () => {
    if (k.type === 'range') {
      const v = params[k.key] as number;
      valueLabel.textContent = String(v);
    }
  };

  if (k.type === 'select') {
    label.textContent = k.label;
    const sel = document.createElement('select');
    for (const o of k.options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.value = String(params[k.key]);
    sel.addEventListener('change', () => {
      const raw = sel.value;
      const cur = params[k.key];
      (params as unknown as Record<string, unknown>)[k.key] =
        typeof cur === 'number' ? Number(raw) : raw;
      onChange();
    });
    wrap.appendChild(label);
    wrap.appendChild(sel);
    return wrap;
  }

  if (k.type === 'checkbox') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(params[k.key]);
    cb.addEventListener('change', () => {
      (params as unknown as Record<string, unknown>)[k.key] = cb.checked;
      onChange();
    });
    label.textContent = k.label;
    wrap.classList.add('knob-check');
    wrap.appendChild(cb);
    wrap.appendChild(label);
    return wrap;
  }

  if (k.type === 'text') {
    label.textContent = k.label;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = String(params[k.key]);
    inp.addEventListener('change', () => {
      (params as unknown as Record<string, unknown>)[k.key] = inp.value;
      onChange();
    });
    wrap.appendChild(label);
    wrap.appendChild(inp);
    return wrap;
  }

  // range
  label.textContent = k.label;
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = String(k.min);
  inp.max = String(k.max);
  inp.step = String(k.step);
  inp.value = String(params[k.key]);
  setLabel();
  inp.addEventListener('input', () => {
    (params as unknown as Record<string, unknown>)[k.key] = Number(inp.value);
    setLabel();
    onChange();
  });
  wrap.appendChild(label);
  wrap.appendChild(valueLabel);
  wrap.appendChild(inp);
  return wrap;
}
