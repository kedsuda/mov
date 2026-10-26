// End-to-end tests ของเว็บวางแผนเที่ยว: node tests/e2e.mjs
// build เว็บไปที่ .test-dist แล้วทดสอบด้วย Edge/Chrome headless ผ่าน DevTools Protocol
// (กำหนดเบราว์เซอร์เองได้ด้วย BROWSER=/path/to/chrome) · แผนที่ใช้ไทล์ OpenStreetMap จริง (ต้องต่ออินเทอร์เน็ต)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../scripts/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, '.test-dist');
const SHOTS = process.env.SHOTS_DIR || path.join(OUT, '_shots');
const SITE_PORT = 8765, CDP_PORT = 9333;
const SITE = `http://127.0.0.1:${SITE_PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const build = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { encoding: 'utf8', env: { ...process.env, OUT_DIR: '.test-dist' } });
if (build.status !== 0) { console.error(build.stdout, build.stderr); process.exit(1); }
fs.mkdirSync(SHOTS, { recursive: true });
const siteServer = await serve(OUT, SITE_PORT);

const candidates = [process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const exe = candidates.find((p) => fs.existsSync(p));
if (!exe) { console.error('No Chrome/Edge found. Set BROWSER=/path/to/chrome'); process.exit(1); }
const profile = path.join(root, '.test-profile');
fs.rmSync(profile, { recursive: true, force: true });
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not ready */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0; const pending = new Map(); const pageErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
  return r.result?.result?.value;
};
const go = async (url) => { await send('Page.navigate', { url }); await sleep(900); };
const waitFor = async (expr, ms = 15000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { try { const v = await ev(expr); if (v) return v; } catch { /* navigating */ } await sleep(250); }
  return null;
};
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('not found: ' + ${JSON.stringify(sel)}); el.click(); return true; })()`);
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
await send('Page.enable'); await send('Runtime.enable');

