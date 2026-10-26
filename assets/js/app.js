(() => {
  'use strict';

  const L = window.Lumiere;
  const { $, esc, store, ICON } = L;
  const timeNow = () => new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const state = {
    seen: new Set(store.get('seenIds', [])),
    hero: [], heroIndex: 0, heroTimer: null,
    lastRefresh: 0, refreshing: false
  };

  // ---------- Rows (ไฮไลต์) ----------
  const tmdbList = (path, params, type = 'movie') => () => L.tmdb(path, params?.() || {}).then((d) => d.results.map((m) => L.normTmdb(m, type)));
  // ลำดับ: หนังที่ดูเต็มเรื่องได้บนเว็บนี้ก่อน → ดูฟรีถูกกฎหมายที่บริการอื่น → หนังใหม่/ยอดนิยม (ตัวอย่าง)
  const ROWS = [
    { id: 'open', kicker: 'Full Movies · Creative Commons', title: 'ดูเต็มเรื่อง · ภาพยนตร์จาก Blender Studio', sub: 'แอนิเมชันและไซไฟคุณภาพสูง เล่นเต็มเรื่องได้ทันที ไม่มีโฆษณา', wide: true,
      load: () => L.archiveSearch({ ids: window.Providers.OPEN_FILMS.map((f) => f.archive) }).then((r) => r.items) },
    { id: 'free', kicker: 'Full Movies · Public Domain', title: 'ดูเต็มเรื่องฟรี · คลาสสิกอมตะ', sub: 'ภาพยนตร์สาธารณสมบัติ เล่นเต็มเรื่องได้ทันทีบนเว็บนี้', wide: true,
      load: () => L.archiveSearch({ q: 'collection:(feature_films)', rows: 40 }).then((r) => r.items) },
    { id: 'external', kicker: 'Watch Free Elsewhere · Legal', title: 'ดูฟรีถูกกฎหมายบนบริการอื่น', sub: 'ข้อมูลจาก JustWatch · กดเพื่อดูตัวอย่างและไปยังบริการที่ให้ชมเต็มเรื่องฟรี', tmdb: true,
      load: () => L.tmdb('/discover/movie', { watch_region: L.settings.region, with_watch_monetization_types: 'free|ads', sort_by: 'popularity.desc' })
        .then((d) => d.results.map((m) => L.normTmdb(m, 'movie', 'external'))) },
    { id: 'trending', kicker: 'Trending Today', title: 'กำลังมาแรงวันนี้', tmdb: true, load: tmdbList('/trending/movie/day') },
    { id: 'now', kicker: 'Now Showing', title: 'กำลังเข้าฉายในโรง', tmdb: true, load: tmdbList('/movie/now_playing', () => ({ region: L.settings.region })) },
    { id: 'upcoming', kicker: 'Coming Soon', title: 'เร็วๆ นี้', tmdb: true, load: tmdbList('/movie/upcoming', () => ({ region: L.settings.region })) },
    { id: 'tv', kicker: 'Series of the Week', title: 'ซีรีส์ยอดนิยมสัปดาห์นี้', tmdb: true, load: tmdbList('/trending/tv/week', null, 'tv') },
    { id: 'top', kicker: 'Hall of Fame', title: 'คะแนนสูงสุดตลอดกาล', tmdb: true, load: tmdbList('/movie/top_rated') }
  ];
  const activeRows = () => ROWS.filter((r) => !r.tmdb || L.settings.key);

  function buildRows() {
    $('#rows').innerHTML = activeRows().map((r) => `
      <section class="row${r.wide ? ' wide' : ''}" id="row-${r.id}">
        <header class="row-head">
          <div>
            <span class="kicker">${esc(r.kicker)}</span>
            <h2>${esc(r.title)}</h2>
            ${r.sub ? `<div class="row-sub">${esc(r.sub)}</div>` : ''}
          </div>
          <div class="row-nav">
            <button class="icon-btn" data-scroll="-1" aria-label="เลื่อนซ้าย">${ICON.prev}</button>
            <button class="icon-btn" data-scroll="1" aria-label="เลื่อนขวา">${ICON.next}</button>
          </div>
        </header>
        <div class="track">${'<div class="skeleton sk-card"></div>'.repeat(8)}</div>
      </section>`).join('');
    $('#keyNotice').hidden = !!L.settings.key;
  }

  async function loadRow(r, markNew) {
    const section = $(`#row-${r.id}`);
    const track = section?.querySelector('.track');
    if (!track) return { ok: true, items: [] };
    try {
      const items = L.dedupe((await r.load()).filter((it) => it.title));
      const scrollLeft = track.scrollLeft;
      track.innerHTML = items.map((it) => L.cardHtml(it, { isNew: markNew && !state.seen.has(L.keyOf(it)) })).join('');
      track.scrollLeft = scrollLeft;
      section.querySelector('.row-error')?.remove();
      return { ok: true, items };
    } catch (err) {
      if (err.auth) handleBadKey();
      if (!track.querySelector('.card')) {
        track.innerHTML = '';
        if (!section.querySelector('.row-error')) track.insertAdjacentHTML('beforebegin', `<p class="row-error">โหลดรายการนี้ไม่สำเร็จ: ${esc(err.message)}</p>`);
      }
      return { ok: false, items: [] };
    }
  }

  // hero = หนังที่ดูเต็มเรื่องได้ ใช้ภาพพื้นหลังความละเอียดสูงจาก TMDB เมื่อมีคีย์
  async function loadHeroFull() {
    if (state.heroFull?.length || !L.settings.key) return state.heroFull || [];
    const films = window.Providers.OPEN_FILMS.filter((f) => f.tmdb);
    const list = await Promise.all(films.map((f) => L.tmdb(`/movie/${f.tmdb}`, { language: 'en-US' }).then((d) => L.normTmdb(d, 'movie')).catch(() => null)));
    state.heroFull = list.filter((it) => it && it.backdrop);
    return state.heroFull;
  }

  async function loadRows() {
    const markNew = state.seen.size > 0;
    const [results, heroFull] = await Promise.all([
      Promise.all(activeRows().map((r) => loadRow(r, markNew).then((res) => [r.id, res]))),
      loadHeroFull()
    ]);
    const byId = Object.fromEntries(results.map(([id, res]) => [id, res.items]));

    const heroPool = (heroFull.length ? heroFull : byId.open || []).filter((it) => it.backdrop).slice(0, 6);
    if (heroPool.length) setHero(heroPool);

    results.forEach(([, res]) => res.items.forEach((it) => state.seen.add(L.keyOf(it))));
    store.set('seenIds', [...state.seen].slice(-3000));
    return results.every(([, res]) => res.ok);
  }

  // ---------- Real-time refresh ----------
  async function refresh({ initial = false } = {}) {
    if (state.refreshing) return;
    state.refreshing = true;
    const live = $('#liveStatus');
    live.classList.add('loading');
    const [rowsOk, catalogOk] = await Promise.all([
      loadRows(),
      initial ? window.Catalog.init() : window.Catalog.refresh()
    ]);
    state.lastRefresh = Date.now();
    state.refreshing = false;
    live.classList.remove('loading');
    const ok = rowsOk && catalogOk !== false;
    live.classList.toggle('error', !ok);
    live.querySelector('span').textContent = (ok ? 'LIVE · ' : 'ออฟไลน์ · ') + timeNow();
    live.title = ok
      ? `อัปเดตล่าสุด ${timeNow()} · รีเฟรชอัตโนมัติทุก ${Math.round(L.settings.refreshMs / 60000) || 1} นาที`
      : 'อัปเดตบางส่วนไม่สำเร็จ กำลังแสดงข้อมูลเดิม';
    if (!ok && !initial) L.toast('อัปเดตข้อมูลบางส่วนไม่สำเร็จ — กำลังแสดงข้อมูลเดิม');
  }

  // ---------- Hero ----------
  function setHero(items) {
    const sameSet = items.map(L.keyOf).join() === state.hero.map(L.keyOf).join();
    state.hero = items;
    if (!sameSet) state.heroIndex = 0;
    $('#heroDots').innerHTML = items.map((_, i) => `<button aria-label="สไลด์ ${i + 1}" data-hero="${i}"></button>`).join('');
    showHero(state.heroIndex, !sameSet);
    restartHeroTimer();
  }

  function restartHeroTimer() {
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
      const full = L.accessOf(it) === 'full';
      content.innerHTML = `
        <span class="kicker">${full ? 'ดูเต็มเรื่อง · ฟรี ไม่มีโฆษณา' : 'กำลังมาแรงวันนี้'}</span>
        <h1>${esc(it.title)}</h1>
        <div class="meta-line">
          ${it.rating ? `<span class="rating">★ ${esc(it.rating)}</span>` : ''}
          ${it.year ? `<span>${esc(it.year)}</span>` : ''}
          ${L.BADGES[L.accessOf(it)]}
        </div>
        <p class="overview">${esc(it.overview || 'ดูรายละเอียดเพิ่มเติม')}</p>
        <div class="actions">
          <a class="btn btn-gold" href="${esc(L.watchHref(it))}">${ICON.play}${full ? 'ดูเต็มเรื่อง' : 'ดูตัวอย่าง'}</a>
          <button class="btn btn-ghost" data-key="${esc(L.keyOf(it))}">${ICON.info}รายละเอียด</button>
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

  async function openDetail(key) {
    const it = L.items.get(key);
    if (!it) return;
    const body = $('#modalBody');
    body.innerHTML = '<div class="d-loading"><div class="spinner"></div></div>';
    openModal($('#modal'));
    if (it.src === 'ia') return renderArchiveDetail(it);
    try {
      await renderTmdbDetail(it);
    } catch (err) {
      if (err.auth) handleBadKey();
      body.innerHTML = `<div class="d-body" style="margin-top:0;padding-top:60px"><h2>${esc(it.title)}</h2><p class="muted">โหลดรายละเอียดไม่สำเร็จ: ${esc(err.message)}</p></div>`;
    }
  }

  function playInto(media, src, title) {
    media.classList.add('playing');
    media.innerHTML = `<iframe src="${esc(src)}" title="${esc(title)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }

  function renderArchiveDetail(it) {
    const page = `${L.IA}/details/${encodeURIComponent(it.id)}`;
    const watch = L.watchHref(it);
    $('#modalBody').innerHTML = `
      <div class="d-media" style="background-image:url('${esc(it.backdrop)}')">
        ${watch ? `<a class="big-play" href="${esc(watch)}" aria-label="ดูหนัง">${ICON.play}</a>` : ''}
      </div>
      <div class="d-body">
        <span class="kicker">Free · Legal · No Ads</span>
        <h2 id="modalTitle">${esc(it.title)}</h2>
        <div class="meta-line">
          ${it.year ? `<span>${esc(it.year)}</span>` : ''}
          <span class="pill">ดูฟรีเต็มเรื่อง</span>
        </div>
        <p class="overview">${esc(it.overview || 'ภาพยนตร์คลาสสิกจากคลัง Internet Archive')}</p>
        ${watch ? `<div class="actions" style="margin-top:22px"><a class="btn btn-gold" href="${esc(watch)}">${ICON.play}ดูเต็มเรื่อง</a></div>` : ''}
        <div class="d-section">
          <h3>แหล่งที่มา</h3>
          <p class="muted">ภาพยนตร์เรื่องนี้เผยแพร่ผ่าน <a href="${esc(page)}" target="_blank" rel="noopener">Internet Archive</a> ในฐานะสาธารณสมบัติหรือได้รับอนุญาตให้เผยแพร่</p>
        </div>
      </div>`;
  }

  async function renderTmdbDetail(it) {
    const d = await L.tmdb(`/${it.type}/${it.id}`, {
      append_to_response: 'videos,credits,watch/providers,external_ids',
      include_video_language: `${L.settings.lang.slice(0, 2)},en,null`
    });
    let overview = d.overview;
    if (!overview && L.settings.lang !== 'en-US') {
      overview = (await L.tmdb(`/${it.type}/${it.id}`, { language: 'en-US' }).catch(() => ({}))).overview;
    }
    const trailer = L.pickTrailer(d.videos);
    const title = d.title || d.name || it.title;
    const date = d.release_date || d.first_air_date || '';
    const runtime = d.runtime ? `${Math.floor(d.runtime / 60)} ชม. ${d.runtime % 60} นาที` : (d.number_of_seasons ? `${d.number_of_seasons} ซีซัน` : '');
    const backdrop = d.backdrop_path ? L.IMG + 'w1280' + d.backdrop_path : it.backdrop || it.poster;
    // ปุ่ม "ดูหนัง" เฉพาะเมื่อมีวิดีโอเต็มเรื่องที่ถูกลิขสิทธิ์
    const full = window.Providers.find(it, { ...d, imdb_id: d.imdb_id || d.external_ids?.imdb_id }, { exclude: ['tmdb'] });
    const watch = full ? window.Providers.watchUrl(full.provider.id, full.key) : '';

    const cast = (d.credits?.cast || []).slice(0, 12);
    const castHtml = cast.length ? `
      <div class="d-section"><h3>นักแสดง</h3><div class="cast">${cast.map((c) => `
        <figure>
          ${c.profile_path ? `<img src="${L.IMG}w185${esc(c.profile_path)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
          <figcaption>${esc(c.name)}<small>${esc(c.character || '')}</small></figcaption>
        </figure>`).join('')}</div></div>` : '';

    $('#modalBody').innerHTML = `
      <div class="d-media" style="background-image:url('${esc(backdrop)}')">
        ${trailer ? `<button class="big-play" aria-label="เล่นตัวอย่าง">${ICON.play}</button>` : ''}
      </div>
      <div class="d-body">
        <span class="kicker">${it.type === 'tv' ? 'Series' : 'Feature Film'}</span>
        <h2 id="modalTitle">${esc(title)}</h2>
        ${d.tagline ? `<p class="tagline">${esc(d.tagline)}</p>` : ''}
        <div class="meta-line">
          ${d.vote_average ? `<span class="rating">★ ${d.vote_average.toFixed(1)}</span>` : ''}
          ${date ? `<span>${esc(new Date(date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }))}</span>` : ''}
          ${runtime ? `<span>${esc(runtime)}</span>` : ''}
          ${watch ? '<span class="pill">ดูฟรีเต็มเรื่อง</span>' : ''}
          ${trailer ? '<span class="pill">มีตัวอย่าง</span>' : ''}
        </div>
        <div class="genres">${(d.genres || []).map((g) => `<span>${esc(g.name)}</span>`).join('')}</div>
        <p class="overview">${esc(overview || 'ยังไม่มีเรื่องย่อ')}</p>
        ${watch || trailer ? `<div class="actions" style="margin-top:22px">
          ${watch ? `<a class="btn btn-gold" href="${esc(watch)}">${ICON.play}ดูเต็มเรื่อง</a>` : ''}
          ${trailer ? `<button class="btn ${watch ? 'btn-ghost' : 'btn-gold'}" data-play-trailer>${ICON.play}ดูตัวอย่าง</button>` : ''}
        </div>` : ''}
        <div class="d-section"><h3>ดูได้ที่ไหน (ถูกลิขสิทธิ์)</h3>${L.watchOptionsHtml(L.watchOptions(d))}</div>
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
    }
  }

  // ---------- Settings ----------
  function openSettings() {
    $('#keyInput').value = L.settings.key;
    $('#regionInput').value = L.settings.region;
    $('#langInput').value = L.settings.lang;
    openModal($('#settings'));
    setTimeout(() => $('#keyInput').focus(), 50);
  }

  let warnedKey = false;
  function handleBadKey() {
    if (warnedKey) return;
    warnedKey = true;
    L.toast('TMDB API Key ไม่ถูกต้อง กรุณาตรวจสอบในหน้าตั้งค่า');
  }

  // ---------- Events ----------
  document.addEventListener('click', (e) => {
    const detail = e.target.closest('[data-key]');
    if (detail) { openDetail(detail.dataset.key); return; }
    const close = e.target.closest('[data-close]');
    if (close) { closeModal(close.closest('.modal')); return; }
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      const track = scroll.closest('.row').querySelector('.track');
      track?.scrollBy({ left: Number(scroll.dataset.scroll) * track.clientWidth * 0.85, behavior: 'smooth' });
      return;
    }
    const dot = e.target.closest('[data-hero]');
    if (dot) { showHero(Number(dot.dataset.hero), true); restartHeroTimer(); return; }
    if (e.target.closest('[data-open-settings]')) openSettings();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal')].reverse().find((m) => !m.hidden);
    if (open) closeModal(open);
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    L.settings.save({ key: $('#keyInput').value.trim(), region: $('#regionInput').value, lang: $('#langInput').value });
    warnedKey = false;
    closeModal($('#settings'));
    L.toast('บันทึกแล้ว กำลังโหลดข้อมูลใหม่…');
    buildRows();
    loadRows();
    window.Catalog.onSettingsChanged();
  });

  const topbar = $('#topbar');
  const onScroll = () => topbar.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  setInterval(() => { if (!document.hidden) refresh(); }, L.settings.refreshMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.lastRefresh > Math.min(2 * 60 * 1000, L.settings.refreshMs)) refresh();
  });

  // ---------- Boot ----------
  buildRows();
  refresh({ initial: true });
})();
