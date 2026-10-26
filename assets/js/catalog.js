// หมวดหมู่ + ตารางโปสเตอร์ + แบ่งหน้า + ค้นหา + แถบ "เพิ่มเข้ามาล่าสุด"
window.Catalog = (() => {
  'use strict';

  const L = window.Lumiere;
  const { $, esc } = L;
  const MAX_TMDB_PAGES = 500; // ข้อจำกัดของ TMDB
  const PAGE_SIZE = 20;

  const today = () => new Date().toISOString().slice(0, 10);
  const openIds = (genre) => window.Providers.OPEN_FILMS.filter((f) => !genre || f.genres.includes(genre)).map((f) => f.archive);
  const FEATURES = 'collection:(feature_films)';

  // แต่ละหมวดมี 2 แหล่ง: tmdb = หนังทั้งหมด (ตัวอย่าง + ช่องทางรับชม), free = ดูฟรีเต็มเรื่อง
  const CATS = [
    { id: 'new', label: 'หนังใหม่',
      tmdb: { path: '/discover/movie', params: () => ({ sort_by: 'primary_release_date.desc', 'primary_release_date.lte': today(), 'vote_count.gte': 10 }) },
      free: { q: FEATURES, sort: 'year desc' } },
    { id: 'action', label: 'แอ็กชัน',
      tmdb: { path: '/discover/movie', params: () => ({ with_genres: 28, sort_by: 'popularity.desc' }) },
      free: { q: `${FEATURES} AND subject:(action OR adventure OR western OR swashbuckler)`, ids: () => openIds('action') } },
    { id: 'comedy', label: 'ตลก',
      tmdb: { path: '/discover/movie', params: () => ({ with_genres: 35, sort_by: 'popularity.desc' }) },
      free: { q: `${FEATURES} AND subject:(comedy)`, ids: () => openIds('comedy') } },
    { id: 'horror', label: 'สยองขวัญ',
      tmdb: { path: '/discover/movie', params: () => ({ with_genres: 27, sort_by: 'popularity.desc' }) },
      free: { q: `${FEATURES} AND subject:(horror)` } },
    { id: 'anime', label: 'อนิเมะ',
      tmdb: { path: '/discover/movie', params: () => ({ with_genres: 16, with_original_language: 'ja', sort_by: 'popularity.desc' }) },
      free: { q: 'collection:(animationandcartoons)', ids: () => openIds('anime') } },
    { id: 'scifi', label: 'ไซไฟ',
      tmdb: { path: '/discover/movie', params: () => ({ with_genres: 878, sort_by: 'popularity.desc' }) },
      free: { q: `${FEATURES} AND subject:("science fiction" OR "sci-fi" OR scifi)`, ids: () => openIds('scifi') } }
  ];

  const hasKey = () => !!L.settings.key;
  const params = new URLSearchParams(location.search);
  const state = {
    cat: CATS.some((c) => c.id === params.get('cat')) ? params.get('cat') : 'new',
    source: params.get('src') === 'free' || params.get('src') === 'tmdb' ? params.get('src') : null,
    page: Math.max(1, parseInt(params.get('page'), 10) || 1),
    q: params.get('q') || '',
    pages: 1,
    shown: new Set(),
    seq: 0
  };
  const latest = new Map(); // key → item (แถบเพิ่มเข้ามาล่าสุด)
  const source = () => (state.source === 'tmdb' && !hasKey() ? 'free' : state.source || (hasKey() ? 'tmdb' : 'free'));
  const cat = () => CATS.find((c) => c.id === state.cat);

  // ---------- Fetch ----------
  async function fetchView(view) {
    const src = view.source;
    if (view.q) {
      if (src === 'tmdb') {
        const d = await L.tmdb('/search/multi', { query: view.q, page: view.page, include_adult: 'false' });
        return {
          items: d.results.filter((m) => m.media_type === 'movie' || m.media_type === 'tv').map((m) => L.normTmdb(m)),
          pages: Math.min(d.total_pages || 1, MAX_TMDB_PAGES), total: d.total_results
        };
      }
      const safe = view.q.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
      if (!safe) return { items: [], pages: 1, total: 0 };
      return L.archiveSearch({ q: `title:(${safe}) AND collection:(feature_films OR animationandcartoons)`, page: view.page, rows: PAGE_SIZE });
    }
    const c = CATS.find((x) => x.id === view.cat);
    if (src === 'tmdb') {
      const d = await L.tmdb(c.tmdb.path, { ...c.tmdb.params(), include_adult: 'false', page: view.page });
      return { items: d.results.map((m) => L.normTmdb(m, 'movie')), pages: Math.min(d.total_pages || 1, MAX_TMDB_PAGES), total: d.total_results };
    }
    return L.archiveSearch({ q: c.free.q, ids: c.free.ids ? c.free.ids() : [], sort: c.free.sort || 'downloads desc', page: view.page, rows: PAGE_SIZE });
  }

  // ---------- Render ----------
  function renderHead() {
    const src = source();
    $('#catalogTitle').textContent = state.q ? `ผลการค้นหา “${state.q}”` : cat().label;
    $('#catalogSub').textContent = src === 'tmdb'
      ? 'ข้อมูลจาก TMDB · กดโปสเตอร์เพื่อดูตัวอย่างและช่องทางรับชมที่ถูกลิขสิทธิ์'
      : 'ดูฟรีเต็มเรื่อง · ภาพยนตร์สาธารณสมบัติและ Creative Commons';
    document.querySelectorAll('[data-cat]').forEach((b) => {
      const on = !state.q && b.dataset.cat === state.cat;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('[data-source]').forEach((b) => {
      const on = b.dataset.source === src;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      if (b.dataset.source === 'tmdb') {
        b.disabled = !hasKey();
        b.title = hasKey() ? '' : 'ต้องใส่ TMDB API Key ก่อน';
      }
    });
    $('#clearSearch').hidden = !state.q;
  }

  function renderPager() {
    const pager = $('#pager');
    const { page, pages } = state;
    if (pages <= 1) { pager.innerHTML = ''; return; }
    const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages));
    const sorted = [...nums].sort((a, b) => a - b);
    let html = `<button class="pg" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="หน้าก่อนหน้า">${L.ICON.prev}</button>`;
    sorted.forEach((n, i) => {
      if (i && n - sorted[i - 1] > 1) html += '<span class="pg-gap">…</span>';
      html += `<button class="pg${n === page ? ' on' : ''}" data-page="${n}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`;
    });
    html += `<button class="pg" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="หน้าถัดไป">${L.ICON.next}</button>`;
    pager.innerHTML = html;
  }

  function showError(err) {
    const box = $('#catalogError');
    const needKey = err.noKey || err.auth;
    box.innerHTML = `
      <span class="err-icon">${L.ICON.alert}</span>
      <div>
        <strong>โหลดรายการหนังไม่สำเร็จ</strong>
        <p>${esc(err.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ')}</p>
      </div>
      <div class="actions">
        ${needKey ? '<button class="btn btn-gold btn-sm" data-open-settings>ตั้งค่า API Key</button>' : ''}
        <button class="btn btn-ghost btn-sm" data-catalog-retry>ลองอีกครั้ง</button>
      </div>`;
    box.hidden = false;
  }

  function syncUrl() {
    const p = new URLSearchParams(location.search);
    const set = (k, v, def) => (v && v !== def ? p.set(k, v) : p.delete(k));
    set('cat', state.q ? '' : state.cat, 'new');
    set('src', state.source || '', '');
    set('page', String(state.page), '1');
    set('q', state.q, '');
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  // silent = อัปเดตอัตโนมัติ: คงรายการเดิมไว้ถ้าโหลดไม่สำเร็จ และติดป้าย NEW ให้เรื่องที่เพิ่งปรากฏ
  async function load({ silent = false } = {}) {
    const seq = ++state.seq;
    const view = { cat: state.cat, q: state.q, page: state.page, source: source() };
    const grid = $('#catalogGrid');
    renderHead();
    syncUrl();
    if (!silent) {
      $('#catalogError').hidden = true;
      grid.innerHTML = '<div class="skeleton sk-card"></div>'.repeat(PAGE_SIZE);
      grid.setAttribute('aria-busy', 'true');
    }
    try {
      const res = await fetchView(view);
      if (seq !== state.seq) return true;
      const items = L.dedupe(res.items.filter((it) => it.title));
      state.pages = Math.max(1, res.pages || 1);
      const prev = state.shown;
      state.shown = new Set(items.map(L.keyOf));
      grid.innerHTML = items.length
        ? items.map((it) => L.cardHtml(it, { isNew: silent && !prev.has(L.keyOf(it)) })).join('')
        : `<p class="empty">${view.q ? 'ไม่พบผลลัพธ์ ลองใช้ชื่อภาษาอังกฤษหรือคำค้นอื่น' : 'ยังไม่มีหนังในหมวดนี้'}</p>`;
      $('#catalogError').hidden = true;
      renderPager();
      return true;
    } catch (err) {
      if (seq !== state.seq) return true;
      if (silent && grid.querySelector('.card')) return false;
      grid.innerHTML = '';
      $('#pager').innerHTML = '';
      showError(err);
      return false;
    } finally {
      if (seq === state.seq) grid.removeAttribute('aria-busy');
    }
  }

  // ---------- Latest strip ----------
  async function loadLatest({ silent = false } = {}) {
    const track = $('#latestTrack');
    try {
      const res = await L.archiveSearch({ q: 'collection:(feature_films OR animationandcartoons)', sort: 'addeddate desc', rows: 24 });
      const firstLoad = latest.size === 0;
      const fresh = new Set();
      res.items.forEach((it) => {
        const k = L.keyOf(it);
        if (!latest.has(k) && !firstLoad) fresh.add(k);
        latest.set(k, it);
      });
      const sorted = [...latest.values()].sort((a, b) => String(b.added).localeCompare(String(a.added))).slice(0, 40);
      latest.clear();
      sorted.forEach((it) => latest.set(L.keyOf(it), it));
      const scrollLeft = track.scrollLeft;
      track.innerHTML = sorted.map((it) => L.cardHtml(it, { isNew: fresh.has(L.keyOf(it)), showAdded: true })).join('');
      track.scrollLeft = scrollLeft;
      $('#latestError').hidden = true;
      return true;
    } catch (err) {
      if (silent && latest.size) return false;
      track.innerHTML = '';
      $('#latestError').innerHTML = `${esc(err.message)} <button class="link-btn" data-latest-retry>ลองอีกครั้ง</button>`;
      $('#latestError').hidden = false;
      return false;
    }
  }

  // ---------- Events ----------
  function go(changes) {
    Object.assign(state, changes);
    load();
  }
  const scrollToCatalog = () => $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });

  function bind() {
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-cat]');
      if (c) {
        $('#searchInput').value = '';
        document.body.classList.remove('searching');
        go({ cat: c.dataset.cat, q: '', page: 1 });
        if (c.closest('.nav')) scrollToCatalog();
        return;
      }
      const s = e.target.closest('[data-source]');
      if (s && !s.disabled) { go({ source: s.dataset.source, page: 1 }); return; }
      const p = e.target.closest('[data-page]');
      if (p && !p.disabled) { go({ page: Number(p.dataset.page) }); scrollToCatalog(); return; }
      if (e.target.closest('[data-catalog-retry]')) { load(); return; }
      if (e.target.closest('[data-latest-retry]')) { loadLatest(); return; }
      if (e.target.closest('#clearSearch')) clearSearch();
    });
    $('#searchInput').addEventListener('input', L.debounce((e) => search(e.target.value), 450));
  }

  function search(q) {
    q = q.trim();
    if (q.length < 2) { if (state.q) clearSearch(false); return; }
    document.body.classList.add('searching');
    go({ q, page: 1 });
    window.scrollTo({ top: 0 });
  }

  function clearSearch(resetInput = true) {
    if (resetInput) $('#searchInput').value = '';
    document.body.classList.remove('searching');
    go({ q: '', page: 1 });
  }

  function init() {
    bind();
    if (state.q) {
      $('#searchInput').value = state.q;
      document.body.classList.add('searching');
    }
    return Promise.all([load(), loadLatest()]);
  }

  // เรียกจาก app.js ทุกครั้งที่ถึงรอบอัปเดตอัตโนมัติ
  async function refresh() {
    const results = await Promise.all([load({ silent: true }), loadLatest({ silent: true })]);
    return results.every(Boolean);
  }

  function onSettingsChanged() {
    state.page = 1;
    load();
  }

  return { init, refresh, onSettingsChanged, CATS };
})();