const results = [];
async function test(name, fn) {
  try { const info = await fn(); results.push({ ok: true }); console.log(`PASS  ${name}${info ? '  ' + info : ''}`); }
  catch (err) { results.push({ ok: false }); console.log(`FAIL  ${name}  ${err.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const total = () => ev(`Number(document.querySelector('#totalSpent').textContent.replace(/[^\\d]/g, ''))`);

await go(SITE);
await ev('localStorage.clear()');
await go(SITE + '#/');

// ---------- หน้าหลัก ----------
await test('home page renders the planner form with 12 provinces', async () => {
  assert(await waitFor(`document.querySelectorAll('[data-prov]').length === 12`), 'provinces missing');
  assert(await ev(`document.title.includes('เที่ยวพอดีงบ')`), 'title');
  return await ev(`document.querySelector('.hero h1').textContent.trim()`);
});
await test('no movie-site leftovers on the page', async () => {
  const html = await ev('document.documentElement.outerHTML');
  assert(!/MovieHub|TMDB|ดูหนัง|watch\.html|LUMI/i.test(html), 'movie text found');
});
await test('form inputs: province, budget, days, people, styles, travel toggle', async () => {
  await click('[data-prov="phuket"]');
  await ev(`(() => { const i = document.querySelector('#budget'); i.value = '12000'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('[data-step="days:-1"]');
  await click('[data-step="people:1"]');
  await click('[data-style="cafe"]'); // ปิดคาเฟ่ (ค่าเริ่มต้นเปิด)
  await click('[data-style="beach"]');
  await ev(`(() => { const t = document.querySelector('#includeTravel'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const s = JSON.parse(await ev(`JSON.stringify({ prov: document.querySelector('[data-prov="phuket"]').getAttribute('aria-pressed'), budget: document.querySelector('#budget').value, days: document.querySelector('#daysOut').textContent, people: document.querySelector('#peopleOut').textContent, beach: document.querySelector('[data-style="beach"]').getAttribute('aria-pressed'), est: document.querySelector('#estimate').textContent.trim() })`));
  assert(s.prov === 'true' && s.budget === '12,000' && s.days.startsWith('2') && s.people.startsWith('3') && s.beach === 'true', JSON.stringify(s));
  assert(/ระดับ|ไม่พอ/.test(s.est), 'no live estimate');
  return s.est.replace(/\s+/g, ' ');
});
await test('Bangkok disables the travel-from-Bangkok toggle', async () => {
  await click('[data-prov="bangkok"]');
  assert(await ev(`document.querySelector('#includeTravel').disabled`), 'not disabled');
  await click('[data-prov="phuket"]');
});
await test('empty budget shows a validation error', async () => {
  await ev(`(() => { const i = document.querySelector('#budget'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('#planner button[type=submit]');
  assert(await waitFor(`!document.querySelector('#formError').hidden`), 'no error');
  await ev(`(() => { const i = document.querySelector('#budget'); i.value = '12000'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
});
await shot('home');

// ---------- ผลลัพธ์ ----------
await test('generating a plan opens the results page', async () => {
  await click('#planner button[type=submit]');
  assert(await waitFor(`location.hash.startsWith('#/plan/') && document.querySelectorAll('.day').length === 2`), 'no plan');
  const s = JSON.parse(await ev(`JSON.stringify({ title: document.querySelector('#planTitle').textContent, places: document.querySelectorAll('.item').length, trip: [...document.querySelectorAll('.item-name')].some(n => n.textContent.includes('เดินทางจากกรุงเทพฯ')) })`));
  assert(s.title.includes('ภูเก็ต') && s.places > 6 && s.trip, JSON.stringify(s));
  return `${s.title} · ${s.places} items`;
});
await test('cost breakdown, total and remaining are shown and consistent', async () => {
  const s = JSON.parse(await ev(`JSON.stringify({ total: document.querySelector('#totalSpent').textContent, remain: document.querySelector('#remaining').textContent, cats: [...document.querySelectorAll('[data-cat-total]')].map(c => c.querySelector('b').textContent), sumItems: [...document.querySelectorAll('.item-cost')].reduce((a, c) => a + (Number(c.childNodes[0].textContent.replace(/[^\\d]/g, '')) || 0), 0) })`));
  const n = (x) => Number(x.replace(/[^\d]/g, ''));
  assert(s.cats.length === 4, 'missing categories');
  assert(n(s.total) === s.cats.reduce((a, c) => a + n(c), 0), 'categories ≠ total');
  assert(n(s.total) === s.sumItems, `items ${s.sumItems} ≠ total ${n(s.total)}`);
  assert(n(s.total) + n(s.remain) === 12000 || n(s.total) - n(s.remain) === 12000, 'remaining wrong');
  return `${s.total} + ${s.remain} · ${s.cats.join(' / ')}`;
});
await test('estimates are labelled as estimates (not live data)', async () => {
  assert(await ev(`document.querySelectorAll('.est-tag').length >= 2 && document.querySelector('.disclaimer').textContent.includes('ค่าประมาณ')`), 'no estimate labels');
});
await test('travel time and distance shown between places', async () => {
  const t = await ev(`document.querySelector('.travel')?.textContent.trim()`);
  assert(/กม\..*นาที|นาที/.test(t || ''), t);
  return t;
});
await test('map shows numbered pins, hotel, route and nearby markers', async () => {
  assert(await waitFor(`document.querySelectorAll('.leaflet-marker-icon .pin').length > 3 && document.querySelectorAll('.leaflet-tile-loaded').length > 0`, 25000), 'no markers/tiles');
  const m = JSON.parse(await ev(`JSON.stringify({ pins: document.querySelectorAll('.pin:not(.hotel):not(.near)').length, hotel: document.querySelectorAll('.pin.hotel').length, near: document.querySelectorAll('.pin.near').length, lines: document.querySelectorAll('.leaflet-overlay-pane path').length })`));
  assert(m.pins >= 4 && m.hotel === 1 && m.lines >= 1, JSON.stringify(m));
  return JSON.stringify(m);
});
await test('choosing a day on the map shows per-leg travel times', async () => {
  await click('[data-mapday="0"]');
  assert(await waitFor(`document.querySelectorAll('.leg').length > 0`), 'no leg labels');
  const legs = await ev(`[...document.querySelectorAll('.leg')].map(l => l.textContent.trim()).join(' | ')`);
  await click('[data-mapday="all"]');
  return legs;
});
await test('🗺️ button focuses the place and opens its popup with travel + nearby', async () => {
  await click('[data-map]');
  assert(await waitFor(`!!document.querySelector('.leaflet-popup-content .pop')`, 5000), 'no popup');
  return await ev(`document.querySelector('.leaflet-popup-content').textContent.replace(/\\s+/g, ' ').slice(0, 120)`);
});
await shot('plan');

// ---------- แก้ไข / ลบ / เพิ่ม ----------
await test('edit an item cost → totals update', async () => {
  const before = await total();
  await click('[data-edit]');
  assert(await waitFor(`!!document.querySelector('#editForm')`), 'no edit form');
  await ev(`(() => { const f = document.querySelector('#editForm'); f.cost.value = Number(f.cost.value) + 500; f.name.value = 'รายการที่แก้ไขแล้ว'; f.requestSubmit(); })()`);
  assert(await waitFor(`[...document.querySelectorAll('.item-name')].some(n => n.textContent === 'รายการที่แก้ไขแล้ว')`), 'name not updated');
  const after = await total();
  assert(after === before + 500, `${before} → ${after}`);
  return `${before} → ${after}`;
});
await test('delete an item → total drops; undo restores it', async () => {
  const before = await total();
  const count = await ev(`document.querySelectorAll('.item').length`);
  await ev(`[...document.querySelectorAll('.item')].find(i => i.querySelector('.item-cost').textContent.match(/\\d/)).querySelector('[data-del]').click()`);
  assert(await waitFor(`document.querySelectorAll('.item').length === ${count - 1}`), 'not deleted');
  const mid = await total();
  assert(mid < before, 'total did not drop');
  await click('#toast button');
  assert(await waitFor(`document.querySelectorAll('.item').length === ${count}`), 'undo failed');
  assert(await total() === before, 'total not restored');
  return `${before} → ${mid} → ${before}`;
});
await test('add a suggested place and a custom item', async () => {
  const count = await ev(`document.querySelectorAll('.item').length`);
  await click('[data-add="0"]');
  assert(await waitFor(`document.querySelectorAll('[data-pick]').length > 0`), 'no suggestions');
  const name = await ev(`document.querySelector('[data-pick]').dataset.pick`);
  await click('[data-pick]');
  assert(await waitFor(`document.querySelectorAll('.item').length === ${count + 1}`), 'suggestion not added');
  await click('[data-add="1"]');
  await click('[data-tab="custom"]');
  await ev(`(() => { const f = document.querySelector('#customForm'); f.name.value = 'ซื้อของฝาก'; f.cost.value = 450; f.requestSubmit(); })()`);
  assert(await waitFor(`[...document.querySelectorAll('.item-name')].some(n => n.textContent === 'ซื้อของฝาก')`), 'custom not added');
  return `+ ${name} · + ซื้อของฝาก`;
});
await test('add my own place: tap the mini map to pin it → shows on the trip map with travel time', async () => {
  const pinsBefore = await ev(`document.querySelectorAll('#map .pin:not(.hotel):not(.near)').length`);
  await click('[data-add-custom]');
  assert(await waitFor(`!document.querySelector('#customForm').hidden && document.querySelectorAll('#locMap .leaflet-tile-loaded').length > 0`, 20000), 'picker map not shown');
  const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('#locMap').getBoundingClientRect())`));
  const x = r.left + r.width / 2 + 25, y = r.top + r.height / 2 - 10;
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  assert(await waitFor(`document.querySelector('#locStatus').textContent.includes('ปักหมุดแล้ว') && !!document.querySelector('#locMap .pin.pick')`, 5000), 'pin not placed');
  await ev(`(() => { const f = document.querySelector('#customForm'); f.name.value = 'คาเฟ่ลับของฉัน'; f.type.value = 'cafe'; f.cat.value = 'food'; f.cost.value = 240; f.requestSubmit(); })()`);
  assert(await waitFor(`[...document.querySelectorAll('.item')].some(i => i.querySelector('.item-name').textContent === 'คาเฟ่ลับของฉัน' && i.querySelector('[data-map]'))`), 'custom place not added with map button');
  assert(await waitFor(`document.querySelectorAll('#map .pin:not(.hotel):not(.near)').length === ${pinsBefore + 1}`), 'no new pin on trip map');
  const card = await ev(`(() => { const i = [...document.querySelectorAll('.item')].find(i => i.querySelector('.item-name').textContent === 'คาเฟ่ลับของฉัน'); const tr = i.previousElementSibling?.classList.contains('travel') ? i.previousElementSibling.textContent.trim() : ''; return i.querySelector('.item-meta').textContent.replace(/\\s+/g, ' ').trim() + ' | ' + tr; })()`);
  assert(card.includes('☕') || card.includes('คาเฟ่'), card);
  return card;
});
await test('edit my own place keeps its pin and can move/clear it', async () => {
  await ev(`[...document.querySelectorAll('.item')].find(i => i.querySelector('.item-name').textContent === 'คาเฟ่ลับของฉัน').querySelector('[data-edit]').click()`);
  assert(await waitFor(`!!document.querySelector('#editForm #locMap .pin.pick')`, 10000), 'existing pin not shown in edit');
  await click('#locClear');
  await ev(`document.querySelector('#editForm').requestSubmit()`);
  assert(await waitFor(`(() => { const i = [...document.querySelectorAll('.item')].find(i => i.querySelector('.item-name').textContent === 'คาเฟ่ลับของฉัน'); return i && !i.querySelector('[data-map]'); })()`), 'pin not cleared');
});
await test('add from "สถานที่ใกล้เคียง" list', async () => {
  const count = await ev(`document.querySelectorAll('.item').length`);
  if (!(await ev(`!!document.querySelector('#nearby [data-addnear]')`))) return 'no nearby left (ok)';
  await click('#nearby [data-addnear]');
  assert(await waitFor(`document.querySelectorAll('.item').length === ${count + 1}`), 'nearby not added');
});

// ---------- บันทึก ----------
await test('save plan → appears in "แผนของฉัน" and survives reload', async () => {
  await click('#saveBtn');
  assert(await waitFor(`document.querySelector('#saveBtn').textContent.includes('บันทึกแล้ว')`), 'not saved');
  const id = await ev(`location.hash.split('/').pop()`);
  const t = await total();
  await go(SITE + '#/saved');
  assert(await waitFor(`document.querySelectorAll('.saved-card').length === 1`), 'not in saved list');
  await go(SITE + '#/plan/' + id);
  await send('Page.reload');
  await sleep(1200);
  assert(await waitFor(`!!document.querySelector('#totalSpent')`), 'plan did not load after reload');
  assert(await total() === t, 'total changed after reload');
  assert(await ev(`[...document.querySelectorAll('.item-name')].some(n => n.textContent === 'ซื้อของฝาก')`), 'edits lost');
  return `${id} · ${t}`;
});
await test('edits on a saved plan autosave', async () => {
  await ev(`[...document.querySelectorAll('.item')].find(i => i.querySelector('.item-name').textContent === 'ซื้อของฝาก').querySelector('[data-del]').click()`);
  await sleep(300);
  await send('Page.reload');
  await sleep(1200);
  await waitFor(`!!document.querySelector('#totalSpent')`);
  assert(!(await ev(`[...document.querySelectorAll('.item-name')].some(n => n.textContent === 'ซื้อของฝาก')`)), 'deletion not persisted');
});
await test('delete a saved plan', async () => {
  await go(SITE + '#/saved');
  await click('[data-remove]');
  await click('#confirmOk');
  assert(await waitFor(`document.querySelectorAll('.saved-card').length === 0 && !!document.querySelector('.empty')`), 'not deleted');
});
await test('low budget warns and suggests a minimum', async () => {
  await go(SITE + '#/');
  await ev(`(() => { const i = document.querySelector('#budget'); i.value = '800'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert(await waitFor(`document.querySelector('#estimate').classList.contains('warn')`), 'no warning on form');
  await click('#planner button[type=submit]');
  assert(await waitFor(`!!document.querySelector('.alert [data-act="usemin"]')`), 'no min-budget action');
  await click('[data-act="usemin"]');
  assert(await waitFor(`!document.querySelector('.alert')`), 'still over budget after using minimum');
});

// ---------- วันที่ / แชร์ / เครดิต ----------
const setInput = (sel, value, evt = 'input') => ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event(${JSON.stringify(evt)}, { bubbles: true })); })()`);
const planSnapshot = () => ev(`JSON.stringify({ total: document.querySelector('#totalSpent').textContent, items: [...document.querySelectorAll('.item-name')].map(n => n.textContent), saved: document.querySelector('#saveBtn').textContent })`).then(JSON.parse);

await test('trip dates are shown on every day and in the header', async () => {
  const d = JSON.parse(await ev(`JSON.stringify({ days: [...document.querySelectorAll('.day-date')].map(x => x.textContent.trim()), chip: [...document.querySelectorAll('.meta-chips span')].map(s => s.textContent).find(t => t.includes('🗓️')) || '' })`));
  assert(d.days.length === 2 && d.days.every((t) => /\d{4}/.test(t)) && d.chip, JSON.stringify(d));
  return d.days.join(' | ');
});
await test('share link round-trips the whole plan (same totals and items)', async () => {
  const before = await planSnapshot();
  await click('[data-act="share"]');
  assert(await waitFor(`!!document.querySelector('#shareLink')`), 'no share link');
  const link = await ev(`document.querySelector('#shareLink').value`);
  assert(/#\/share\/[\w-]+$/.test(link), link.slice(0, 80));
  await click('#sheet [data-close]');
  await go(SITE + link.slice(link.indexOf('#')));
  assert(await waitFor(`location.hash.startsWith('#/plan/') && !!document.querySelector('#totalSpent')`), 'shared link did not open a plan');
  const after = await planSnapshot();
  assert(after.total === before.total && JSON.stringify(after.items) === JSON.stringify(before.items), 'plan differs after share');
  assert(after.saved.includes('บันทึกแผน'), 'shared plan should start unsaved');
  return `${link.length} chars · ${after.total} · ${after.items.length} items`;
});
await test('tampered share link shows a friendly error', async () => {
  await go(SITE + '#/share/zNOT-A-REAL-PLAN');
  assert(await waitFor(`document.body.textContent.includes('ลิงก์แผนไม่ถูกต้อง')`), 'no error message');
});
await test('weekday warning for places that open only on certain days', async () => {
  await go(SITE + '#/');
  await click('[data-prov="chiangmai"]');
  await setInput('#startDate', '2026-11-02', 'change'); // วันจันทร์
  await setInput('#budget', '9000');
  await click('#planner button[type=submit]');
  assert(await waitFor(`!!document.querySelector('#days .item')`), 'no plan');
  // ใส่ถนนคนเดินวันอาทิตย์ลงวันที่ 1 (วันจันทร์) ให้แน่ใจว่ามีกรณีที่ต้องเตือน
  const sunday = 'ถนนคนเดินวันอาทิตย์ ประตูท่าแพ';
  if (!(await ev(`[...document.querySelectorAll('#day-1 .item-name')].some(n => n.textContent === ${JSON.stringify(sunday)})`))) {
    await click('[data-add="0"]');
    assert(await waitFor(`!!document.querySelector('[data-pick="${sunday}"]')`), 'Sunday market not in suggestions');
    await click(`[data-pick="${sunday}"]`);
  }
  assert(await waitFor(`document.querySelectorAll('.open-warn').length > 0`), 'no warning rendered');
  const w = await ev(`[...document.querySelectorAll('.open-warn')].map(x => x.closest('.item').querySelector('.item-name').textContent + ': ' + x.textContent.trim()).join(' | ')`);
  assert(w && w.includes('ถนนคนเดินวันอาทิตย์') && w.includes('จันทร์'), w || 'no warnings');
  return w.slice(0, 110);
});
await test('photo credits list every province photo with license', async () => {
  await go(SITE + '#/');
  assert(await waitFor(`document.querySelectorAll('.prov-photo img').length === 12`), 'photos missing');
  await click('[data-credits]');
  assert(await waitFor(`document.querySelectorAll('.credit').length === 12 && [...document.querySelectorAll('.credit')].every(c => /CC BY|CC0|Public domain/i.test(c.textContent))`), 'credits incomplete');
  await click('#sheet [data-close]');
});

// ---------- มือถือ ----------
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await test('mobile: no horizontal overflow on home and plan, bottom bar visible', async () => {
  await go(SITE + '#/');
  await waitFor(`!!document.querySelector('#planner')`);
  const hw = await ev('document.documentElement.scrollWidth');
  await click('#planner button[type=submit]');
  await waitFor(`!!document.querySelector('#days .item')`);
  const pw = await ev('document.documentElement.scrollWidth');
  const bar = await ev(`getComputedStyle(document.querySelector('.bottom-bar')).display !== 'none'`);
  assert(hw <= 390 && pw <= 390 && bar, JSON.stringify({ hw, pw, bar }));
  await shot('plan-mobile');
  return `home ${hw}px · plan ${pw}px`;
});
await test('no JavaScript errors on any page', async () => { assert(!pageErrors.length, pageErrors.join(' | ')); });

ws.close(); browser.kill(); siteServer.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
