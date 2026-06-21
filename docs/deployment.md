# Deployment & operations

## Docker (recommended)

The `Dockerfile` is a 4-stage build that produces one self-contained image:

1. **smfconv** — clones & compiles [tizbac/SpringMapConvNG](https://github.com/tizbac/SpringMapConvNG)
   (CMake + `libdevil-dev`).
2. **web** — `npm install` + `npm run build` → `dist/`.
3. **scaffold** — clones `map_blueprint` and runs `docker/build-scaffold.sh` to produce
   the generic-named scaffold.
4. **runtime** — `node:18-slim` + `p7zip-full` + DevIL runtime; copies the compiler, the
   built site, `server.js`, the validator (with `spring-map-parser` installed), and the
   scaffold.

```bash
docker build -t bar-map-generator .
docker run --rm -p 8100:8100 bar-map-generator      # http://localhost:8100

# detached, auto-restart:
docker run -d --restart unless-stopped -p 8100:8100 --name bargen bar-map-generator
```

Override any setting at run time with `-e`, e.g. `docker run -e PORT=9000 -e CT=4 …`.
The container has a `HEALTHCHECK` that hits `/api/health`.

### Image env vars

| Var | Default (in image) | Meaning |
|---|---|---|
| `PORT` | `8100` | listen port |
| `BIND` | `0.0.0.0` | bind address |
| `CT` | `2` | tile compression (2 = fast dedup, 4 = higher quality) |
| `COMPILER` | `/opt/bargen/smfconv/springMapConvNG` | SMF compiler binary |
| `PREFIX` | `/usr` | DevIL lib prefix (`$PREFIX/lib/x86_64-linux-gnu`) |
| `SCAFFOLD` | `/opt/bargen/scaffold` | map_blueprint scaffold dir |
| `VALIDATOR` | `/opt/bargen/parsertest/validate.mjs` | validator entry |
| `DIST` | `/opt/bargen/site/dist` | static frontend dir |
| `SEVENZA` | `7za` | 7-Zip binary |

## Bare-metal

You need, on the host:

- **Node 18+**
- **7za** (`p7zip-full`)
- **SpringMapConvNG** built from source (CMake + DevIL/`libdevil-dev`) — note the binary
  loads `libmapconv.so` and DevIL at runtime, so put both on `LD_LIBRARY_PATH`.
- **spring-map-parser** installed next to `validate.mjs`
- the **scaffold** assembled via `docker/build-scaffold.sh <map_blueprint> <out>`

Then build the frontend and run the server, pointing the env vars at your paths:

```bash
npm install && npm run build
COMPILER=/path/to/springMapConvNG \
PREFIX=/path/to/devil/prefix \
SCAFFOLD=/path/to/scaffold \
VALIDATOR=/path/to/parsertest/validate.mjs \
DIST=./dist  PORT=8100 \
node server.js
```

A reference host setup (the dev box this was built on) keeps everything under
`~/bargen/` with `start.sh`/`stop.sh` wrappers that `nohup` the server.

## API

### `GET /api/health`
`{ "ok": true, "compiler": "…", "ct": "2" }`

### `POST /api/compile`
Body: the source-bundle `.zip` the frontend produces (`Content-Type: application/zip`).

Responses:
- **200** — body is the `.sd7`; `X-Map-Validation` header carries the validation JSON
  (`ok`, `errors`, `warnings`, `stats` with `maxSlopeDeg`, `minimapNonZeroPct`, …).
- **422** — validation found hard errors; body is `{ error, validation }`, no `.sd7`.
- **429** — another compile is already running (`Retry-After`).
- **500** — compiler or packaging error.

Only one compile runs at a time. There is no persistent state; restart-safe.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Compile 500 "SpringMapConvNG failed" | DevIL/`libmapconv.so` not on `LD_LIBRARY_PATH` |
| Map loads but in-game changes don't appear when you tweak knobs | stale engine cache — confirm the map **name** changed (it embeds a param hash) |
| No trees | `set.lua` feature name doesn't match a bundled FeatureDef |
| Invisible splat textures | textures not in `maps/`, or detail-normals supplied as PNG instead of DDS/TGA |
| Blocky grass | using the SMF `-v` grass instead of `custom.grassConfig.grassDistTGA` |
| Blank lobby preview | missing `maps/mini.png` |
