/**
 * BAR Map Generator — server.
 *
 * Serves the static Vite build (dist/) and exposes POST /api/compile which
 * turns a generated source bundle (.zip of heightmap/texture/metalmap/typemap
// PNGs + mapinfo.lua + mapconfig) into a playable .sd7 archive by running the
 * locally-built SpringMapConvNG, then packaging with 7za.
 *
 * Pure Node built-ins — no npm deps. Paths configurable via env.
 *
 *   BIND       bind address            (default 0.0.0.0)
 *   PORT       listen port             (default 8100)
 *   DIST       static dir              (default ./dist)
 *   COMPILER   springMapConvNG binary  (default ~/bargen/SpringMapConvNG/build/springMapConvNG)
 *   PREFIX     DevIL lib prefix        (default ~/bargen/local/usr)
 *   SEVENZA    7za binary              (default 7za)
 *   CT         tile compression 1..4   (default 2 = fast dedup)
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOME = os.homedir();
const VALIDATOR = process.env.VALIDATOR || path.join(HOME, 'bargen', 'parsertest', 'validate.mjs');
// official BAR map_blueprint scaffold (LuaGaia FeaturePlacer, tree FeatureDef +
// model + textures, maphelper, mapconfig, splat material DDS) — every map is
// assembled on top of this so structure matches a real, working BAR map.
const SCAFFOLD = process.env.SCAFFOLD || path.join(HOME, 'bargen', 'scaffold');
const BIND = process.env.BIND || '0.0.0.0';
const PORT = Number(process.env.PORT || 8100);
const DIST = process.env.DIST || path.join(__dirname, 'dist');
const COMPILER = process.env.COMPILER || path.join(HOME, 'bargen', 'SpringMapConvNG', 'build', 'springMapConvNG');
const PREFIX = process.env.PREFIX || path.join(HOME, 'bargen', 'local', 'usr');
const SEVENZA = process.env.SEVENZA || '7za';
const CT = process.env.CT || '2';
const LIBDIR = path.join(PREFIX, 'lib', 'x86_64-linux-gnu');
const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

let compileActive = false;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const log = (...a) => console.log(new Date().toISOString(), ...a);
const err = (...a) => console.error(new Date().toISOString(), ...a);

/** find first file in dir tree whose basename matches */
async function findFile(root, name) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      const r = await findFile(p, name);
      if (r) return r;
    } else if (e.name === name) {
      return p;
    }
  }
  return null;
}

/** find first directory named `dir` in tree */
async function findDir(root, name) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === name) return p;
      const r = await findDir(p, name);
      if (r) return r;
    }
  }
  return null;
}

function sanitizeName(s) {
  return (s || 'ProceduralMap').replace(/[^A-Za-z0-9_\-]/g, '_') || 'ProceduralMap';
}

/** pull name + min/maxheight + mapSize out of mapinfo.lua (regex — good enough) */
function parseMapInfo(lua) {
  const str = lua.toString('utf8');
  const nameM = str.match(/name\s*=\s*"([^"]*)"/);
  const minM = str.match(/minheight\s*=\s*(-?[\d.]+)/i);
  const maxM = str.match(/maxheight\s*=\s*(-?[\d.]+)/i);
  // mapSize.x is in game units (N); Spring mapWidth = N * 64 squares
  const sizeM = str.match(/mapSize\s*=\s*\{[^}]*x\s*=\s*(\d+)/i);
  return {
    name: nameM ? nameM[1] : 'Procedural BAR Map',
    minheight: minM ? Number(minM[1]) : 0,
    maxheight: maxM ? Number(maxM[1]) : 600,
    mapWidth: sizeM ? Number(sizeM[1]) * 64 : 0,
  };
}

