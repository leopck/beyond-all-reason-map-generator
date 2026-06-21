# Generation pipeline

How a set of knobs becomes a playable map, stage by stage. Code references are to
`src/`.

## 1. Heightmap (`gen/heightmap.ts`)

The terrain is the foundation everything else keys off.

1. **Base field** — warped fractal Brownian motion (fBm) + ridged noise, sampled in
   world-elmo coordinates. Octaves/frequency/persistence/lacunarity are tunable; the
   defaults (4 octaves, freq 0.8) deliberately keep high-frequency "minor hills" low so
   the terrain reads as broad landforms, not noise.
2. **Terrain-type shaping** — a `switch` on `terrainType` reshapes the field: `islands`
   uses a smoothstep for distinct landmasses, `water` lowers the base, `metal`/`air` go
   nearly flat, etc.
3. **Choke points** — optional Gaussian valleys carved across the map for land pathing.
4. **Normalize** to `[0,1]`, light erosion (a small Gaussian blur), symmetry mirroring.
5. **Water level** — `effectiveSeaQuantile()` picks the fraction of the map below sea
   level **from the terrain type** (land ≈ 12 %, mixed ≈ 35 %, islands ≈ 51 %, water ≈
   65 %), fine-tuned by the Water-amount knob. This is what makes the types look different.
6. **Low-pass + slope cap** — a genuine low-pass (smooth *without* re-normalizing, so
   amplitude actually drops) removes residual bumps, then `limitSlopes()` hard-caps the
   adjacent-vertex slope at ~34°. The metric that matters is the **angle**:
   `slope° = atan(Δheight_elmos / squareSize)` — a "5:1" ratio is 78°, nearly vertical,
   which is why early versions looked like a field of needles.

The output is a normalized `Float32Array`. `pipeline.ts` then derives `minHeight`
(negative, so the coastline sits at 0 elmos = the engine's water plane) and `maxHeight`.

## 2. Water level → coastline

`minHeight = -(waterLevelNorm / (1 - waterLevelNorm)) * maxHeight`. This anchors the
shoreline at elmo 0; everything below renders with the engine water shader.

## 3. Start boxes (`gen/startboxes.ts`)

Placed on land, symmetry-aware, one box per allyteam.

## 4. Metal (`gen/metal.ts`)

- A target spot count scales with map size × density knob, divided by the symmetry orbit
  size (so a mirror map doesn't get double). Real BAR maps run ~8–40 spots — *not*
  hundreds.
- Spots are placed with min-distance rejection. **Every** symmetry image of a candidate
  is distance-checked against **every** placed spot, so mirrors can't collide.
- Two outputs: discrete spots (for `map_metal_layout.lua`) and a continuous `metalmap`
  (Gaussian blob per spot — this is what the engine actually reads, scaled by
  `mapinfo.maxMetal`).

## 5. Features (`gen/features.ts`)

Trees on flat lowland/midland, rocks on highland, geovents on land — all kept clear of
mex spots. Positions are world elmos. These become entries in the FeaturePlacer
`set.lua` (see [map-format.md](map-format.md#features)).

## 6. Texture & splat (`gen/texture.ts`, `gen/splat.ts`)

- **Color texture** — `shadeColor()` classifies each pixel by height/water into a terrain
  class, applies the biome palette, hillshading, moisture tint and grain. Streamed
  row-by-row into the PNG encoder so the 8192² image never fully materializes.
- **Minimap** — the same shading at 1024² (also reused as the lobby preview `mini.png`).
- **Splat distribution** — an RGBA map (R cliffs, G pebbles, B grass, A bare earth)
  derived from slope + terrain class. It tells the engine where to blend each detail
  material (see map-format).
- **Grass distribution** — a smooth 512² gradient TGA (`grassdist.tga`) for BAR's
  `custom.grassConfig` system, far smoother than the engine's coarse SMF grass.

## 7. Export & bundle (`export/bundle.ts`)

Encodes every layer (heightmap 16-bit PNG, texture RGBA PNG, metalmap/typemap 8-bit PNG,
minimap, splat distribution PNG, grass TGA) plus `mapinfo.lua`, the FeaturePlacer
`set.lua`, start boxes and metal layout, and zips it all.

## 8. Compile & package (server, see [map-format.md](map-format.md))

SpringMapConvNG turns the PNGs into `.smf` + `.smt`; the server assembles the `.sd7` on
the scaffold and validates it.

## Tuning notes / gotchas

- **Slope must be measured in degrees**, not rise:run ratio. This was the single biggest
  source of "spiky" bugs.
- **Smoothing without re-normalizing** is what actually flattens terrain; re-normalizing
  stretches it straight back to full amplitude.
- **Too much smoothing dissolves terrain-type character** — islands stop being islands.
  Keep it light and let low octaves do the de-noising.
- **The map name must be unique per param set** (it embeds a hash) or the engine serves a
  cached map and nothing you change appears in-game.
