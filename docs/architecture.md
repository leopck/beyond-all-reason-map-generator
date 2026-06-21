# Architecture

The system has two halves that talk over a single HTTP endpoint, plus a set of native
tools the backend shells out to.

```
┌─────────────────────────── Browser (frontend) ───────────────────────────┐
│  src/ui            knob panel + live <canvas> preview                      │
│  src/gen           procedural generation (pure math, no DOM)              │
│  src/export        encode layers → PNG/TGA + Lua, zip them (JSZip)        │
│                                                                           │
│   user clicks "Download .sd7"  ──► POST /api/compile  (multipart zip)     │
└───────────────────────────────────────────────────────────────────────────┘
                                   │  source bundle (.zip of PNGs + Lua)
                                   ▼
┌─────────────────────────── Node server (server.js) ──────────────────────┐
│  1. unzip the source bundle                                              │
│  2. SpringMapConvNG  ─► <name>.smf + <name>.smt   (native C++ compiler)   │
│  3. assemble .sd7 ON TOP OF the map_blueprint scaffold                    │
│  4. validate.mjs (spring-map-parser)  ─► slope/minimap/metal checks       │
│  5. stream the .sd7 back (+ X-Map-Validation header)                      │
└───────────────────────────────────────────────────────────────────────────┘
        │ shells out to                  │ reads
        ▼                                ▼
   SpringMapConvNG (DevIL)          ~/scaffold  (official BAR map skeleton)
   7za (p7zip)                      spring-map-parser (npm)
```

## Components

### Frontend (`src/`)
Pure client-side TypeScript built by Vite. No network calls except the final compile
POST. Key modules:

- **`gen/`** — deterministic generation seeded by a string. `pipeline.ts` orchestrates
  heightmap → water level → start boxes → metal → features → shade context.
- **`export/`** — turns the generated `MapData` into the files a map needs:
  - `png.ts` — a from-scratch streaming PNG encoder (and a small TGA encoder) so the
    8192² texture never has to live in memory all at once.
  - `bundle.ts` — assembles every layer + Lua into a `.zip` (JSZip).
  - `lua.ts` — emits `mapinfo.lua`, the FeaturePlacer `set.lua`, start boxes, metal layout.
- **`ui/`** — `knobs.ts` (schema-driven control panel) and `preview.ts` (2-D canvas preview).

### Backend (`server.js`)
A dependency-free Node HTTP server. It serves the built frontend (`dist/`) and exposes
`POST /api/compile`. It does **no generation** — it only compiles and packages what the
browser produced. It shells out to:

- **SpringMapConvNG** — compiles source PNGs into the binary `.smf` (heightmap, typemap,
  minimap, grass header, metalmap, feature/tile pointers) and `.smt` (compressed texture
  tiles). Built from [tizbac/SpringMapConvNG](https://github.com/tizbac/SpringMapConvNG),
  links DevIL for image loading.
- **7za** (p7zip) — packs the staged folder into the `.sd7` (a 7-Zip archive).

### Validator (`validate.mjs`)
Runs as a child process after packaging. Uses **spring-map-parser** — the BAR team's own
map-reading library — to load the finished `.sd7` exactly as the engine would and assert:
max terrain slope (in degrees), minimap is non-blank, metalmap has metal, height range
matches `mapinfo`. Results ride back in the `X-Map-Validation` response header; hard
failures return HTTP 422.

### Scaffold (`map_blueprint`)
The single most important design decision: **we don't hand-roll the `.sd7` structure, we
build on the official, working one.** The
[map_blueprint](https://github.com/beyond-all-reason/map_blueprint) repo is a minimal,
known-good BAR map. The server copies its skeleton (the FeaturePlacer LuaGaia gadget, a
tree FeatureDef + `.s3o` model + textures, `maphelper`, `mapconfig`, the splat material
DDS textures) into every map, and overlays only the four things that are actually
map-specific: the compiled terrain, `mapinfo.lua`, the feature positions, and the splat
distribution. See [map-format.md](map-format.md).

## Data flow & boundaries

- The browser → server payload is a `.zip` of source images + Lua (typically ~100 MB
  uncompressed texture, a few MB zipped). The server response is the `.sd7` (~10 MB).
- Generation is **deterministic**: the same params (including seed) always yield the same
  map. The map's internal name embeds a hash of all params, so the engine's name-keyed
  cache can never serve a stale map after you change a knob.
- The server holds no state between requests; one compile runs at a time (a 429 is
  returned if another is in flight).

## Why this split?

Generation is cheap and parallel-friendly, so it lives in the browser (instant preview,
no server load). Compilation needs a native toolchain (SpringMapConvNG + DevIL + 7za)
that can't run in a browser, so it lives in a small server. The Docker image packages
the whole thing so neither half needs manual setup.
