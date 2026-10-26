// End-to-end tests: npm test
// - build เว็บไปที่ .test-dist โดยชี้ TMDB ไปยังเซิร์ฟเวอร์จำลอง (ไม่ต้องใช้ API Key จริง)
// - Internet Archive และการเล่นวิดีโอใช้ของจริง (ต้องต่ออินเทอร์เน็ต)
// - ใช้ Edge/Chrome แบบ headless ผ่าน DevTools Protocol (กำหนดเองได้ด้วย BROWSER=/path/to/chrome)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../scripts/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, '.test-dist');
const SHOTS = process.env.SHOTS_DIR || path.join(root, '.test-dist', '_shots');
const SITE_PORT = 8765, MOCK_PORT = 8766, CDP_PORT = 9333;
const SITE = `http://127.0.0.1:${SITE_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Build with mock TMDB ----------
const build = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], {
  encoding: 'utf8',
  env: { ...process.env, OUT_DIR: '.test-dist', TMDB_API_KEY: 'test-key', REFRESH_MINUTES: '0.12',
    TMDB_API_BASE: `http://127.0.0.1:${MOCK_PORT}/3`, TMDB_IMAGE_BASE: `http://127.0.0.1:${MOCK_PORT}/img/` }
});
if (build.status !== 0) { console.error(build.stdout, build.stderr); process.exit(1); }
fs.mkdirSync(SHOTS, { recursive: true });

// ---------- Mock TMDB ----------
const mock = { fail: false, addNew: false, calls: [] };
const SINTEL = { id: 45745, title: 'Sintel', original_title: 'Sintel', release_date: '2010-09-27' };
const movie = (id, title, extra = {}) => ({
  id, title, original_title: title, release_date: '2026-09-01', vote_average: 7.4,
  poster_path: `/p${id}.svg`, backdrop_path: `/b${id}.svg`, overview: `เรื่องย่อของ ${title}`, ...extra
});
function listFor(u) {
  const page = Number(u.searchParams.get('page') || 1);
  const genre = u.searchParams.get('with_genres') || '0';
  const base = (u.pathname.length * 7 + Number(genre)) * 1000 + page * 50;
  const label = u.pathname.split('/').slice(2).join(' ') + (genre !== '0' ? ` g${genre}` : '');
  const results = Array.from({ length: 20 }, (_, i) => movie(base + i, `Mock ${label} p${page} #${i + 1}`));
  if (u.pathname === '/3/discover/movie' && genre === '0' && page === 1) {
    results[1] = { ...results[0] };                       // รายการซ้ำ → ต้องถูกกรองออก
    results[2] = movie(SINTEL.id, SINTEL.title, SINTEL);  // หนัง CC ที่มีวิดีโอเต็มเรื่อง
    if (mock.addNew) results[19] = movie(999001, 'Brand New Arrival');
  }
  return { page, results, total_pages: 9, total_results: 180 };
}
function details(type, id) {
  const isSintel = Number(id) === SINTEL.id;
  return {
    id: Number(id), ...(type === 'tv' ? { name: `Mock Series ${id}`, first_air_date: '2026-01-01', number_of_seasons: 2 } : { title: isSintel ? 'Sintel' : `Mock Movie ${id}`, original_title: isSintel ? 'Sintel' : `Mock Movie ${id}`, release_date: isSintel ? SINTEL.release_date : '2026-09-01', runtime: 101 }),
    imdb_id: isSintel ? 'tt1727587' : `tt9${id}`, overview: `เรื่องย่อ ${id}`, vote_average: 7.4, tagline: 'Mock tagline',
    genres: [{ id: 28, name: 'แอ็กชัน' }], poster_path: `/p${id}.svg`, backdrop_path: `/b${id}.svg`,
    videos: { results: [{ site: 'YouTube', type: 'Trailer', official: true, key: `mockTrailer${id}` }] },
    credits: { cast: [{ name: 'Actor One', character: 'Hero', profile_path: null }] },
    external_ids: { imdb_id: isSintel ? 'tt1727587' : `tt9${id}` },
    'watch/providers': { results: { TH: { link: `https://www.themoviedb.org/${type}/${id}/watch`,
      flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.svg' }],
      rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/apple.svg' }] } } }
  };
}
const mockServer = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204, '');
  if (u.pathname.startsWith('/img/')) return send(200, `<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="100%" height="100%" fill="#2a2418"/><text x="20" y="260" fill="#d4af37" font-size="28">${u.pathname.slice(-10)}</text></svg>`, 'image/svg+xml');
  mock.calls.push(u.pathname + u.search);
  if (u.searchParams.get('api_key') !== 'test-key') return send(401, { status_message: 'Invalid API key' });
  if (mock.fail) return send(500, { status_message: 'Mock failure' });
  const det = /^\/3\/(movie|tv)\/(\d+)$/.exec(u.pathname);
  if (det) return send(200, details(det[1], det[2]));
  if (u.pathname === '/3/search/multi') {
    const q = u.searchParams.get('query');
    const page = Number(u.searchParams.get('page') || 1);
    return send(200, { page, total_pages: 3, total_results: 60, results: Array.from({ length: 20 }, (_, i) => ({ ...movie(700000 + page * 100 + i, `${q} result p${page} #${i + 1}`), media_type: 'movie' })) });
  }
  if (u.pathname.startsWith('/3/')) return send(200, listFor(u));
  send(404, {});
});
await new Promise((r) => mockServer.listen(MOCK_PORT, r));
const siteServer = await serve(OUT, SITE_PORT);

