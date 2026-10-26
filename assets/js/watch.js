(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const IA = 'https://archive.org';
  const LOAD_TIMEOUT_MS = 25000;

  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
  const ICON_ALERT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>';

  const params = new URLSearchParams(location.search);
  const providerId = params.get('p') || '';
  const key = params.get('id') || '';
  const player = $('#player');
  let media = null;

  // สถานะของเครื่องเล่นถูกเขียนลง data-state เพื่อใช้ทดสอบอัตโนมัติด้วย
  function setState(state, extra = {}) {
    player.dataset.state = state;
    for (const [k, v] of Object.entries(extra)) player.dataset[k] = v;
  }

  function showError(title, detail) {
    setState('error');
    const actions = [
      '<button class="btn btn-gold" data-retry>ลองอีกครั้ง</button>',
      media?.embedUrl && !player.querySelector('iframe') ? '<button class="btn btn-ghost" data-embed>ใช้เครื่องเล่นสำรอง</button>' : '',
      media?.pageUrl ? `<a class="btn btn-ghost" href="${esc(media.pageUrl)}" target="_blank" rel="noopener">เปิดที่แหล่งต้นทาง</a>` : '',
      '<a class="btn btn-ghost" href="./">กลับหน้าหลัก</a>'
    ].join('');
    player.innerHTML = `
      <div class="player-msg error" role="alert">
        <span class="err-icon">${ICON_ALERT}</span>
        <h2>${esc(title)}</h2>
        <p>${esc(detail)}</p>
        <div class="actions">${actions}</div>
      </div>`;
  }

  function withTimeout(promise, ms, message) {
    return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms))]);
  }

  // ---------- Players ----------
  function playNative(m) {
    setState('loading');
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (m.poster) video.poster = m.poster;
    m.sources.forEach((s) => {
      const el = document.createElement('source');
      el.src = s.src;
      el.type = s.type;
      video.appendChild(el);
    });

    let settled = false;
    const fail = (title, detail) => {
      if (settled && player.dataset.state === 'error') return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.querySelectorAll('source').forEach((s) => s.remove());
      video.load();
      showError(title, detail);
    };
    const timer = setTimeout(() => fail('โหลดวิดีโอนานเกินไป', 'เซิร์ฟเวอร์ต้นทางตอบสนองช้าหรือไม่พร้อมใช้งานในขณะนี้ ลองอีกครั้ง หรือใช้เครื่องเล่นสำรอง'), LOAD_TIMEOUT_MS);

    // <source> ตัวสุดท้ายล้มเหลว = ทุกไฟล์เล่นไม่ได้
    video.lastElementChild?.addEventListener('error', () =>
      fail('ไม่สามารถเล่นวิดีโอนี้ได้', 'เบราว์เซอร์ของคุณเปิดไฟล์วิดีโอจากแหล่งนี้ไม่ได้ หรือไฟล์ถูกย้าย/ลบไปแล้ว'));
    video.addEventListener('error', () =>
      fail('เกิดข้อผิดพลาดระหว่างเล่นวิดีโอ', video.error?.message || `รหัสข้อผิดพลาด ${video.error?.code ?? '-'}`));
    video.addEventListener('loadedmetadata', () => {
      settled = true;
      clearTimeout(timer);
      setState('ready', { duration: String(Math.round(video.duration || 0)), source: video.currentSrc });
    });
    video.addEventListener('playing', () => setState('playing'));
    video.addEventListener('pause', () => { if (player.dataset.state === 'playing') setState('paused'); });
    video.addEventListener('timeupdate', () => { player.dataset.time = video.currentTime.toFixed(1); });

    player.innerHTML = '';
    player.appendChild(video);
    // เล่นอัตโนมัติถ้าเบราว์เซอร์อนุญาต ไม่งั้นผู้ใช้กดปุ่ม play เอง
    video.play().catch(() => {});
  }

  function playEmbed(m) {
    // iframe ของผู้ให้บริการอื่นตรวจสอบสถานะการเล่นไม่ได้ จึงแสดงเป็นสถานะ "embed"
    setState('embed');
    player.innerHTML = `<iframe src="${esc(m.embedUrl)}" title="${esc(m.title)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    $('#embedNote')?.removeAttribute('hidden');
  }

  function start() {
    if (media.sources?.length) playNative(media);
    else if (media.embedUrl) playEmbed(media);
    else showError('ไม่พบไฟล์วิดีโอ', 'แหล่งนี้ไม่มีไฟล์วิดีโอที่เปิดให้รับชมได้');
  }

  // ---------- Info ----------
  function renderInfo(m, provider) {
    document.title = `${m.title} — LUMIÈRE`;
    const quality = m.sources?.[0]?.label;
    $('#watchInfo').innerHTML = `
      <span class="kicker">${esc(provider.name)}</span>
      <h1>${esc(m.title)}</h1>
      <div class="meta-line">
        ${m.year ? `<span>${esc(m.year)}</span>` : ''}
        ${quality ? `<span class="pill">${esc(quality)}</span>` : ''}
        <span class="pill">FREE · NO ADS</span>
      </div>
      ${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ''}
      <div class="license">
        <div><small>สัญญาอนุญาต</small>${m.licenseUrl ? `<a href="${esc(m.licenseUrl)}" target="_blank" rel="noopener">${esc(m.license)}</a>` : esc(m.license || '-')}</div>
        <div><small>แหล่งที่มา</small>${m.pageUrl ? `<a href="${esc(m.pageUrl)}" target="_blank" rel="noopener">${esc(m.credit || provider.name)}</a>` : esc(m.credit || provider.name)}</div>
      </div>
      <p class="muted" id="embedNote" hidden>กำลังใช้เครื่องเล่นของผู้ให้บริการ — หากวิดีโอไม่แสดง ให้กด “เปิดที่แหล่งต้นทาง”</p>
      <div class="actions">
        ${m.embedUrl && m.sources?.length ? '<button class="btn btn-ghost" data-embed>ใช้เครื่องเล่นสำรอง</button>' : ''}
        ${m.pageUrl ? `<a class="btn btn-ghost" href="${esc(m.pageUrl)}" target="_blank" rel="noopener">เปิดที่แหล่งต้นทาง</a>` : ''}
      </div>`;
  }

  async function renderMore() {
    const open = window.Providers.OPEN_FILMS.map((f) => ({ p: 'open', id: f.archive, title: f.title, year: f.year }));
    let popular = [];
    try {
      const url = new URL(`${IA}/advancedsearch.php`);
      url.searchParams.set('q', 'collection:(feature_films) AND mediatype:(movies)');
      ['identifier', 'title', 'year'].forEach((f) => url.searchParams.append('fl[]', f));
      url.searchParams.append('sort[]', 'downloads desc');
      url.searchParams.set('rows', '16');
      url.searchParams.set('output', 'json');
      const data = await (await fetch(url)).json();
      popular = data.response.docs.map((d) => ({
        p: 'archive', id: d.identifier,
        title: Array.isArray(d.title) ? d.title[0] : d.title, year: d.year
      }));
    } catch { /* optional section */ }
    const items = [...open, ...popular].filter((it) => it.id !== key);
    if (!items.length) return;
    $('#moreTrack').innerHTML = items.map((it) => `
      <a class="card" href="${esc(window.Providers.watchUrl(it.p, it.id))}">
        <div class="poster">
          <img src="${IA}/services/img/${encodeURIComponent(it.id)}" alt="" loading="lazy" onload="this.classList.add('ok')" onerror="this.remove()">
          <span class="ph">${esc(it.title)}</span>
          <div class="badges"><span class="badge free">${it.p === 'open' ? 'CC' : 'FREE'}</span></div>
          <span class="play-hint">${ICON_PLAY}</span>
        </div>
        <span class="title">${esc(it.title)}</span>
        <span class="sub">${esc(it.year || '')}&nbsp;</span>
      </a>`).join('');
    $('#moreRow').hidden = false;
  }

  // ---------- Boot ----------
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { load(); return; }
    if (e.target.closest('[data-embed]') && media?.embedUrl) playEmbed(media);
  });

  async function load() {
    const provider = window.Providers.get(providerId);
    if (!provider || !key) {
      $('#watchInfo').innerHTML = '<h1>ไม่พบภาพยนตร์</h1>';
      showError('ไม่พบแหล่งวิดีโอ', 'ลิงก์นี้ไม่ถูกต้อง หรือแหล่งวิดีโอนี้ไม่ได้ลงทะเบียนไว้ในเว็บไซต์');
      return;
    }
    setState('loading');
    player.innerHTML = '<div class="player-msg"><div class="spinner"></div><p>กำลังเตรียมภาพยนตร์…</p></div>';
    try {
      media = await withTimeout(provider.resolve(key), LOAD_TIMEOUT_MS, 'แหล่งวิดีโอไม่ตอบสนอง');
      renderInfo(media, provider);
      start();
    } catch (err) {
      $('#watchInfo').innerHTML = `<span class="kicker">${esc(provider.name)}</span><h1>เปิดภาพยนตร์ไม่สำเร็จ</h1>`;
      showError('ไม่สามารถโหลดภาพยนตร์ได้', err.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
    }
  }

  load();
  renderMore();
})();
