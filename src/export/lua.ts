/**
 * Lua config emitters for the BAR/Spring map (research §4.3, §4.5).
 *
 *  - mapinfo.lua            : map metadata + SMF height range (min/maxHeight)
 *  - map_metal_layout.lua   : discrete mex spots  (`mexes` table)
 *  - map_startboxes.lua     : team spawn boxes     (1-based allyteam keys)
 *
 * The exact table keys are the widely-used ZK/BAR conventions; they are
 * documented inline and trivial to adjust if a gadget expects a different key.
 */
import type { MapData } from '../types';
import type { MapParams } from '../params';

function luaNum(n: number): string {
  // avoid scientific notation; Spring Lua parses plain decimals
  return Number(n.toFixed(2)).toString();
}

/**
 * Short deterministic hash of all generation params. The engine caches map data
 * (minimap, loaded archive) by the map's NAME — if every generation is called
 * "Procedural BAR Map" the engine serves a STALE cached map and nothing the user
 * tweaks appears to change. Embedding this hash in the name makes each distinct
 * parameter set a distinct map, so the cache can never mask a regeneration.
 */
function paramHash(params: MapParams): string {
  const s = JSON.stringify(params);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}

/** Map name as the engine sees it: user name + content hash (cache-buster). */
export function uniqueMapName(params: MapParams): string {
  return `${params.mapName} ${paramHash(params)}`;
}

/** Per-biome environment: water color, sun, ground light, sky/fog. RGB in 0..1. */
interface BiomeEnv {
  waterBase: [number, number, number];   // shallow-water start color
  waterMin: [number, number, number];    // deep-water color
  waterSurface: [number, number, number];// surface tint
  sunDir: [number, number, number];
  sunColor: [number, number, number];
  groundAmbient: [number, number, number];
  groundDiffuse: [number, number, number];
  skyColor: [number, number, number];
  fogColor: [number, number, number];
  grassColor: [number, number, number];
}

const BIOME_ENV: Record<string, BiomeEnv> = {
  temperate: {
    waterBase: [0.2, 0.55, 0.75], waterMin: [0.0, 0.12, 0.22], waterSurface: [0.55, 0.85, 1.0],
    sunDir: [0.5, 1.0, 0.4], sunColor: [1.0, 0.96, 0.85],
    groundAmbient: [0.38, 0.4, 0.42], groundDiffuse: [1.0, 0.98, 0.9],
    skyColor: [0.5, 0.66, 0.84], fogColor: [0.74, 0.82, 0.9], grassColor: [0.45, 0.7, 0.38],
  },
  desert: {
    waterBase: [0.25, 0.6, 0.7], waterMin: [0.02, 0.18, 0.25], waterSurface: [0.6, 0.85, 0.95],
    sunDir: [0.55, 1.0, 0.35], sunColor: [1.0, 0.95, 0.8],
    groundAmbient: [0.45, 0.42, 0.36], groundDiffuse: [1.0, 0.97, 0.85],
    skyColor: [0.7, 0.74, 0.78], fogColor: [0.86, 0.82, 0.68], grassColor: [0.7, 0.66, 0.4],
  },
  arctic: {
    waterBase: [0.3, 0.5, 0.62], waterMin: [0.05, 0.15, 0.25], waterSurface: [0.7, 0.85, 0.95],
    sunDir: [0.45, 0.95, 0.5], sunColor: [0.92, 0.95, 1.0],
    groundAmbient: [0.5, 0.53, 0.58], groundDiffuse: [0.95, 0.97, 1.0],
    skyColor: [0.62, 0.72, 0.84], fogColor: [0.82, 0.88, 0.95], grassColor: [0.7, 0.78, 0.82],
  },
  volcanic: {
    waterBase: [0.35, 0.18, 0.12], waterMin: [0.12, 0.04, 0.03], waterSurface: [0.6, 0.3, 0.2],
    sunDir: [0.5, 0.9, 0.45], sunColor: [1.0, 0.8, 0.6],
    groundAmbient: [0.32, 0.26, 0.24], groundDiffuse: [1.0, 0.85, 0.7],
    skyColor: [0.4, 0.32, 0.34], fogColor: [0.5, 0.36, 0.32], grassColor: [0.4, 0.3, 0.22],
  },
  alien: {
    waterBase: [0.18, 0.5, 0.42], waterMin: [0.04, 0.16, 0.14], waterSurface: [0.5, 0.9, 0.75],
    sunDir: [0.5, 1.0, 0.4], sunColor: [0.9, 1.0, 0.92],
    groundAmbient: [0.36, 0.4, 0.38], groundDiffuse: [0.92, 1.0, 0.94],
    skyColor: [0.45, 0.6, 0.55], fogColor: [0.6, 0.72, 0.66], grassColor: [0.45, 0.72, 0.5],
  },
  lunar: {
    waterBase: [0.3, 0.32, 0.36], waterMin: [0.1, 0.1, 0.12], waterSurface: [0.5, 0.52, 0.56],
    sunDir: [0.5, 1.0, 0.4], sunColor: [1.0, 1.0, 1.0],
    groundAmbient: [0.42, 0.42, 0.44], groundDiffuse: [0.96, 0.96, 0.98],
    skyColor: [0.08, 0.09, 0.12], fogColor: [0.2, 0.2, 0.24], grassColor: [0.5, 0.5, 0.52],
  },
};