async function runCompile(zipBuf) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bargen-'));
  log('compile temp', tmp, 'zip bytes', zipBuf.length);
  try {
    const inZip = path.join(tmp, 'in.zip');
    await fsp.writeFile(inZip, zipBuf);

    // 1. extract source bundle
    await execFileP(SEVENZA, ['x', '-y', `-o${path.join(tmp, 'src')}`, inZip], {});
    const srcRoot = path.join(tmp, 'src');

    // 2. locate source files
    const heightPng = await findFile(srcRoot, 'heightmap.png');
    const texturePng = await findFile(srcRoot, 'texture.png');
    const minimapPng = await findFile(srcRoot, 'minimap.png');
    const metalPng = await findFile(srcRoot, 'metalmap.png');
    const typePng = await findFile(srcRoot, 'typemap.png');
    const mapinfoPath = await findFile(srcRoot, 'mapinfo.lua');
    const setLuaPath = await findFile(srcRoot, 'set.lua');
    const startboxPath = await findFile(srcRoot, 'map_startboxes.lua');
    const metalLayoutPath = await findFile(srcRoot, 'map_metal_layout.lua');
    const splatDistrPath = await findFile(srcRoot, 'splat_distribution.png');
    const grassDistPath = await findFile(srcRoot, 'grassdist.tga');
    if (!heightPng || !texturePng || !metalPng || !typePng || !mapinfoPath) {
      throw new Error('source bundle missing required files '
        + `(height=${!!heightPng} tex=${!!texturePng} metal=${!!metalPng} type=${!!typePng} mapinfo=${!!mapinfoPath})`);
    }

    // 3. map name + height range
    const mapinfoLua = await fsp.readFile(mapinfoPath);
    const mi = parseMapInfo(mapinfoLua);
    const mapName = sanitizeName(mi.name);
    log('compile map', mapName, 'min', mi.minheight, 'max', mi.maxheight);

    // 4. run SpringMapConvNG → <mapName>.smf + <mapName>.smt
    const outPrefix = path.join(tmp, mapName);
    const args = [
      '-t', texturePng,
      '-m', metalPng,
      '-z', typePng,
      '-h', heightPng,
      '-maxh', String(mi.maxheight),
      '-minh', String(mi.minheight),
      '-o', outPrefix,
      '-ct', String(CT),
    ];
    if (minimapPng) args.push('-minimap', minimapPng);
    // grass is now the smooth custom.grassConfig.grassDistTGA system (staged below),
    // not the engine's blocky SMF veg map, so we no longer pass -v.
    log('compiler:', COMPILER, args.join(' '));
    const env = { ...process.env, LD_LIBRARY_PATH: LIBDIR };
    try {
      const { stdout, stderr } = await execFileP(COMPILER, args, { env, maxBuffer: 64 * 1024 * 1024 });
      if (stdout) log('compiler stdout:', stdout.slice(0, 500));
      if (stderr) err('compiler stderr:', stderr.slice(0, 500));
    } catch (e) {
      err('compiler failed:', e.message, (e.stderr || '').slice(0, 800));
      throw new Error('SpringMapConvNG failed: ' + (e.stderr || e.message).toString().slice(0, 300));
    }
    const smf = outPrefix + '.smf';
    const smt = outPrefix + '.smt';
    if (!await fileExists(smf) || !await fileExists(smt)) {
      throw new Error('compiler did not produce .smf/.smt');
    }

    // 5. assemble the .sd7 ON TOP OF the official BAR map_blueprint scaffold:
    //    LuaGaia (FeaturePlacer gadget), features/ (tree FeatureDef), objects3d/
    //    (tree model), unittextures/, maphelper/, mapconfig/{mapinfo,featureplacer/
    //    config.lua}, mapoptions.lua, maps/ (splat material DDS). We only swap in
    //    our compiled terrain, mapinfo, feature positions and splat distribution.
    const stage = path.join(tmp, 'stage');
    await fsp.mkdir(stage, { recursive: true });
    await fsp.cp(SCAFFOLD, stage, { recursive: true });

    const stageMaps = path.join(stage, 'maps');
    const stageMapcfg = path.join(stage, 'mapconfig');
    await fsp.mkdir(stageMaps, { recursive: true });
    await fsp.mkdir(path.join(stageMapcfg, 'featureplacer'), { recursive: true });

    // our compiled terrain → maps/ (mapinfo mapfile/smtFileName0 point here)
    await fsp.copyFile(smf, path.join(stageMaps, `${mapName}.smf`));
    await fsp.copyFile(smt, path.join(stageMaps, `${mapName}.smt`));
    // mapinfo at root
    await fsp.copyFile(mapinfoPath, path.join(stage, 'mapinfo.lua'));
    // feature placement (trees) read by the bundled FeaturePlacer gadget
    if (setLuaPath) await fsp.copyFile(setLuaPath, path.join(stageMapcfg, 'featureplacer', 'set.lua'));
    // start boxes + metal layout
    if (startboxPath) await fsp.copyFile(startboxPath, path.join(stageMapcfg, 'map_startboxes.lua'));
    if (metalLayoutPath) await fsp.copyFile(metalLayoutPath, path.join(stageMapcfg, 'map_metal_layout.lua'));
    // per-map splat distribution → maps/ (materials already provided by scaffold)
    if (splatDistrPath) await fsp.copyFile(splatDistrPath, path.join(stageMaps, 'splat_distribution.png'));
    // smooth grass density map (custom.grassConfig.grassDistTGA)
    if (grassDistPath) await fsp.copyFile(grassDistPath, path.join(stageMaps, 'grassdist.tga'));
    // lobby/menu preview image (real BAR maps ship maps/mini.png) — reuse our minimap
    if (minimapPng) await fsp.copyFile(minimapPng, path.join(stageMaps, 'mini.png'));

    // 6. package .sd7 (7z/LZMA)
    const sd7 = path.join(tmp, `${mapName}.sd7`);
    await execFileP(SEVENZA, ['a', '-t7z', '-mx=5', `-bso0`, `-bse0`, sd7, '.'], { cwd: stage });

    // 7. closed-loop validation via spring-map-parser
    let validation = null;
    try {
      // pass mapWidth only if known (0 = unknown → validator skips dimension check)
      const valArgs = [VALIDATOR, sd7, String(mi.mapWidth || 0), String(mi.minheight), String(mi.maxheight)];
      const { stdout: valOut } = await execFileP(
        'node',
        valArgs,
        { cwd: path.dirname(VALIDATOR), timeout: 60000 },
      );
      validation = JSON.parse(valOut.trim());
      if (validation.ok) {
        log('validation OK', JSON.stringify(validation.stats));
      } else {
        err('validation ERRORS', JSON.stringify(validation.errors));
      }
    } catch (e) {
      err('validator failed:', e.message, (e.stdout || '').slice(0, 300));
      // try to parse stdout even on non-zero exit (exit 1 = errors, exit 2 = bad args)
      if (e.stdout) {
        try { validation = JSON.parse(e.stdout.trim()); } catch {}
      }
      if (!validation) validation = { ok: false, errors: ['validator crashed: ' + e.message], warnings: [], stats: {} };
    }

    const sd7Data = await fsp.readFile(sd7);
    log('compile done', mapName, 'sd7 bytes', sd7Data.length);
    return { data: sd7Data, mapName, validation };
  } finally {
    // best-effort cleanup
    try { await fsp.rm(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function fileExists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400); res.end('bad request'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  // prevent path traversal
  const distRoot = path.resolve(DIST);
  const fp = path.resolve(distRoot, '.' + urlPath);
  const relative = path.relative(distRoot, fp);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const stat = await fsp.stat(fp);
    if (stat.isDirectory()) { res.writeHead(403); res.end('forbidden'); return; }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(fp).pipe(res);
  } catch {
    // SPA fallback
    try {
      await fsp.access(path.join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/compile') {
    if (compileActive) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '15' });
      res.end(JSON.stringify({ error: 'another map is currently compiling' }));
      return;
    }
    compileActive = true;
    try {
      const body = await readBody(req, MAX_UPLOAD_BYTES);
      const { data, mapName, validation } = await runCompile(body);
      // HTTP headers must be ASCII only (RFC 7230). Strip any non-ASCII characters
      // that may appear in validator warning/error strings (e.g. ≤ → <=).
      const valHeader = validation ? JSON.stringify({
        ok: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
        stats: validation.stats,
      }).replace(/[^\x20-\x7E]/g, '') : '';
      if (validation && !validation.ok) {
        res.writeHead(422, {
          'Content-Type': 'application/json',
          'X-Map-Validation': valHeader,
        });
        res.end(JSON.stringify({ error: 'map validation failed', validation }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/x-7z-compressed',
        'Content-Disposition': `attachment; filename="${mapName}.sd7"`,
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
        ...(valHeader ? { 'X-Map-Validation': valHeader } : {}),
      });
      res.end(data);
    } catch (e) {
      err('compile error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    } finally {
      compileActive = false;
    }
    return;
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, compiler: COMPILER, ct: CT }));
    return;
  }
  if (req.method === 'GET') {
    await serveStatic(req, res);
    return;
  }
  res.writeHead(405); res.end('method not allowed');
});

server.timeout = 0; // compile can take a while for big maps
server.keepAliveTimeout = 120000;
server.listen(PORT, BIND, () => {
  log(`BAR map generator serving ${DIST} on http://${BIND}:${PORT}`);
  log(`compiler=${COMPILER} prefix=${PREFIX} ct=${CT}`);
});
