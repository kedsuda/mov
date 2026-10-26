// ส่วนกลางที่หน้าแรกและหน้าเล่นวิดีโอใช้ร่วมกัน: ตัวช่วย, TMDB, Internet Archive, การ์ดโปสเตอร์
window.Lumiere = (() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const stripHtml = (s) => new DOMParser().parseFromString(String(s || ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>'
  };

  // ---------- Settings (config.js สร้างจาก environment variables ตอน build; ผู้ชมเปลี่ยนเองได้ในหน้าตั้งค่า) ----------
  const cfg = window.CONFIG || {};
  const settings = {
    get key() { return store.get('tmdbKey', '') || cfg.TMDB_KEY || ''; },
    get region() { return store.get('region', cfg.REGION || 'TH'); },
    get lang() { return store.get('lang', cfg.LANGUAGE || 'th-TH'); },
    refreshMs: Math.max(0.05, Number(cfg.REFRESH_MINUTES) || 5) * 60 * 1000,
    save({ key, region, lang }) { store.set('tmdbKey', key); store.set('region', region); store.set('lang', lang); }
  };

  // ---------- TMDB ----------
  const TMDB = (cfg.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/$/, '');
  const IMG = cfg.TMDB_IMAGE_BASE || 'https://image.tmdb.org/t/p/';

  async function tmdb(path, params = {}) {
    const key = settings.key;
    if (!key) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า TMDB API Key'), { noKey: true });
    const url = new URL(TMDB + path);
    const bearer = key.startsWith('eyJ');
    if (!bearer) url.searchParams.set('api_key', key);
    url.searchParams.set('language', settings.lang);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetch(url, { headers: bearer ? { Authorization: 'Bearer ' + key } : {} });
    } catch {
      throw new Error('เชื่อมต่อ TMDB ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    }
    if (res.status === 401) throw Object.assign(new Error('TMDB API Key ไม่ถูกต้อง'), { auth: true });
    if (!res.ok) throw new Error(`TMDB ตอบกลับผิดพลาด (${res.status})`);
    return res.json();
  }

  function normTmdb(m, fallbackType) {
    const type = m.media_type || fallbackType || 'movie';
    const date = m.release_date || m.first_air_date || '';
    return remember({
      src: 'tmdb', type, id: String(m.id),
      title: m.title || m.name || '',
      year: date.slice(0, 4), date,
      rating: m.vote_average ? m.vote_average.toFixed(1) : '',
      poster: m.poster_path ? IMG + 'w342' + m.poster_path : '',
      backdrop: m.backdrop_path ? IMG + 'w1280' + m.backdrop_path : '',
      overview: m.overview || ''
    });
  }

  function pickTrailer(videos) {
    const yt = (videos?.results || []).filter((v) => v.site === 'YouTube');
    return yt.find((v) => v.type === 'Trailer' && v.official) || yt.find((v) => v.type === 'Trailer') || yt.find((v) => v.type === 'Teaser') || yt[0] || null;
  }

  // ช่องทางรับชมที่ถูกกฎหมาย (ข้อมูล JustWatch ผ่าน TMDB)
  function watchOptions(d) {
    const all = d?.['watch/providers']?.results || {};
    const region = all[settings.region] ? settings.region : (all.US ? 'US' : '');
    const data = all[region];
    const list = [];
    const seen = new Set();
    [['flatrate', 'สตรีมมิ่ง'], ['free', 'ดูฟรี'], ['ads', 'ดูฟรี (มีโฆษณา)'], ['rent', 'เช่า'], ['buy', 'ซื้อ']].forEach(([k, label]) => {
      (data?.[k] || []).forEach((p) => {
        if (seen.has(p.provider_id)) return;
        seen.add(p.provider_id);
        list.push({ name: p.provider_name, logo: p.logo_path ? IMG + 'w92' + p.logo_path : '', label });
      });
    });
    return { link: data?.link || '', region, fallback: region !== settings.region, list };
  }

  function watchOptionsHtml(w) {
    if (!w.list.length) return '<p class="muted">ยังไม่มีช่องทางรับชมออนไลน์อย่างเป็นทางการในภูมิภาคนี้ — หากกำลังฉาย ชมได้ที่โรงภาพยนตร์ใกล้บ้านคุณ</p>';
    return `<div class="providers">${w.list.slice(0, 12).map((p) => `
      <a class="provider" href="${esc(w.link)}" target="_blank" rel="noopener">
        ${p.logo ? `<img src="${esc(p.logo)}" alt="" loading="lazy">` : ''}
        <span>${esc(p.name)}<small>${esc(p.label)}</small></span>
      </a>`).join('')}</div>
      <p class="muted" style="margin-top:12px">ข้อมูลช่องทางรับชมโดย JustWatch${w.fallback ? ' (แสดงข้อมูลของสหรัฐฯ)' : ''}</p>`;
  }

  // ---------- Internet Archive ----------
  // ป้ายสัญญาอนุญาตใน Internet Archive ผู้อัปโหลดเป็นผู้กำหนดเอง และพบหนังมีลิขสิทธิ์ที่ติดป้าย CC อยู่จริง
  // จึงรับเฉพาะรายการที่ระบุเป็นสาธารณสมบัติ และออกฉายไม่เกินปี ARCHIVE_MAX_YEAR
  // (ภาพยนตร์ Creative Commons ที่ตรวจสอบแล้ว อยู่ในรายการ OPEN_FILMS ของ providers.js)
  const IA = 'https://archive.org';
  const ARCHIVE_MAX_YEAR = 1970;
  const ARCHIVE_SAFE = `mediatype:(movies) AND licenseurl:(*publicdomain*) AND year:[1890 TO ${ARCHIVE_MAX_YEAR}]`;
  // รหัสรายการที่ต้องการซ่อน (เช่น ได้รับแจ้งเรื่องลิขสิทธิ์)
  const ARCHIVE_BLOCKED = new Set([]);

  async function archiveSearch({ q = '', ids = [], sort = 'downloads desc', rows = 20, page = 1 }) {
    const parts = [];
    if (q) parts.push(`((${q}) AND ${ARCHIVE_SAFE})`);
    if (ids.length) parts.push(`identifier:(${ids.join(' OR ')})`);
    const url = new URL(IA + '/advancedsearch.php');
    url.searchParams.set('q', parts.join(' OR '));
    ['identifier', 'title', 'year', 'description', 'addeddate'].forEach((f) => url.searchParams.append('fl[]', f));
    url.searchParams.append('sort[]', sort);
    url.searchParams.set('rows', rows);
    url.searchParams.set('page', page);
    url.searchParams.set('output', 'json');
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new Error('เชื่อมต่อ Internet Archive ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    }
    if (!res.ok) throw new Error(`Internet Archive ตอบกลับผิดพลาด (${res.status})`);
    const data = await res.json();
    if (!data.response) throw new Error('Internet Archive ส่งข้อมูลไม่ถูกต้อง');
    const items = data.response.docs.filter((d) => !ARCHIVE_BLOCKED.has(d.identifier)).map(normArchive);
    return { items, total: data.response.numFound, pages: Math.ceil(data.response.numFound / rows) };
  }

  function normArchive(d) {
    const id = d.identifier;
    return remember({
      src: 'ia', type: 'movie', id,
      title: stripHtml(first(d.title)) || id,
      year: d.year ? String(first(d.year)).slice(0, 4) : '',
      rating: '',
      poster: `${IA}/services/img/${encodeURIComponent(id)}`,
      backdrop: `${IA}/services/img/${encodeURIComponent(id)}`,
      overview: stripHtml(first(d.description)),
      added: d.addeddate || '',
      free: true
    });
  }

  // ---------- Items & cards ----------
  const items = new Map();
  const keyOf = (it) => `${it.src}:${it.type}:${it.id}`;
  function remember(it) { items.set(keyOf(it), it); return it; }
  const dedupe = (list) => [...new Map(list.map((it) => [keyOf(it), it])).values()];

  // ลิงก์หน้าเล่น: เลือก provider ตัวแรกที่รองรับ (ดู providers.js)
  function watchMatch(it, details = null) { return window.Providers?.find(it, details) || null; }
  function watchHref(it, details = null) {
    const m = watchMatch(it, details);
    return m ? window.Providers.watchUrl(m.provider.id, m.key) : '';
  }

  const dateTh = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  };

  function cardHtml(it, { isNew = false, showAdded = false } = {}) {
    const sub = [
      it.year,
      it.rating ? `<b>★ ${esc(it.rating)}</b>` : '',
      it.type === 'tv' ? 'ซีรีส์' : '',
      showAdded && it.added ? `เพิ่ม ${esc(dateTh(it.added))}` : ''
    ].filter(Boolean).join(' · ');
    const href = watchHref(it);
    return `
      <a class="card" href="${esc(href)}" data-card="${esc(keyOf(it))}" aria-label="${esc(it.title)}">
        <div class="poster">
          ${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy" onload="this.classList.add('ok')" onerror="this.remove()">` : ''}
          <span class="ph">${esc(it.title)}</span>
          <div class="badges">${isNew ? '<span class="badge new">NEW</span>' : ''}${it.free ? '<span class="badge free">ดูฟรี</span>' : '<span class="badge trailer">ตัวอย่าง</span>'}</div>
          <span class="play-hint">${ICON.play}</span>
        </div>
        <span class="title">${esc(it.title)}</span>
        <span class="sub">${sub || '&nbsp;'}</span>
      </a>`;
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  return {
    $, esc, store, first, stripHtml, debounce, ICON, settings,
    tmdb, normTmdb, pickTrailer, watchOptions, watchOptionsHtml, IMG,
    IA, ARCHIVE_MAX_YEAR, ARCHIVE_BLOCKED, archiveSearch, normArchive,
    items, keyOf, remember, dedupe, watchMatch, watchHref, cardHtml, dateTh, toast
  };
})();