function rgb(c: [number, number, number]): string {
  return `{ ${c.map((v) => luaNum(v)).join(', ')} }`;
}

export function mapinfoLua(data: MapData): string {
  const { params, dims } = data;
  const env = BIOME_ENV[params.biome] ?? BIOME_ENV.temperate;
  const hasWater = params.terrainType !== 'metal' && params.terrainType !== 'air';
  // grassdist.tga is only emitted for green biomes on non-flat presets
  const grass = hasWater && (params.biome === 'temperate' || params.biome === 'alien' || params.biome === 'arctic');
  const name = uniqueMapName(params); // includes content hash → defeats engine map cache
  const file = sanitize(name);        // smf/smt basename (matches server staging)
  return [
    '-- mapinfo.lua (Spring/Recoil SMF) — structure mirrors the official BAR map_blueprint',
    'local mapinfo = {',
    `  name        = "${escapeStr(name)}",`,
    `  shortname   = "${escapeStr(name)}",`,
    `  description = "Procedurally generated (${params.terrainType}, ${params.biome}, ${params.symmetry})",`,
    `  author      = "bar-map-generator",`,
    `  version     = "1",`,
    `  mapfile     = "maps/${file}.smf",`,
    `  modtype     = 3,`,
    `  depend      = { "Map Helper v1" },`,
    `  replace     = {},`,
    '',
    '  maphardness     = 100,',
    '  notDeformable   = false,',
    '  gravity         = 130,',
    `  tidalStrength   = ${Math.round(params.tidalStrength * 30)},`, // 0..1 → 0..30 (BAR maps ~15-23)
    '  maxMetal        = 0.60,',
    '  extractorRadius = 100.0,',
    `  voidWater       = ${hasWater ? 'false' : 'true'},`,
    '  autoShowMetal   = true,',
    '',
    '  smf = {',
    `    minheight = ${luaNum(data.minHeight)},`,
    `    maxheight = ${luaNum(data.maxHeight)},`,
    `    smtFileName0 = "maps/${file}.smt",`,
    '  },',
    `  mapSize = { x = ${dims.N}, z = ${dims.N} },`,
    '',
    '  lighting = {',
    `    sunDir = ${rgb(env.sunDir)},`,
    `    groundambientcolor = ${rgb(env.groundAmbient)},`,
    `    grounddiffusecolor = ${rgb(env.groundDiffuse)},`,
    '    groundspecularcolor = { 0.5, 0.5, 0.5 },',
    '    groundshadowdensity = 0.7,',
    `    unitAmbientColor = ${rgb(env.groundAmbient)},`,
    `    unitDiffuseColor = ${rgb(env.groundDiffuse)},`,
    '    unitshadowdensity = 0.7,',
    '    specularExponent = 80.0,',
    '  },',
    '',
    '  atmosphere = {',
    `    minWind = ${Math.round(params.windStrength * 5)},`,       // 0..5
    `    maxWind = ${Math.round(5 + params.windStrength * 20)},`,  // 5..25

    '    fogStart = 0.95,',
    '    fogEnd = 1.0,',
    `    fogColor = ${rgb(env.fogColor)},`,
    `    skyColor = ${rgb(env.skyColor)},`,
    `    sunColor = ${rgb(env.sunColor)},`,
    '    cloudDensity = 0.3,',
    '    cloudColor = { 0.9, 0.9, 0.92 },',
    '  },',
    '',
    '  water = {',
    '    damage = 0,',
    '    repeatX = 0.0,',
    '    repeatY = 0.0,',
    '    absorb = { 0.0015, 0.0008, 0.0004 },',
    `    basecolor = ${rgb(env.waterBase)},`,
    `    mincolor = ${rgb(env.waterMin)},`,
    `    surfacecolor = ${rgb(env.waterSurface)},`,
    '    surfaceAlpha = 0.55,',
    '    ambientFactor = 1.0,',
    '    diffuseFactor = 1.0,',
    '    specularFactor = 1.2,',
    '    specularPower = 40.0,',
    '    fresnelMin = 0.2,',
    '    fresnelMax = 0.8,',
    '    fresnelPower = 5.0,',
    '    reflectionDistortion = 1.0,',
    '    shoreWaves = true,',
    '    forceRendering = false,',
    '    hasWaterPlane = false,',
    '  },',
    '',
    '  grass = {',
    '    bladeWaveScale = 1.0,',
    '    bladeWidth = 0.32,',
    '    bladeHeight = 4.0,',
    '    bladeAngle = 2.0,',
    `    bladeColor = ${rgb(env.grassColor)},`,
    '  },',
    '',
    '  -- SSMF splat detail — exact recipe + assets from the official map_blueprint.',
    '  -- Order is cliffs, pebbles, grass, metalspots (matches splat_distribution RGBA).',
    '  resources = {',
    '    detailTex = "detailtexblurred.bmp",',
    '    splatDistrTex = "splat_distribution.png",',
    '    splatDetailTex = "iwantDNTS.tga",',
    '    splatDetailNormalDiffuseAlpha = 1,',
    '    splatDetailNormalTex1 = "Rock_Brown_1k_dnts.dds",',
    '    splatDetailNormalTex2 = "Ground_LargeScaleRockyDirt_1k_dnts.dds",',
    '    splatDetailNormalTex3 = "Ground_GrassThickGreen_1k_dnts.dds",',
    '    splatDetailNormalTex4 = "earth_NORM.dds",',
    '  },',
    '  splats = {',
    '    texScales = { 0.010, 0.005, 0.0075, 0.01 },',
    '    texMults  = { 1.2, 0.4, 0.9, 0.25 },',
    '  },',
    '',
    '  terrainTypes = {',
    '    [0] = {',
    '      name = "Ground",',
    '      hardness = 1.0,',
    '      receiveTracks = true,',
    '      moveSpeeds = { tank = 1.0, kbot = 1.0, hover = 1.0, ship = 1.0 },',
    '    },',
    '  },',
    ...(grass ? [
    '',
    '  -- BAR smooth-grass system (custom.grassConfig.grassDistTGA) — the higher-res',
    '  -- gradient density map renders far smoother than the engine SMF grass blocks.',
    '  custom = {',
    '    grassConfig = {',
    '      grassDistTGA = "maps/grassdist.tga",',
    '      grassMaxSize = 2.0,',
    '      grassMinSize = 0.8,',
    '      grassBladeColorTex = "maps/grass_field_dry.dds.cached.dds",',
    '      grassShaderParams = { MAPCOLORFACTOR = 0.4, MAPCOLORBASE = 0.6 },',
    '    },',
    '  },',
    ] : []),
    '}',
    'return mapinfo',
    '',
  ].join('\n');
}