// ---------- Browser ----------
const candidates = [process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const exe = candidates.find((p) => fs.existsSync(p));
if (!exe) { console.error('No Chrome/Edge found. Set BROWSER=/path/to/chrome'); process.exit(1); }
const profile = path.join(root, '.test-profile');
fs.rmSync(profile, { recursive: true, force: true });
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--autoplay-policy=no-user-gesture-required',
  '--mute-audio', `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not ready */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
  return r.result?.result?.value;
};
const go = async (url) => { await send('Page.navigate', { url }); await sleep(1200); };
const waitFor = async (expr, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { try { const v = await ev(expr); if (v) return v; } catch { /* navigating */ } await sleep(400); }
  return null;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
await send('Page.enable'); await send('Runtime.enable');

const results = [];
async function test(name, fn) {
  try {
    const info = await fn();
    results.push({ ok: true, name, info });
    console.log(`PASS  ${name}${info ? '  ' + info : ''}`);
  } catch (err) {
    results.push({ ok: false, name, info: err.message });
    console.log(`FAIL  ${name}  ${err.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const gridState = `JSON.stringify((() => { const cards = [...document.querySelectorAll('#catalogGrid .card')]; const keys = cards.map(c => c.dataset.card); return { n: cards.length, unique: new Set(keys).size, first: cards[0]?.querySelector('.title')?.textContent, title: document.querySelector('#catalogTitle').textContent, pager: document.querySelector('#pager .pg.on')?.textContent || '' }; })())`;
const grid = async () => JSON.parse(await ev(gridState));
const playing = (min = 2) => `(() => { const p = document.querySelector('#player'); return !!p && p.dataset.state === 'playing' && Number(p.dataset.time) > ${min}; })()`;

// ---------- Homepage: catalog ----------
await go(SITE);
await test('catalog grid renders TMDB posters (default "หนังใหม่")', async () => {
  assert(await waitFor(`document.querySelectorAll('#catalogGrid .card').length > 0`), 'grid empty');
  const g = await grid();
  assert(g.title === 'หนังใหม่', 'title ' + g.title);
  return `${g.n} cards`;
});
await test('duplicates from API are removed', async () => {
  const g = await grid();
  assert(g.n === g.unique && g.n === 19, `cards=${g.n} unique=${g.unique} (mock sent 20 with 1 duplicate)`);
  return `${g.n} unique of 20 returned`;
});
await test('poster shows title, year and rating', async () => {
  const sub = await ev(`document.querySelector('#catalogGrid .card .sub').textContent`);
  assert(/2026/.test(sub) && /★/.test(sub), 'sub=' + sub);
  return sub.trim();
});
await shot('home-desktop');

for (const [cat, label, genre] of [['action', 'แอ็กชัน', '28'], ['comedy', 'ตลก', '35'], ['horror', 'สยองขวัญ', '27'], ['anime', 'อนิเมะ', '16'], ['scifi', 'ไซไฟ', '878']]) {
  await test(`category tab "${label}" loads its genre`, async () => {
    mock.calls.length = 0;
    await ev(`document.querySelector('.cat-tabs [data-cat="${cat}"]').click()`);
    assert(await waitFor(`document.querySelector('#catalogTitle').textContent === '${label}' && document.querySelectorAll('#catalogGrid .card').length > 0`), 'not loaded');
    assert(mock.calls.some((c) => c.includes(`with_genres=${genre}`)), 'no request with genre ' + genre);
    if (cat === 'anime') assert(mock.calls.some((c) => c.includes('with_original_language=ja')), 'anime not ja');
    return (await grid()).n + ' cards';
  });
}

await test('pagination: page 2 loads different movies and updates URL', async () => {
  const before = (await grid()).first;
  await ev(`document.querySelector('#pager [data-page="2"]').click()`);
  assert(await waitFor(`document.querySelector('#pager .pg.on')?.textContent === '2' && !document.querySelector('#catalogGrid[aria-busy]')`), 'page 2 not active');
  const g = await grid();
  assert(g.first !== before && /p2/.test(g.first), `first=${g.first}`);
  const qs = await ev('location.search');
  assert(/page=2/.test(qs), 'url ' + qs);
  return `${g.first} · ${qs}`;
});

await test('source switch "ดูฟรีเต็มเรื่อง" loads real Internet Archive films', async () => {
  await ev(`document.querySelector('.cat-tabs [data-cat="horror"]').click()`);
  await sleep(300);
  await ev(`document.querySelector('[data-source="free"]').click()`);
  assert(await waitFor(`[...document.querySelectorAll('#catalogGrid .card')].length > 5 && [...document.querySelectorAll('#catalogGrid .card')].every(c => /p=(archive|open)/.test(c.getAttribute('href')))`, 40000), 'archive grid not loaded');
  return (await grid()).n + ' playable cards';
});

await test('free pagination works (Archive page 2)', async () => {
  const before = (await grid()).first;
  await ev(`document.querySelector('#pager [data-page="2"]').click()`);
  assert(await waitFor(`document.querySelector('#pager .pg.on')?.textContent === '2' && !document.querySelector('#catalogGrid[aria-busy]') && document.querySelectorAll('#catalogGrid .card').length > 0`, 40000), 'no page 2');
  const g = await grid();
  assert(g.first !== before, 'same first item');
  return `${before} → ${g.first}`;
});

// ---------- Latest strip ----------
await test('"เพิ่มเข้ามาล่าสุด" is sorted by date added (newest first)', async () => {
  assert(await waitFor(`document.querySelectorAll('#latestTrack .card').length > 5`, 40000), 'latest empty');
  const dates = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#latestTrack .card')].map(c => Lumiere.items.get(c.dataset.card).added))`));
  const sorted = [...dates].sort().reverse();
  assert(JSON.stringify(dates) === JSON.stringify(sorted), 'not sorted');
  const keys = await ev(`(() => { const k = [...document.querySelectorAll('#latestTrack .card')].map(c => c.dataset.card); return k.length === new Set(k).size; })()`);
  assert(keys, 'duplicates in latest');
  return `${dates.length} items, newest ${dates[0].slice(0, 10)}`;
});

// ---------- Search ----------
await test('search (TMDB) shows results with pagination', async () => {
  await ev(`document.querySelector('[data-source="tmdb"]').click()`);
  await ev(`(() => { const i = document.querySelector('#searchInput'); i.value = 'batman'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert(await waitFor(`document.querySelector('#catalogTitle').textContent.includes('batman') && document.querySelectorAll('#catalogGrid .card').length === 20`), 'no search results');
  assert(await ev(`getComputedStyle(document.querySelector('#hero')).display === 'none'`), 'hero not hidden while searching');
  await ev(`document.querySelector('#pager [data-page="2"]').click()`);
  assert(await waitFor(`document.querySelector('#catalogGrid .card .title')?.textContent.includes('p2')`), 'search page 2 failed');
  return 'page 2 ok';
});
await test('search (free films) finds real Archive titles', async () => {
  await ev(`(() => { const i = document.querySelector('#searchInput'); i.value = 'chaplin'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(700);
  await ev(`document.querySelector('[data-source="free"]').click()`);
  assert(await waitFor(`document.querySelector('#catalogTitle').textContent.includes('chaplin') && document.querySelectorAll('#catalogGrid .card').length > 0 && !document.querySelector('#catalogGrid[aria-busy]')`, 40000), 'no archive search results');
  const t = await ev(`document.querySelector('#catalogGrid .card .title').textContent`);
  return t;
});
await shot('search');
await test('clear search restores homepage', async () => {
  await ev(`document.querySelector('#clearSearch').click()`);
  assert(await waitFor(`!document.body.classList.contains('searching') && getComputedStyle(document.querySelector('#hero')).display !== 'none'`), 'not restored');
});

// ---------- Errors ----------
await test('loading failure shows a clear error with retry', async () => {
  await ev(`document.querySelector('[data-source="tmdb"]').click()`);
  await waitFor(`!document.querySelector('#catalogGrid[aria-busy]')`);
  mock.fail = true;
  await ev(`document.querySelector('.cat-tabs [data-cat="comedy"]').click()`);
  assert(await waitFor(`!document.querySelector('#catalogError').hidden`), 'no error box');
  const msg = await ev(`document.querySelector('#catalogError').textContent.replace(/\\s+/g, ' ').trim()`);
  await shot('catalog-error');
  mock.fail = false;
  await ev(`document.querySelector('[data-catalog-retry]').click()`);
  assert(await waitFor(`document.querySelector('#catalogError').hidden && document.querySelectorAll('#catalogGrid .card').length > 0`), 'retry did not recover');
  return msg;
});

// ---------- Auto refresh ----------
await test('auto refresh adds new movies without duplicates (NEW badge)', async () => {
  await ev(`document.querySelector('.cat-tabs [data-cat="new"]').click()`);
  await waitFor(`document.querySelector('#catalogTitle').textContent === 'หนังใหม่' && document.querySelectorAll('#catalogGrid .card').length > 0`);
  const before = await grid();
  mock.addNew = true;
  assert(await waitFor(`[...document.querySelectorAll('#catalogGrid .card .title')].some(t => t.textContent === 'Brand New Arrival')`, 30000), 'new movie never appeared');
  const g = await grid();
  const count = await ev(`[...document.querySelectorAll('#catalogGrid .card .title')].filter(t => t.textContent === 'Brand New Arrival').length`);
  const badge = await ev(`[...document.querySelectorAll('#catalogGrid .card')].find(c => c.querySelector('.title').textContent === 'Brand New Arrival').querySelector('.badge.new') !== null`);
  assert(count === 1 && g.n === g.unique, `count=${count} n=${g.n} unique=${g.unique}`);
  assert(badge, 'no NEW badge');
  return `before ${before.n}, after ${g.n} unique`;
});
await test('failed auto refresh keeps existing posters and shows status', async () => {
  mock.fail = true;
  assert(await waitFor(`document.querySelector('#liveStatus').classList.contains('error')`, 30000), 'status not updated');
  const n = (await grid()).n;
  assert(n > 0, 'grid emptied');
  const toast = await ev(`document.querySelector('#toast').textContent`);
  mock.fail = false;
  assert(await waitFor(`!document.querySelector('#liveStatus').classList.contains('error')`, 30000), 'did not recover');
  return `${n} posters kept · "${toast}"`;
});

// ---------- Poster → watch.html ----------
await test('TMDB poster opens watch.html with trailer + legal services', async () => {
  const href = await ev(`[...document.querySelectorAll('#catalogGrid .card')].find(c => !/Sintel|Brand/.test(c.textContent)).getAttribute('href')`);
  assert(/^watch\.html\?p=tmdb&id=movie-\d+$/.test(href), 'href ' + href);
  await ev(`[...document.querySelectorAll('#catalogGrid .card')].find(c => !/Sintel|Brand/.test(c.textContent)).click()`);
  assert(await waitFor(`location.pathname.endsWith('watch.html') && document.querySelector('#player').dataset.state === 'trailer'`), 'no trailer state');
  const src = await ev(`document.querySelector('#player iframe').src`);
  assert(src.startsWith('https://www.youtube-nocookie.com/embed/mockTrailer'), src);
  const providers = await ev(`[...document.querySelectorAll('#watchOptions .provider')].map(p => p.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')`);
  assert(/Netflix/.test(providers), 'providers ' + providers);
  assert(await ev(`!!document.querySelector('#previewNote')`), 'no preview note');
  await shot('watch-trailer');
  return providers;
});
await test('TMDB poster of a CC film redirects to the full movie and plays', async () => {
  await go(SITE);
  assert(await waitFor(`[...document.querySelectorAll('#catalogGrid .card')].some(c => c.textContent.includes('Sintel'))`), 'Sintel not in grid');
  await ev(`[...document.querySelectorAll('#catalogGrid .card')].find(c => c.textContent.includes('Sintel')).click()`);
  assert(await waitFor(playing(2), 60000), 'did not play');
  return await ev('location.search');
});
await test('free poster opens watch.html and the film plays', async () => {
  await go(SITE + '?src=free&cat=comedy');
  assert(await waitFor(`document.querySelectorAll('#catalogGrid .card').length > 0`, 40000), 'no free grid');
  const href = await ev(`document.querySelector('#catalogGrid .card').getAttribute('href')`);
  await ev(`document.querySelector('#catalogGrid .card').click()`);
  assert(await waitFor(playing(2), 60000), 'did not play: ' + await ev(`JSON.stringify(document.querySelector('#player')?.dataset)`));
  await shot('watch-playing');
  return href;
});
await test('hero "รายละเอียด" still opens the detail modal', async () => {
  await go(SITE);
  assert(await waitFor(`!!document.querySelector('#heroContent [data-key]')`), 'no hero');
  await ev(`document.querySelector('#heroContent [data-key]').click()`);
  assert(await waitFor(`!document.querySelector('#modal').hidden && !!document.querySelector('#modalTitle')`), 'modal not opened');
  await ev(`document.querySelector('#modal .modal-close').click()`);
});
await test('highlight rows still render', async () => {
  const n = await ev(`document.querySelectorAll('#rows .row').length`);
  const filled = await waitFor(`document.querySelectorAll('#row-trending .card').length > 0 && document.querySelectorAll('#row-free .card').length > 0`, 40000);
  assert(filled, 'rows empty');
  return `${n} rows`;
});

// ---------- Watch page errors / license gate ----------
await test('unknown provider shows an error', async () => {
  await go(SITE + 'watch.html?p=nope&id=x');
  assert(await waitFor(`document.querySelector('#player').dataset.state === 'error'`, 10000), 'no error');
});
await test('archive refuses items not marked public domain', async () => {
  await go(SITE + 'watch.html?p=archive&id=CosmosLaundromatFirstCycle');
  assert(await waitFor(`document.querySelector('#player').dataset.state === 'error'`, 30000), 'no error');
  return await ev(`document.querySelector('.player-msg p').textContent`);
});

// ---------- Mobile ----------
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await test('mobile homepage: 3-column grid, no horizontal overflow', async () => {
  await go(SITE);
  assert(await waitFor(`document.querySelectorAll('#catalogGrid .card').length > 0`), 'no grid');
  const m = JSON.parse(await ev(`JSON.stringify({ cols: getComputedStyle(document.querySelector('#catalogGrid')).gridTemplateColumns.split(' ').length, w: document.documentElement.scrollWidth })`));
  assert(m.cols === 3 && m.w <= 390, JSON.stringify(m));
  await ev(`document.querySelector('#latest').scrollIntoView()`);
  await sleep(800);
  await shot('home-mobile');
  return JSON.stringify(m);
});
await test('mobile watch page: 16:9 player, no overflow, video plays', async () => {
  await go(SITE + 'watch.html?p=open&id=Tears-of-Steel');
  assert(await waitFor(playing(1), 60000), 'did not play');
  const b = JSON.parse(await ev(`(() => { const r = document.querySelector('#player').getBoundingClientRect(); return JSON.stringify({ ratio: +(r.width / r.height).toFixed(3), w: document.documentElement.scrollWidth }); })()`));
  assert(Math.abs(b.ratio - 16 / 9) < 0.02 && b.w <= 390, JSON.stringify(b));
  await shot('watch-mobile');
  return JSON.stringify(b);
});
await send('Emulation.clearDeviceMetricsOverride');

// ---------- Done ----------
ws.close(); browser.kill(); mockServer.close(); siteServer.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
