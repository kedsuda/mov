(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }
  };
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const stripHtml = (s) => new DOMParser().parseFromString(String(s || ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const timeNow = () => new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const ICON_INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
  const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

  // ---------- State ----------
  const cfg = window.CONFIG || {};
  const state = {
    key: store.get('tmdbKey', '') || cfg.TMDB_KEY || '',
    region: store.get('region', cfg.REGION || 'TH'),
    lang: store.get('lang', cfg.LANGUAGE || 'th-TH'),
    seen: new Set(store.get('seenIds', [])),
    items: new Map(),
    hero: [], heroIndex: 0, heroTimer: null,
    lastRefresh: 0, refreshing: false
  };
  const REFRESH_MS = (cfg.REFRESH_MINUTES || 5) * 60 * 1000;

  // ---------- APIs ----------
  const TMDB = 'https://api.themoviedb.org/3';
  const IMG = 'https://image.tmdb.org/t/p/';
  const IA = 'https://archive.org';
  const IA_BASE = 'collection:(feature_films) AND mediatype:(movies)';

  async function tmdb(path, params = {}) {
    const url = new URL(TMDB + path);
    const bearer = state.key.startsWith('eyJ');
    if (!bearer) url.searchParams.set('api_key', state.key);
    url.searchParams.set('language', state.lang);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: bearer ? { Authorization: 'Bearer ' + state.key } : {} });
    if (res.status === 401) throw Object.assign(new Error('TMDB key invalid'), { auth: true });
    if (!res.ok) throw new Error('TMDB ' + res.status);
    return res.json();
  }

  async function archive(query, sort, rows = 30) {
    const url = new URL(IA + '/advancedsearch.php');
    url.searchParams.set('q', query);
    ['identifier', 'title', 'year', 'description', 'downloads'].forEach((f) => url.searchParams.append('fl[]', f));
    url.searchParams.append('sort[]', sort);
    url.searchParams.set('rows', rows);
    url.searchParams.set('output', 'json');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Archive ' + res.status);
    const data = await res.json();
    return data.response.docs.map(normArchive);
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

  function normArchive(d) {
    const id = d.identifier;
    return remember({
      src: 'ia', type: 'movie', id,
      title: stripHtml(first(d.title)) || id,
      year: d.year ? String(first(d.year)) : '',
      rating: '',
      poster: `${IA}/services/img/${encodeURIComponent(id)}`,
      backdrop: `${IA}/services/img/${encodeURIComponent(id)}`,
      overview: stripHtml(first(d.description)),
      free: true
    });
  }

  const keyOf = (it) => `${it.src}:${it.type}:${it.id}`;
  function remember(it) { state.items.set(keyOf(it), it); return it; }

  // ---------- Rows ----------
  const ROWS = [
    { id: 'trending', kicker: 'Trending Today', title: 'กำลังมาแรงวันนี้', tmdb: true,
      load: () => tmdb('/trending/movie/day').then((d) => d.results.map((m) => normTmdb(m, 'movie'))) },
    { id: 'free', kicker: 'Watch Free · No Ads', title: 'ดูฟรีเต็มเรื่อง · คลาสสิกอมตะ', sub: 'ภาพยนตร์สาธารณสมบัติ เล่นได้ทันทีบนเว็บนี้', wide: true,
      load: () => archive(IA_BASE, 'downloads desc', 40) },
    { id: 'now', kicker: 'Now Showing', title: 'กำลังเข้าฉายในโรง', tmdb: true,
      load: () => tmdb('/movie/now_playing', { region: state.region }).then((d) => d.results.map((m) => normTmdb(m, 'movie'))) },
    { id: 'upcoming', kicker: 'Coming Soon', title: 'เร็วๆ นี้', tmdb: true,
      load: () => tmdb('/movie/upcoming', { region: state.region }).then((d) => d.results.map((m) => normTmdb(m, 'movie'))) },
    { id: 'fresh', kicker: 'Fresh in the Vault', title: 'เพิ่งเพิ่มเข้าคลังหนังฟรี', wide: true,
      load: () => archive(IA_BASE, 'addeddate desc', 30) },
    { id: 'tv', kicker: 'Series of the Week', title: 'ซีรีส์ยอดนิยมสัปดาห์นี้', tmdb: true,
      load: () => tmdb('/trending/tv/week').then((d) => d.results.map((m) => normTmdb(m, 'tv'))) },
    { id: 'top', kicker: 'Hall of Fame', title: 'คะแนนสูงสุดตลอดกาล', tmdb: true,
      load: () => tmdb('/movie/top_rated').then((d) => d.results.map((m) => normTmdb(m, 'movie'))) }
  ];

  const activeRows = () => ROWS.filter((r) => !r.tmdb || state.key);

  function buildRows() {
    const wrap = $('#rows');
    wrap.innerHTML = activeRows().map((r) => `
      <section class="row${r.wide ? ' wide' : ''}" id="row-${r.id}">
        <header class="row-head">
          <div>
            <span class="kicker">${esc(r.kicker)}</span>
            <h2>${esc(r.title)}</h2>
            ${r.sub ? `<div class="row-sub">${esc(r.sub)}</div>` : ''}
          </div>
          <div class="row-nav">
            <button class="icon-btn" data-scroll="-1" aria-label="เลื่อนซ้าย">${ICON_PREV}</button>
            <button class="icon-btn" data-scroll="1" aria-label="เลื่อนขวา">${ICON_NEXT}</button>
          </div>
        </header>
        <div class="track">${'<div class="skeleton sk-card"></div>'.repeat(8)}</div>
      </section>`).join('');
    $('#keyNotice').hidden = !!state.key;
  }

  function cardHtml(it, markNew) {
    const isNew = markNew && !state.seen.has(keyOf(it));
    const sub = [it.year, it.rating ? `<b>★ ${esc(it.rating)}</b>` : '', it.type === 'tv' ? 'ซีรีส์' : ''].filter(Boolean).join(' · ');
    return `
      <button class="card" data-key="${esc(keyOf(it))}" aria-label="${esc(it.title)}">
        <div class="poster">
          ${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy" onload="this.classList.add('ok')" onerror="this.remove()">` : ''}
          <span class="ph">${esc(it.title)}</span>
          <div class="badges">${isNew ? '<span class="badge new">NEW</span>' : ''}${it.free ? '<span class="badge free">FREE</span>' : ''}</div>
          <span class="play-hint">${ICON_PLAY}</span>
        </div>
        <span class="title">${esc(it.title)}</span>
        <span class="sub">${sub || '&nbsp;'}</span>
      </button>`;
  }

  async function loadRow(r, markNew) {
    const track = $(`#row-${r.id} .track`);
    if (!track) return [];
    try {
      const items = (await r.load()).filter((it) => it.title);
      const scrollLeft = track.scrollLeft;
      track.innerHTML = items.map((it) => cardHtml(it, markNew)).join('');
      track.scrollLeft = scrollLeft;
      return items;
    } catch (err) {
      if (err.auth) handleBadKey();
      if (!track.querySelector('.card')) track.outerHTML = '<p class="row-error">โหลดรายการนี้ไม่สำเร็จ ลองใหม่อีกครั้งในภายหลัง</p>';
      return [];
    }
  }

  async function refresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    const live = $('#liveStatus');
    live.classList.add('loading');
    const markNew = state.seen.size > 0;
    const results = await Promise.all(activeRows().map((r) => loadRow(r, markNew).then((items) => [r.id, items])));
    const byId = Object.fromEntries(results);

    // Hero: prefer trending (with backdrop), otherwise free classics.
    const heroPool = (byId.trending?.length ? byId.trending : byId.free || []).filter((it) => it.backdrop).slice(0, 6);
    if (heroPool.length) setHero(heroPool);

    const all = results.flatMap(([, items]) => items.map(keyOf));
    all.forEach((k) => state.seen.add(k));
    store.set('seenIds', [...state.seen].slice(-3000));

    state.lastRefresh = Date.now();
    state.refreshing = false;
    live.classList.remove('loading');
    live.querySelector('span').textContent = 'LIVE · ' + timeNow();
    live.title = 'อัปเดตล่าสุด ' + timeNow() + ' · รีเฟรชอัตโนมัติทุก ' + (cfg.REFRESH_MINUTES || 5) + ' นาที';
  }

  // ---------- Hero ----------
  function setHero(items) {
    const sameSet = items.map(keyOf).join() === state.hero.map(keyOf).join();
    state.hero = items;
    if (!sameSet) state.heroIndex = 0;
    $('#heroDots').innerHTML = items.map((_, i) => `<button aria-label="สไลด์ ${i + 1}" data-hero="${i}"></button>`).join('');
    showHero(state.heroIndex, !sameSet);
    clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => showHero((state.heroIndex + 1) % state.hero.length, true), 9000);
  }

  function showHero(i, animate) {
    const it = state.hero[i];
    if (!it) return;
    state.heroIndex = i;
    const bg = $('#heroBg');
    const content = $('#heroContent');
    const apply = () => {
      bg.style.backgroundImage = `url("${it.backdrop.replace('w1280', 'original')}")`;
      bg.classList.remove('fade');
      content.innerHTML = `
        <span class="kicker">${it.free ? 'ดูฟรีเต็มเรื่อง' : 'กำลังมาแรงวันนี้'}</span>
        <h1>${esc(it.title)}</h1>
        <div class="meta-line">
          ${it.rating ? `<span class="rating">★ ${esc(it.rating)}</span>` : ''}
          ${it.year ? `<span>${esc(it.year)}</span>` : ''}
          ${it.free ? '<span class="pill">FREE · NO ADS</span>' : '<span class="pill">HD Trailer</span>'}
        </div>
        <p class="overview">${esc(it.overview || 'ดูรายละเอียดเพิ่มเติม')}</p>
        <div class="actions">
          <button class="btn btn-gold" data-key="${esc(keyOf(it))}" data-autoplay="1">${ICON_PLAY}${it.free ? 'เล่นเลย' : 'ดูตัวอย่าง'}</button>
          <button class="btn btn-ghost" data-key="${esc(keyOf(it))}">${ICON_INFO}รายละเอียด</button>
        </div>`;
      content.classList.remove('swap');
      [...$('#heroDots').children].forEach((d, j) => d.classList.toggle('on', j === i));
    };
    if (animate && bg.style.backgroundImage) {
      bg.classList.add('fade');
      content.classList.add('swap');
      setTimeout(apply, 600);
    } else apply();
  }

  // ---------- Detail modal ----------
  let lastFocus = null;
  function openModal(el) {
    lastFocus = document.activeElement;
    el.hidden = false;
    document.body.classList.add('locked');
    el.querySelector('.modal-close')?.focus({ preventScroll: true });
  }
  function closeModal(el) {
    el.hidden = true;
    if (el.id === 'modal') $('#modalBody').innerHTML = '';
    if ($('#modal').hidden && $('#settings').hidden) document.body.classList.remove('locked');
    lastFocus?.focus?.({ preventScroll: true });
  }

  async function openDetail(key, autoplay) {
    const it = state.items.get(key);
    if (!it) return;
    const body = $('#modalBody');
    body.innerHTML = '<div class="d-loading"><div class="spinner"></div></div>';
    openModal($('#modal'));
    if (it.src === 'ia') return renderArchiveDetail(it, autoplay);
    try {
      await renderTmdbDetail(it, autoplay);
    } catch (err) {
      if (err.auth) handleBadKey();
      body.innerHTML = `<div class="d-body" style="margin-top:0;padding-top:60px"><h2>${esc(it.title)}</h2><p class="muted">โหลดรายละเอียดไม่สำเร็จ</p></div>`;
    }
  }

  function playInto(media, src, title) {
    media.classList.add('playing');
    media.innerHTML = `<iframe src="${esc(src)}" title="${esc(title)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }

  function renderArchiveDetail(it, autoplay) {
    const page = `${IA}/details/${encodeURIComponent(it.id)}`;
    $('#modalBody').innerHTML = `
      <div class="d-media" style="background-image:url('${esc(it.backdrop)}')">
        <button class="big-play" aria-label="เล่นภาพยนตร์">${ICON_PLAY}</button>
      </div>
      <div class="d-body">
        <span class="kicker">Free · Public Domain · No Ads</span>
        <h2 id="modalTitle">${esc(it.title)}</h2>
        <div class="meta-line">
          ${it.year ? `<span>${esc(it.year)}</span>` : ''}
          <span class="pill">ดูฟรีเต็มเรื่อง</span>
        </div>
        <p class="overview">${esc(it.overview || 'ภาพยนตร์คลาสสิกจากคลัง Internet Archive')}</p>
        <div class="d-section">
          <h3>แหล่งที่มา</h3>
          <p class="muted">ภาพยนตร์เรื่องนี้เผยแพร่ผ่าน <a href="${esc(page)}" target="_blank" rel="noopener">Internet Archive</a> ในฐานะสาธารณสมบัติหรือได้รับอนุญาตให้เผยแพร่</p>
        </div>
      </div>`;
    const media = $('#modalBody .d-media');
    const play = () => playInto(media, `${IA}/embed/${encodeURIComponent(it.id)}?autoplay=1`, it.title);
    media.querySelector('.big-play').addEventListener('click', play);
    if (autoplay) play();
  }

  function pickTrailer(videos) {
    const yt = (videos?.results || []).filter((v) => v.site === 'YouTube');
    return yt.find((v) => v.type === 'Trailer' && v.official) || yt.find((v) => v.type === 'Trailer') || yt.find((v) => v.type === 'Teaser') || yt[0];
  }

  async function renderTmdbDetail(it, autoplay) {
    const d = await tmdb(`/${it.type}/${it.id}`, {
      append_to_response: 'videos,credits,watch/providers',
      include_video_language: `${state.lang.slice(0, 2)},en,null`
    });
    let overview = d.overview;
    if (!overview && state.lang !== 'en-US') {
      overview = (await tmdb(`/${it.type}/${it.id}`, { language: 'en-US' }).catch(() => ({}))).overview;
    }
    const trailer = pickTrailer(d.videos);
    const title = d.title || d.name || it.title;
    const date = d.release_date || d.first_air_date || '';
    const runtime = d.runtime ? `${Math.floor(d.runtime / 60)} ชม. ${d.runtime % 60} นาที` : (d.number_of_seasons ? `${d.number_of_seasons} ซีซัน` : '');
    const backdrop = d.backdrop_path ? IMG + 'w1280' + d.backdrop_path : it.backdrop || it.poster;

    const wp = d['watch/providers']?.results || {};
    const regionData = wp[state.region] || wp.US;
    const providers = [];
    const seenP = new Set();
    [['flatrate', 'สตรีมมิ่ง'], ['free', 'ดูฟรี'], ['ads', 'ดูฟรี (มีโฆษณา)'], ['rent', 'เช่า'], ['buy', 'ซื้อ']].forEach(([k, label]) => {
      (regionData?.[k] || []).forEach((p) => {
        if (seenP.has(p.provider_id)) return;
        seenP.add(p.provider_id);
        providers.push({ ...p, label });
      });
    });
    const providerHtml = providers.length
      ? `<div class="providers">${providers.slice(0, 12).map((p) => `
          <a class="provider" href="${esc(regionData.link)}" target="_blank" rel="noopener">
            <img src="${IMG}w92${esc(p.logo_path)}" alt="" loading="lazy">
            <span>${esc(p.provider_name)}<small>${esc(p.label)}</small></span>
          </a>`).join('')}</div>
         <p class="muted" style="margin-top:12px">ข้อมูลช่องทางรับชมโดย JustWatch${wp[state.region] ? '' : ' (แสดงข้อมูลของสหรัฐฯ)'}</p>`
      : '<p class="muted">ยังไม่มีช่องทางรับชมออนไลน์อย่างเป็นทางการในภูมิภาคนี้ — หากกำลังฉาย ชมได้ที่โรงภาพยนตร์ใกล้บ้านคุณ</p>';

    const cast = (d.credits?.cast || []).slice(0, 12);
    const castHtml = cast.length ? `
      <div class="d-section"><h3>นักแสดง</h3><div class="cast">${cast.map((c) => `
        <figure>
          ${c.profile_path ? `<img src="${IMG}w185${esc(c.profile_path)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
          <figcaption>${esc(c.name)}<small>${esc(c.character || '')}</small></figcaption>
        </figure>`).join('')}</div></div>` : '';

    $('#modalBody').innerHTML = `
      <div class="d-media" style="background-image:url('${esc(backdrop)}')">
        ${trailer ? `<button class="big-play" aria-label="เล่นตัวอย่าง">${ICON_PLAY}</button>` : ''}
      </div>
      <div class="d-body">
        <span class="kicker">${it.type === 'tv' ? 'Series' : 'Feature Film'}</span>
        <h2 id="modalTitle">${esc(title)}</h2>
        ${d.tagline ? `<p class="tagline">${esc(d.tagline)}</p>` : ''}
        <div class="meta-line">
          ${d.vote_average ? `<span class="rating">★ ${d.vote_average.toFixed(1)}</span>` : ''}
          ${date ? `<span>${esc(new Date(date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }))}</span>` : ''}
          ${runtime ? `<span>${esc(runtime)}</span>` : ''}
          ${trailer ? '<span class="pill">มีตัวอย่าง</span>' : ''}
        </div>
        <div class="genres">${(d.genres || []).map((g) => `<span>${esc(g.name)}</span>`).join('')}</div>
        <p class="overview">${esc(overview || 'ยังไม่มีเรื่องย่อ')}</p>
        ${trailer ? `<div class="actions" style="margin-top:22px"><button class="btn btn-gold" data-play-trailer>${ICON_PLAY}ดูตัวอย่าง</button></div>` : ''}
        <div class="d-section"><h3>ดูได้ที่ไหน (ถูกลิขสิทธิ์)</h3>${providerHtml}</div>
        ${castHtml}
      </div>`;

    if (trailer) {
      const media = $('#modalBody .d-media');
      const play = () => {
        playInto(media, `https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=1&rel=0&modestbranding=1`, title);
        $('#modal .modal-panel').scrollTop = 0;
      };
      media.querySelector('.big-play').addEventListener('click', play);
      $('#modalBody [data-play-trailer]').addEventListener('click', play);
      if (autoplay) play();
    }
  }

  // ---------- Search ----------
  let searchSeq = 0;
  async function runSearch(q) {
    q = q.trim();
    if (q.length < 2) return clearSearch(false);
    const seq = ++searchSeq;
    document.body.classList.add('searching');
    $('#searchView').hidden = false;
    $('#searchTitle').textContent = `ผลการค้นหา “${q}”`;
    $('#searchGrid').innerHTML = '<div class="skeleton sk-card"></div>'.repeat(12);
    window.scrollTo({ top: 0 });

    const safe = q.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    const tasks = [
      state.key
        ? tmdb('/search/multi', { query: q, include_adult: 'false' })
          .then((d) => d.results.filter((m) => m.media_type === 'movie' || m.media_type === 'tv').map((m) => normTmdb(m)))
          .catch(() => [])
        : Promise.resolve([]),
      safe ? archive(`title:(${safe}) AND ${IA_BASE}`, 'downloads desc', 24).catch(() => []) : Promise.resolve([])
    ];
    const [a, b] = await Promise.all(tasks);
    if (seq !== searchSeq) return;
    const items = [...a, ...b];
    $('#searchGrid').innerHTML = items.length
      ? items.map((it) => cardHtml(it, false)).join('')
      : '<p class="empty">ไม่พบผลลัพธ์ ลองใช้ชื่อภาษาอังกฤษหรือคำค้นอื่น</p>';
  }

  function clearSearch(resetInput = true) {
    searchSeq++;
    if (resetInput) $('#searchInput').value = '';
    document.body.classList.remove('searching');
    $('#searchView').hidden = true;
  }

  // ---------- Settings ----------
  function openSettings() {
    $('#keyInput').value = state.key;
    $('#regionInput').value = state.region;
    $('#langInput').value = state.lang;
    openModal($('#settings'));
    setTimeout(() => $('#keyInput').focus(), 50);
  }

  let warnedKey = false;
  function handleBadKey() {
    if (warnedKey) return;
    warnedKey = true;
    toast('TMDB API Key ไม่ถูกต้อง กรุณาตรวจสอบในหน้าตั้งค่า');
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  // ---------- Events ----------
  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-key]');
    if (card) { openDetail(card.dataset.key, card.dataset.autoplay === '1'); return; }
    const close = e.target.closest('[data-close]');
    if (close) { closeModal(close.closest('.modal')); return; }
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      const track = scroll.closest('.row').querySelector('.track');
      track?.scrollBy({ left: Number(scroll.dataset.scroll) * track.clientWidth * 0.85, behavior: 'smooth' });
      return;
    }
    const dot = e.target.closest('[data-hero]');
    if (dot) {
      showHero(Number(dot.dataset.hero), true);
      clearInterval(state.heroTimer);
      state.heroTimer = setInterval(() => showHero((state.heroIndex + 1) % state.hero.length, true), 9000);
      return;
    }
    if (e.target.closest('[data-open-settings]')) openSettings();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal')].reverse().find((m) => !m.hidden);
    if (open) closeModal(open);
    else if (document.body.classList.contains('searching')) clearSearch();
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.key = $('#keyInput').value.trim();
    state.region = $('#regionInput').value;
    state.lang = $('#langInput').value;
    store.set('tmdbKey', state.key);
    store.set('region', state.region);
    store.set('lang', state.lang);
    warnedKey = false;
    closeModal($('#settings'));
    toast('บันทึกแล้ว กำลังโหลดข้อมูลใหม่…');
    buildRows();
    refresh();
  });

  $('#searchInput').addEventListener('input', debounce((e) => runSearch(e.target.value), 450));
  $('#clearSearch').addEventListener('click', () => clearSearch());

  const topbar = $('#topbar');
  const onScroll = () => topbar.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Real-time: periodic refresh + refresh when the tab becomes visible again.
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.lastRefresh > 2 * 60 * 1000) refresh();
  });

  // ---------- Boot ----------
  buildRows();
  refresh();
})();
