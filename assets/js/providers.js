// ระบบแหล่งวิดีโอ (Video providers)
// ---------------------------------------------------------------------------
// เพิ่มผู้ให้บริการใหม่ได้ด้วย Providers.register({...}) — ใช้กับแหล่งที่คุณมีสิทธิ์
// เผยแพร่/ฝังวิดีโอเท่านั้น
//
// รูปแบบ provider:
//   id        : string  ใช้ใน URL ของหน้าเล่น (watch.html?p=<id>&id=<key>)
//   name      : string  ชื่อที่แสดงบนหน้าเล่น
//   fromItem  : (item, details) => key | null
//               item    = รายการบนหน้าแรก { src: 'ia' | 'tmdb', id, type, title, year }
//               details = ข้อมูลเต็มจาก TMDB (มี imdb_id, original_title …) หรือ null
//               คืนค่า key ถ้า provider นี้เล่นเรื่องนี้ได้ ไม่งั้นคืน null
//   resolve   : async (key) => Media
//
// Media:
//   { title, year?, overview?, poster?,
//     sources?:  [{ src, type, label }]   // ไฟล์วิดีโอตรง → ใช้ <video> (แนะนำ ตรวจจับ error ได้)
//     embedUrl?: string                    // หรือ iframe ของผู้ให้บริการที่อนุญาตให้ฝัง
//     pageUrl?, license?, licenseUrl?, credit? }
//
// ตัวอย่างการเพิ่มผู้ให้บริการแบบ iframe (เปลี่ยนเป็นโดเมนที่คุณได้รับสิทธิ์):
//
//   Providers.register(Providers.embedProvider({
//     id: 'mystudio',
//     name: 'My Studio',
//     fromItem: (item, d) => d?.imdb_id && MY_LICENSED_TITLES.has(d.imdb_id) ? d.imdb_id : null,
//     embedUrl: (key) => `https://player.my-licensed-studio.example/embed/${key}`,
//     license: 'Licensed to LUMIÈRE'
//   }));
// ---------------------------------------------------------------------------
window.Providers = (() => {
  'use strict';

  const IA = 'https://archive.org';
  const registry = [];
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const stripHtml = (s) => new DOMParser().parseFromString(String(s || ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  function register(provider) {
    if (!provider || !provider.id || typeof provider.resolve !== 'function') throw new Error('Invalid provider');
    const i = registry.findIndex((p) => p.id === provider.id);
    if (i >= 0) registry.splice(i, 1, provider); else registry.push(provider);
    return provider;
  }

  const get = (id) => registry.find((p) => p.id === id) || null;
  const list = () => registry.slice();

  // คืน { provider, key } ตัวแรกที่เล่นรายการนี้ได้
  function find(item, details = null) {
    for (const p of registry) {
      try {
        const key = p.fromItem?.(item, details);
        if (key) return { provider: p, key };
      } catch { /* ignore broken provider */ }
    }
    return null;
  }

  const watchUrl = (providerId, key) => `watch.html?p=${encodeURIComponent(providerId)}&id=${encodeURIComponent(key)}`;

  function embedProvider({ id, name, fromItem, embedUrl, license = '', pageUrl }) {
    return {
      id, name, fromItem,
      async resolve(key) {
        return { title: name, embedUrl: embedUrl(key), license, pageUrl: pageUrl ? pageUrl(key) : '' };
      }
    };
  }

  // ---------- Internet Archive ----------
  const VIDEO_TYPES = [
    { re: /\.mp4$/i, type: 'video/mp4' },
    { re: /\.m4v$/i, type: 'video/mp4' },
    { re: /\.webm$/i, type: 'video/webm' }
  ];

  async function archiveResolve(identifier) {
    if (!/^[\w.-]+$/.test(identifier)) throw new Error('รหัสภาพยนตร์ไม่ถูกต้อง');
    const res = await fetch(`${IA}/metadata/${encodeURIComponent(identifier)}`);
    if (!res.ok) throw new Error(`Internet Archive ตอบกลับ ${res.status}`);
    const data = await res.json();
    if (!data || !data.metadata) throw new Error('ไม่พบภาพยนตร์นี้ใน Internet Archive');
    if (data.is_dark || data.metadata.mediatype !== 'movies') throw new Error('รายการนี้ไม่ใช่วิดีโอที่เปิดให้รับชม');

    const files = (data.files || [])
      .map((f) => ({ f, t: VIDEO_TYPES.find((v) => v.re.test(f.name)) }))
      .filter((x) => x.t && x.f.private !== 'true')
      // คุณภาพสูงก่อน, ไฟล์ mp4 ก่อน webm (รองรับทุกเบราว์เซอร์), 512Kb ไว้ท้ายสุดเป็นสำรอง
      .sort((a, b) => {
        const low = (x) => (/512kb/i.test(x.f.name) ? 1 : 0);
        const mp4 = (x) => (x.t.type === 'video/mp4' ? 0 : 1);
        return low(a) - low(b) || mp4(a) - mp4(b) || (Number(b.f.height) || 0) - (Number(a.f.height) || 0);
      })
      .slice(0, 4)
      .map(({ f, t }) => ({
        src: `${IA}/download/${encodeURIComponent(identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
        type: t.type,
        label: f.height ? `${f.height}p` : (f.format || '')
      }));

    const m = data.metadata;
    const licenseUrl = first(m.licenseurl) || '';
    return {
      title: stripHtml(first(m.title)) || identifier,
      year: String(first(m.year) || first(m.date) || '').slice(0, 4),
      overview: stripHtml(first(m.description)),
      poster: `${IA}/services/img/${encodeURIComponent(identifier)}`,
      sources: files,
      embedUrl: `${IA}/embed/${encodeURIComponent(identifier)}`,
      pageUrl: `${IA}/details/${encodeURIComponent(identifier)}`,
      license: licenseLabel(licenseUrl),
      licenseUrl,
      credit: 'Internet Archive'
    };
  }

  function licenseLabel(url) {
    if (!url) return 'สาธารณสมบัติ / เผยแพร่ผ่าน Internet Archive';
    if (/publicdomain|zero/i.test(url)) return 'Public Domain';
    const m = url.match(/licenses\/([a-z-]+)\/([\d.]+)/i);
    return m ? `Creative Commons ${m[1].toUpperCase()} ${m[2]}` : 'Creative Commons';
  }

  // ---------- Open movies (Creative Commons, Blender Studio) ----------
  // ระบุด้วย IMDb ID และชื่อต้นฉบับ เพื่อจับคู่กับข้อมูล TMDB บนหน้ารายละเอียด
  const OPEN_FILMS = [
    { archive: 'BigBuckBunny_124', title: 'Big Buck Bunny', year: 2008, imdb: 'tt1254207' },
    { archive: 'ElephantsDream', title: 'Elephants Dream', year: 2006, imdb: 'tt0807840' },
    { archive: 'Sintel', title: 'Sintel', year: 2010, imdb: 'tt1727587' },
    { archive: 'Tears-of-Steel', title: 'Tears of Steel', year: 2012, imdb: 'tt2285752' },
    { archive: 'CosmosLaundromatFirstCycle', title: 'Cosmos Laundromat', year: 2015 },
    { archive: 'Caminandes1LlamaDrama', title: 'Caminandes: Llama Drama', year: 2013 },
    { archive: 'Caminandes2GranDillama', title: 'Caminandes: Gran Dillama', year: 2013 },
    { archive: 'CaminandesLlamigos', title: 'Caminandes: Llamigos', year: 2016 }
  ];

  register({
    id: 'open',
    name: 'Blender Open Movies',
    films: OPEN_FILMS,
    fromItem(item, d) {
      if (item.src === 'ia') return OPEN_FILMS.some((f) => f.archive === item.id) ? item.id : null;
      if (item.src !== 'tmdb' || item.type !== 'movie' || !d) return null;
      const year = Number(String(d.release_date || '').slice(0, 4));
      const hit = OPEN_FILMS.find((f) =>
        (f.imdb && f.imdb === d.imdb_id) ||
        (norm(f.title) === norm(d.original_title) && Math.abs(f.year - year) <= 1));
      return hit ? hit.archive : null;
    },
    async resolve(key) {
      if (!OPEN_FILMS.some((f) => f.archive === key)) throw new Error('ไม่พบภาพยนตร์นี้ในรายการ Open Movies');
      const media = await archiveResolve(key);
      return { ...media, credit: 'Blender Studio · Internet Archive' };
    }
  });

  register({
    id: 'archive',
    name: 'Internet Archive',
    fromItem: (item) => (item.src === 'ia' ? item.id : null),
    resolve: archiveResolve
  });

  return { register, get, list, find, watchUrl, embedProvider, archiveResolve, OPEN_FILMS };
})();
