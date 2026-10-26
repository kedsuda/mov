// ระบบแหล่งวิดีโอ (Video providers)
// ---------------------------------------------------------------------------
// เพิ่มผู้ให้บริการใหม่ได้ด้วย Providers.register({...}) — ใช้กับแหล่งที่คุณมีสิทธิ์
// เผยแพร่/ฝังวิดีโอเท่านั้น provider จะถูกตรวจตามลำดับที่ลงทะเบียน ตัวแรกที่รองรับจะถูกใช้
//
// รูปแบบ provider:
//   id        : string  ใช้ใน URL ของหน้าเล่น (watch.html?p=<id>&id=<key>)
//   name      : string  ชื่อที่แสดงบนหน้าเล่น
//   fromItem  : (item, details) => key | null
//               item    = { src: 'ia' | 'tmdb', id, type, title, year }
//               details = ข้อมูลเต็มจาก TMDB (มี imdb_id, original_title …) หรือ null
//   resolve   : async (key) => Media
//
// Media:
//   { title, year?, overview?, poster?, backdrop?,
//     sources?:  [{ src, type, label }]   // ไฟล์วิดีโอตรง → <video> (ตรวจจับ error ได้)
//     embedUrl?: string                    // iframe ของผู้ให้บริการที่อนุญาตให้ฝัง
//     preview?:  true, trailer?, watch?    // ไม่มีวิดีโอเต็มเรื่อง → แสดงตัวอย่าง + ช่องทางรับชมถูกกฎหมาย
//     redirect?: string                    // ส่งต่อไปหน้าเล่นของ provider อื่น
//     pageUrl?, license?, licenseUrl?, credit? }
//
// ตัวอย่างการเพิ่มผู้ให้บริการแบบ iframe (เปลี่ยนเป็นโดเมนที่คุณได้รับสิทธิ์) — ลงทะเบียนก่อน 'tmdb':
//
//   Providers.register(Providers.embedProvider({
//     id: 'mystudio',
//     name: 'My Studio',
//     fromItem: (item, d) => d?.imdb_id && MY_LICENSED_TITLES.has(d.imdb_id) ? d.imdb_id : null,
//     embedUrl: (key) => `https://player.my-licensed-studio.example/embed/${key}`,
//     license: 'Licensed to LUMIÈRE'
//   }), { before: 'tmdb' });
// ---------------------------------------------------------------------------
window.Providers = (() => {
  'use strict';

  const L = window.Lumiere;
  const registry = [];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  function register(provider, { before } = {}) {
    if (!provider || !provider.id || typeof provider.resolve !== 'function') throw new Error('Invalid provider');
    const old = registry.findIndex((p) => p.id === provider.id);
    if (old >= 0) registry.splice(old, 1);
    const at = before ? registry.findIndex((p) => p.id === before) : -1;
    if (at >= 0) registry.splice(at, 0, provider); else registry.push(provider);
    return provider;
  }

  const get = (id) => registry.find((p) => p.id === id) || null;
  const list = () => registry.slice();

  function find(item, details = null, { exclude = [] } = {}) {
    for (const p of registry) {
      if (exclude.includes(p.id)) continue;
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

  function licenseLabel(url) {
    if (!url) return 'ไม่ระบุ';
    if (/publicdomain|zero/i.test(url)) return 'Public Domain';
    const m = url.match(/licenses\/([a-z-]+)\/([\d.]+)/i);
    return m ? `Creative Commons ${m[1].toUpperCase()} ${m[2]}` : 'Creative Commons';
  }

  async function archiveFetch(identifier) {
    if (!/^[\w.-]+$/.test(identifier)) throw new Error('รหัสภาพยนตร์ไม่ถูกต้อง');
    if (L.ARCHIVE_BLOCKED.has(identifier)) throw new Error('รายการนี้ถูกนำออกจากเว็บไซต์แล้ว');
    let res;
    try {
      res = await fetch(`${L.IA}/metadata/${encodeURIComponent(identifier)}`);
    } catch {
      throw new Error('เชื่อมต่อ Internet Archive ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    }
    if (!res.ok) throw new Error(`Internet Archive ตอบกลับ ${res.status}`);
    const data = await res.json();
    if (!data || !data.metadata) throw new Error('ไม่พบภาพยนตร์นี้ใน Internet Archive');
    if (data.is_dark || data.metadata.mediatype !== 'movies') throw new Error('รายการนี้ไม่ใช่วิดีโอที่เปิดให้รับชม');
    return data;
  }

  function toMedia(identifier, data) {
    const files = (data.files || [])
      .map((f) => ({ f, t: VIDEO_TYPES.find((v) => v.re.test(f.name)) }))
      .filter((x) => x.t && x.f.private !== 'true')
      // คุณภาพสูงก่อน, mp4 ก่อน webm (รองรับทุกเบราว์เซอร์), 512Kb ไว้ท้ายสุดเป็นสำรอง
      .sort((a, b) => {
        const low = (x) => (/512kb/i.test(x.f.name) ? 1 : 0);
        const mp4 = (x) => (x.t.type === 'video/mp4' ? 0 : 1);
        return low(a) - low(b) || mp4(a) - mp4(b) || (Number(b.f.height) || 0) - (Number(a.f.height) || 0);
      })
      .slice(0, 4)
      .map(({ f, t }) => ({
        src: `${L.IA}/download/${encodeURIComponent(identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
        type: t.type,
        label: f.height ? `${f.height}p` : (f.format || '')
      }));
    const m = data.metadata;
    const licenseUrl = L.first(m.licenseurl) || '';
    return {
      title: L.stripHtml(L.first(m.title)) || identifier,
      year: String(L.first(m.year) || L.first(m.date) || '').slice(0, 4),
      overview: L.stripHtml(L.first(m.description)),
      poster: `${L.IA}/services/img/${encodeURIComponent(identifier)}`,
      sources: files,
      embedUrl: `${L.IA}/embed/${encodeURIComponent(identifier)}`,
      pageUrl: `${L.IA}/details/${encodeURIComponent(identifier)}`,
      license: licenseLabel(licenseUrl),
      licenseUrl,
      credit: 'Internet Archive'
    };
  }

  // ---------- Open movies (Creative Commons, Blender Studio) ----------
  const OPEN_FILMS = [
    { archive: 'BigBuckBunny_124', title: 'Big Buck Bunny', year: 2008, imdb: 'tt1254207', genres: ['anime'] },
    { archive: 'ElephantsDream', title: 'Elephants Dream', year: 2006, imdb: 'tt0807840', genres: ['anime', 'scifi'] },
    { archive: 'Sintel', title: 'Sintel', year: 2010, imdb: 'tt1727587', genres: ['anime', 'action'] },
    { archive: 'Tears-of-Steel', title: 'Tears of Steel', year: 2012, imdb: 'tt2285752', genres: ['scifi', 'action'] },
    { archive: 'CosmosLaundromatFirstCycle', title: 'Cosmos Laundromat', year: 2015, genres: ['anime', 'comedy'] },
    { archive: 'Caminandes1LlamaDrama', title: 'Caminandes: Llama Drama', year: 2013, genres: ['anime', 'comedy'] },
    { archive: 'Caminandes2GranDillama', title: 'Caminandes: Gran Dillama', year: 2013, genres: ['anime', 'comedy'] },
    { archive: 'CaminandesLlamigos', title: 'Caminandes: Llamigos', year: 2016, genres: ['anime', 'comedy'] }
  ];
  const isOpen = (id) => OPEN_FILMS.some((f) => f.archive === id);

  register({
    id: 'open',
    name: 'Blender Open Movies',
    fromItem(item, d) {
      if (item.src === 'ia') return isOpen(item.id) ? item.id : null;
      if (item.src !== 'tmdb' || item.type !== 'movie' || !d) return null;
      const year = Number(String(d.release_date || '').slice(0, 4));
      const hit = OPEN_FILMS.find((f) =>
        (f.imdb && f.imdb === d.imdb_id) ||
        (norm(f.title) === norm(d.original_title) && Math.abs(f.year - year) <= 1));
      return hit ? hit.archive : null;
    },
    async resolve(key) {
      if (!isOpen(key)) throw new Error('ไม่พบภาพยนตร์นี้ในรายการ Open Movies');
      return { ...toMedia(key, await archiveFetch(key)), credit: 'Blender Studio · Internet Archive' };
    }
  });

  // ---------- Internet Archive (public domain only) ----------
  register({
    id: 'archive',
    name: 'Internet Archive · Public Domain',
    fromItem: (item) => (item.src === 'ia' ? item.id : null),
    async resolve(key) {
      const data = await archiveFetch(key);
      const license = L.first(data.metadata.licenseurl) || '';
      const year = Number(String(L.first(data.metadata.year) || '').slice(0, 4));
      if (!/publicdomain/i.test(license) || (year && year > L.ARCHIVE_MAX_YEAR)) {
        throw new Error('รายการนี้ไม่ได้ระบุสถานะสาธารณสมบัติที่ตรวจสอบได้ จึงไม่เปิดให้เล่นบนเว็บไซต์นี้');
      }
      return toMedia(key, data);
    }
  });

  // ---------- TMDB: ไม่มีวิดีโอเต็มเรื่อง → ตัวอย่างหนัง + ช่องทางรับชมถูกกฎหมาย ----------
  register({
    id: 'tmdb',
    name: 'ตัวอย่างหนัง · TMDB',
    fromItem: (item) => (item.src === 'tmdb' ? `${item.type}-${item.id}` : null),
    async resolve(key) {
      const m = /^(movie|tv)-(\d+)$/.exec(key);
      if (!m) throw new Error('รหัสภาพยนตร์ไม่ถูกต้อง');
      const [, type, id] = m;
      const d = await L.tmdb(`/${type}/${id}`, {
        append_to_response: 'videos,watch/providers,external_ids',
        include_video_language: `${L.settings.lang.slice(0, 2)},en,null`
      });
      const details = { ...d, imdb_id: d.imdb_id || d.external_ids?.imdb_id };

      // มีวิดีโอเต็มเรื่องถูกลิขสิทธิ์จาก provider อื่นหรือไม่
      const full = find({ src: 'tmdb', type, id }, details, { exclude: ['tmdb'] });
      if (full) return { redirect: watchUrl(full.provider.id, full.key) };

      let overview = d.overview;
      if (!overview && L.settings.lang !== 'en-US') {
        overview = (await L.tmdb(`/${type}/${id}`, { language: 'en-US' }).catch(() => ({}))).overview;
      }
      const date = d.release_date || d.first_air_date || '';
      return {
        preview: true,
        title: d.title || d.name || '',
        year: date.slice(0, 4),
        date,
        rating: d.vote_average ? d.vote_average.toFixed(1) : '',
        runtime: d.runtime ? `${Math.floor(d.runtime / 60)} ชม. ${d.runtime % 60} นาที` : (d.number_of_seasons ? `${d.number_of_seasons} ซีซัน` : ''),
        genres: (d.genres || []).map((g) => g.name),
        overview: overview || '',
        poster: d.poster_path ? L.IMG + 'w342' + d.poster_path : '',
        backdrop: d.backdrop_path ? L.IMG + 'w1280' + d.backdrop_path : '',
        trailer: L.pickTrailer(d.videos),
        watch: L.watchOptions(d),
        pageUrl: `https://www.themoviedb.org/${type}/${id}`,
        credit: 'TMDB',
        license: 'ตัวอย่างหนังอย่างเป็นทางการผ่าน YouTube'
      };
    }
  });

  return { register, get, list, find, watchUrl, embedProvider, OPEN_FILMS };
})();
