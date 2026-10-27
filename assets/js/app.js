// เที่ยวพอดีงบ — หน้าจอ (หน้าหลัก / แผนของฉัน / ผลลัพธ์แผนเที่ยว)
(() => {
  'use strict';

  const D = window.TRIP_DATA;
  const P = window.TripPlanner;
  const app = document.getElementById('app');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const baht = (n) => `฿${Math.round(Number(n) || 0).toLocaleString('th-TH')}`;
  const DAY_COLORS = ['#FF7A59', '#3B82F6', '#14B8A6', '#7C5CFF', '#F59E0B', '#FF5E8A', '#16A34A', '#0EA5E9', '#A855F7', '#EF4444'];
  const dayColor = (i) => DAY_COLORS[i % DAY_COLORS.length];
  const grad = (p) => `linear-gradient(135deg, ${p.color[0]}, ${p.color[1]})`;
  const tint = (hex, a = '1F') => `${hex}${a}`;
  const dur = (m) => { m = Math.round(m || 0); const h = Math.floor(m / 60); const r = m % 60; return h && r ? `${h} ชม. ${r} นาที` : h ? `${h} ชม.` : `${r} นาที`; };
  const dateTh = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); };
  const mapsUrl = (name, p) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${p.full}`)}`;

  // ---------- Storage (ใช้ localStorage — ห่อ try/catch เผื่อเบราว์เซอร์ปิดการเก็บข้อมูล) ----------
  const KEYS = { plans: 'tripplanner.plans.v1', draft: 'tripplanner.draft.v1', form: 'tripplanner.form.v1' };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  };
  const loadPlans = () => { const v = store.get(KEYS.plans, {}); return v && typeof v === 'object' ? v : {}; };
  const savedList = () => Object.values(loadPlans()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  const DEFAULT_FORM = { province: 'chiangmai', budget: 8000, days: 3, people: 2, styles: ['nature', 'cafe'], includeTravel: false, startDate: null, mode: 'auto', needs: [], mealCap: 0, lodgingRate: 0 };
  const state = {
    form: { ...DEFAULT_FORM, ...(store.get(KEYS.form, {}) || {}) },
    plan: null, map: null, pickerMap: null, layers: null, markers: {}, mapDay: 'all', showNearby: true, undo: null
  };
  if (!P.province(state.form.province)) state.form.province = DEFAULT_FORM.province;

  function writePlan(plan, { quiet = true } = {}) {
    plan.updatedAt = new Date().toISOString();
    let ok;
    if (plan.saved) {
      const all = loadPlans();
      all[plan.id] = plan;
      ok = store.set(KEYS.plans, all);
    } else {
      ok = store.set(KEYS.draft, plan);
    }
    if (!ok && !quiet) toast('บันทึกไม่สำเร็จ — เบราว์เซอร์นี้ไม่อนุญาตให้เก็บข้อมูล');
    updateSavedCount();
    return ok;
  }
  function findPlan(id) {
    if (state.plan?.id === id) return state.plan;
    const all = loadPlans();
    if (all[id]) return all[id];
    const draft = store.get(KEYS.draft, null);
    return draft && draft.id === id ? draft : null;
  }
  function removePlan(id) {
    const all = loadPlans();
    delete all[id];
    store.set(KEYS.plans, all);
    updateSavedCount();
  }
  function updateSavedCount() {
    const n = Object.keys(loadPlans()).length;
    const c = $('#savedCount');
    c.textContent = n;
    c.hidden = !n;
  }

  // ---------- Router ----------
  function route() {
    const h = location.hash || '#/';
    destroyMap();
    closeSheet();
    document.body.classList.remove('has-bar');
    const m = /^#\/plan\/([\w-]+)/.exec(h);
    $$('.top-link').forEach((a) => a.classList.toggle('on', (a.dataset.nav === 'saved' && h.startsWith('#/saved')) || (a.dataset.nav === 'home' && (h === '#/' || h === ''))));
    const sh = /^#\/share\/([\w-]+)/.exec(h);
    if (sh) { openShared(sh[1]); window.scrollTo(0, 0); return; }
    if (m) renderPlan(m[1]);
    else if (h.startsWith('#/saved')) renderSaved();
    else renderHome();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }

  // ---------- Home ----------
  // ภาพจังหวัดจาก Wikimedia Commons (assets/js/credits.js) — ถ้าไม่มีภาพใช้ไล่สี + อีโมจิแทน
  const photoOf = (id) => window.PHOTO_CREDITS?.[id] || null;

  // ไอคอนเส้น (แนว Lucide) แบบ inline — ไม่ต้องโหลดไลบรารีเพิ่ม
  const ICONS = {
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    calc: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/><path d="M19 3v4M17 5h4"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    crown: '<path d="M2 20h20M3 7l5 5 4-7 4 7 5-5-2 11H5z"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>'
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  function stepHead(no, title, sub, badge = '') {
    return `<div class="step-head"><span class="step-no">${no}</span><div class="step-title"><h2>${title}</h2><p>${sub}</p></div>${badge ? `<span class="hint">${badge}</span>` : ''}</div>`;
  }

  function provCard(p, selected) {
    const ph = photoOf(p.id);
    return `
      <button type="button" class="prov" data-prov="${p.id}" aria-pressed="${selected}" aria-label="${esc(p.full)} — ${esc(p.blurb)}">
        <span class="prov-photo" style="background:${grad(p)}">${ph ? `<img src="${esc(ph.src)}" alt="" loading="lazy" decoding="async">` : `<span class="prov-emoji" aria-hidden="true">${p.emoji}</span>`}<span class="prov-region">${esc(p.region)}</span></span>
        <span class="prov-body"><b class="prov-name">${esc(p.name)}</b><small class="prov-blurb">${esc(p.blurb)}</small></span>
      </button>`;
  }

  // วันที่: เก็บเป็น YYYY-MM-DD (เวลาท้องถิ่น)
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseISO = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const nextSaturday = () => { const t = new Date(); return isoDate(addDays(t, ((6 - t.getDay() + 7) % 7) || 7)); };
  const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => d.toLocaleDateString('th-TH', opts);
  const LONG_DAY = { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' };
  const dayDate = (plan, i) => { const s = parseISO(plan.input.startDate); return s ? addDays(s, i) : null; };
  // ---------- เตือนวันเปิด-ปิด (อ่านจากหมายเหตุของสถานที่ในข้อมูลตัวอย่าง) ----------
  const DOW_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  function openDays(note) {
    if (!note) return null;
    if (/เฉพาะ(เย็น)?วันอาทิตย์/.test(note)) return [0];
    if (/ศุกร์-อาทิตย์/.test(note)) return [5, 6, 0];
    if (/เสาร์-อาทิตย์/.test(note)) return [6, 0];
    if (/ปิดวันจันทร์/.test(note)) return [0, 2, 3, 4, 5, 6];
    return null;
  }
  function openWarning(it, date) {
    const days = openDays(it.note);
    if (!days || !date || days.includes(date.getDay())) return '';
    return `<div class="open-warn">⚠️ วันนี้เป็นวัน${DOW_FULL[date.getDay()]} — สถานที่นี้อาจไม่เปิด ลองแก้ไขย้ายไปวันอื่น</div>`;
  }

  // ---------- แชร์แผน: เก็บข้อมูลแผนทั้งหมดในลิงก์ (บีบอัด) ไม่ต้องมีเซิร์ฟเวอร์ ----------
  const b64enc = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const b64dec = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const ITEM_KINDS = new Set(['trip', 'local', 'place', 'meal', 'lodging', 'free', 'custom']);
  // เพิ่มคีย์ใหม่ต่อท้ายเท่านั้น — ลิงก์/ไฟล์เก่าที่ไม่มีคีย์นั้นจะได้ค่า null
  const ITEM_KEYS = ['kind', 'cat', 'name', 'time', 'mins', 'cost', 'note', 'll', 'travel', 'km', 'icon', 'type', 'typeLabel', 'zone', 'zoneLabel', 'access'];

  const packData = (plan) => ({ v: 1, i: plan.input, t: plan.title, ct: !!plan.customTitle, r: plan.tier, f: plan.feasible, m: plan.minBudget, p: plan.provinceId,
    d: plan.days.map((d) => d.items.map((it) => ITEM_KEYS.map((k) => it[k] ?? null))) });

  async function packPlan(plan) {
    const bytes = new TextEncoder().encode(JSON.stringify(packData(plan)));
    if (window.CompressionStream) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 'z' + b64enc(new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    return 'j' + b64enc(bytes);
  }

  // ถอดลิงก์แชร์ + ตรวจสอบข้อมูลทุกช่อง (ลิงก์มาจากภายนอก ห้ามเชื่อข้อมูลตรงๆ)
  async function unpackPlan(str) {
    let bytes = b64dec(str.slice(1));
    if (str[0] === 'z') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (str[0] !== 'j') throw new Error('bad format');
    return planFromData(JSON.parse(new TextDecoder().decode(bytes)));
  }

  // สร้างแผนจากข้อมูลภายนอก (ลิงก์แชร์ / ไฟล์สำรอง) — ตรวจทุกช่อง
  function planFromData(data) {
    if (!data || data.v !== 1 || !P.province(data.p)) throw new Error('bad plan');
    const base = P.plan({ ...data.i, province: data.p });
    const txt = (v, n) => String(v ?? '').slice(0, n);
    const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
    const days = (Array.isArray(data.d) ? data.d : []).slice(0, base.input.days).map((items, i) => ({
      n: i + 1,
      items: (Array.isArray(items) ? items : []).slice(0, 40).map((row) => {
        const o = Object.fromEntries(ITEM_KEYS.map((k, j) => [k, Array.isArray(row) ? row[j] : null]));
        const ll = Array.isArray(o.ll) && o.ll.length === 2 && o.ll.every((x) => Number.isFinite(x) && Math.abs(x) <= 180) ? o.ll.map(Number) : null;
        return {
          id: P.uid(), kind: ITEM_KINDS.has(o.kind) ? o.kind : 'custom', cat: P.CATS[o.cat] ? o.cat : 'fees',
          name: txt(o.name, 120) || 'รายการ', time: /^\d{2}:\d{2}$/.test(o.time) ? o.time : '12:00',
          mins: num(o.mins, 0, 1440), cost: num(o.cost, 0, 1e7), note: txt(o.note, 300), ll,
          travel: num(o.travel, 0, 600), km: Number.isFinite(o.km) ? Math.round(o.km * 10) / 10 : null,
          icon: txt(o.icon, 8) || '📌', type: D.TYPES[o.type] ? o.type : undefined, typeLabel: txt(o.typeLabel, 40),
          zone: txt(o.zone, 40), zoneLabel: txt(o.zoneLabel, 60), access: o.access === 'hard' || o.access === 'some' ? o.access : ''
        };
      })
    }));
    while (days.length < base.input.days) days.push({ n: days.length + 1, items: [] });
    return { ...base, title: txt(data.t, 80) || base.title, customTitle: !!data.ct, tier: num(data.r, 0, 2), feasible: !!data.f, minBudget: num(data.m, 0, 1e8), days, saved: false, shared: true };
  }

  const shareBase = () => (location.protocol === 'file:' ? 'https://kedsuda.github.io/mov/' : location.href.split('#')[0]);
  const shareLink = async (plan) => `${shareBase()}#/share/${await packPlan(plan)}`;

  // ---------- สำรอง/ย้ายแผน: ส่งออกเป็นไฟล์ .json แล้วนำเข้าในเครื่องอื่น ----------
  const BACKUP_APP = 'tiew-podee-ngob';
  const isIso = (s) => typeof s === 'string' && s.length < 40 && !isNaN(Date.parse(s));
  function downloadPlans(plans, name) {
    const file = { app: BACKUP_APP, type: 'plans', v: 1, exportedAt: new Date().toISOString(),
      plans: plans.map((pl) => ({ id: pl.id, createdAt: pl.createdAt, updatedAt: pl.updatedAt, data: packData(pl) })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${isoDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  // นำเข้าไฟล์สำรอง: แผนที่มีอยู่แล้ว (id เดียวกัน) จะถูกแทนที่เมื่อไฟล์ใหม่กว่าเท่านั้น
  async function importPlans(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('ไฟล์ใหญ่เกินไป (เกิน 5 MB)'); return; }
    let json;
    try { json = JSON.parse(await file.text()); } catch { toast('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ .json ที่ส่งออกจากเที่ยวพอดีงบ'); return; }
    if (!json || json.app !== BACKUP_APP || json.type !== 'plans' || !Array.isArray(json.plans)) { toast('ไฟล์นี้ไม่ใช่ไฟล์สำรองแผนของเที่ยวพอดีงบ'); return; }
    const all = loadPlans();
    const now = new Date().toISOString();
    let added = 0, updated = 0, skipped = 0, bad = 0;
    for (const row of json.plans.slice(0, 300)) {
      let plan;
      try { plan = planFromData(row?.data); } catch { bad++; continue; }
      const id = typeof row.id === 'string' && /^trip-[a-z0-9]{4,40}$/.test(row.id) ? row.id : plan.id;
      Object.assign(plan, { id, saved: true, shared: false, createdAt: isIso(row.createdAt) ? row.createdAt : now, updatedAt: isIso(row.updatedAt) ? row.updatedAt : now });
      const old = all[id];
      if (old && String(old.updatedAt) >= plan.updatedAt) { skipped++; continue; }
      if (old) updated++; else added++;
      all[id] = plan;
    }
    if ((added || updated) && !store.set(KEYS.plans, all)) { toast('บันทึกไม่สำเร็จ — พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็มหรือถูกปิด'); return; }
    updateSavedCount();
    const parts = [added && `เพิ่ม ${added} แผน`, updated && `อัปเดต ${updated} แผน`, skipped && `ข้าม ${skipped} แผนที่มีอยู่แล้ว`, bad && `อ่านไม่ได้ ${bad} แผน`].filter(Boolean);
    toast(parts.length ? `นำเข้าแล้ว: ${parts.join(' · ')}` : 'ไม่มีแผนในไฟล์นี้');
    if (location.hash.startsWith('#/saved')) renderSaved(); else location.hash = '#/saved';
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  function planText(plan, link) {
    const s = P.summarize(plan);
    const lines = [`🧭 ${plan.title}${tripRange(plan) ? ` (${tripRange(plan)})` : ''}`, `งบ ${baht(s.budget)} · ใช้ประมาณ ${baht(s.total)} · ${s.over ? 'เกินงบ' : 'คงเหลือ'} ${baht(Math.abs(s.remaining))}`, ''];
    plan.days.forEach((d, i) => {
      const dt = dayDate(plan, i);
      lines.push(`วันที่ ${d.n}${dt ? ` (${fmtDay(dt)})` : ''}`);
      for (const it of P.sortItems(d.items)) lines.push(`  ${it.time} ${it.name}${it.cost ? ` — ${baht(it.cost)}` : ''}`);
      lines.push('');
    });
    if (link) lines.push(`ดูแผนเต็มพร้อมแผนที่: ${link}`);
    lines.push('* ราคาและเวลาเป็นค่าประมาณ ตรวจสอบก่อนเดินทาง');
    return lines.join('\n');
  }

  async function openShare() {
    const plan = state.plan;
    let link = '';
    try { link = await shareLink(plan); } catch { /* ยังพิมพ์/คัดลอกข้อความได้ */ }
    const canNative = typeof navigator.share === 'function';
    openSheet('แชร์ / พิมพ์แผน', `
      <div class="share-grid">
        ${canNative && link ? '<button type="button" class="share-opt" data-share="native"><span class="em">📲</span><b>ส่งให้เพื่อน</b><small>LINE, Messenger และแอปอื่นๆ</small></button>' : ''}
        ${link ? '<button type="button" class="share-opt" data-share="copy"><span class="em">🔗</span><b>คัดลอกลิงก์</b><small>เพื่อนเปิดแล้วเห็นแผนเดียวกัน</small></button>' : ''}
        <button type="button" class="share-opt" data-share="text"><span class="em">📝</span><b>คัดลอกเป็นข้อความ</b><small>สรุปรายวันสำหรับวางในแชท</small></button>
        <button type="button" class="share-opt" data-share="print"><span class="em">🖨️</span><b>พิมพ์ / บันทึก PDF</b><small>เลือก “บันทึกเป็น PDF” ในหน้าพิมพ์</small></button>
        <button type="button" class="share-opt" data-share="file"><span class="em">💾</span><b>ดาวน์โหลดไฟล์แผน</b><small>ไฟล์ .json สำรองไว้ หรือนำเข้าในเครื่องอื่น</small></button>
      </div>
      ${link ? `<label class="field share-link"><span>ลิงก์แผน</span><input readonly id="shareLink" value="${esc(link)}"></label>
      <p class="muted share-note">🔒 ข้อมูลแผนอยู่ในลิงก์ทั้งหมด ไม่ได้อัปโหลดไปเก็บที่ไหน เพื่อนเปิดแล้วกดบันทึกเป็นแผนของตัวเองได้</p>` : ''}`);
    const body = $('#sheetBody');
    body.onclick = async (e) => {
      const b = e.target.closest('[data-share]');
      if (!b) return;
      const how = b.dataset.share;
      if (how === 'native') {
        try { await navigator.share({ title: plan.title, text: `แผนเที่ยว ${plan.title}`, url: link }); } catch { /* ผู้ใช้ยกเลิก */ }
      } else if (how === 'copy') {
        toast((await copyText(link)) ? 'คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย' : 'คัดลอกไม่สำเร็จ — กดค้างที่ช่องลิงก์เพื่อคัดลอกเอง');
      } else if (how === 'text') {
        toast((await copyText(planText(plan, link))) ? 'คัดลอกสรุปแผนแล้ว วางในแชทได้เลย' : 'คัดลอกไม่สำเร็จ');
      } else if (how === 'print') {
        closeSheet();
        setTimeout(() => window.print(), 250);
      } else if (how === 'file') {
        downloadPlans([plan], `แผนเที่ยว-${plan.title.replace(/[\\/:*?"<>|\s]+/g, '-')}`);
        toast('ดาวน์โหลดไฟล์แผนแล้ว — นำเข้าได้ที่หน้า “ทริปที่บันทึกไว้”');
      }
    };
    $('#shareLink')?.addEventListener('focus', (e) => e.target.select());
  }

  async function openShared(data) {
    app.innerHTML = '<div class="wrap"><div class="empty" style="margin-top:32px"><div class="em">⏳</div><h3>กำลังเปิดแผนที่เพื่อนแชร์มา…</h3></div></div>';
    try {
      const plan = await unpackPlan(data);
      state.plan = plan;
      writePlan(plan);
      location.replace(`#/plan/${plan.id}`);
      toast('เปิดแผนที่แชร์มาแล้ว — กด “บันทึกแผน” เพื่อเก็บไว้');
    } catch {
      app.innerHTML = '<div class="wrap"><div class="empty" style="margin-top:32px"><div class="em">🔗</div><h3>ลิงก์แผนไม่ถูกต้อง</h3><p>ลิงก์อาจถูกตัดไม่ครบ ลองขอลิงก์ใหม่จากเพื่อน</p><a class="btn btn-primary" href="#/">วางแผนใหม่</a></div></div>';
    }
  }

  function openCredits() {
    const list = D.PROVINCES.map((p) => [p, photoOf(p.id)]).filter(([, c]) => c);
    openSheet('เครดิตภาพจังหวัด', `
      <p class="muted" style="margin-top:0">ภาพจาก Wikimedia Commons ใช้ภายใต้สัญญาอนุญาตแบบเปิด (ปรับขนาดเพื่อใช้บนเว็บ)</p>
      <div class="credits">${list.map(([p, c]) => `
        <div class="credit"><img src="${esc(c.src)}" alt="" loading="lazy"><div><b>${esc(p.full)}</b><small>${esc(c.title)} · ภาพโดย ${esc(c.artist)}</small>
        <small><a href="${esc(c.source)}" target="_blank" rel="noopener">ต้นฉบับ</a> · ${c.licenseUrl ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(c.license)}</a>` : esc(c.license)}</small></div></div>`).join('')}</div>`);
  }

  const tripRange = (plan) => {
    const s = parseISO(plan.input.startDate);
    if (!s) return '';
    const e = addDays(s, plan.input.days - 1);
    return plan.input.days > 1 ? `${fmtDay(s, { day: 'numeric', month: 'short' })} – ${fmtDay(e, { day: 'numeric', month: 'short', year: '2-digit' })}` : fmtDay(s, { day: 'numeric', month: 'short', year: '2-digit' });
  };

  function savedCard(plan) {
    const p = P.province(plan.provinceId);
    if (!p) return '';
    const s = P.summarize(plan);
    const ph = photoOf(p.id);
    return `
      <article class="saved-card">
        <div class="saved-top${ph ? ' has-photo' : ''}" style="background:${grad(p)}">
          ${ph ? `<img class="cover" src="${esc(ph.src)}" alt="" loading="lazy" decoding="async">` : ''}
          <span class="em" aria-hidden="true">${p.emoji}</span>
          <h3>${esc(plan.title)}</h3>
          <small>${tripRange(plan) ? `🗓️ ${esc(tripRange(plan))}` : `อัปเดต ${dateTh(plan.updatedAt)}`} · ${esc(D.TIERS[plan.tier]?.label || '')}</small>
        </div>
        <div class="saved-body">
          <div class="saved-stats">
            <span>งบ<b>${baht(s.budget)}</b></span>
            <span>ใช้ไป<b>${baht(s.total)}</b></span>
            <span>${s.over ? 'เกินงบ' : 'คงเหลือ'}<b style="color:${s.over ? 'var(--red)' : 'var(--green)'}">${baht(Math.abs(s.remaining))}</b></span>
          </div>
          <div class="saved-actions">
            <a class="btn btn-primary btn-sm" href="#/plan/${esc(plan.id)}">เปิดแผน</a>
            <button class="icon-btn danger" data-remove="${esc(plan.id)}" aria-label="ลบแผน ${esc(plan.title)}">🗑️</button>
          </div>
        </div>
      </article>`;
  }

  function renderHome() {
    const f = state.form;
    // วันไป: ครั้งแรก (หรือแผนเก่าที่ไม่มีวันที่) ตั้งเป็นเสาร์ถัดไป ถ้าวันที่เลยไปแล้วก็เลื่อนให้
    const today = parseISO(isoDate(new Date()));
    if (!parseISO(f.startDate) || parseISO(f.startDate) < today) f.startDate = nextSaturday();
    const saved = savedList();
    app.innerHTML = `
      <section class="hero">
        <div class="wrap hero-in">
          <span class="hero-badge">${icon('crown')}วางแผนท่องเที่ยวอย่างสมบูรณ์แบบ คุมงบได้ดั่งใจ</span>
          <h1>ออกแบบทริปในฝัน<br><span class="hl">คุ้มค่า ตรงใจ ในงบที่พอดี</span></h1>
          <p>เลือกจังหวัด งบประมาณ ระยะเวลา และสไตล์เดินทางของคุณ<br class="br-wide"> ระบบจะจัดสรรงบ คำนวณค่าใช้จ่าย และวางแผนรายวันพร้อมแผนที่ให้อัตโนมัติ</p>
        </div>
      </section>
      <div class="wrap home-wrap">
        <form class="planner" id="planner" novalidate>
          <section class="step">
            ${stepHead(1, 'เลือกจังหวัดปลายทาง', `สำรวจ ${D.PROVINCES.length} จุดหมายยอดนิยมทั่วประเทศไทย`, 'ยอดนิยมปี 2026')}
            <div class="prov-grid" role="group" aria-label="เลือกจังหวัด">${D.PROVINCES.map((p) => provCard(p, p.id === f.province)).join('')}</div>
            <p class="prov-desc"><span id="provDesc"></span> <button type="button" class="link-btn" data-credits>เครดิตภาพ</button></p>
          </section>
          <section class="step">
            ${stepHead(2, 'งบประมาณรวมทั้งทริป', 'กำหนดงบประมาณรวมที่ต้องการใช้')}
            <div class="budget-panel">
              <label class="money"><span class="money-label">${icon('wallet')}งบประมาณที่ระบุ</span><span class="money-in"><span class="cur" aria-hidden="true">฿</span><input id="budget" inputmode="numeric" autocomplete="off" aria-label="งบประมาณรวมทั้งทริป (บาท)" placeholder="0" value="${f.budget ? Number(f.budget).toLocaleString('th-TH') : ''}"></span></label>
              <div class="chips">${[3000, 5000, 8000, 15000, 30000].map((v) => `<button type="button" class="chip" data-budget="${v}" aria-pressed="${f.budget === v}">${baht(v)}</button>`).join('')}</div>
              <div class="avg-row"><span>${icon('calc')}ค่าใช้จ่ายเฉลี่ยประเมิน</span><span><b id="budgetNote">–</b> / คน / วัน</span></div>
            </div>
          </section>
          <section class="step">
            ${stepHead(3, 'วันเดินทางและผู้ร่วมทริป', 'ระบุเพื่อจัดสรรที่พักและการเดินทาง')}
            <div class="trip-row">
              <button type="button" class="counter date-box range" id="datePick" aria-haspopup="dialog" aria-describedby="daysOut">
                <span class="c-icon c-amber">${icon('calendar')}</span>
                <span class="range-fields">
                  <span class="d-field"><small>วันไป</small><b id="startLabel"></b></span>
                  <span class="range-arrow" aria-hidden="true">→</span>
                  <span class="d-field"><small>วันกลับ</small><b id="endLabel"></b></span>
                </span>
                <output id="daysOut" class="range-sum" aria-live="polite"></output>
              </button>
              <input type="hidden" id="startDate" value="${esc(f.startDate)}"><input type="hidden" id="endDate">
              <div class="counter"><span class="c-icon c-sky">${icon('users')}</span><span class="c-text"><small>ผู้ร่วมเดินทาง</small><b>จำนวนคน</b></span>
                <div class="stepper"><button type="button" data-step="people:-1" aria-label="ลดจำนวนคน">−</button><output id="peopleOut">${f.people}<small>คน</small></output><button type="button" data-step="people:1" aria-label="เพิ่มจำนวนคน">+</button></div></div>
            </div>
          </section>
          <section class="step">
            ${stepHead(4, 'สไตล์การเที่ยวที่ชอบ', 'เลือกได้มากกว่า 1 ข้อ')}
            <div class="styles">${D.STYLES.map((s) => `<button type="button" class="style" data-style="${s.id}" aria-pressed="${f.styles.includes(s.id)}"><span class="em" aria-hidden="true">${s.icon}</span>${esc(s.label)}</button>`).join('')}</div>
            <div class="sub-block">
              <h3 class="sub-title">ข้อจำกัดของผู้ร่วมทริป <small>(ถ้ามี)</small></h3>
              <div class="chips" role="group" aria-label="ข้อจำกัดของผู้ร่วมทริป">${D.NEEDS.map((n) => `<button type="button" class="chip" data-need="${n.id}" aria-pressed="${(f.needs || []).includes(n.id)}"><span class="em" aria-hidden="true">${n.icon}</span>${esc(n.label)}</button>`).join('')}</div>
              <label class="meal-cap"><span>🍽️ งบอาหารต่อคนต่อมื้อ</span><select id="mealCap">${D.MEAL_CAPS.map((v) => `<option value="${v}" ${Number(f.mealCap) === v ? 'selected' : ''}>${v ? `ไม่เกิน ${baht(v)}` : 'ไม่จำกัด (ตามระดับงบ)'}</option>`).join('')}</select></label>
              <label class="meal-cap"><span>🛏️ ที่พักต่อห้อง/คืน (ห้องละ 2 คน)</span><input id="lodgingRate" type="number" inputmode="numeric" min="0" max="100000" step="100" value="${Number(f.lodgingRate) || ''}" placeholder="ตามระดับที่พักที่แนะนำ" aria-describedby="lodgingHint"></label>
              <p class="sub-note" id="lodgingHint">เว้นว่างหรือใส่ 0 เพื่อใช้ราคาตัวอย่างตามระดับงบ · ราคาจริงเปลี่ยนตามวันและฤดูกาล</p>
              <p class="sub-note" id="needsNote"></p>
            </div>
          </section>
          <section class="step">
            ${stepHead(5, 'การเดินทาง', 'วิธีเดินทางในพื้นที่ และค่าเดินทางจากกรุงเทพฯ')}
            <div class="seg" role="group" aria-label="วิธีเดินทางในพื้นที่">${D.MODES.map((m) => `<button type="button" data-mode="${m.id}" aria-pressed="${(f.mode || 'auto') === m.id}"><span class="em" aria-hidden="true">${m.icon}</span>${esc(m.label)}</button>`).join('')}</div>
            <p class="sub-note" id="modeNote"></p>
            <label class="toggle" id="travelToggle"><span class="toggle-text"><b>รวมค่าเดินทางไป-กลับจากกรุงเทพฯ</b><small id="travelHint"></small></span><input type="checkbox" id="includeTravel" ${f.includeTravel ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>
            <div class="overview" id="estimate" aria-live="polite"></div>
          </section>
          <p class="form-error" id="formError" role="alert" hidden></p>
          <button class="btn btn-primary btn-lg btn-block submit" type="submit">${icon('sparkles')}<span>สร้างแผนเที่ยวให้เลย</span>${icon('arrow')}</button>
        </form>

        ${saved.length ? `
        <section class="section">
          <div class="section-head"><h2>แผนที่บันทึกไว้</h2><a class="btn btn-ghost btn-sm" href="#/saved">ดูทั้งหมด (${saved.length}) →</a></div>
          <div class="saved-grid">${saved.slice(0, 3).map(savedCard).join('')}</div>
        </section>` : ''}

        <section class="section">
          <div class="section-head center"><h2>สัมผัสประสบการณ์วางแผนทริปง่ายๆ</h2></div>
          <div class="how">
            <div class="how-card"><span class="em c-amber">${icon('sliders')}</span><div><h3>1. กำหนดความต้องการ</h3><p>ระบุจังหวัด งบประมาณ จำนวนวัน คน และสไตล์การท่องเที่ยวที่คุณชอบ</p></div></div>
            <div class="how-card"><span class="em c-orange">${icon('map')}</span><div><h3>2. รับแผนรายวัน + แผนที่</h3><p>ระบบจัดตารางเวลา สถานที่ เวลาเดินทาง และแจกแจงค่าใช้จ่ายแยกหมวด</p></div></div>
            <div class="how-card"><span class="em c-green">${icon('sparkles')}</span><div><h3>3. เที่ยวสบายอย่างมั่นใจ</h3><p>แก้ไข บันทึก แชร์ หรือพิมพ์แผนได้ทันที ไม่ต้องกังวลว่างบจะบานปลาย</p></div></div>
          </div>
        </section>
      </div>`;
    syncHome();
    bindHome();
    // มือถือ: แถวจังหวัดเลื่อนแนวนอน — เลื่อนให้เห็นจังหวัดที่เลือกอยู่
    const sel = $('.prov[aria-pressed="true"]');
    if (sel) sel.parentElement.scrollLeft = Math.max(0, sel.offsetLeft - sel.parentElement.offsetLeft - 16);
  }

  function syncHome() {
    const f = state.form;
    const p = P.province(f.province);
    $$('[data-prov]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.prov === f.province));
    $$('[data-budget]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.budget) === f.budget));
    $$('[data-style]').forEach((b) => b.setAttribute('aria-pressed', f.styles.includes(b.dataset.style)));
    f.needs = Array.isArray(f.needs) ? f.needs : [];
    f.mode = D.MODES.some((m) => m.id === f.mode) ? f.mode : 'auto';
    $$('[data-need]').forEach((b) => b.setAttribute('aria-pressed', f.needs.includes(b.dataset.need)));
    $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === f.mode));
    const MODE_NOTE = {
      auto: 'เลือกให้ตามระดับงบ: ประหยัด = รถสาธารณะ · มาตรฐาน = แอปเรียกรถ · สบาย = เช่ารถพร้อมคนขับ',
      public: 'รถเมล์ สองแถว รถไฟ — ค่าเดินทางคิดต่อคน และเผื่อเวลารอรถ (ช้ากว่าขับรถประมาณ 1.5 เท่า)',
      drive: `ค่าน้ำมันตามระยะทางจริงของแต่ละวัน (~${D.TRAVEL.fuelPerKm} บาท/กม.) + ค่าจอด · ถ้ารวมค่าเดินทางจากกรุงเทพฯ จะคิดเป็นค่าน้ำมันไป-กลับ (ไม่รวมทางด่วน)`,
      rent: `ค่าเช่า ~${D.TRAVEL.rentPerDay.toLocaleString('th-TH')} บาท/คัน/วัน + ค่าน้ำมันตามระยะทาง · คันละไม่เกิน ${D.TRAVEL.seatsPerCar} คน`
    };
    $('#modeNote').textContent = MODE_NOTE[f.mode];
    const prof = P.profile({ needs: f.needs });
    const skipped = p.places.filter((pl) => prof.avoid.has(P.accessOf(pl.n)));
    $('#needsNote').textContent = f.needs.length
      ? `${skipped.length ? `ไม่จัด ${skipped.length} แห่งใน${p.name}ที่อาจไม่สะดวก (เช่น ${skipped.slice(0, 2).map((x) => x.n).join(', ')})` : `สถานที่ใน${p.name}เหมาะกับข้อจำกัดนี้ทั้งหมด`} · เที่ยววันละไม่เกิน ${prof.cap} ชม. — ประเมินจากข้อมูลทั่วไป ควรสอบถามสถานที่ก่อนเดินทาง`
      : 'เช่น เด็กเล็ก ผู้สูงอายุ รถเข็น — ระบบจะเลี่ยงสถานที่ที่ต้องเดินขึ้นเขา บันไดชัน หรือลุยน้ำขึ้นเรือ';
    // วันเดินทาง: วันไป + วันกลับ จากปฏิทิน → จำนวนวัน (1–10)
    const start = parseISO(f.startDate);
    const end = addDays(start, f.days - 1);
    $('#startDate').value = f.startDate;
    $('#endDate').value = isoDate(end);
    $('#startLabel').textContent = fmtDay(start, LONG_DAY);
    $('#endLabel').textContent = fmtDay(end, LONG_DAY);
    $('#daysOut').innerHTML = `<b>${f.days} วัน</b> ${f.days > 1 ? `${f.days - 1} คืน` : 'ไปเช้าเย็นกลับ'}<small>${f.days > 1 ? `${fmtDay(start)} – ${fmtDay(end)}` : fmtDay(start)}</small>`;
    $('#peopleOut').innerHTML = `${f.people}<small>คน</small>`;
    $('[data-step="people:-1"]').disabled = f.people <= 1;
    $('[data-step="people:1"]').disabled = f.people >= 20;
    const travelInput = $('#includeTravel');
    const canTravel = !!p.fromBangkok;
    travelInput.disabled = !canTravel;
    $('#travelToggle').classList.toggle('disabled', !canTravel);
    $('#travelHint').textContent = canTravel
      ? (f.mode === 'drive'
        ? `ขับรถเอง: ค่าน้ำมันไป-กลับประมาณ ${baht(P.tripCost(p, 0, { mode: 'drive', people: f.people }).cost)} (${P.tripCost(p, 0, { mode: 'drive', people: f.people }).km.toLocaleString('th-TH')} กม. ไม่รวมทางด่วน)`
        : `ประมาณ ${baht(p.fromBangkok.price[0])}–${baht(p.fromBangkok.price[1])} ต่อคน (${p.fromBangkok.mode.join(' / ')})`)
      : 'ไม่ต้องรวม — ทริปนี้อยู่ในกรุงเทพฯ';
    const perDay = f.budget / Math.max(1, f.people) / Math.max(1, f.days);
    $('#budgetNote').textContent = f.budget ? baht(perDay) : '–';
    $('#provDesc').innerHTML = `<b>${esc(p.full)}</b> · ${esc(p.blurb)}`;
    store.set(KEYS.form, f);

    const est = $('#estimate');
    if (!f.budget) {
      est.className = 'overview';
      est.innerHTML = '<div class="ov-head"><span class="em">' + icon('wallet') + '</span><div><b>กรอกงบเพื่อดูภาพรวมค่าใช้จ่าย</b><small>ระบบเลือกที่พัก อาหาร และการเดินทางให้พอดีกับงบ</small></div></div>';
      return;
    }
    const plan = P.plan({ ...f, includeTravel: f.includeTravel && canTravel });
    const s = P.summarize(plan);
    const T = D.TIERS[plan.tier];
    const scale = Math.max(s.total, s.budget, 1);
    const parts = [
      ['lodging', 'ที่พัก'], ['food', 'อาหาร'], ['transport', 'เดินทาง'], ['fees', 'กิจกรรม/ค่าเข้าชม']
    ].map(([k, label]) => ({ k, label, v: s.byCat[k], color: P.CATS[k].color, icon: P.CATS[k].icon }));
    est.className = `overview${plan.feasible ? '' : ' warn'}`;
    est.innerHTML = `
      <div class="ov-head">
        <span class="em">${plan.feasible ? icon('sparkles') : '⚠️'}</span>
        <div>${plan.feasible
          ? `<b>ระดับการท่องเที่ยวที่แนะนำ <span class="tier-badge">${T.icon} ${esc(T.label)}</span></b><small>${esc(T.lodging)} · ${esc(f.mode === 'auto' ? T.transport : D.MODES.find((m) => m.id === f.mode).label)}${plan.skipped.length ? ` · เลี่ยง ${plan.skipped.length} สถานที่ตามข้อจำกัด` : ''}${f.mealCap ? ` · อาหารไม่เกิน ${baht(f.mealCap)}/มื้อ` : ''}</small>`
          : `<b>งบอาจไม่พอสำหรับ ${esc(p.name)} ${f.days} วัน ${f.people} คน</b><small>แนะนำอย่างน้อยประมาณ ${baht(plan.minBudget)}</small>`}</div>
        <div class="ov-total"><small>ใช้ประมาณ</small><b>${baht(s.total)}</b></div>
      </div>
      <div class="ov-bar" role="img" aria-label="สัดส่วนงบ: ${parts.map((x) => `${x.label} ${baht(x.v)}`).join(', ')}${s.over ? '' : `, คงเหลือ ${baht(s.remaining)}`}">
        ${parts.map((x) => `<i style="width:${(x.v / scale) * 100}%;background:${x.color}"></i>`).join('')}
      </div>
      <div class="ov-legend">
        ${parts.map((x) => `<span><i style="background:${x.color}"></i>${x.icon} ${x.label} <b>${baht(x.v)}</b></span>`).join('')}
        <span class="${s.over ? 'over' : 'left'}"><i></i>${s.over ? 'เกินงบ' : 'คงเหลือ'} <b>${baht(Math.abs(s.remaining))}</b></span>
      </div>`;
  }

  // ---------- ปฏิทินเลือกวันไป-กลับ: แตะวันไป แล้วแตะวันกลับ (แตะวันไปซ้ำ = ไปเช้าเย็นกลับ) ----------
  const MAX_DAYS = 10;
  const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  function openRangeCalendar() {
    const f = state.form;
    const today = parseISO(isoDate(new Date()));
    let start = parseISO(f.startDate);
    let end = addDays(start, f.days - 1);
    let picking = 'start';
    let view = new Date(start.getFullYear(), start.getMonth(), 1);
    const same = (a, b) => !!a && !!b && a.getTime() === b.getTime();
    const last = () => (picking === 'end' ? addDays(start, MAX_DAYS - 1) : null);
    const count = () => Math.round((end - start) / 864e5) + 1;

    function monthHtml(m) {
      const cells = Array.from({ length: m.getDay() }, () => '<span></span>');
      const n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= n; d++) {
        const dt = new Date(m.getFullYear(), m.getMonth(), d);
        const off = dt < today || (last() && (dt < start || dt > last()));
        const picked = same(dt, start) || same(dt, end);
        const cls = ['cal-day', same(dt, start) && 'is-start', same(dt, end) && 'is-end', end && dt > start && dt < end && 'in-range', same(dt, today) && 'is-today'].filter(Boolean).join(' ');
        cells.push(`<button type="button" class="${cls}" data-cal="${isoDate(dt)}" aria-pressed="${picked}" aria-label="${fmtDay(dt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}" ${off ? 'disabled' : ''}>${d}</button>`);
      }
      return `<div class="cal-month"><h3>${m.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}</h3>
        <div class="cal-grid">${TH_DOW.map((w) => `<span class="cal-dow" aria-hidden="true">${w}</span>`).join('')}${cells.join('')}</div></div>`;
    }
    function render(focusIso) {
      const months = Array.from({ length: window.innerWidth >= 720 ? 2 : 1 }, (_, i) => new Date(view.getFullYear(), view.getMonth() + i, 1));
      const canPrev = view > new Date(today.getFullYear(), today.getMonth(), 1);
      body.innerHTML = `
        <div class="cal-status">
          <div class="cal-pick${picking === 'start' ? ' on' : ''}"><small>วันไป</small><b>${fmtDay(start, LONG_DAY)}</b></div>
          <span aria-hidden="true">→</span>
          <div class="cal-pick${picking === 'end' ? ' on' : ''}"><small>วันกลับ</small><b>${end ? fmtDay(end, LONG_DAY) : 'แตะเลือกวันกลับ'}</b></div>
        </div>
        <p class="cal-hint" aria-live="polite">${picking === 'end'
          ? `แตะวันกลับ (ไม่เกิน ${MAX_DAYS} วัน) · แตะวันไปซ้ำถ้าไปเช้าเย็นกลับ`
          : `<b>${count()} วัน ${count() > 1 ? `${count() - 1} คืน` : '(ไปเช้าเย็นกลับ)'}</b> · แตะวันที่เพื่อเลือกวันไปใหม่`}</p>
        <div class="cal-wrap">
          <button type="button" class="icon-btn cal-prev" data-calnav="-1" aria-label="เดือนก่อนหน้า" ${canPrev ? '' : 'disabled'}>‹</button>
          <div class="cal-months">${months.map(monthHtml).join('')}</div>
          <button type="button" class="icon-btn cal-next" data-calnav="1" aria-label="เดือนถัดไป">›</button>
        </div>
        <div class="sheet-actions"><button type="button" class="btn btn-light" data-close>ยกเลิก</button><button type="button" class="btn btn-primary" data-calok>ตกลง</button></div>`;
      if (focusIso) body.querySelector(`[data-cal="${focusIso}"]`)?.focus();
    }

    openSheet('เลือกวันไป-กลับ', '');
    const body = $('#sheetBody');
    render();
    setTimeout(() => body.querySelector('.cal-day.is-start')?.focus(), 60);
    body.onclick = (e) => {
      const nav = e.target.closest('[data-calnav]');
      if (nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.calnav), 1); render(); return; }
      const day = e.target.closest('[data-cal]');
      if (day && !day.disabled) {
        const dt = parseISO(day.dataset.cal);
        if (picking === 'start' || dt < start) { start = dt; end = null; picking = 'end'; }
        else { end = dt; picking = 'start'; }
        render(day.dataset.cal);
        return;
      }
      if (e.target.closest('[data-calok]')) {
        f.startDate = isoDate(start);
        f.days = end ? count() : 1; // ยังไม่เลือกวันกลับ = ไปเช้าเย็นกลับ
        closeSheet();
        syncHome();
      }
    };
    // เลื่อนเมาส์ขณะเลือกวันกลับ: ไฮไลต์ช่วงวันที่จะได้
    body.onmouseover = (e) => {
      if (picking !== 'end') return;
      const b = e.target.closest('[data-cal]');
      const to = b && !b.disabled ? parseISO(b.dataset.cal) : null;
      $$('.cal-day', body).forEach((c) => { const d = parseISO(c.dataset.cal); c.classList.toggle('preview', !!to && d > start && d <= to); });
    };
    // คีย์บอร์ด: ลูกศรเลื่อนทีละวัน/สัปดาห์ (ข้ามเดือนได้)
    body.onkeydown = (e) => {
      const b = e.target.closest('[data-cal]');
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!b || !step) return;
      e.preventDefault();
      const next = isoDate(addDays(parseISO(b.dataset.cal), step));
      const target = body.querySelector(`[data-cal="${next}"]`);
      if (target) target.focus();
      else { view = new Date(view.getFullYear(), view.getMonth() + Math.sign(step), 1); render(next); }
    };
  }

  function bindHome() {
    const form = $('#planner');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('click', (e) => {
      const f = state.form;
      const prov = e.target.closest('[data-prov]');
      if (prov) { f.province = prov.dataset.prov; syncHome(); return; }
      const bud = e.target.closest('[data-budget]');
      if (bud) { f.budget = Number(bud.dataset.budget); $('#budget').value = f.budget.toLocaleString('th-TH'); syncHome(); return; }
      const step = e.target.closest('[data-step]');
      if (step) {
        const [k, d] = step.dataset.step.split(':');
        f[k] = Math.min(k === 'days' ? 10 : 20, Math.max(1, f[k] + Number(d)));
        syncHome();
        return;
      }
      const st = e.target.closest('[data-style]');
      if (st) {
        const id = st.dataset.style;
        f.styles = f.styles.includes(id) ? f.styles.filter((x) => x !== id) : [...f.styles, id];
        syncHome();
        return;
      }
      const need = e.target.closest('[data-need]');
      if (need) {
        const id = need.dataset.need;
        f.needs = f.needs.includes(id) ? f.needs.filter((x) => x !== id) : [...f.needs, id];
        syncHome();
        return;
      }
      const mode = e.target.closest('[data-mode]');
      if (mode) { f.mode = mode.dataset.mode; syncHome(); }
    });
    $('#mealCap').addEventListener('change', (e) => { state.form.mealCap = Number(e.target.value) || 0; syncHome(); });
    $('#lodgingRate').addEventListener('input', (e) => { state.form.lodgingRate = Math.min(100000, Math.max(0, Number(e.target.value) || 0)); syncHome(); });
    $('#budget').addEventListener('input', (e) => {
      const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 8);
      state.form.budget = Number(digits) || 0;
      e.target.value = digits ? Number(digits).toLocaleString('th-TH') : '';
      $('#formError').hidden = true;
      syncHome();
    });
    $('#includeTravel').addEventListener('change', (e) => { state.form.includeTravel = e.target.checked; syncHome(); });
    // เปลี่ยนวันไป: คงจำนวนวันไว้ วันกลับเลื่อนตาม · เปลี่ยนวันกลับ: คำนวณจำนวนวันใหม่
    $('#startDate').addEventListener('change', (e) => {
      if (parseISO(e.target.value)) state.form.startDate = e.target.value;
      else e.target.value = state.form.startDate; // ลบวันที่ทิ้ง → คืนค่าเดิม
      syncHome();
    });
    $('#endDate').addEventListener('change', (e) => {
      const s = parseISO(state.form.startDate);
      const en = parseISO(e.target.value);
      if (en) state.form.days = Math.min(10, Math.max(1, Math.round((en - s) / 864e5) + 1));
      syncHome();
    });
    $('#datePick').addEventListener('click', openRangeCalendar);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = state.form;
      const err = $('#formError');
      if (!f.budget || f.budget < 100) {
        err.textContent = 'กรุณากรอกงบประมาณรวม (อย่างน้อย 100 บาท)';
        err.hidden = false;
        $('#budget').focus();
        return;
      }
      const p = P.province(f.province);
      const plan = P.plan({ ...f, includeTravel: f.includeTravel && !!p.fromBangkok });
      plan.saved = false;
      state.plan = plan;
      writePlan(plan);
      location.hash = `#/plan/${plan.id}`;
    });
  }

  // ---------- Saved plans ----------
  function renderSaved() {
    const list = savedList();
    app.innerHTML = `
      <div class="wrap">
        <section class="section" style="margin-top:24px">
          <div class="section-head"><h2>แผนของฉัน</h2><a class="btn btn-primary btn-sm" href="#/">＋ วางแผนใหม่</a></div>
          ${list.length ? `<div class="saved-grid">${list.map(savedCard).join('')}</div>` : `
          <div class="empty"><div class="em">🧳</div><h3>ยังไม่มีแผนที่บันทึกไว้</h3><p>จัดแผนเที่ยวแล้วกด “บันทึกแผน” เพื่อเก็บไว้ในเบราว์เซอร์นี้</p><a class="btn btn-primary" href="#/">เริ่มวางแผน</a></div>`}
        </section>
        <section class="card backup">
          <div class="backup-text"><h2>💾 สำรองและย้ายแผน</h2>
            <p>แผนเก็บอยู่ในเบราว์เซอร์นี้เท่านั้น ถ้าล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่องแผนจะหาย — ส่งออกเป็นไฟล์เก็บไว้ แล้วนำเข้าในเครื่องอื่นได้</p></div>
          <div class="backup-actions">
            <button type="button" class="btn btn-light" data-export ${list.length ? '' : 'disabled'}>⬇️ ส่งออกทั้งหมด (${list.length})</button>
            <label class="btn btn-light file-btn">⬆️ นำเข้าจากไฟล์<input type="file" id="importFile" accept=".json,application/json"></label>
          </div>
        </section>
      </div>`;
  }

  // ---------- Plan page ----------
  function numbering(day) {
    const map = {};
    let n = 0;
    for (const it of day.items) if (it.ll && it.kind !== 'lodging') map[it.id] = ++n;
    return map;
  }

  function renderPlan(id) {
    const plan = findPlan(id);
    if (!plan) {
      app.innerHTML = `<div class="wrap"><div class="empty" style="margin-top:32px"><div class="em">🔎</div><h3>ไม่พบแผนนี้</h3><p>แผนอาจถูกลบ หรือบันทึกไว้ในเบราว์เซอร์อื่น</p><a class="btn btn-primary" href="#/">วางแผนใหม่</a></div></div>`;
      return;
    }
    state.plan = plan;
    state.mapDay = 'all';
    const p = P.province(plan.provinceId);
    const T = D.TIERS[plan.tier];
    const styles = plan.input.styles.map((s) => D.STYLES.find((x) => x.id === s)).filter(Boolean);
    app.innerHTML = `
      <div class="wrap">
        <div class="plan-top">
          <a class="btn btn-ghost btn-sm" href="#/" data-edit-input>← แก้ข้อมูลทริป</a>
          <div class="plan-actions">
            <button class="btn btn-light btn-sm" data-act="regen" title="จัดแผนใหม่จากข้อมูลเดิม">🔄 <span class="lbl">จัดใหม่</span></button>
            <button class="btn btn-light btn-sm" data-act="share" title="แชร์ หรือพิมพ์เป็น PDF">📤 <span class="lbl">แชร์/พิมพ์</span></button>
            <button class="btn btn-primary btn-sm" data-act="save" id="saveBtn"></button>
          </div>
        </div>
        <section class="trip-hero${photoOf(p.id) ? ' has-photo' : ''}" style="background:${grad(p)}">
          ${photoOf(p.id) ? `<img class="cover" src="${esc(photoOf(p.id).src)}" alt="" decoding="async">` : '<span class="em-bg" aria-hidden="true">' + p.emoji + '</span>'}
          <div class="kicker">แผนเที่ยว${esc(p.full)} · ${esc(p.region)}</div>
          <h1><span id="planTitle">${esc(plan.title)}</span> <button class="icon-btn" data-act="rename" aria-label="แก้ชื่อแผน">✏️</button></h1>
          <div class="meta-chips">
            ${tripRange(plan) ? `<span>🗓️ ${esc(tripRange(plan))}</span>` : ''}
            <span>📅 ${plan.input.days} วัน ${Math.max(0, plan.input.days - 1)} คืน</span>
            <span>👥 ${plan.input.people} คน</span>
            <span>${T.icon} ระดับ${esc(T.label)}</span>
            ${styles.map((s) => `<span>${s.icon} ${esc(s.label)}</span>`).join('')}
            ${plan.input.includeTravel ? '<span>🧭 รวมค่าเดินทางจากกรุงเทพฯ</span>' : ''}
            ${plan.input.mode && plan.input.mode !== 'auto' ? `<span>${D.MODES.find((m) => m.id === plan.input.mode)?.icon || ''} ${esc(D.MODES.find((m) => m.id === plan.input.mode)?.label || '')}</span>` : ''}
            ${(plan.input.needs || []).map((n) => D.NEEDS.find((x) => x.id === n)).filter(Boolean).map((n) => `<span>${n.icon} ${esc(n.label)}</span>`).join('')}
            ${plan.input.mealCap ? `<span>🍽️ ไม่เกิน ${baht(plan.input.mealCap)}/มื้อ</span>` : ''}
          </div>
        </section>
        <div class="grid-2">
          <section class="card" id="summary" aria-live="polite"></section>
          <section class="card map-card">
            <div class="card-title"><h2>🗺️ แผนที่ทริป</h2><div class="title-actions"><span class="est-tag">ตำแหน่งโดยประมาณ</span><button class="btn btn-light btn-sm" data-add-custom>＋ ปักหมุดเอง</button></div></div>
            <div class="map-filter" id="mapFilter" role="group" aria-label="กรองแผนที่ตามวัน"></div>
            <div id="map" role="region" aria-label="แผนที่สถานที่ในแผน"></div>
            <p class="map-note">หมายเลขบนหมุดตรงกับลำดับในแผน · ＋ = สถานที่ใกล้เคียงที่ยังไม่ได้ไป · 🛏️ = ที่พัก · เลือกวันเพื่อดูเวลาเดินทางแต่ละช่วง · เส้นประคือแนวทางโดยประมาณ ไม่ใช่เส้นทางถนนจริง</p>
          </section>
        </div>
        <section class="card nearby-card" id="nearby"></section>
        <section class="card checklist-card" aria-labelledby="checklistTitle">
          <div class="card-title"><h2 id="checklistTitle">✅ เช็กลิสต์ก่อนออกเดินทาง</h2><span class="est-tag">คำแนะนำ · โปรดยืนยันกับผู้ให้บริการ</span></div>
          <div class="checklist">
            <label><input type="checkbox"><span>ตรวจพยากรณ์อากาศและประกาศเตือนภัยใกล้วันเดินทาง <a href="https://www.tmd.go.th/" target="_blank" rel="noopener">กรมอุตุนิยมวิทยา ↗</a></span></label>
            <label><input type="checkbox"><span>ยืนยันเวลาเปิด วันหยุด ค่าเข้า และข้อจำกัดการเข้าชมกับสถานที่โดยตรง <a href="https://www.google.com/search?q=${encodeURIComponent(p.full + ' สถานที่ท่องเที่ยว เว็บไซต์ทางการ') }" target="_blank" rel="noopener">ค้นหาเว็บไซต์สถานที่ ↗</a></span></label>
            <label><input type="checkbox"><span>จองที่พักและการเดินทางล่วงหน้า โดยเฉพาะวันหยุดและช่วงเทศกาล</span></label>
            <label><input type="checkbox"><span>เตรียมบัตรประชาชน ยาประจำตัว เงินสด/ช่องทางชำระเงิน และเบอร์ติดต่อฉุกเฉิน</span></label>
            <label><input type="checkbox"><span>ตรวจเส้นทางจริง เวลารถ และเงื่อนไขยกเลิกกับผู้ให้บริการก่อนออกเดินทาง</span></label>
          </div>
        </section>
        <nav class="day-nav" id="dayNav" aria-label="ไปยังวัน"></nav>
        <div id="days"></div>
        <div class="disclaimer"><span>⚠️</span><span>ราคา ค่าเข้าชม เวลาเดินทาง และตำแหน่งบนแผนที่ทั้งหมดเป็น <b>ค่าประมาณจากข้อมูลตัวอย่าง</b> (ปรับปรุง ${esc(D.UPDATED)}) ไม่ใช่ข้อมูลสด กรุณาตรวจสอบราคาและเวลาเปิด-ปิดกับแหล่งข้อมูลทางการก่อนเดินทาง</span></div>
        <div class="plan-foot">
          <button class="btn btn-primary" data-act="share">📤 แชร์ให้เพื่อน / พิมพ์ PDF</button>
          <a class="btn btn-light" href="#/" data-edit-input>✏️ แก้ข้อมูลทริป</a>
          <a class="btn btn-light" href="#/saved">📚 แผนของฉัน</a>
        </div>
      </div>
      <div class="bottom-bar" id="bottomBar"></div>`;
    document.body.classList.add('has-bar');
    refresh();
    initMap();
  }

  function refresh() {
    renderSummary();
    renderDays();
    renderNearby();
    renderSaveState();
    updateMap(false);
  }

  // สถานที่ใกล้เคียงที่ยังไม่อยู่ในแผน
  function renderNearby() {
    const el = $('#nearby');
    if (!el) return;
    const list = P.nearbyPlaces(state.plan, { maxKm: 20, limit: 8 });
    if (!list.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `
      <div class="card-title"><h2>📍 สถานที่ใกล้เคียงที่ยังไม่ได้ไป</h2><span class="est-tag">ระยะทาง/เวลาโดยประมาณ</span></div>
      <div class="nearby-list">${list.map((x) => {
        const T = D.TYPES[x.place.t];
        const cost = ((x.place.fee || 0) + (x.place.spend || 0)) * state.plan.input.people;
        return `
          <div class="nearby-item">
            <span class="item-icon" style="background:${tint(dayColor(x.day))}">${T.icon}</span>
            <div class="s-main"><b>${esc(x.place.n)}</b><small>ใกล้ “${esc(shortName(x.near.name))}” · ${x.km} กม. · 🚗 ~${dur(x.mins)} · ${cost ? baht(cost) : 'ฟรี'}</small></div>
            <button class="btn btn-light btn-sm" data-addnear="${x.day}|${esc(x.place.n)}" aria-label="เพิ่ม ${esc(x.place.n)} ลงวันที่ ${x.day + 1}">＋ วันที่ ${x.day + 1}</button>
          </div>`;
      }).join('')}</div>`;
  }
  const shortName = (s) => (s.length > 22 ? s.slice(0, 22) + '…' : s);

  function addNear(key) {
    const [di, name] = key.split('|');
    const day = state.plan.days[Number(di)];
    const item = day && P.makePlaceItem(state.plan, name, Number(di));
    if (!item) return;
    day.items.push(item);
    state.map?.closePopup();
    commit(`เพิ่ม “${shortName(name)}” ลงวันที่ ${day.n} แล้ว`, item.id);
  }

  function renderSummary() {
    const plan = state.plan;
    const s = P.summarize(plan);
    const scale = Math.max(s.total, s.budget, 1);
    const ratio = s.budget ? s.total / s.budget : 1;
    const remainCls = s.over ? 'over' : ratio > 0.95 ? 'tight' : '';
    const cats = Object.entries(P.CATS);
    const perDay = s.total / plan.input.people / plan.input.days;
    $('#summary').innerHTML = `
      <div class="card-title"><h2>💰 สรุปค่าใช้จ่าย</h2><span class="est-tag">ค่าประมาณ</span></div>
      <div class="money-row">
        <div class="money-box"><small>ใช้ไปทั้งหมด</small><b id="totalSpent">${baht(s.total)}</b><small>จากงบ ${baht(s.budget)}</small></div>
        <div class="money-box remain ${remainCls}"><small>${s.over ? 'เกินงบ' : 'เงินคงเหลือ'}</small><b id="remaining">${baht(Math.abs(s.remaining))}</b><small>${s.over ? 'ลองลบหรือลดบางรายการ' : `${Math.round((s.remaining / Math.max(1, s.budget)) * 100)}% ของงบ`}</small></div>
      </div>
      <div class="meter">
        <div class="meter-bar" role="img" aria-label="สัดส่วนค่าใช้จ่ายเทียบกับงบ">${cats.map(([k, c]) => `<i style="width:${(s.byCat[k] / scale) * 100}%;background:${c.color}"></i>`).join('')}</div>
        <div class="meter-foot"><span>฿0</span><span>${s.over ? `ใช้ไป ${baht(s.total)}` : `งบ ${baht(s.budget)}`}</span></div>
      </div>
      <div class="cats">${cats.map(([k, c]) => `
        <div class="cat" data-cat-total="${k}"><span class="em" style="background:${tint(c.color)}">${c.icon}</span><div><small>${c.label}</small><b>${baht(s.byCat[k])}</b></div><span class="pct">${s.total ? Math.round((s.byCat[k] / s.total) * 100) : 0}%</span></div>`).join('')}</div>
      <p class="per-person">เฉลี่ย <b>${baht(s.perPerson)}</b> ต่อคน · ${baht(perDay)} ต่อคนต่อวัน · ${s.places} สถานที่</p>
      ${!s.over && s.budget && s.remaining / s.budget > 0.3 ? `
      <div class="tip"><span class="em">💡</span><span>งบยังเหลืออีก ${baht(s.remaining)} — เพิ่มสถานที่ใกล้เคียงด้านล่าง หรือกด ✏️ ที่รายการ “ที่พัก” เพื่อปรับเป็นที่พักที่ดีขึ้นได้</span></div>` : ''}
      ${!plan.feasible || s.over ? `
      <div class="alert"><span class="em">⚠️</span><div><b>${s.over ? 'ค่าใช้จ่ายเกินงบ' : 'งบอาจไม่พอสำหรับทริปนี้'}</b><p>งบที่แนะนำสำหรับ ${plan.input.days} วัน ${plan.input.people} คน แบบประหยัดอย่างน้อยประมาณ ${baht(plan.minBudget)}</p>
      ${plan.minBudget > plan.input.budget ? `<button class="btn btn-light btn-sm" data-act="usemin">ใช้งบ ${baht(plan.minBudget)} แล้วจัดใหม่</button>` : ''}</div></div>` : ''}`;
    $('#bottomBar').innerHTML = `
      <div class="wrap bottom-in">
        <div class="bb-stat"><small>ใช้ไป</small><b>${baht(s.total)}</b></div>
        <div class="bb-stat remain ${remainCls}"><small>${s.over ? 'เกินงบ' : 'คงเหลือ'}</small><b>${baht(Math.abs(s.remaining))}</b></div>
        <button class="btn btn-primary btn-sm" data-act="save" id="saveBtn2"></button>
      </div>`;
  }

  function renderSaveState() {
    const saved = !!state.plan.saved;
    for (const b of [$('#saveBtn'), $('#saveBtn2')].filter(Boolean)) {
      b.innerHTML = saved ? '✅ <span class="lbl">บันทึกแล้ว</span>' : '💾 <span class="lbl">บันทึกแผน</span>';
      b.classList.toggle('btn-primary', !saved);
      b.classList.toggle('btn-light', saved);
      b.title = saved ? 'บันทึกแล้ว — การแก้ไขจะบันทึกอัตโนมัติ' : 'บันทึกแผนไว้ในเบราว์เซอร์นี้';
    }
  }

  const ACCESS_TAG = {
    hard: '<span class="access-tag hard" title="ประเมินจากข้อมูลทั่วไป">⛰️ ทางชัน/เดินป่า/ขึ้นเรือ</span>',
    some: '<span class="access-tag" title="ประเมินจากข้อมูลทั่วไป">🚶 เดินค่อนข้างมาก</span>'
  };
  function itemHtml(it, di, no) {
    const c = P.CATS[it.cat] || P.CATS.fees;
    const color = dayColor(di);
    const people = state.plan.input.people;
    const per = it.cost > 0 && people > 1 && (it.kind === 'place' || it.kind === 'meal' || it.kind === 'trip') ? `<small>≈ ${baht(it.cost / people)}/คน</small>` : '';
    return `
      <div class="item" id="it-${it.id}">
        <div class="item-time">${esc(it.time)}</div>
        <article class="item-card">
          <div class="item-icon" style="background:${tint(c.color)}">${it.icon || c.icon}${no ? `<span class="no" style="background:${color}">${no}</span>` : ''}</div>
          <div class="item-main">
            <div class="item-name">${esc(it.name)}</div>
            <div class="item-meta">
              <span class="tag" style="background:${tint(c.color)};color:color-mix(in srgb, ${c.color} 52%, #000)">${c.icon} ${c.label}</span>
              ${it.typeLabel ? `<span>${esc(it.typeLabel)}</span>` : ''}
              ${ACCESS_TAG[it.access] || ''}
              ${it.zoneLabel && it.kind !== 'lodging' ? `<span>📍 ${esc(it.zoneLabel)}</span>` : ''}
              ${it.mins ? `<span>⏱️ ${dur(it.mins)}</span>` : ''}
            </div>
            ${it.note ? `<div class="item-note">${esc(it.note)}</div>` : ''}
            ${openWarning(it, dayDate(state.plan, di))}
          </div>
          <div class="item-side">
            <div class="item-cost ${it.cost ? '' : 'free'}">${it.cost ? baht(it.cost) : 'ฟรี'}${per}</div>
            <div class="item-actions">
              ${it.ll ? `<button class="icon-btn" data-map="${di}:${it.id}" aria-label="ดู ${esc(it.name)} บนแผนที่">🗺️</button>` : ''}
              <button class="icon-btn" data-edit="${di}:${it.id}" aria-label="แก้ไข ${esc(it.name)}">✏️</button>
              <button class="icon-btn danger" data-del="${di}:${it.id}" aria-label="ลบ ${esc(it.name)}">🗑️</button>
            </div>
          </div>
        </article>
      </div>`;
  }

  function renderDays() {
    const plan = state.plan;
    $('#dayNav').innerHTML = plan.days.map((d, i) => { const dt = dayDate(plan, i); return `<a href="#day-${i + 1}" data-jump="${i}"><i style="background:${dayColor(i)}"></i>วันที่ ${d.n}${dt ? `<small>${fmtDay(dt, { weekday: 'short', day: 'numeric', month: 'short' })}</small>` : ''}</a>`; }).join('');
    $('#days').innerHTML = plan.days.map((day, di) => {
      const items = P.sortItems(day.items);
      day.items = items;
      const nums = numbering(day);
      const total = items.reduce((a, it) => a + (Number(it.cost) || 0), 0);
      const zones = [...new Set(items.filter((it) => it.kind === 'place' && it.zoneLabel).map((it) => it.zoneLabel))];
      const placeCount = items.filter((it) => it.kind === 'place' || it.kind === 'custom').length;
      const body = items.map((it) => {
        const travel = it.travel > 0 ? `<div class="travel">🚗 ${it.km != null ? `${it.km} กม. · ` : ''}ประมาณ ${dur(it.travel)}</div>` : '';
        return travel + itemHtml(it, di, nums[it.id]);
      }).join('');
      return `
        <section class="day" id="day-${di + 1}">
          <header class="day-head">
            <span class="day-badge" style="background:${dayColor(di)};color:${dayColor(di)}"><span style="color:#fff"><small>วันที่</small>${day.n}</span></span>
            <div>${dayDate(plan, di) ? `<span class="day-date">🗓️ ${esc(fmtDay(dayDate(plan, di), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span>` : ''}<h2>${zones.length ? esc(zones.slice(0, 3).join(' · ')) : 'วันที่ ' + day.n}</h2><p>${placeCount} สถานที่ · ${items.length} รายการ</p></div>
            <div class="day-cost"><b>${baht(total)}</b><small>รวมวันนี้</small></div>
          </header>
          <div class="timeline">${body || '<div class="empty">ยังไม่มีรายการในวันนี้</div>'}</div>
          <div class="add-row"><button class="add-btn" data-add="${di}">＋ เพิ่มรายการ</button></div>
        </section>`;
    }).join('');
  }

  // ---------- Map (Leaflet + OpenStreetMap) ----------
  // ชั้นภาพแผนที่: OpenStreetMap ไม่อนุญาตให้โหลดไทล์จากหน้าเว็บที่เปิดเป็นไฟล์ (file://) — ใช้แผนที่สำรอง Esri แทน
  // และสลับไปแผนที่สำรองอัตโนมัติถ้าไทล์ OSM โหลดไม่ขึ้นหลายครั้ง
  function addBaseTiles(map) {
    const fallbackTiles = () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, crossOrigin: true, // อ่านไทล์แบบ CORS เพื่อให้ service worker เก็บไว้ดูออฟไลน์ได้
      attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
    });
    if (location.protocol === 'file:') { fallbackTiles().addTo(map); return; }
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, crossOrigin: true, // อ่านไทล์แบบ CORS เพื่อให้ service worker เก็บไว้ดูออฟไลน์ได้
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);
    let failed = 0;
    osm.on('tileerror', () => {
      if (++failed !== 4 || !map._container?.isConnected) return;
      map.removeLayer(osm);
      fallbackTiles().addTo(map);
    });
  }

  // ---------- ปักหมุดสถานที่เอง (ค้นหาชื่อ หรือแตะบนแผนที่) ----------
  const toLL = (ll) => [Math.round(ll.lat * 1e5) / 1e5, Math.round(ll.lng * 1e5) / 1e5];

  function locFieldHtml(hasLL) {
    return `
      <div class="field loc-field">
        <span>📍 ตำแหน่งบนแผนที่ <em>(ไม่บังคับ)</em></span>
        <div class="loc-search">
          <input type="search" id="locQ" placeholder="ค้นหาชื่อสถานที่ เช่น ร้านกาแฟ วัด ตลาด" autocomplete="off" aria-label="ค้นหาตำแหน่งสถานที่">
          <button type="button" class="btn btn-light btn-sm" id="locGo">🔎 ค้นหา</button>
        </div>
        <div class="loc-results" id="locResults" hidden></div>
        <div class="loc-map" id="locMap" role="region" aria-label="แผนที่สำหรับปักหมุด"></div>
        <div class="loc-status" id="locStatus">${hasLL ? '✅ ปักหมุดแล้ว — แตะที่อื่นหรือลากหมุดเพื่อย้าย' : '👆 แตะบนแผนที่เพื่อปักหมุด หรือค้นหาจากชื่อ'}</div>
        <button type="button" class="link-btn" id="locClear" ${hasLL ? '' : 'hidden'}>ล้างตำแหน่ง</button>
      </div>`;
  }

  // ผูกช่องเลือกตำแหน่งในแผ่นล่าง คืนค่า { get ll() } · onName เรียกเมื่อเลือกผลค้นหา (เติมชื่อให้ถ้ายังว่าง)
  function bindLocField({ ll = null, onName } = {}) {
    const box = { ll };
    const el = $('#locMap');
    const status = $('#locStatus');
    const p = P.province(state.plan.provinceId);
    const center = p.center || [13.75, 100.5];
    if (!window.L) { el.outerHTML = '<div class="map-fallback">โหลดแผนที่ไม่สำเร็จ — ยังเพิ่มรายการโดยไม่ปักหมุดได้</div>'; return box; }
    const map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
    addBaseTiles(map);
    map.setView(ll || center, ll ? 15 : 12);
    state.pickerMap = map;
    const icon = L.divIcon({ className: '', html: '<div class="pin pick"><span>★</span></div>', iconSize: [30, 30], iconAnchor: [15, 30] });
    let marker = null;
    const place = (pos, label) => {
      box.ll = pos;
      if (!marker) {
        marker = L.marker(pos, { icon, draggable: true }).addTo(map);
        marker.on('dragend', () => place(toLL(marker.getLatLng())));
      } else marker.setLatLng(pos);
      status.textContent = `✅ ปักหมุดแล้ว${label ? `: ${label}` : ''} — แตะที่อื่นหรือลากหมุดเพื่อย้าย`;
      $('#locClear').hidden = false;
    };
    if (ll) place(ll);
    map.on('click', (e) => place(toLL(e.latlng)));
    $('#locClear').addEventListener('click', () => {
      box.ll = null;
      if (marker) { map.removeLayer(marker); marker = null; }
      status.textContent = '👆 แตะบนแผนที่เพื่อปักหมุด หรือค้นหาจากชื่อ';
      $('#locClear').hidden = true;
    });
    // ค้นหาด้วย Nominatim (OpenStreetMap) — เรียกเฉพาะตอนผู้ใช้กดค้นหา จำกัดในประเทศไทยและใกล้จังหวัดที่เลือก
    const search = async () => {
      const q = $('#locQ').value.trim();
      const res = $('#locResults');
      if (q.length < 2) return;
      res.hidden = false;
      res.innerHTML = '<div class="loc-msg">กำลังค้นหา…</div>';
      try {
        const u = new URL('https://nominatim.openstreetmap.org/search');
        u.searchParams.set('format', 'jsonv2');
        u.searchParams.set('q', q);
        u.searchParams.set('countrycodes', 'th');
        u.searchParams.set('limit', '6');
        u.searchParams.set('accept-language', 'th');
        u.searchParams.set('viewbox', [center[1] - 1, center[0] + 1, center[1] + 1, center[0] - 1].join(','));
        const r = await fetch(u);
        if (!r.ok) throw new Error(String(r.status));
        const list = (await r.json()).map((x) => ({ name: x.name || String(x.display_name).split(',')[0], addr: x.display_name, ll: [Math.round(x.lat * 1e5) / 1e5, Math.round(x.lon * 1e5) / 1e5] }));
        if (!list.length) { res.innerHTML = '<div class="loc-msg">ไม่พบสถานที่นี้ ลองชื่ออื่น หรือแตะบนแผนที่เพื่อปักหมุดเอง</div>'; return; }
        res.innerHTML = list.map((x, i) => {
          const km = P.roadKm(center, x.ll);
          return `<button type="button" class="loc-item" data-loc="${i}"><b>${esc(x.name)}</b><small>${esc(x.addr)}${km != null ? ` · ห่างตัวเมือง ~${Math.round(km)} กม.` : ''}</small></button>`;
        }).join('');
        res.onclick = (e) => {
          const b = e.target.closest('[data-loc]');
          if (!b) return;
          const x = list[Number(b.dataset.loc)];
          place(x.ll, x.name);
          map.setView(x.ll, 16);
          res.hidden = true;
          onName?.(x.name);
        };
      } catch {
        res.innerHTML = '<div class="loc-msg">ค้นหาไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต) — แตะบนแผนที่เพื่อปักหมุดแทนได้</div>';
      }
    };
    $('#locGo').addEventListener('click', search);
    $('#locQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    setTimeout(() => { if (state.pickerMap === map) map.invalidateSize(); }, 150);
    return box;
  }

  // เวลาเดินทาง/ระยะทางจากรายการที่มีพิกัดก่อนหน้า (ตามเวลา) ในวันเดียวกัน
  function legFromPrevious(day, item) {
    const p = P.province(state.plan.provinceId);
    if (!item.ll) return { travel: 0, km: null };
    const t = P.parseTime(item.time);
    const prev = P.sortItems(day.items).filter((x) => x !== item && x.ll && P.parseTime(x.time) <= t && x.kind !== 'lodging').pop();
    const from = prev?.ll || p.center;
    const km = P.roadKm(from, item.ll);
    return { travel: P.driveMins(from, item.ll) || 0, km: km == null ? null : Math.round(km * 10) / 10 };
  }

  const typeOptions = (sel) => `<option value="">📌 อื่นๆ</option>` + Object.entries(D.TYPES).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('');

  function initMap() {
    const el = $('#map');
    if (!el) return;
    if (!window.L) {
      el.outerHTML = '<div class="map-fallback">🗺️ โหลดแผนที่ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า<br>ใช้ปุ่ม “ดูบน Google Maps” ในแต่ละสถานที่แทนได้</div>';
      return;
    }
    const map = L.map(el, { scrollWheelZoom: false, tap: true });
    addBaseTiles(map);
    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());
    // ปุ่มในป๊อปอัป (Leaflet หยุดการส่งต่อคลิก จึงผูก event ตอนเปิดป๊อปอัป)
    map.on('popupopen', (e) => {
      e.popup.getElement()?.querySelectorAll('[data-addnear]').forEach((b) => { b.onclick = () => addNear(b.dataset.addnear); });
    });
    state.map = map;
    state.layers = L.layerGroup().addTo(map);
    updateMap(true);
    setTimeout(() => { if (state.map === map) map.invalidateSize(); }, 80);
  }

  function destroyMap() {
    if (!state.map) return;
    const map = state.map;
    state.map = null;
    state.layers = null;
    state.markers = {};
    map.stop(); // หยุดแอนิเมชัน flyTo ที่ค้างอยู่ก่อนลบแผนที่
    map.off();
    map.remove();
  }

  function popupHtml(it, di, no) {
    const p = P.province(state.plan.provinceId);
    const leg = it.travel > 0 && it.kind !== 'lodging' ? `<div class="pop-leg">🚗 จากจุดก่อนหน้า ${it.km != null ? `${it.km} กม. · ` : ''}~${dur(it.travel)}</div>` : '';
    const near = it.kind === 'lodging' ? [] : P.unusedPlaces(state.plan)
      .filter((pl) => pl.ll)
      .map((pl) => ({ pl, km: Math.round(P.roadKm(it.ll, pl.ll) * 10) / 10 }))
      .filter((x) => x.km <= 10)
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
    const nearHtml = near.length ? `<div class="pop-near"><span>ใกล้ ๆ ที่นี่</span>${near.map((x) => `<button type="button" data-addnear="${di}|${esc(x.pl.n)}" title="เพิ่มลงวันที่ ${di + 1}">＋ ${esc(shortName(x.pl.n))} <small>${x.km} กม.</small></button>`).join('')}</div>` : '';
    return `<div class="pop"><b>${no ? `${no}. ` : ''}${esc(it.name)}</b><small>วันที่ ${di + 1} · ${esc(it.time)}${it.mins ? ` · อยู่ ${dur(it.mins)}` : ''}${it.cost ? ` · ${baht(it.cost)}` : ' · ฟรี'}</small>${leg}${nearHtml}<a href="${mapsUrl(it.kind === 'lodging' ? `โรงแรม ${it.zoneLabel || ''}` : it.name, p)}" target="_blank" rel="noopener">เปิดใน Google Maps ↗</a></div>`;
  }

  function nearPopupHtml(x) {
    const T = D.TYPES[x.place.t];
    const cost = ((x.place.fee || 0) + (x.place.spend || 0)) * state.plan.input.people;
    return `<div class="pop"><b>${T.icon} ${esc(x.place.n)}</b><small>${esc(T.label)} · ใช้เวลา ${dur(x.place.h * 60)} · ${cost ? baht(cost) : 'ฟรี'}</small>
      <div class="pop-leg">📍 ใกล้ “${esc(shortName(x.near.name))}” ${x.km} กม. · 🚗 ~${dur(x.mins)}</div>
      ${x.place.note ? `<small>${esc(x.place.note)}</small>` : ''}
      <button type="button" class="pop-add" data-addnear="${x.day}|${esc(x.place.n)}">＋ เพิ่มลงวันที่ ${x.day + 1}</button></div>`;
  }

  function updateMap(fit) {
    const plan = state.plan;
    renderMapFilter();
    if (!state.map || !plan) return;
    const p = P.province(plan.provinceId);
    state.layers.clearLayers();
    state.markers = {};
    const bounds = [];
    let hotelAdded = false;
    plan.days.forEach((day, di) => {
      if (state.mapDay !== 'all' && state.mapDay !== di) return;
      const nums = numbering(day);
      const color = dayColor(di);
      const route = p.center ? [p.center] : [];
      const legLabels = state.mapDay === di; // แสดงเวลาเดินทางแต่ละช่วงเมื่อเลือกดูทีละวัน
      for (const it of P.sortItems(day.items)) {
        if (!it.ll) continue;
        if (it.kind === 'lodging') {
          if (!hotelAdded) {
            const icon = L.divIcon({ className: '', html: '<div class="pin hotel"><span>🛏️</span></div>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
            const m = L.marker(it.ll, { icon, title: it.name, zIndexOffset: -100 }).bindPopup(popupHtml(it, di, 0));
            state.layers.addLayer(m);
            hotelAdded = true;
          }
          state.markers[it.id] = state.markers[it.id] || null;
          bounds.push(it.ll);
          continue;
        }
        const no = nums[it.id];
        const icon = L.divIcon({ className: '', html: `<div class="pin" style="background:${color}"><span>${no}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });
        const m = L.marker(it.ll, { icon, title: `${no}. ${it.name}`, riseOnHover: true }).bindPopup(popupHtml(it, di, no));
        state.layers.addLayer(m);
        state.markers[it.id] = m;
        const prev = route[route.length - 1];
        if (legLabels && prev && it.travel > 0) {
          const mid = [(prev[0] + it.ll[0]) / 2, (prev[1] + it.ll[1]) / 2];
          state.layers.addLayer(L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: `<div class="leg" style="border-color:${color}">🚗 ${dur(it.travel)}</div>`, iconSize: [0, 0] }) }));
        }
        route.push(it.ll);
        bounds.push(it.ll);
      }
      if (route.length > 1) state.layers.addLayer(L.polyline(route, { color, weight: 4, opacity: 0.75, dashArray: '2 9', lineCap: 'round' }));
    });
    if (state.showNearby) {
      for (const x of P.nearbyPlaces(plan, { maxKm: 20, limit: 15 })) {
        if (state.mapDay !== 'all' && state.mapDay !== x.day) continue;
        const icon = L.divIcon({ className: '', html: '<div class="pin near"><span>＋</span></div>', iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -10] });
        state.layers.addLayer(L.marker(x.place.ll, { icon, title: `ใกล้เคียง: ${x.place.n}`, zIndexOffset: -200 }).bindPopup(nearPopupHtml(x)));
      }
    }
    if (fit) {
      if (bounds.length) state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      else state.map.setView(p.center || [13.75, 100.5], 11);
    }
  }

  function renderMapFilter() {
    const el = $('#mapFilter');
    if (!el || !state.plan) return;
    el.innerHTML = `<button class="chip" data-mapday="all" aria-pressed="${state.mapDay === 'all'}">ทั้งหมด</button>` +
      state.plan.days.map((d, i) => `<button class="chip" data-mapday="${i}" aria-pressed="${state.mapDay === i}"><i style="background:${dayColor(i)}"></i>วันที่ ${d.n}</button>`).join('') +
      `<button class="chip" data-nearby-toggle aria-pressed="${state.showNearby}">＋ ที่ใกล้เคียง</button>`;
  }

  function focusOnMap(di, id) {
    if (!state.map) return;
    if (state.mapDay !== 'all' && state.mapDay !== di) { state.mapDay = 'all'; updateMap(false); }
    const it = state.plan.days[di].items.find((x) => x.id === id);
    if (!it?.ll) return;
    $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const map = state.map;
    map.flyTo(it.ll, 15, { duration: 0.6 });
    const m = state.markers[id];
    if (m) setTimeout(() => { if (state.map === map && map.hasLayer(m)) m.openPopup(); }, 650);
  }

  // ---------- Edit / delete / add ----------
  const findItem = (key) => {
    const [di, id] = key.split(':');
    const day = state.plan.days[Number(di)];
    return { di: Number(di), day, it: day?.items.find((x) => x.id === id) };
  };

  function commit(msg, flashId) {
    writePlan(state.plan, { quiet: false });
    refresh();
    if (flashId) {
      const el = $(`#it-${CSS.escape(flashId)} .item-card`);
      if (el) { el.classList.add('flash'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
    if (msg) toast(msg);
  }

  const catOptions = (sel) => Object.entries(P.CATS).map(([k, c]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('');

  function openEdit(key) {
    const { di, it } = findItem(key);
    if (!it) return;
    const days = state.plan.days;
    openSheet('แก้ไขรายการ', `
      <form id="editForm" novalidate>
        <label class="field"><span>ชื่อรายการ</span><input name="name" required maxlength="120" value="${esc(it.name)}"></label>
        ${it.kind === 'custom' ? locFieldHtml(!!it.ll) : ''}
        <div class="field-row">
          <label class="field"><span>หมวดค่าใช้จ่าย</span><select name="cat">${catOptions(it.cat)}</select></label>
          <label class="field"><span>ค่าใช้จ่าย (บาท)</span><input name="cost" type="number" inputmode="numeric" min="0" step="10" value="${Math.round(it.cost || 0)}"><small>รวมทั้งกลุ่ม ${state.plan.input.people} คน</small></label>
        </div>
        <div class="field-row">
          <label class="field"><span>เวลาเริ่ม</span><input name="time" type="time" value="${esc(it.time)}"></label>
          <label class="field"><span>ใช้เวลา (นาที)</span><input name="mins" type="number" inputmode="numeric" min="0" step="15" value="${Math.round(it.mins || 0)}"></label>
        </div>
        ${days.length > 1 ? `<label class="field"><span>อยู่ในวันที่</span><select name="day">${days.map((d, i) => `<option value="${i}" ${i === di ? 'selected' : ''}>วันที่ ${d.n}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>หมายเหตุ</span><textarea name="note" maxlength="300">${esc(it.note || '')}</textarea></label>
        <p class="form-error" id="editError" hidden></p>
        <div class="sheet-actions">
          <button type="button" class="btn btn-danger" data-sheet-del>🗑️ ลบรายการ</button>
          <button type="submit" class="btn btn-primary">บันทึกการแก้ไข</button>
        </div>
      </form>`);
    const form = $('#editForm');
    const loc = it.kind === 'custom' ? bindLocField({ ll: it.ll || null }) : null;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      if (!name) { $('#editError').textContent = 'กรุณาใส่ชื่อรายการ'; $('#editError').hidden = false; return; }
      it.name = name;
      if (loc) it.ll = loc.ll || null;
      it.cat = P.CATS[fd.get('cat')] ? fd.get('cat') : it.cat;
      it.cost = Math.max(0, Math.round(Number(fd.get('cost')) || 0));
      it.time = /^\d{2}:\d{2}$/.test(fd.get('time')) ? fd.get('time') : it.time;
      it.mins = Math.max(0, Math.round(Number(fd.get('mins')) || 0));
      it.note = String(fd.get('note') || '').trim();
      const to = fd.has('day') ? Number(fd.get('day')) : di;
      if (to !== di && state.plan.days[to]) {
        state.plan.days[di].items = state.plan.days[di].items.filter((x) => x !== it);
        state.plan.days[to].items.push(it);
      }
      if (it.kind === 'custom') Object.assign(it, legFromPrevious(state.plan.days[to] || state.plan.days[di], it));
      closeSheet();
      commit('แก้ไขรายการแล้ว', it.id);
    });
    $('[data-sheet-del]').addEventListener('click', () => { closeSheet(); deleteItem(key); });
  }

  function deleteItem(key) {
    const { di, day, it } = findItem(key);
    if (!it) return;
    const index = day.items.indexOf(it);
    day.items.splice(index, 1);
    state.undo = { di, it, index, planId: state.plan.id };
    commit();
    toast(`ลบ “${it.name.length > 26 ? it.name.slice(0, 26) + '…' : it.name}” แล้ว`, {
      label: 'เลิกทำ',
      fn: () => {
        const u = state.undo;
        if (!u || u.planId !== state.plan?.id) return;
        state.plan.days[u.di].items.splice(u.index, 0, u.it);
        state.undo = null;
        commit('กู้คืนรายการแล้ว', u.it.id);
      }
    });
  }

  function openAdd(di, startTab = 'suggest') {
    const plan = state.plan;
    const p = P.province(plan.provinceId);
    const day = plan.days[di];
    const lastItem = P.sortItems(day.items).filter((x) => x.ll && x.kind !== 'lodging').pop();
    const lastZone = lastItem?.zone;
    const from = lastItem?.ll || p.center;
    const list = P.unusedPlaces(plan)
      .map((pl) => ({ pl, t: P.driveMins(from, pl.ll) ?? P.travelMins(p, lastZone, pl.z), km: P.roadKm(from, pl.ll) }))
      .sort((a, b) => a.t - b.t);
    const lastEnd = day.items.filter((x) => x.kind !== 'lodging').reduce((m, x) => Math.max(m, P.parseTime(x.time) + (x.mins || 0)), 9 * 60);
    const suggest = list.length ? list.map(({ pl, t, km }) => {
      const T = D.TYPES[pl.t];
      const cost = ((pl.fee || 0) + (pl.spend || 0)) * plan.input.people;
      return `
        <div class="suggest-item">
          <span class="item-icon" style="background:${tint(P.CATS[pl.fee || !pl.spend ? 'fees' : 'food'].color)}">${T.icon}</span>
          <div class="s-main"><b>${esc(pl.n)}</b><small>${esc(T.label)} · ${esc(P.zoneName(p, pl.z))} · อยู่ ${dur(pl.h * 60)} · 🚗 ${km != null ? `${Math.round(km * 10) / 10} กม. ` : ''}~${dur(t)} · ${cost ? baht(cost) : 'ฟรี'}</small></div>
          <button class="btn btn-light btn-sm" data-pick="${esc(pl.n)}" aria-label="เพิ่ม ${esc(pl.n)}">＋ เพิ่ม</button>
        </div>`;
    }).join('') : '<div class="empty">ใส่สถานที่แนะนำครบทุกแห่งแล้ว — เพิ่มรายการเองได้ที่แท็บ “เพิ่มเอง”</div>';
    openSheet(`เพิ่มรายการ · วันที่ ${day.n}`, `
      <div class="tabs" role="tablist">
        <button role="tab" class="on" data-tab="suggest" aria-selected="true">📍 สถานที่แนะนำ (${list.length})</button>
        <button role="tab" data-tab="custom" aria-selected="false">✍️ เพิ่มสถานที่เอง</button>
      </div>
      <div data-pane="suggest"><div class="suggest">${suggest}</div></div>
      <form data-pane="custom" id="customForm" hidden novalidate>
        <label class="field"><span>ชื่อสถานที่ / รายการ</span><input name="name" required maxlength="120" placeholder="เช่น ร้านกาแฟที่อยากไป, ตลาดนัด, นวดแผนไทย"></label>
        ${locFieldHtml(false)}
        <div class="field-row">
          <label class="field"><span>ประเภท</span><select name="type">${typeOptions('')}</select></label>
          <label class="field"><span>หมวดค่าใช้จ่าย</span><select name="cat">${catOptions('fees')}</select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>ค่าใช้จ่าย (บาท)</span><input name="cost" type="number" inputmode="numeric" min="0" step="10" value="0"><small>รวมทั้งกลุ่ม</small></label>
          <label class="field"><span>เวลาเริ่ม</span><input name="time" type="time" value="${P.fmtTime(Math.min(lastEnd + 15, 22 * 60))}"></label>
        </div>
        <label class="field"><span>ใช้เวลา (นาที)</span><input name="mins" type="number" inputmode="numeric" min="0" step="15" value="60"></label>
        <label class="field"><span>หมายเหตุ</span><textarea name="note" maxlength="300"></textarea></label>
        <p class="form-error" id="customError" hidden></p>
        <div class="sheet-actions"><button type="submit" class="btn btn-primary">＋ เพิ่มลงแผน</button></div>
      </form>`);
    const body = $('#sheetBody');
    let loc = null; // สร้างแผนที่ปักหมุดตอนเปิดแท็บ (Leaflet ต้องการกล่องที่มองเห็นได้)
    const showTab = (name) => {
      $$('[data-tab]', body).forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      $$('[data-pane]', body).forEach((pane) => { pane.hidden = pane.dataset.pane !== name; });
      if (name === 'custom') {
        if (!loc) loc = bindLocField({ onName: (n) => { const f = $('#customForm [name=name]'); if (f && !f.value.trim()) f.value = n; } });
        $('#customForm [name=name]').focus({ preventScroll: true });
      }
    };
    if (startTab === 'custom') showTab('custom');
    // ใช้ onclick (แทนที่ของเดิม) — #sheetBody ถูกใช้ซ้ำทุกแผ่น ถ้าใช้ addEventListener ตัวจับคลิกของแผ่นก่อนหน้าจะค้างและทำงานซ้ำ
    body.onclick = (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { showTab(tab.dataset.tab); return; }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const item = P.makePlaceItem(plan, pick.dataset.pick, di);
        if (!item) return;
        day.items.push(item);
        closeSheet();
        commit('เพิ่มสถานที่ลงแผนแล้ว', item.id);
      }
    };
    $('#customForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get('name') || '').trim();
      if (!name) { $('#customError').textContent = 'กรุณาใส่ชื่อรายการ'; $('#customError').hidden = false; return; }
      const cat = P.CATS[fd.get('cat')] ? fd.get('cat') : 'fees';
      const type = D.TYPES[fd.get('type')] ? fd.get('type') : '';
      const item = {
        id: P.uid(), kind: 'custom', cat, name,
        icon: type ? D.TYPES[type].icon : '📌', type: type || undefined, typeLabel: type ? D.TYPES[type].label : 'สถานที่ของฉัน',
        ll: loc?.ll || null,
        time: /^\d{2}:\d{2}$/.test(fd.get('time')) ? fd.get('time') : '12:00',
        mins: Math.max(0, Math.round(Number(fd.get('mins')) || 0)),
        cost: Math.max(0, Math.round(Number(fd.get('cost')) || 0)),
        note: String(fd.get('note') || '').trim()
      };
      Object.assign(item, legFromPrevious(day, item));
      day.items.push(item);
      closeSheet();
      commit(item.ll ? 'เพิ่มสถานที่และปักหมุดบนแผนที่แล้ว' : 'เพิ่มรายการแล้ว', item.id);
    });
  }

  function openConfirm(title, text, okLabel, onOk, danger = false) {
    openSheet(title, `
      <p style="margin:0 0 18px;color:var(--muted)">${text}</p>
      <div class="sheet-actions"><button class="btn btn-light" data-close>ยกเลิก</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmOk">${okLabel}</button></div>`);
    $('#confirmOk').addEventListener('click', () => { closeSheet(); onOk(); });
  }

  function regenerate(input) {
    const old = state.plan;
    const fresh = P.plan(input || old.input);
    Object.assign(old, { input: fresh.input, tier: fresh.tier, feasible: fresh.feasible, minBudget: fresh.minBudget, days: fresh.days });
    if (!old.customTitle) old.title = fresh.title;
    writePlan(old, { quiet: false });
    renderPlan(old.id);
    toast('จัดแผนใหม่แล้ว');
  }

  function savePlan() {
    const plan = state.plan;
    if (plan.saved) { toast('แผนนี้บันทึกแล้ว — การแก้ไขจะบันทึกอัตโนมัติ'); return; }
    plan.saved = true;
    if (writePlan(plan, { quiet: false })) {
      store.del(KEYS.draft);
      renderSaveState();
      toast('บันทึกแผนไว้ในเบราว์เซอร์แล้ว ✓', { label: 'ดูแผนของฉัน', fn: () => { location.hash = '#/saved'; } });
    } else {
      plan.saved = false;
    }
  }

  function rename() {
    openSheet('ตั้งชื่อแผน', `
      <form id="renameForm"><label class="field"><span>ชื่อแผน</span><input name="title" maxlength="80" required value="${esc(state.plan.title)}"></label>
      <div class="sheet-actions"><button type="submit" class="btn btn-primary">บันทึกชื่อ</button></div></form>`);
    $('#renameForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const t = String(new FormData(e.target).get('title') || '').trim();
      if (!t) return;
      state.plan.title = t;
      state.plan.customTitle = true;
      $('#planTitle').textContent = t;
      closeSheet();
      commit('เปลี่ยนชื่อแผนแล้ว');
    });
  }

  // ---------- Sheet & toast ----------
  let lastFocus = null;
  function openSheet(title, html) {
    lastFocus = document.activeElement;
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#sheet').hidden = false;
    document.body.classList.add('locked');
    const panel = $('#sheet .sheet-panel');
    panel.tabIndex = -1;
    setTimeout(() => panel.focus({ preventScroll: true }), 30);
  }
  function closeSheet() {
    if ($('#sheet').hidden) return;
    if (state.pickerMap) { state.pickerMap.off(); state.pickerMap.remove(); state.pickerMap = null; }
    $('#sheet').hidden = true;
    $('#sheetBody').innerHTML = '';
    $('#sheetBody').onclick = $('#sheetBody').onmouseover = $('#sheetBody').onkeydown = null;
    document.body.classList.remove('locked');
    lastFocus?.focus?.({ preventScroll: true });
  }

  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    t.hidden = false;
    if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.fn(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3200);
  }

  // ---------- Global events ----------
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    if (e.target.closest('[data-credits]')) { openCredits(); return; }
    if (e.target.closest('[data-export]')) {
      downloadPlans(savedList(), 'tiew-podee-ngob-plans');
      toast('ส่งออกแผนทั้งหมดแล้ว — เก็บไฟล์ไว้ในที่ปลอดภัย');
      return;
    }
    const editInput = e.target.closest('[data-edit-input]');
    if (editInput && state.plan) { state.form = { ...state.plan.input }; store.set(KEYS.form, state.form); return; }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const plan = loadPlans()[remove.dataset.remove];
      openConfirm('ลบแผนนี้?', `แผน “${esc(plan?.title || '')}” จะถูกลบออกจากเบราว์เซอร์นี้`, '🗑️ ลบแผน', () => {
        removePlan(remove.dataset.remove);
        if (location.hash.startsWith('#/saved')) renderSaved(); else renderHome();
        toast('ลบแผนแล้ว');
      }, true);
      return;
    }
    if (!state.plan || !$('#days')) return;
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'save') savePlan();
      else if (a === 'share') openShare();
      else if (a === 'print') window.print();
      else if (a === 'rename') rename();
      else if (a === 'regen') openConfirm('จัดแผนใหม่?', 'ระบบจะจัดรายการใหม่จากข้อมูลทริปเดิม รายการที่คุณแก้ไขหรือเพิ่มเองจะถูกแทนที่', '🔄 จัดใหม่', () => regenerate());
      else if (a === 'usemin') regenerate({ ...state.plan.input, budget: state.plan.minBudget });
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openEdit(edit.dataset.edit); return; }
    const del = e.target.closest('[data-del]');
    if (del) { deleteItem(del.dataset.del); return; }
    if (e.target.closest('[data-add-custom]')) { openAdd(state.mapDay === 'all' ? 0 : state.mapDay, 'custom'); return; }
    const add = e.target.closest('[data-add]');
    if (add) { openAdd(Number(add.dataset.add)); return; }
    const mapBtn = e.target.closest('[data-map]');
    if (mapBtn) { const [di, id] = mapBtn.dataset.map.split(':'); focusOnMap(Number(di), id); return; }
    const md = e.target.closest('[data-mapday]');
    if (md) { state.mapDay = md.dataset.mapday === 'all' ? 'all' : Number(md.dataset.mapday); updateMap(true); return; }
    if (e.target.closest('[data-nearby-toggle]')) { state.showNearby = !state.showNearby; updateMap(false); return; }
    const an = e.target.closest('[data-addnear]');
    if (an) { addNear(an.dataset.addnear); return; }
    const jump = e.target.closest('[data-jump]');
    if (jump) { e.preventDefault(); $(`#day-${Number(jump.dataset.jump) + 1}`).scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'importFile') { importPlans(e.target.files?.[0]); e.target.value = ''; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSheet(); return; }
    // ขณะเปิดหน้าต่าง (sheet) ให้ Tab วนอยู่ในหน้าต่าง ไม่หลุดไปที่หน้าเว็บด้านหลัง
    if (e.key === 'Tab' && !$('#sheet').hidden) {
      const items = $$('#sheet .sheet-panel :is(a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]))').filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $('#sheet .sheet-panel'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', () => { if (!/^#day-/.test(location.hash)) route(); });

  // ---------- Boot ----------
  $('#dataUpdated').textContent = D.UPDATED;
  updateSavedCount();
  route();

  // ใช้งานออฟไลน์ (sw.js) — service worker ใช้ได้เฉพาะเมื่อเปิดผ่าน http(s) ไม่ใช่ไฟล์ในเครื่อง
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* ใช้งานต่อได้ตามปกติ */ }); });
  }
  const offlineNote = () => toast('ออฟไลน์อยู่ — เปิดแผนที่บันทึกไว้ได้ แผนที่แสดงเฉพาะบริเวณที่เคยเปิดดู');
  window.addEventListener('offline', offlineNote);
  window.addEventListener('online', () => toast('กลับมาออนไลน์แล้ว'));
  if (navigator.onLine === false) offlineNote();
  $('.skip-link')?.addEventListener('click', (e) => { e.preventDefault(); app.focus(); app.scrollIntoView(); });
})();