/**
 * mapconfig/featureplacer/set.lua — the official BAR FeaturePlacer format.
 * The bundled FP_featureplacer.lua gadget reads `objectlist` and spawns each
 * with Spring.CreateFeature(name, x, GetGroundHeight(x,z), z, rot). `name` must
 * be a valid FeatureDef (we bundle the map_blueprint fir-tree def). rot "-1"
 * means random. Coordinates are world elmos.
 */
const TREE_FEATURE = 'fir_tree_small_1()tree_fir_tall_5';

export function featurePlacerSetLua(data: MapData): string {
  const lines: string[] = [
    '-- AutoCreated by bar-map-generator (FeaturePlacer format)',
    'local setcfg = {',
    '  unitlist = {},',
    '  buildinglist = {},',
    '  objectlist = {',
  ];
  for (const f of data.features) {
    if (!f.type.startsWith('tree')) continue; // only trees have a bundled FeatureDef
    lines.push(`    { name = '${TREE_FEATURE}', x = ${Math.round(f.x)}, z = ${Math.round(f.z)}, rot = "-1" },`);
  }
  lines.push('  },', '}', 'return setcfg', '');
  return lines.join('\n');
}

export function metalLayoutLua(data: MapData): string {
  const lines: string[] = [
    '-- mapconfig/map_metal_layout.lua',
    '-- Discrete metal spots in world elmos. Continuous extraction also comes',
    '-- from the red channel of metalmap.png.',
    'return {',
    '  mexes = {',
  ];
  for (const m of data.mexSpots) {
    lines.push(`    { x = ${luaNum(m.x)}, z = ${luaNum(m.z)} },`);
  }
  lines.push('  },', '}');
  return lines.join('\n') + '\n';
}

