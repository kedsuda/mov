// Service worker: ให้เปิดเว็บและแผนที่บันทึกไว้ได้เมื่อสัญญาณไม่ดี/ออฟไลน์
// - ไฟล์ของเว็บ (HTML/CSS/JS): ดึงจากเน็ตก่อน (ได้เวอร์ชันล่าสุดเสมอ) ถ้าเน็ตไม่มีค่อยใช้ที่เก็บไว้
// - ภาพ ฟอนต์ ไลบรารีจาก CDN และไทล์แผนที่: ใช้ที่เก็บไว้ก่อน — เก็บเฉพาะไทล์ที่เคยเปิดดู
//   (ไม่ดาวน์โหลดไทล์ล่วงหน้าจำนวนมาก ตามนโยบายการใช้งานของ OpenStreetMap)
// แผนที่บันทึกไว้อยู่ใน localStorage อยู่แล้ว จึงเปิดดูได้แม้ออฟไลน์
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const MAX_TILES = 800;

const PROVINCES = ['bangkok', 'chiangmai', 'phuket', 'krabi', 'chiangrai', 'pattaya', 'huahin', 'kanchanaburi', 'ayutthaya', 'sukhothai', 'nan', 'khaoyai'];
const SHELL_FILES = ['./', 'index.html', 'assets/css/style.css', 'assets/js/data.js', 'assets/js/credits.js', 'assets/js/planner.js', 'assets/js/app.js'];
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    // ภาพจังหวัดและไลบรารี: ถ้าบางไฟล์โหลดไม่ได้ก็ไม่ทำให้การติดตั้งล้ม
    const assets = await caches.open(ASSETS);
    await Promise.allSettled([
      ...PROVINCES.map((id) => assets.add(`assets/img/provinces/${id}.jpg`)),
      ...CDN_FILES.map((url) => assets.add(new Request(url, { mode: 'cors' })))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS, TILES]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isTile = (url) => /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname) || url.hostname === 'server.arcgisonline.com';
const isAsset = (url) => url.origin === self.location.origin
  ? /\/assets\/img\//.test(url.pathname)
  : /^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
// เก็บเฉพาะคำตอบที่อ่านได้ (ไม่เก็บ opaque response เพราะกินพื้นที่มากและตรวจสอบไม่ได้)
const storable = (res) => res && res.ok && res.type !== 'opaque';

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

async function cacheFirst(req, name, onStore) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (storable(res)) {
    const cache = await caches.open(name);
    await cache.put(req, res.clone());
    onStore?.();
  }
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (storable(res)) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await caches.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isTile(url)) e.respondWith(cacheFirst(req, TILES, () => trimTiles()));
  else if (isAsset(url)) e.respondWith(cacheFirst(req, ASSETS));
  else if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  // อื่นๆ (เช่น ค้นหาสถานที่ผ่าน Nominatim) ปล่อยให้เบราว์เซอร์จัดการตามปกติ
});
