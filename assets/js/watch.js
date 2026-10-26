(() => {
  'use strict';

  const L = window.Lumiere;
  const { $, esc, ICON } = L;
  const LOAD_TIMEOUT_MS = 25000;

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

  function showError(title, detail, { settings = false } = {}) {
    setState('error');
    const actions = [
      settings ? '<a class="btn btn-gold" href="./">ไปหน้าแรกเพื่อตั้งค่า API Key</a>' : '<button class="btn btn-gold" data-retry>ลองอีกครั้ง</button>',
      media?.embedUrl && !player.querySelector('iframe') ? '<button class="btn btn-ghost" data-embed>ใช้เครื่องเล่นสำรอง</button>' : '',
      media?.pageUrl ? `<a class="btn btn-ghost" href="${esc(media.pageUrl)}" target="_blank" rel="noopener">เปิดที่แหล่งต้นทาง</a>` : '',
      settings ? '' : '<a class="btn btn-ghost" href="./">กลับหน้าหลัก</a>'
    ].join('');
    player.innerHTML = `
      <div class="player-msg error" role="alert">
        <span class="err-icon">${ICON.alert}</span>
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
    addSubtitles(video, m.subtitles || []);
  }

  // ---------- Subtitles ----------
  const srtToVtt = (s) => 'WEBVTT\n\n' + s.replace(/^﻿/, '').replace(/\r/g, '')
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').trim() + '\n';

  async function addSubtitles(video, subs) {
    player.dataset.subtitles = '0';
    if (!subs.length) return;
    let added = 0;
    for (const s of subs) {
      try {
        const res = await fetch(s.src);
        if (!res.ok) continue;
        let text = await res.text();
        if (s.format === 'srt') text = srtToVtt(text);
        else if (!/^﻿?WEBVTT/.test(text)) continue;
        if (!/-->/.test(text)) continue;
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = s.label;
        track.srclang = s.lang;
        track.src = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
        video.appendChild(track);
        added++;
      } catch { /* ข้ามไฟล์คำบรรยายที่โหลดไม่ได้ */ }
    }
    player.dataset.subtitles = String(added);
    renderSubtitleBar(video);
  }

  function renderSubtitleBar(video) {
    const bar = $('#subsBar');
    if (!bar) return;
    const tracks = [...video.textTracks];
    if (!tracks.length) { bar.hidden = true; return; }
    const draw = () => {
      const active = tracks.findIndex((t) => t.mode === 'showing');
      bar.innerHTML = `<small>คำบรรยาย</small>
        <button class="chip${active < 0 ? ' on' : ''}" data-sub="-1">ปิด</button>
        ${tracks.map((t, i) => `<button class="chip${i === active ? ' on' : ''}" data-sub="${i}">${esc(t.label)}</button>`).join('')}`;
    };
    bar.onclick = (e) => {
      const b = e.target.closest('[data-sub]');
      if (!b) return;
      const n = Number(b.dataset.sub);
      tracks.forEach((t, i) => { t.mode = i === n ? 'showing' : 'disabled'; });
      draw();
    };
    // เปิดภาษาไทยอัตโนมัติถ้ามี
    const th = tracks.findIndex((t) => t.language === 'th');
    if (th >= 0) tracks[th].mode = 'showing';
    draw();
    bar.hidden = false;
  }

  // ---------- Keyboard: Space/K เล่น-หยุด · F เต็มจอ · ←/→ 10 วิ · M ปิดเสียง · C คำบรรยาย ----------
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const video = player.querySelector('video');
    if (!video) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
    else if (k === 'f') { e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : player.requestFullscreen?.(); }
    else if (k === 'arrowright') { e.preventDefault(); video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); }
    else if (k === 'arrowleft') { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 10); }
    else if (k === 'm') video.muted = !video.muted;
    else if (k === 'c') {
      const tracks = [...video.textTracks];
      if (!tracks.length) return;
      const i = tracks.findIndex((t) => t.mode === 'showing');
      tracks.forEach((t, j) => { t.mode = j === (i + 1) % (tracks.length + 1) ? 'showing' : 'disabled'; });
      $('#subsBar [data-sub]') && renderSubtitleBar(video);
    }
  });

  function iframeHtml(src, title) {
    return `<iframe src="${esc(src)}" title="${esc(title)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }

  function playEmbed(m) {
    // iframe ของผู้ให้บริการอื่นตรวจสอบสถานะการเล่นไม่ได้ จึงแสดงเป็นสถานะ "embed"
    setState('embed');
    player.innerHTML = iframeHtml(m.embedUrl, m.title);
    $('#embedNote')?.removeAttribute('hidden');
  }

  function playPreview(m) {
    if (m.trailer) {
      setState('trailer', { trailer: m.trailer.key });
      player.innerHTML = iframeHtml(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(m.trailer.key)}?autoplay=1&rel=0&modestbranding=1`, `ตัวอย่าง ${m.title}`);
      return;
    }
    setState('no-video');
    player.innerHTML = `
      <div class="player-msg" style="${m.backdrop ? `background:linear-gradient(rgba(8,8,10,.75),rgba(8,8,10,.9)),url('${esc(m.backdrop)}') center/cover` : ''}">
        <h2>ยังไม่มีตัวอย่างหนังเรื่องนี้</h2>
        <p>ดูช่องทางรับชมที่ถูกลิขสิทธิ์ได้ด้านล่าง</p>
      </div>`;
  }

  function start() {
    if (media.preview) playPreview(media);
    else if (media.sources?.length) playNative(media);
    else if (media.embedUrl) playEmbed(media);
    else showError('ไม่พบไฟล์วิดีโอ', 'แหล่งนี้ไม่มีไฟล์วิดีโอที่เปิดให้รับชมได้');
  }

  // ---------- Info ----------
  function renderInfo(m, provider) {
    document.title = `${m.title} — MovieHub Thailand`;
    const quality = m.sources?.[0]?.label;
    const preview = !!m.preview;
    const access = !preview ? 'full' : (m.external ? 'external' : 'trailer');
    $('#watchInfo').dataset.access = access;
    const outside = m.freeOutside?.[0] || m.watch?.list?.[0];
    $('#watchInfo').innerHTML = `
      ${preview ? `<div class="preview-note" id="previewNote">
        <div class="badges-inline">${L.BADGES[access]}${m.trailer ? L.BADGES.trailer : ''}</div>
        <strong>${m.freeOutside?.length ? `ดูเต็มเรื่องฟรีถูกกฎหมายได้ที่ ${esc(m.freeOutside.map((p) => p.name).join(', '))}` : m.external ? 'เรื่องนี้รับชมเต็มเรื่องได้ที่บริการภายนอกที่ถูกกฎหมาย' : 'ยังไม่มีช่องทางรับชมเต็มเรื่องที่ถูกลิขสิทธิ์ในภูมิภาคนี้'}</strong>
        <span>${m.trailer ? 'บนหน้านี้กำลังแสดงตัวอย่างหนังอย่างเป็นทางการ' : 'ยังไม่มีตัวอย่างหนังเรื่องนี้'}${m.external ? ' · กดปุ่มด้านล่างเพื่อไปยังบริการรับชม' : ''}</span>
        ${outside && m.watch.link ? `<div class="actions"><a class="btn btn-gold btn-sm" id="externalCta" href="${esc(m.watch.link)}" target="_blank" rel="noopener">${ICON.play}${m.freeOutside?.length ? 'ดูเต็มเรื่องฟรีที่' : 'รับชมเต็มเรื่องที่'} ${esc(outside.name)}</a></div>` : ''}
      </div>` : ''}
      <span class="kicker">${esc(provider.name)}</span>
      <h1>${esc(m.title)}</h1>
      <div class="meta-line">
        ${m.rating ? `<span class="rating">★ ${esc(m.rating)}</span>` : ''}
        ${m.year ? `<span>${esc(m.year)}</span>` : ''}
        ${m.runtime ? `<span>${esc(m.runtime)}</span>` : ''}
        ${quality ? `<span class="pill">${esc(quality)}</span>` : ''}
        ${preview ? '' : L.BADGES.full + '<span class="pill">FREE · NO ADS</span>'}
      </div>
      ${preview ? '' : '<div class="subs" id="subsBar" hidden></div><p class="muted kbd-hint">คีย์ลัด: Space เล่น/หยุด · F เต็มจอ · ← → ข้าม 10 วินาที · M ปิดเสียง · C คำบรรยาย</p>'}
      ${m.genres?.length ? `<div class="genres">${m.genres.map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : ''}
      ${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ''}
      ${preview ? `<div class="d-section" id="watchOptions"><h3>ดูเต็มเรื่องได้ที่ (ถูกลิขสิทธิ์)</h3>${L.watchOptionsHtml(m.watch)}</div>` : ''}
      <div class="license">
        <div><small>${preview ? 'วิดีโอ' : 'สัญญาอนุญาต'}</small>${m.licenseUrl ? `<a href="${esc(m.licenseUrl)}" target="_blank" rel="noopener">${esc(m.license)}</a>` : esc(m.license || '-')}</div>
        <div><small>แหล่งที่มา</small>${m.pageUrl ? `<a href="${esc(m.pageUrl)}" target="_blank" rel="noopener">${esc(m.credit || provider.name)}</a>` : esc(m.credit || provider.name)}</div>
      </div>
      <p class="muted" id="embedNote" hidden>กำลังใช้เครื่องเล่นของผู้ให้บริการ — หากวิดีโอไม่แสดง ให้กด “เปิดที่แหล่งต้นทาง”</p>
      <div class="actions">
        ${!preview && m.embedUrl && m.sources?.length ? '<button class="btn btn-ghost" data-embed>ใช้เครื่องเล่นสำรอง</button>' : ''}
        ${m.pageUrl ? `<a class="btn btn-ghost" href="${esc(m.pageUrl)}" target="_blank" rel="noopener">เปิดที่แหล่งต้นทาง</a>` : ''}
      </div>`;
  }

  async function renderMore() {
    const open = window.Providers.OPEN_FILMS.map((f) => ({ p: 'open', id: f.archive, title: f.title, year: f.year }));
    let popular = [];
    try {
      popular = (await L.archiveSearch({ q: 'collection:(feature_films)', rows: 16 })).items.map((it) => ({ p: 'archive', id: it.id, title: it.title, year: it.year }));
    } catch { /* optional section */ }
    const items = [...open, ...popular].filter((it) => it.id !== key);
    if (!items.length) return;
    $('#moreTrack').innerHTML = items.map((it) => `
      <a class="card" href="${esc(window.Providers.watchUrl(it.p, it.id))}">
        <div class="poster">
          <img src="${L.IA}/services/img/${encodeURIComponent(it.id)}" alt="" loading="lazy" onload="this.classList.add('ok')" onerror="this.remove()">
          <span class="ph">${esc(it.title)}</span>
          <div class="badges"><span class="badge free">${it.p === 'open' ? 'CC' : 'ดูฟรี'}</span></div>
          <span class="play-hint">${ICON.play}</span>
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
      if (media.redirect) { location.replace(media.redirect); return; }
      renderInfo(media, provider);
      start();
    } catch (err) {
      $('#watchInfo').innerHTML = `<span class="kicker">${esc(provider.name)}</span><h1>เปิดภาพยนตร์ไม่สำเร็จ</h1>`;
      showError('ไม่สามารถโหลดภาพยนตร์ได้', err.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ', { settings: !!(err.noKey || err.auth) });
    }
  }

  load();
  renderMore();
})();
