// Genera el sitio estático público: construye la app en modo solo lectura, la arranca sobre
// results-public/ y rastrea todas las páginas de resultados para volcarlas como HTML en site/.
// No prerenderiza con Astro porque las páginas son SSR: es más simple y fiel rastrear la app real.
//
//   npm run export-site                       # site/ con enlaces absolutos desde la raíz (Vercel, Netlify, dominio propio)
//   npm run export-site -- --base /agent-bench  # GitHub Pages de proyecto: prefija todas las rutas
//   npm run export-site -- --skip-build        # reutiliza dist/
//
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const base = (arg('base') ?? '').replace(/\/$/, '');
const out = arg('out') ?? 'site';
const port = Number(arg('port') ?? 4390);
const resultsDir = arg('results') ?? 'results-public';
const skipBuild = process.argv.includes('--skip-build');
const env = { ...process.env, PUBLIC_READONLY: '1', BENCH_RESULTS_DIR: resultsDir, HOST: '127.0.0.1', PORT: String(port) };

if (!skipBuild) {
  console.log('astro build (PUBLIC_READONLY=1)…');
  const b = spawnSync('npx', ['astro', 'build'], { stdio: 'inherit', env });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const server = spawn('node', ['dist/server/entry.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const origin = `http://127.0.0.1:${port}`;
const stop = () => { server.kill(); };
process.on('exit', stop);
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`${origin}/resultados`); if (r.ok) break; } catch { /* aún no */ }
  await new Promise((r) => setTimeout(r, 500));
}

const batches = readdirSync(join(resultsDir, 'batches')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const runIds = readdirSync(resultsDir).filter((f) => f.endsWith('.json')).map((f) => (JSON.parse(readFileSync(join(resultsDir, f), 'utf8')) as { id: string }).id);
const pages: [string, string][] = [
  ['/resultados', 'resultados/index.html'],
  ['/escenarios', 'escenarios/index.html'],
  ...batches.map((id): [string, string] => [`/lotes/${id}`, `lotes/${id}/index.html`]),
  ...batches.map((id): [string, string] => [`/duelo?batch=${id}`, `duelo/${id}/index.html`]),
  ...runIds.map((id): [string, string] => [`/runs/${id}`, `runs/${id}/index.html`]),
];

// Enlaces: /duelo?batch=X → /duelo/X/ ; rutas de páginas con barra final (sirven igual en Pages, Vercel y Netlify);
// y, con --base, prefijo en toda ruta absoluta (href, src, url()).
function rewrite(html: string): string {
  let h = html
    .replace(/href="\/duelo\?batch=([^"]+)"/g, 'href="/duelo/$1/"')
    .replace(/href="\/(resultados|escenarios|lotes\/[^"/]+|runs\/[^"/]+)"/g, 'href="/$1/"');
  if (base) h = h.replace(/(href|src|action)="\//g, `$1="${base}/`).replace(/url\(\//g, `url(${base}/`);
  return h;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let bytes = 0, failed = 0;
for (const [url, file] of pages) {
  const res = await fetch(origin + url);
  if (!res.ok) { failed++; console.error(`✗ ${res.status} ${url}`); continue; }
  const html = rewrite(await res.text());
  mkdirSync(join(out, file, '..'), { recursive: true });
  writeFileSync(join(out, file), html);
  bytes += html.length;
}
// Datos crudos para quien quiera analizarlos: el mismo JSON que sirve la API.
const api = await fetch(`${origin}/api/results`);
if (api.ok) { mkdirSync(join(out, 'api'), { recursive: true }); writeFileSync(join(out, 'api', 'results.json'), await api.text()); }
// Portada: redirección a resultados. Assets de Astro, informe y .nojekyll (GitHub Pages ignoraría _astro/).
writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${base}/resultados/"><title>KubeBolt Agent Bench</title></head><body><a href="${base}/resultados/">Resultados</a></body></html>\n`);
if (existsSync('dist/client')) cpSync('dist/client', out, { recursive: true });
if (existsSync('docs/informes')) { mkdirSync(join(out, 'informes'), { recursive: true }); for (const f of readdirSync('docs/informes')) { let h = readFileSync(join('docs/informes', f), 'utf8'); if (base) h = h.replace(/href="\//g, `href="${base}/`); writeFileSync(join(out, 'informes', f), h); } }
writeFileSync(join(out, '.nojekyll'), '');
stop();
console.log(`${pages.length - failed} páginas (${(bytes / 1024 / 1024).toFixed(1)} MB de HTML), ${failed} fallidas, assets de dist/client, informes y api/results.json → ${out}/${base ? ` con base ${base}` : ''}`);
process.exit(failed ? 1 : 0);
