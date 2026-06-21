# BAR map format & how we assemble it

A BAR/Spring map is a `.sd7` — a 7-Zip archive with a specific layout. The single most
important lesson learned building this generator: **mimic a real, working map exactly.**
We do that by building every map on top of the official
[map_blueprint](https://github.com/beyond-all-reason/map_blueprint) scaffold.

## Archive layout (what a working `.sd7` contains)

```
mapinfo.lua                         map metadata, lighting, water, resources, grass…
maphelper/mapinfo.lua               boilerplate (from scaffold)
mapoptions.lua                      player-facing options (from scaffold)
maps/
  <Name>.smf                        binary heightmap/typemap/minimap/grass/metal/tiles ptr
  <Name>.smt                        compressed texture tiles
  splat_distribution.png            per-map: where each detail material blends
  grassdist.tga                     per-map: smooth grass density
  mini.png                          lobby/menu preview image
  Rock_Brown_1k_dnts.dds            \
  Ground_LargeScaleRockyDirt…dds     } SSMF detail-normal materials (from scaffold)
  Ground_GrassThickGreen_1k…dds      } "dnts" = Detail Normal Texture Splat
  earth_NORM.dds                    /
  detailtexblurred.bmp              classic detail texture (from scaffold)
  grass_field_dry.dds.cached.dds    grass blade color (from scaffold)
  waterbump_4tiles.png              water normal (from scaffold)
features/ad0newfeatures.lua         FeatureDef: the fir tree (from scaffold)
objects3d/…tree….s3o                tree 3-D model (from scaffold)
unittextures/tree…dds               tree textures (from scaffold)
LuaGaia/
  main.lua, draw.lua                gadget-handler bootstrap (from scaffold)
  Gadgets/FP_featureplacer.lua      spawns features from set.lua (from scaffold)
mapconfig/
  featureplacer/config.lua          → includes set.lua (from scaffold)
  featureplacer/set.lua             per-map: the actual tree positions
  mapinfo/0_apply_options.lua       (from scaffold)
  map_metal_layout.lua              per-map: mex spots
  map_startboxes.lua                per-map: team boxes
```

"(from scaffold)" = copied verbatim from `map_blueprint`. The server only **generates**
the per-map files and the compiled `.smf`/`.smt`.

## The SMF binary (`maps/<Name>.smf`)

Produced by SpringMapConvNG from our PNGs. 80-byte header + sections:

| Section | Source PNG | Notes |
|---|---|---|
| heightmap | `heightmap.png` (16-bit) | `(mapx+1)²` uint16, mapped to `[minHeight, maxHeight]` |
| typemap | `typemap.png` (8-bit) | terrain type per 2×2 squares |
| minimap | `minimap.png` | DXT1, full mipmap chain |
| **grass** | `-v` (now unused) | engine grass extra-header; we use grassDistTGA instead |
| metalmap | `metalmap.png` (8-bit) | red channel = metal density |
| tiles | `texture.png` → `.smt` | de-duplicated 32² DXT1 tiles |
| features | (we use FeaturePlacer) | the SMF feature section is *not* how BAR places features |

`mapinfo.smf.minheight/maxheight` and `mapfile`/`smtFileName0` must point at the file in
`maps/`. We verify all of this with spring-map-parser.

## Features — the real mechanism {#features}

BAR does **not** place trees/rocks via the SMF feature section. It uses a LuaGaia gadget:

1. `LuaGaia/Gadgets/FP_featureplacer.lua` (the standard FeaturePlacer by Smoth) reads
   `mapconfig/featureplacer/config.lua`, which `VFS.Include`s `set.lua`.
2. `set.lua` returns `{ objectlist = { {name=…, x=…, z=…, rot=…}, … } }`.
3. For each entry the gadget calls `Spring.CreateFeature(name, x, GetGroundHeight(x,z),
   z, rot)`. It computes the ground height itself, so we only emit `x, z, rot`.
4. `name` **must** be a real FeatureDef. We bundle the blueprint's tree def
   (`fir_tree_small_1()tree_fir_tall_5`) + its `.s3o` model + textures, and emit that name.

Using a fake name (e.g. `tree1`) silently spawns nothing — this was the original
"no trees" bug.

## Textures — SSMF splat detail

Close-up ground detail comes from the **SSMF splat system**, configured in
`mapinfo.resources`:

- Four `splatDetailNormalTex1..4` (the `.dds` "dnts" materials: cliffs, pebbles, grass,
  earth) — **must be TGA/DDS**; PNG is silently skipped for these slots.
- `splatDistrTex` (our per-map `splat_distribution.png`) — RGBA, each channel is the
  blend weight for the matching material. PNG *is* accepted here.
- `splats.texScales/texMults` control tiling and strength.

These textures live in `maps/` and are referenced by bare filename; the engine resolves
resource names relative to `maps/`. Putting them at the archive root (an early mistake)
makes them invisible.

## Grass — `custom.grassConfig`

The engine's native SMF grass map is only `mapx/4` and binary, so it renders as
pixelated 32-elmo blocks. Real maps (e.g. crater_islands) instead use BAR's
`custom.grassConfig.grassDistTGA` — a higher-res, smooth-gradient density map rendered by
a BAR-global system. We emit a 512² `grassdist.tga` with soft density falloff and point
`grassConfig.grassDistTGA` at it, plus the scaffold's `grassBladeColorTex`.

## Metal

BAR derives mex spots from the **metalmap red channel** scaled by `mapinfo.maxMetal`
(≈0.6) with `extractorRadius`. No `map_metal_layout.lua` is strictly required (we still
emit one for tooling compatibility). Hundreds of blobs = a metal carpet; keep it to a
realistic ~8–40.

## Caching gotcha

The engine caches map data (including the lobby minimap) **by the map's name**. Our
`mapinfo.name` embeds a 6-char hash of all generation params, so every distinct map is a
distinct name — otherwise changing a knob shows no change in-game because a cached map is
served.
