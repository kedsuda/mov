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

  const DEFAULT_FORM = { province: 'chiangmai', budget: 8000, days: 3, people: 2, styles: ['nature', 'cafe'], includeTravel: false };
  const state = {
    form: { ...DEFAULT_FORM, ...(store.get(KEYS.form, {}) || {}) },
    plan: null, map: null, layers: null, markers: {}, mapDay: 'all', showNearby: true, undo: null
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
    if (m) renderPlan(m[1]);
    else if (h.startsWith('#/saved')) renderSaved();
    else renderHome();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }

  // ---------- Home ----------
  const HERO_ART = `
    <svg class="hero-art" viewBox="0 0 1440 190" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#56C1F5"/><stop offset="1" stop-color="#8ED8FA"/></linearGradient>
        <linearGradient id="hillA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FD9B9"/><stop offset="1" stop-color="#4FC49D"/></linearGradient>
        <linearGradient id="hillB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B7EBD6"/><stop offset="1" stop-color="#93DEC2"/></linearGradient>
      </defs>
      <circle cx="1210" cy="58" r="40" fill="#FFC85C"/><circle cx="1210" cy="58" r="58" fill="#FFC85C" opacity=".22"/>
      <g fill="#fff" opacity=".92"><ellipse cx="230" cy="40" rx="62" ry="16"/><ellipse cx="270" cy="30" rx="40" ry="16"/><ellipse cx="980" cy="52" rx="56" ry="14"/><ellipse cx="1015" cy="43" rx="34" ry="13"/></g>
      <path d="M0 132 L120 86 L230 120 L360 64 L500 122 L620 96 L760 128 L900 74 L1040 118 L1180 90 L1300 124 L1440 98 V190 H0Z" fill="url(#hillB)"/>
      <path d="M0 150 L150 112 L280 146 L420 104 L560 150 L700 122 L860 156 L1010 118 L1160 152 L1300 126 L1440 150 V190 H0Z" fill="url(#hillA)"/>
      <path d="M0 160 C240 150 480 172 720 162 C960 152 1200 170 1440 160 V190 H0Z" fill="url(#sea)"/>
      <g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"><path d="M120 176 q20 -8 40 0 t40 0"/><path d="M620 180 q20 -8 40 0 t40 0"/><path d="M1120 176 q20 -8 40 0 t40 0"/></g>
      <path d="M0 184 C300 178 600 190 900 184 C1140 179 1300 186 1440 183 V190 H0Z" fill="#FFE3BD"/>
    </svg>`;

  function provCard(p, selected) {
    return `
      <button type="button" class="prov" data-prov="${p.id}" aria-pressed="${selected}">
        <span class="prov-top" style="background:${grad(p)}"><span class="prov-emoji" aria-hidden="true">${p.emoji}</span><span class="prov-region">${esc(p.region)}</span></span>
        <span class="prov-body"><span class="prov-name">${esc(p.name)}</span><span class="prov-blurb">${esc(p.blurb)}</span></span>
      </button>`;
  }

  function savedCard(plan) {
    const p = P.province(plan.provinceId);
    if (!p) return '';
    const s = P.summarize(plan);
    return `
      <article class="saved-card">
        <div class="saved-top" style="background:${grad(p)}">
          <span class="em" aria-hidden="true">${p.emoji}</span>
          <h3>${esc(plan.title)}</h3>
          <small>อัปเดต ${dateTh(plan.updatedAt)} · ${esc(D.TIERS[plan.tier]?.label || '')}</small>
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
    const saved = savedList();
    app.innerHTML = `
      <section class="hero">
        <div class="wrap hero-in">
          <span class="hero-badge">🧭 วางแผนเที่ยวไทยตามงบ</span>
          <h1>เที่ยวให้คุ้ม <span class="hl">พอดีงบ</span></h1>
          <p>บอกจังหวัด งบ จำนวนวัน และสไตล์ที่ชอบ เราจัดแผนรายวัน พร้อมแผนที่และค่าใช้จ่ายโดยประมาณให้ทันที</p>
        </div>
        ${HERO_ART}
      </section>
      <div class="wrap">
        <form class="planner" id="planner" novalidate>
          <section class="step">
            <div class="step-head"><span class="step-no">1</span><h2>อยากไปจังหวัดไหน?</h2><span class="hint">${D.PROVINCES.length} จังหวัดยอดนิยม</span></div>
            <div class="prov-grid" role="group" aria-label="เลือกจังหวัด">${D.PROVINCES.map((p) => provCard(p, p.id === f.province)).join('')}</div>
          </section>
          <section class="step">
            <div class="step-head"><span class="step-no">2</span><h2>งบประมาณรวมทั้งทริป</h2></div>
            <label class="money"><span aria-hidden="true">฿</span><input id="budget" inputmode="numeric" autocomplete="off" aria-label="งบประมาณรวม (บาท)" placeholder="0" value="${f.budget ? Number(f.budget).toLocaleString('th-TH') : ''}"></label>
            <div class="chips">${[3000, 5000, 8000, 15000, 30000].map((v) => `<button type="button" class="chip" data-budget="${v}" aria-pressed="${f.budget === v}">${baht(v)}</button>`).join('')}</div>
            <p class="budget-note" id="budgetNote"></p>
          </section>
          <section class="step">
            <div class="step-head"><span class="step-no">3</span><h2>กี่วัน กี่คน?</h2></div>
            <div class="pair">
              <div class="counter"><span class="counter-label">📅 จำนวนวัน</span>
                <div class="stepper"><button type="button" data-step="days:-1" aria-label="ลดจำนวนวัน">−</button><output id="daysOut">${f.days}<small>วัน</small></output><button type="button" data-step="days:1" aria-label="เพิ่มจำนวนวัน">+</button></div></div>
              <div class="counter"><span class="counter-label">👥 จำนวนคน</span>
                <div class="stepper"><button type="button" data-step="people:-1" aria-label="ลดจำนวนคน">−</button><output id="peopleOut">${f.people}<small>คน</small></output><button type="button" data-step="people:1" aria-label="เพิ่มจำนวนคน">+</button></div></div>
            </div>
          </section>
          <section class="step">
            <div class="step-head"><span class="step-no">4</span><h2>ชอบเที่ยวแบบไหน?</h2><span class="hint">เลือกได้หลายแบบ</span></div>
            <div class="styles">${D.STYLES.map((s) => `<button type="button" class="style" data-style="${s.id}" aria-pressed="${f.styles.includes(s.id)}"><span class="em" aria-hidden="true">${s.icon}</span>${esc(s.label)}</button>`).join('')}</div>
          </section>
          <section class="step">
            <div class="step-head"><span class="step-no">5</span><h2>ค่าเดินทางไป-กลับ</h2></div>
            <label class="toggle" id="travelToggle"><input type="checkbox" id="includeTravel" ${f.includeTravel ? 'checked' : ''}><span class="switch" aria-hidden="true"></span><span class="toggle-text"><b>รวมค่าเดินทางจากกรุงเทพฯ</b><small id="travelHint"></small></span></label>
          </section>
          <div class="estimate" id="estimate" aria-live="polite"></div>
          <p class="form-error" id="formError" role="alert" hidden></p>
          <button class="btn btn-primary btn-lg btn-block submit" type="submit">✨ จัดแผนเที่ยวให้เลย</button>
        </form>

        ${saved.length ? `
        <section class="section">
          <div class="section-head"><h2>แผนที่บันทึกไว้</h2><a class="btn btn-ghost btn-sm" href="#/saved">ดูทั้งหมด (${saved.length}) →</a></div>
          <div class="saved-grid">${saved.slice(0, 3).map(savedCard).join('')}</div>
        </section>` : ''}

        <section class="section">
          <div class="section-head"><h2>ใช้งานง่ายใน 3 ขั้นตอน</h2></div>
          <div class="how">
            <div class="how-card"><span class="em" style="background:#FFF1EC">📝</span><div><h3>กรอกข้อมูลทริป</h3><p>เลือกจังหวัด งบ วัน คน และสไตล์ที่ชอบ</p></div></div>
            <div class="how-card"><span class="em" style="background:#E9FBF8">🗺️</span><div><h3>รับแผนรายวัน + แผนที่</h3><p>สถานที่ เวลา เวลาเดินทาง และค่าใช้จ่ายแยกหมวด</p></div></div>
            <div class="how-card"><span class="em" style="background:#EEF4FF">💾</span><div><h3>ปรับแต่งและบันทึก</h3><p>แก้ไข ลบ เพิ่มรายการ แล้วบันทึกไว้ดูภายหลัง</p></div></div>
          </div>
        </section>
      </div>`;
    syncHome();
    bindHome();
  }

  function syncHome() {
    const f = state.form;
    const p = P.province(f.province);
    $$('[data-prov]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.prov === f.province));
    $$('[data-budget]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.budget) === f.budget));
    $$('[data-style]').forEach((b) => b.setAttribute('aria-pressed', f.styles.includes(b.dataset.style)));
    $('#daysOut').innerHTML = `${f.days}<small>วัน</small>`;
    $('#peopleOut').innerHTML = `${f.people}<small>คน</small>`;
    $('[data-step="days:-1"]').disabled = f.days <= 1;
    $('[data-step="days:1"]').disabled = f.days >= 10;
    $('[data-step="people:-1"]').disabled = f.people <= 1;
    $('[data-step="people:1"]').disabled = f.people >= 20;
    const travelInput = $('#includeTravel');
    const canTravel = !!p.fromBangkok;
    travelInput.disabled = !canTravel;
    $('#travelToggle').classList.toggle('disabled', !canTravel);
    $('#travelHint').textContent = canTravel
      ? `ประมาณ ${baht(p.fromBangkok.price[0])}–${baht(p.fromBangkok.price[1])} ต่อคน (${p.fromBangkok.mode.join(' / ')})`
      : 'ไม่ต้องรวม — ทริปนี้อยู่ในกรุงเทพฯ';
    const perDay = f.budget / Math.max(1, f.people) / Math.max(1, f.days);
    $('#budgetNote').textContent = f.budget ? `≈ ${baht(perDay)} ต่อคนต่อวัน` : 'กรอกงบรวมของทั้งกลุ่ม';
    store.set(KEYS.form, f);

    const est = $('#estimate');
    if (!f.budget) {
      est.className = 'estimate';
      est.innerHTML = '<span class="em">💡</span><div><b>กรอกงบเพื่อดูว่าจะได้ทริประดับไหน</b><small>ระบบเลือกที่พัก อาหาร และการเดินทางให้พอดีกับงบ</small></div>';
      return;
    }
    const plan = P.plan({ ...f, includeTravel: f.includeTravel && canTravel });
    const s = P.summarize(plan);
    const T = D.TIERS[plan.tier];
    if (!plan.feasible) {
      est.className = 'estimate warn';
      est.innerHTML = `<span class="em">⚠️</span><div><b>งบนี้อาจไม่พอสำหรับ ${esc(p.name)} ${f.days} วัน ${f.people} คน</b><small>แนะนำอย่างน้อยประมาณ ${baht(plan.minBudget)} · ยังจัดแผนแบบประหยัดที่สุดให้ดูได้</small></div>`;
    } else {
      est.className = 'estimate';
      est.innerHTML = `<span class="em">${T.icon}</span><div><b>ได้ทริประดับ “${esc(T.label)}”</b><small>${esc(T.lodging)} · ${esc(T.transport)} · ใช้ประมาณ ${baht(s.total)} เหลือ ${baht(s.remaining)}</small></div>`;
    }
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
      }
    });
    $('#budget').addEventListener('input', (e) => {
      const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 8);
      state.form.budget = Number(digits) || 0;
      e.target.value = digits ? Number(digits).toLocaleString('th-TH') : '';
      $('#formError').hidden = true;
      syncHome();
    });
    $('#includeTravel').addEventListener('change', (e) => { state.form.includeTravel = e.target.checked; syncHome(); });
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
            <button class="btn btn-light btn-sm" data-act="print" title="พิมพ์แผน">🖨️ <span class="lbl">พิมพ์</span></button>
            <button class="btn btn-primary btn-sm" data-act="save" id="saveBtn"></button>
          </div>
        </div>
        <section class="trip-hero" style="background:${grad(p)}">
          <span class="em-bg" aria-hidden="true">${p.emoji}</span>
          <div class="kicker">แผนเที่ยว${esc(p.full)} · ${esc(p.region)}</div>
          <h1><span id="planTitle">${esc(plan.title)}</span> <button class="icon-btn" data-act="rename" aria-label="แก้ชื่อแผน">✏️</button></h1>
          <div class="meta-chips">
            <span>📅 ${plan.input.days} วัน ${Math.max(0, plan.input.days - 1)} คืน</span>
            <span>👥 ${plan.input.people} คน</span>
            <span>${T.icon} ระดับ${esc(T.label)}</span>
            ${styles.map((s) => `<span>${s.icon} ${esc(s.label)}</span>`).join('')}
            ${plan.input.includeTravel ? '<span>🧭 รวมค่าเดินทางจากกรุงเทพฯ</span>' : ''}
          </div>
        </section>
        <div class="grid-2">
          <section class="card" id="summary" aria-live="polite"></section>
          <section class="card map-card">
            <div class="card-title"><h2>🗺️ แผนที่ทริป</h2><span class="est-tag">ตำแหน่งโดยประมาณ</span></div>
            <div class="map-filter" id="mapFilter" role="group" aria-label="กรองแผนที่ตามวัน"></div>
            <div id="map" role="region" aria-label="แผนที่สถานที่ในแผน"></div>
            <p class="map-note">หมายเลขบนหมุดตรงกับลำดับในแผน · ＋ = สถานที่ใกล้เคียงที่ยังไม่ได้ไป · 🛏️ = ที่พัก · เลือกวันเพื่อดูเวลาเดินทางแต่ละช่วง · เส้นประคือแนวทางโดยประมาณ ไม่ใช่เส้นทางถนนจริง</p>
          </section>
        </div>
        <section class="card nearby-card" id="nearby"></section>
        <nav class="day-nav" id="dayNav" aria-label="ไปยังวัน"></nav>
        <div id="days"></div>
        <div class="disclaimer"><span>⚠️</span><span>ราคา ค่าเข้าชม เวลาเดินทาง และตำแหน่งบนแผนที่ทั้งหมดเป็น <b>ค่าประมาณจากข้อมูลตัวอย่าง</b> (ปรับปรุง ${esc(D.UPDATED)}) ไม่ใช่ข้อมูลสด กรุณาตรวจสอบราคาและเวลาเปิด-ปิดกับแหล่งข้อมูลทางการก่อนเดินทาง</span></div>
        <div class="plan-foot">
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
              <span class="tag" style="background:${tint(c.color)};color:${c.color}">${c.icon} ${c.label}</span>
              ${it.typeLabel ? `<span>${esc(it.typeLabel)}</span>` : ''}
              ${it.zoneLabel && it.kind !== 'lodging' ? `<span>📍 ${esc(it.zoneLabel)}</span>` : ''}
              ${it.mins ? `<span>⏱️ ${dur(it.mins)}</span>` : ''}
            </div>
            ${it.note ? `<div class="item-note">${esc(it.note)}</div>` : ''}
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
    $('#dayNav').innerHTML = plan.days.map((d, i) => `<a href="#day-${i + 1}" data-jump="${i}"><i style="background:${dayColor(i)}"></i>วันที่ ${d.n}</a>`).join('');
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
            <div><h2>${zones.length ? esc(zones.slice(0, 3).join(' · ')) : 'วันที่ ' + day.n}</h2><p>${placeCount} สถานที่ · ${items.length} รายการ</p></div>
            <div class="day-cost"><b>${baht(total)}</b><small>รวมวันนี้</small></div>
          </header>
          <div class="timeline">${body || '<div class="empty">ยังไม่มีรายการในวันนี้</div>'}</div>
          <div class="add-row"><button class="add-btn" data-add="${di}">＋ เพิ่มรายการ</button></div>
        </section>`;
    }).join('');
  }

  // ---------- Map (Leaflet + OpenStreetMap) ----------
  function initMap() {
    const el = $('#map');
    if (!el) return;
    if (!window.L) {
      el.outerHTML = '<div class="map-fallback">🗺️ โหลดแผนที่ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้า<br>ใช้ปุ่ม “ดูบน Google Maps” ในแต่ละสถานที่แทนได้</div>';
      return;
    }
    const map = L.map(el, { scrollWheelZoom: false, tap: true });
    // OpenStreetMap ไม่อนุญาตให้โหลดไทล์จากหน้าเว็บที่เปิดเป็นไฟล์ (file://) — ใช้แผนที่สำรอง Esri แทน
    // และสลับไปแผนที่สำรองอัตโนมัติถ้าไทล์ OSM โหลดไม่ขึ้นหลายครั้ง
    const fallbackTiles = () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'
    });
    if (location.protocol === 'file:') {
      fallbackTiles().addTo(map);
    } else {
      const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }).addTo(map);
      let failed = 0;
      osm.on('tileerror', () => {
        if (++failed !== 4 || state.map !== map) return;
        map.removeLayer(osm);
        fallbackTiles().addTo(map);
      });
    }
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
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      if (!name) { $('#editError').textContent = 'กรุณาใส่ชื่อรายการ'; $('#editError').hidden = false; return; }
      it.name = name;
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

  function openAdd(di) {
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
        <button role="tab" data-tab="custom" aria-selected="false">✍️ เพิ่มเอง</button>
      </div>
      <div data-pane="suggest"><div class="suggest">${suggest}</div></div>
      <form data-pane="custom" id="customForm" hidden novalidate>
        <label class="field"><span>ชื่อรายการ</span><input name="name" required maxlength="120" placeholder="เช่น ซื้อของฝาก, นวดแผนไทย"></label>
        <div class="field-row">
          <label class="field"><span>หมวดค่าใช้จ่าย</span><select name="cat">${catOptions('fees')}</select></label>
          <label class="field"><span>ค่าใช้จ่าย (บาท)</span><input name="cost" type="number" inputmode="numeric" min="0" step="10" value="0"><small>รวมทั้งกลุ่ม</small></label>
        </div>
        <div class="field-row">
          <label class="field"><span>เวลาเริ่ม</span><input name="time" type="time" value="${P.fmtTime(Math.min(lastEnd + 15, 22 * 60))}"></label>
          <label class="field"><span>ใช้เวลา (นาที)</span><input name="mins" type="number" inputmode="numeric" min="0" step="15" value="60"></label>
        </div>
        <label class="field"><span>หมายเหตุ</span><textarea name="note" maxlength="300"></textarea></label>
        <p class="form-error" id="customError" hidden></p>
        <div class="sheet-actions"><button type="submit" class="btn btn-primary">＋ เพิ่มลงแผน</button></div>
      </form>`);
    const body = $('#sheetBody');
    body.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        $$('[data-tab]', body).forEach((b) => { const on = b === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
        $$('[data-pane]', body).forEach((pane) => { pane.hidden = pane.dataset.pane !== tab.dataset.tab; });
        if (tab.dataset.tab === 'custom') $('#customForm [name=name]').focus();
        return;
      }
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const item = P.makePlaceItem(plan, pick.dataset.pick, di);
        if (!item) return;
        day.items.push(item);
        closeSheet();
        commit('เพิ่มสถานที่ลงแผนแล้ว', item.id);
      }
    });
    $('#customForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get('name') || '').trim();
      if (!name) { $('#customError').textContent = 'กรุณาใส่ชื่อรายการ'; $('#customError').hidden = false; return; }
      const cat = P.CATS[fd.get('cat')] ? fd.get('cat') : 'fees';
      const item = {
        id: P.uid(), kind: 'custom', cat, icon: '📌', name, travel: 0,
        time: /^\d{2}:\d{2}$/.test(fd.get('time')) ? fd.get('time') : '12:00',
        mins: Math.max(0, Math.round(Number(fd.get('mins')) || 0)),
        cost: Math.max(0, Math.round(Number(fd.get('cost')) || 0)),
        note: String(fd.get('note') || '').trim()
      };
      day.items.push(item);
      closeSheet();
      commit('เพิ่มรายการแล้ว', item.id);
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
    $('#sheet').hidden = true;
    $('#sheetBody').innerHTML = '';
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('hashchange', () => { if (!/^#day-/.test(location.hash)) route(); });

  // ---------- Boot ----------
  $('#dataUpdated').textContent = D.UPDATED;
  updateSavedCount();
  route();
})();