export function startBoxesLua(data: MapData): string {
  const lines: string[] = [
    '-- mapconfig/map_startboxes.lua',
    '-- Team spawn boxes in world elmos (1-based allyteam index).',
    'return {',
  ];
  // group by team (1-based)
  const byTeam = new Map<number, typeof data.startBoxes>();
  for (const sb of data.startBoxes) {
    const arr = byTeam.get(sb.team) ?? [];
    arr.push(sb);
    byTeam.set(sb.team, arr);
  }
  for (const [team, boxes] of byTeam) {
    lines.push(`  [${team + 1}] = {`);
    for (const sb of boxes) {
      lines.push(
        `    { x1 = ${luaNum(sb.x1)}, z1 = ${luaNum(sb.z1)}, x2 = ${luaNum(sb.x2)}, z2 = ${luaNum(sb.z2)} },`,
      );
    }
    lines.push('  },');
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

export function fsTxt(data: MapData): string {
  // one feature tdfname per line; R channel (255 - i) indexes these (featuremap image format)
  return data.fsList.join('\n') + '\n';
}

/** SpringMapConvNG -features format: one instance per line: tdfname x y z rot_y */
export function featuresTxt(data: MapData): string {
  // y < -490000 → compiler calculates height from terrain (documented behavior)
  return data.features
    .map(f => `${f.type} ${f.x.toFixed(1)} -500000 ${f.z.toFixed(1)} ${f.rot.toFixed(1)}`)
    .join('\n') + '\n';
}

export function readmeTxt(data: MapData): string {
  const { dims } = data;
  return [
    `${data.params.mapName} — source bundle`,
    '=========================================',
    'Generated by bar-map-generator (Phase 1 source set).',
    '',
    'To compile to a playable .sd7 with SpringMapConvNG:',
    '',
    '  springmapconvng \\',
    '    -t texture.png \\',
    '    -a heightmap.png \\',
    '    -m metalmap.png \\',
    '    -y typemap.png \\',
    '    -f featuremap.png \\',
    '    --featurelist fs.txt \\',
    '    --minheight ' + data.minHeight + ' \\',
    '    --maxheight ' + data.maxHeight + ' \\',
    '    -o ' + sanitize(data.params.mapName) + '.smf',
    '',
    'Then assemble the .sd7 (7z archive) containing:',
    `  ${sanitize(data.params.mapName)}.smf`,
    `  ${sanitize(data.params.mapName)}.smt   (texture tiles, emitted by the compiler)`,
    '  mapinfo.lua',
    '  mapconfig/map_metal_layout.lua',
    '  mapconfig/map_startboxes.lua',
    '',
    'Dimensions (mapSize = ' + dims.N + '):',
    '  texture  = ' + dims.texture + 'x' + dims.texture,
    '  heightmap= ' + dims.heightW + 'x' + dims.heightH + ' (16-bit grayscale)',
    '  metalmap = ' + dims.metalW + 'x' + dims.metalH + ' (8-bit, red=metal)',
    '  featuremap = ' + dims.featureW + 'x' + dims.featureH + ' (RGBA)',
    '  typemap  = ' + dims.typeW + 'x' + dims.typeH + ' (8-bit grayscale)',
    '',
    'Stats: mex=' + data.stats.mexCount + ' features=' + data.stats.featureCount +
      ' teams=' + data.stats.teamCount + ' water=' +
      (data.stats.waterFraction * 100).toFixed(0) + '%',
    '',
  ].join('\n');
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_\-]/g, '_');
}
