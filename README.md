# BAR Procedural Map Generator

> NOTE: The map generated has several bugs but the maps does generate and load into the game and it is playable but bugs are shown here
> 
> NOTE: The generator's tuner knobs for things like the tree placement or the metal points are not optimized, it's placed randomly too causing weird issues.

Goal: Generate playable [Beyond All Reason](https://www.beyondallreason.info/) (Spring/Recoil
engine) maps in your browser, then compile them to a ready-to-play `.sd7` with one click.

The app draws terrain, water, metal spots, start boxes, trees and grass from a set of
tunable knobs, previews them live, and produces a real BAR map that loads in-game —
terrain, textures, 3D trees, grass, metal, geo and a lobby preview included.

---

## Quick start (Docker — recommended)

Everything (the SMF compiler, the website, the validator, the map scaffold) is baked
into one image. You only need Docker — it's a single app, no orchestration required.

```bash
docker build -t bar-map-generator .
docker run --rm -p 8100:8100 bar-map-generator
# open http://localhost:8100
```

Want it to run in the background and restart on reboot?

```bash
docker run -d --restart unless-stopped -p 8100:8100 --name bargen bar-map-generator
```

Generate a map, tweak the knobs (or hit 🎲 **Randomize**), then click
**⬇ Download .sd7 (playable)**. Drop the file into your BAR maps folder
(`…/Beyond-All-Reason/data/maps/`) and it appears in the map list.

> The first build takes a few minutes — it compiles SpringMapConvNG from source and
> installs dependencies. Subsequent builds are cached and fast.

---

## Quick start (local dev)

For working on the frontend with hot-reload (no `.sd7` compilation):

```bash
npm install
npm run dev        # Vite dev server with live preview
```

To get the **one-click `.sd7` compile**, you need the backend, which needs the native
SMF compiler and a few tools. The Docker image is the easy path; to run the backend
bare-metal see [docs/deployment.md](docs/deployment.md).

```bash
npm run build      # produces dist/
node server.js     # serves dist/ + POST /api/compile  (needs COMPILER, SCAFFOLD, … env)
```

---

## What you can tune

| Group | Knobs |
|---|---|
| **Core** | seed, map name, map size (6×6 … 32×32) |
| **Symmetry & fairness** | symmetry (mirror/rotate/flip/…), team count, start-box layout, resource-symmetry lock |
| **Terrain** | type (land / water / islands / mixed / metal / air), biome (temperate / desert / arctic / volcanic / alien / lunar), water amount |
| **Relief** | difficulty, mountain height, erosion, choke points, detail noise |
| **Resources** | metal density & distribution, geovents, **wind energy**, **tidal energy** |
| **Features** | tree / rock / grass coverage |
| **Advanced** | noise octaves / frequency / persistence / lacunarity |

🎲 **Randomize** rolls the whole set within ranges proven (against real BAR maps) to
produce playable terrain — it never yields a crumpled or barren map.

---

## How it works (in one breath)

The **browser** generates every source layer (heightmap, color texture, metalmap,
typemap, minimap, splat distribution) plus the Lua configs, zips them, and POSTs to the
**server**. The server runs **SpringMapConvNG** to compile the binary `.smf`/`.smt`,
assembles the archive **on top of the official BAR `map_blueprint` scaffold** (so the
structure matches a real map exactly), validates it with **spring-map-parser**, and
streams back a playable `.sd7`.

Full details: [docs/architecture.md](docs/architecture.md) ·
[docs/pipeline.md](docs/pipeline.md) · [docs/map-format.md](docs/map-format.md)

---

## Repository layout

```
src/                     frontend (TypeScript, Vite)
  gen/                   generation: heightmap, metal, features, texture, splat …
  export/                emit layers + Lua (bundle.ts, lua.ts, png.ts)
  ui/                    knob panel + live preview
server.js                Node backend: /api/compile  (no npm deps)
validate.mjs             closed-loop validator (spring-map-parser)
Dockerfile               multi-stage build of the whole system
docker/                  scaffold build script + validator package.json
docs/                    architecture / pipeline / map-format / deployment
```

---

## License & assets

Code is yours to use. The map **scaffold** (FeaturePlacer gadget, the fir-tree model,
the splat material textures) comes from
[beyond-all-reason/map_blueprint](https://github.com/beyond-all-reason/map_blueprint)
and is fetched at build time — see that repo for its asset licensing. The SMF compiler
is [tizbac/SpringMapConvNG](https://github.com/tizbac/SpringMapConvNG).
