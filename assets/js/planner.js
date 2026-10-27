// เครื่องมือจัดแผนเที่ยว (ไม่ยุ่งกับ DOM — ทดสอบใน Node ได้)
// ---------------------------------------------------------------------------
// plan(input) → แผนรายวัน: รายการ (สถานที่ มื้ออาหาร ค่าเดินทาง ที่พัก) พร้อมเวลาและค่าใช้จ่าย
// summarize(plan) → ยอดรวมแยกหมวด ยอดรวมทั้งหมด และเงินคงเหลือ (คำนวณใหม่ทุกครั้งหลังแก้ไข)
//
// หลักการ:
// 1) เลือกระดับความสบาย (ประหยัด/มาตรฐาน/สบาย) ระดับสูงสุดที่ค่าที่พัก+อาหาร+เดินทาง ไม่เกิน 90% ของงบ
//    (เก็บ 10% ไว้เป็นเงินสำรอง/ค่าเข้าชม)
// 2) เลือกสถานที่ตามสไตล์ที่ชอบก่อน แล้วจัดกลุ่มรายวันตามโซนเพื่อลดเวลาเดินทาง
// 3) ค่าเข้าชมรวมต้องไม่เกินเงินที่เหลือ — ถ้าไม่พอจะเลือกสถานที่ฟรีแทน
// เวลาเดินทางเป็นค่าประมาณจากระยะห่างของโซนในข้อมูลตัวอย่าง ไม่ได้ใช้ API แผนที่
// ---------------------------------------------------------------------------
(function (root) {
  'use strict';

  const D = () => root.TRIP_DATA;
  const CATS = {
    lodging: { label: 'ที่พัก', icon: '🏨', color: '#7C5CFF' },
    food: { label: 'อาหาร', icon: '🍽️', color: '#FF7A59' },
    transport: { label: 'ค่าเดินทาง', icon: '🚌', color: '#1FB6FF' },
    fees: { label: 'ค่าเข้าชม', icon: '🎟️', color: '#22C3A6' }
  };
  const RESERVE = 0.1;
  const DAY_START = 9 * 60;
  const ARRIVAL_START = 11 * 60;

  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.round(m % 60))}`;
  const parseTime = (s) => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
  const round10 = (n) => Math.round(n / 10) * 10;
  let seq = 0;
  const uid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

  const province = (id) => D().PROVINCES.find((p) => p.id === id) || null;
  const centerZone = (p) => Object.entries(p.zones).sort((a, b) => a[1][1] - b[1][1])[0][0];
  const zoneName = (p, z) => p.zones[z]?.[0] || '';

  // ระยะทางเส้นตรงระหว่าง 2 พิกัด (กม.)
  function distKm(a, b) {
    if (!a || !b) return null;
    const r = Math.PI / 180;
    const s = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(s));
  }
  // ระยะทางถนนโดยประมาณ = เส้นตรง × 1.35 · ความเร็วเฉลี่ยตามระยะ (ในเมืองช้ากว่า) — ไม่ได้ใช้ API แผนที่
  function roadKm(a, b) { const d = distKm(a, b); return d == null ? null : d * 1.35; }
  function driveMins(a, b) {
    const km = roadKm(a, b);
    if (km == null) return null;
    if (km < 0.6) return 5; // เดินถึง
    const speed = km < 8 ? 22 : km < 40 ? 38 : 50;
    return round5((km / speed) * 60 + 5);
  }
  // รถสาธารณะช้ากว่าขับรถ (รอรถ ต่อรถ) — ระยะเดินถึง (≤5 นาที) ไม่ปรับ
  const modeMins = (m, mode) => (mode === 'public' && m > 5 ? round5(m * 1.5 + 10) : m);
  // เวลาเดินทางระหว่าง 2 สถานที่: ใช้พิกัดถ้ามี ไม่งั้นประมาณจากโซน
  const legMins = (p, from, to, mode) => modeMins(driveMins(from?.ll, to?.ll) ?? travelMins(p, from?.z, to?.z), mode);

  // ระดับการเข้าถึงของสถานที่ (D().ACCESS) และกฎตามข้อจำกัดของผู้เดินทาง
  function accessOf(name) {
    const A = D().ACCESS || {};
    return A.hard?.includes(name) ? 'hard' : A.some?.includes(name) ? 'some' : A.adult?.includes(name) ? 'adult' : '';
  }
  function profile(input) {
    const needs = new Set(input.needs || []);
    const avoid = new Set();
    if (needs.has('elderly')) avoid.add('hard');
    if (needs.has('wheelchair') || needs.has('lowwalk')) { avoid.add('hard'); avoid.add('some'); }
    if (needs.has('kids')) avoid.add('adult');
    const gentle = needs.has('elderly') || needs.has('wheelchair') || needs.has('lowwalk');
    return {
      avoid,
      cap: gentle || needs.has('kids') ? 6 : 7.5, // ชั่วโมงเที่ยวกลางวันสูงสุด
      maxPlaces: gentle ? 3 : 4 // สถานที่กลางวันต่อวัน
    };
  }
  const suitable = (pl, prof) => !prof.avoid.has(accessOf(pl.n));

  const carsFor = (people) => Math.ceil(people / D().TRAVEL.seatsPerCar);
  const foodPerPerson = (p, tier, input) => (input.mealCap ? Math.min(p.costs.food[tier], input.mealCap * 3) : p.costs.food[tier]);
  // ค่าเดินทางในพื้นที่ต่อวัน: km = ระยะทางที่ขับวันนั้น (ใช้ 40 กม. เมื่อยังไม่รู้เส้นทาง)
  function localCost(p, tier, input, km = 40) {
    const T = D().TRAVEL;
    const cars = carsFor(input.people);
    const fuel = Math.max(100, round10(km * T.fuelPerKm)) * cars;
    if (input.mode === 'public') return round10(p.costs.transport[0] * T.publicPerPerson * input.people);
    if (input.mode === 'drive') return fuel + T.parkingPerDay * cars;
    if (input.mode === 'rent') return fuel + T.rentPerDay * cars;
    return p.costs.transport[tier];
  }
  function localLabel(tier, input) {
    const cars = carsFor(input.people);
    if (input.mode === 'public') return 'รถสาธารณะ/สองแถว';
    if (input.mode === 'drive') return `ขับรถเอง ${cars} คัน: ค่าน้ำมัน + ค่าจอด`;
    if (input.mode === 'rent') return `เช่ารถขับเอง ${cars} คัน + ค่าน้ำมัน`;
    return D().TIERS[tier].transport;
  }
  // ค่าเดินทางไป-กลับจากกรุงเทพฯ: ขับรถเอง = ค่าน้ำมันต่อคัน (ไม่รวมทางด่วน) · อื่นๆ = ราคาตั๋วต่อคน
  function tripCost(p, tier, input) {
    if (!p.fromBangkok) return { cost: 0, km: 0 };
    if (input.mode === 'drive') {
      const km = Math.round(roadKm(D().TRAVEL.bangkok, p.center) * 2);
      return { cost: round10(km * D().TRAVEL.fuelPerKm) * carsFor(input.people), km };
    }
    return { cost: input.people * p.fromBangkok.price[tier === 0 ? 0 : 1], km: 0 };
  }

  // เวลาเดินทางโดยประมาณระหว่าง 2 โซน (นาที)
  function travelMins(p, a, b) {
    if (!a || !b) return 0;
    if (a === b) return 15;
    const za = p.zones[a]?.[1] ?? 30;
    const zb = p.zones[b]?.[1] ?? 30;
    return round5(Math.max(za, zb) + Math.min(za, zb) * 0.6 + 10);
  }

  function fixedCost(p, tier, input) {
    const { days, people, includeTravel } = input;
    const nights = Math.max(0, days - 1);
    const rooms = Math.ceil(people / 2);
    const lodgingRate = input.lodgingRate || p.costs.lodging[tier];
    const lodging = nights * rooms * lodgingRate;
    const food = days * people * foodPerPerson(p, tier, input);
    const trip = includeTravel ? tripCost(p, tier, input).cost : 0;
    const transport = days * localCost(p, tier, input) + trip;
    return { lodging, food, transport, trip, total: lodging + food + transport };
  }

  const placeSpend = (pl, people) => ((pl.fee || 0) + (pl.spend || 0)) * people;

  function rankPlaces(p, styles, prof) {
    const types = new Set((styles || []).flatMap((s) => D().STYLES.find((x) => x.id === s)?.types || []));
    return p.places
      .filter((pl) => !prof || suitable(pl, prof))
      .map((pl, i) => ({ pl, i, s: types.size && types.has(pl.t) ? 0 : 1 }))
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map((x) => x.pl);
  }

  // จัดสถานที่ลงแต่ละวัน
  function assignPlaces(p, input, money) {
    const { days, people, styles, includeTravel, mode } = input;
    const prof = profile(input);
    const ranked = rankPlaces(p, styles, prof);
    const used = new Set();
    let left = money;
    const fits = (pl) => placeSpend(pl, people) <= left;
    const take = (pl) => { used.add(pl); left -= placeSpend(pl, people); };
    const out = [];

    for (let d = 0; d < days; d++) {
      const arrival = includeTravel && p.fromBangkok && d === 0;
      const departure = includeTravel && p.fromBangkok && days > 1 && d === days - 1;
      const cap = arrival || departure ? Math.min(5, prof.cap) : prof.cap; // ชั่วโมงเที่ยวกลางวัน
      const list = [];
      const seed = ranked.find((pl) => !used.has(pl) && pl.when !== 'evening' && fits(pl) && (pl.when !== 'fullday' || cap >= 7.5));
      if (seed) {
        take(seed);
        list.push(seed);
        if (seed.when !== 'fullday') {
          let hours = seed.h;
          const pool = ranked
            .filter((pl) => !used.has(pl) && pl.when !== 'fullday' && pl.when !== 'evening')
            .map((pl, rank) => ({ pl, rank, t: legMins(p, seed, pl, mode) }))
            .filter((x) => x.t <= 45)
            .sort((a, b) => a.t - b.t || a.rank - b.rank);
          for (const { pl, t } of pool) {
            if (list.length >= prof.maxPlaces) break;
            if (!fits(pl) || hours + pl.h + t / 60 > cap) continue;
            take(pl);
            list.push(pl);
            hours += pl.h + t / 60;
          }
          // ยังมีเวลาว่างมาก → เติมสถานที่ที่ไกลขึ้น (ไม่เกิน 75 นาทีจากจุดล่าสุด) เพื่อไม่ให้บ่ายว่างทั้งบ่าย
          while (list.length < prof.maxPlaces && hours < cap - 1.5) {
            const from = list[list.length - 1];
            const next = ranked
              .filter((pl) => !used.has(pl) && pl.when !== 'fullday' && pl.when !== 'evening' && fits(pl))
              .map((pl) => ({ pl, t: legMins(p, from, pl, mode) }))
              .filter((x) => x.t <= 75 && hours + x.pl.h + x.t / 60 <= cap)
              .sort((a, b) => a.t - b.t)[0];
            if (!next) break;
            take(next.pl);
            list.push(next.pl);
            hours += next.pl.h + next.t / 60;
          }
        }
      }
      // วันที่มีทริปเต็มวัน (เช่น ดอยอินทนนท์ ทัวร์เกาะ) กลับถึงที่พักค่ำ จึงไม่จัดสถานที่ช่วงเย็นเพิ่ม
      if (!departure && seed?.when !== 'fullday') {
        const last = list.length ? list[list.length - 1] : { z: centerZone(p), ll: p.center };
        const evening = ranked
          .filter((pl) => !used.has(pl) && pl.when === 'evening' && fits(pl))
          .sort((a, b) => legMins(p, last, a, mode) - legMins(p, last, b, mode))[0];
        if (evening) {
          take(evening);
          list.push(evening);
        }
      }
      out.push(list);
    }
    return out;
  }

  function placeItem(p, pl, people) {
    const T = D().TYPES[pl.t] || { icon: '📍', label: '' };
    const access = accessOf(pl.n);
    const fee = (pl.fee || 0) * people;
    const spend = (pl.spend || 0) * people;
    return {
      id: uid(), kind: 'place', cat: fee > 0 || !spend ? 'fees' : 'food',
      name: pl.n, type: pl.t, icon: T.icon, typeLabel: T.label, zone: pl.z, zoneLabel: zoneName(p, pl.z), ll: pl.ll || null,
      mins: Math.round(pl.h * 60), cost: fee + spend, note: [pl.note, spend && fee ? `รวมค่าใช้จ่ายระหว่างเที่ยว ${spend.toLocaleString('th-TH')} บาท` : ''].filter(Boolean).join(' · '),
      fullday: pl.when === 'fullday', access: access === 'adult' ? '' : access
    };
  }

  const ORDER = { morning: 0, day: 1, fullday: 1, evening: 3 };

  function buildDay(p, d, places, ctx) {
    const { days, people, tier, includeTravel, mode } = ctx;
    const T = D().TIERS[tier];
    const items = [];
    const arrival = includeTravel && p.fromBangkok && d === 0;
    const center = centerZone(p);
    const add = (it) => { items.push({ id: uid(), travel: 0, note: '', mins: 0, ...it }); };

    if (arrival) {
      const trip = tripCost(p, tier, ctx);
      if (mode === 'drive') {
        add({ kind: 'trip', cat: 'transport', icon: '🧭', name: 'ขับรถจากกรุงเทพฯ ไป-กลับ (ค่าน้ำมัน)', time: '07:00', cost: trip.cost, note: `ระยะทางไป-กลับประมาณ ${trip.km.toLocaleString('th-TH')} กม. × ${carsFor(people)} คัน · ไม่รวมค่าทางด่วน` });
      } else {
        const how = p.fromBangkok.mode[tier === 0 ? 0 : 1];
        add({ kind: 'trip', cat: 'transport', icon: '🧭', name: `เดินทางจากกรุงเทพฯ ไป-กลับ (${how})`, time: '07:00', cost: trip.cost, note: 'ราคาไป-กลับต่อคนโดยประมาณ × จำนวนคน · ระยะเวลาขึ้นกับวิธีเดินทาง' });
      }
    }
    const fullday = places.some((pl) => pl.when === 'fullday');
    let cursor = arrival ? ARRIVAL_START : fullday ? 7 * 60 + 30 : DAY_START;
    const MODE_ICON = { public: '🚌', drive: '🚗', rent: '🔑' };
    add({ kind: 'local', cat: 'transport', icon: MODE_ICON[mode] || '🚕', name: `เดินทางในพื้นที่ (${localLabel(tier, ctx)})`, time: fmtTime(cursor - 15), cost: localCost(p, tier, ctx), note: mode === 'public' ? 'ค่ารถโดยประมาณต่อคน × จำนวนคน' : 'ค่าใช้จ่ายต่อกลุ่มต่อวันโดยประมาณ' });

    const foodDay = foodPerPerson(p, tier, ctx) * people;
    const lunchCost = round10(foodDay * 0.4);
    const dinnerCost = foodDay - lunchCost;
    const sorted = places.slice().sort((a, b) => ORDER[a.when] - ORDER[b.when]);
    const daytime = sorted.filter((pl) => pl.when !== 'evening');
    const evening = sorted.find((pl) => pl.when === 'evening');
    const hotel = { z: center, ll: p.center };
    let here = hotel;
    const km = (from, to) => { const k = roadKm(from?.ll, to?.ll); return k == null ? null : Math.round(k * 10) / 10; };
    let lunch = false;
    const addLunch = () => {
      add({ kind: 'meal', cat: 'food', icon: '🍛', name: 'อาหารกลางวัน', time: fmtTime(Math.max(cursor, 11 * 60 + 30)), mins: 60, cost: lunchCost, note: 'ร้านอาหารท้องถิ่นใกล้สถานที่ถัดไป' });
      cursor = Math.max(cursor, 11 * 60 + 30) + 60;
      lunch = true;
    };

    for (const pl of daytime) {
      const travel = legMins(p, here, pl, mode);
      if (!lunch && cursor + travel >= 12 * 60 + 30) addLunch();
      cursor += travel;
      add({ ...placeItem(p, pl, people), time: fmtTime(cursor), travel, km: km(here, pl) });
      cursor += Math.round(pl.h * 60);
      here = pl;
      if (pl.when === 'fullday') {
        lunch = true; // ทริปเต็มวันมักรวมมื้อกลางวันระหว่างทาง
        cursor += legMins(p, pl, hotel, mode); // เดินทางกลับเข้าเมือง
        here = hotel;
      }
    }
    if (!daytime.length) {
      add({ kind: 'free', cat: 'fees', icon: '🧘', name: 'เวลาว่าง พักผ่อนตามอัธยาศัย', time: fmtTime(cursor), mins: 180, cost: 0, note: 'เพิ่มสถานที่เองได้ด้วยปุ่ม “เพิ่มรายการ”' });
      cursor += 180;
    }
    if (!lunch) addLunch();
    if (daytime.some((pl) => pl.when === 'fullday')) {
      add({ kind: 'meal', cat: 'food', icon: '🍛', name: 'อาหารกลางวันระหว่างทาง', time: '12:30', mins: 60, cost: lunchCost, note: '' });
    }

    if (evening) {
      const travel = legMins(p, here, evening, mode);
      cursor = Math.max(cursor + travel, 17 * 60 + 30);
      add({ ...placeItem(p, evening, people), time: fmtTime(cursor), travel, km: km(here, evening) });
      cursor += Math.round(evening.h * 60);
      here = evening;
    }
    const dinnerAt = Math.max(cursor, 18 * 60 + 30);
    add({ kind: 'meal', cat: 'food', icon: '🍲', name: evening?.t === 'food' ? `อาหารเย็นที่${evening.n}` : 'อาหารเย็น', time: fmtTime(dinnerAt), mins: 60, cost: dinnerCost, note: '' });

    if (d < days - 1) {
      const rooms = Math.ceil(people / 2);
      const lodgingRate = input.lodgingRate || p.costs.lodging[tier];
      add({ kind: 'lodging', cat: 'lodging', icon: '🛏️', ll: p.center || null, zone, zoneLabel: zoneName(p, center), name: `ที่พัก: ${T.lodging} (${zoneName(p, center)})`, time: fmtTime(Math.min(Math.max(dinnerAt + 75, 20 * 60 + 30), 22 * 60 + 30)), cost: rooms * lodgingRate, travel: legMins(p, here, hotel, mode), km: km(here, hotel), note: `${rooms} ห้อง × ${lodgingRate.toLocaleString('th-TH')} บาท/คืน (ห้องละ 2 คน)` });
    }
    // ขับรถเอง/เช่ารถ: คิดค่าน้ำมันจากระยะทางจริงของวันนั้น (รวมขากลับจากทริปเต็มวัน)
    if (mode === 'drive' || mode === 'rent') {
      const back = daytime.filter((pl) => pl.when === 'fullday').reduce((a, pl) => a + (roadKm(pl.ll, hotel.ll) || 0), 0);
      const dayKm = items.reduce((a, it) => a + (it.km || 0), 0) + back;
      const local = items.find((it) => it.kind === 'local');
      local.cost = localCost(p, tier, ctx, dayKm);
      local.note = `ขับประมาณ ${Math.round(dayKm)} กม. · น้ำมัน ~${D().TRAVEL.fuelPerKm} บาท/กม.${mode === 'rent' ? ` · ค่าเช่า ${D().TRAVEL.rentPerDay.toLocaleString('th-TH')} บาท/คัน/วัน` : ` · ค่าจอด ${D().TRAVEL.parkingPerDay} บาท/คัน/วัน`}`;
    }
    return { n: d + 1, items: sortItems(items) };
  }

  const KIND_ORDER = { trip: 0, local: 1 };
  function sortItems(items) {
    return items.slice().sort((a, b) => parseTime(a.time) - parseTime(b.time) || (KIND_ORDER[a.kind] ?? 2) - (KIND_ORDER[b.kind] ?? 2));
  }

  function normalizeInput(input) {
    return {
      province: input.province,
      budget: Math.max(0, Math.round(Number(input.budget) || 0)),
      days: clamp(input.days, 1, 10),
      people: clamp(input.people, 1, 20),
      styles: Array.isArray(input.styles) ? input.styles.filter((s) => D().STYLES.some((x) => x.id === s)) : [],
      includeTravel: !!input.includeTravel,
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '') ? input.startDate : '',
      mode: D().MODES.some((m) => m.id === input.mode) ? input.mode : 'auto',
      needs: Array.isArray(input.needs) ? [...new Set(input.needs.filter((n) => D().NEEDS.some((x) => x.id === n)))] : [],
      mealCap: clamp(input.mealCap, 0, 10000),
      lodgingRate: clamp(input.lodgingRate, 0, 100000)
    };
  }

  function plan(raw) {
    const input = normalizeInput(raw);
    const p = province(input.province);
    if (!p) throw new Error('ไม่พบข้อมูลจังหวัดนี้');
    const usable = input.budget * (1 - RESERVE);
    // เลือกระดับสูงสุดที่ (1) ค่าที่พัก+อาหาร+เดินทางไม่เกินงบ และ (2) ไม่ต้องตัดสถานที่ท่องเที่ยว
    // เทียบกับระดับประหยัด (นับจำนวนสถานที่และชั่วโมงเที่ยวที่จัดได้) — กันกรณีงบหมดไปกับที่พักจนไม่เหลือค่าเข้าชม
    const simulate = (t) => {
      const money = Math.max(0, usable - fixedCost(p, t, input).total);
      const perDay = assignPlaces(p, input, money);
      const all = perDay.flat();
      return { perDay, money, count: all.length, hours: all.reduce((a, pl) => a + pl.h, 0) };
    };
    const base = simulate(0);
    let tier = 0;
    let sim = base;
    for (const t of [2, 1]) {
      if (fixedCost(p, t, input).total > usable) continue;
      const s = simulate(t);
      if (s.count >= base.count && s.hours >= base.hours * 0.95) { tier = t; sim = s; break; }
    }
    const fixed = fixedCost(p, tier, input);
    const feasible = fixed.total <= input.budget;
    const perDay = sim.perDay;
    const ctx = { ...input, tier };
    const days = perDay.map((places, d) => buildDay(p, d, places, ctx));
    const minBudget = Math.ceil(fixedCost(p, 0, input).total / (1 - RESERVE) / 100) * 100;
    const now = new Date().toISOString();
    return {
      id: `trip-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      version: 1, createdAt: now, updatedAt: now,
      input, provinceId: p.id, tier, feasible, minBudget,
      skipped: p.places.filter((pl) => !suitable(pl, profile(input))).map((pl) => pl.n), // สถานที่ที่ตัดออกตามข้อจำกัด
      title: `${p.name} ${input.days} วัน ${input.people} คน`,
      days
    };
  }

  function summarize(planObj) {
    const byCat = { lodging: 0, food: 0, transport: 0, fees: 0 };
    let places = 0;
    for (const day of planObj.days) {
      for (const it of day.items) {
        byCat[it.cat] = (byCat[it.cat] || 0) + (Number(it.cost) || 0);
        if (it.kind === 'place' || it.kind === 'custom') places++;
      }
    }
    const total = Object.values(byCat).reduce((a, b) => a + b, 0);
    const budget = planObj.input.budget;
    return { byCat, total, budget, remaining: budget - total, perPerson: Math.round(total / planObj.input.people), places, over: total > budget };
  }

  // สถานที่ในจังหวัดที่ยังไม่อยู่ในแผน (สำหรับปุ่มเพิ่มรายการ)
  function unusedPlaces(planObj) {
    const p = province(planObj.provinceId);
    const used = new Set(planObj.days.flatMap((d) => d.items.map((it) => it.name)));
    return p.places.filter((pl) => !used.has(pl.n));
  }

  function makePlaceItem(planObj, placeName, dayIndex) {
    const p = province(planObj.provinceId);
    const pl = p.places.find((x) => x.n === placeName);
    if (!pl) return null;
    const day = planObj.days[dayIndex];
    const last = sortItems(day.items).filter((it) => it.zone).pop();
    const lastEnd = day.items.filter((it) => it.kind !== 'lodging').reduce((m, it) => Math.max(m, parseTime(it.time) + (it.mins || 0)), DAY_START);
    const from = last ? { z: last.zone, ll: last.ll } : { z: centerZone(p), ll: p.center };
    const travel = legMins(p, from, pl, planObj.input.mode);
    const k = roadKm(from.ll, pl.ll);
    return { ...placeItem(p, pl, planObj.input.people), time: fmtTime(Math.min(lastEnd + travel, 22 * 60)), travel, km: k == null ? null : Math.round(k * 10) / 10 };
  }

  // สถานที่ที่ยังไม่อยู่ในแผนแต่อยู่ใกล้สถานที่ในแผน (สำหรับแสดงบนแผนที่และแนะนำ)
  // คืนค่า [{ place, near: รายการในแผนที่ใกล้ที่สุด, day: index วัน, km, mins }] เรียงจากใกล้ไปไกล
  function nearbyPlaces(planObj, { maxKm = 15, limit = 12 } = {}) {
    const planned = planObj.days.flatMap((d, di) => d.items.filter((it) => it.ll && it.kind !== 'lodging').map((it) => ({ it, di })));
    if (!planned.length) return [];
    return unusedPlaces(planObj)
      .filter((pl) => pl.ll)
      .map((pl) => {
        let best = null;
        for (const x of planned) {
          const k = roadKm(x.it.ll, pl.ll);
          if (!best || k < best.km) best = { near: x.it, day: x.di, km: k };
        }
        return { place: pl, near: best.near, day: best.day, km: Math.round(best.km * 10) / 10, mins: modeMins(driveMins(best.near.ll, pl.ll), planObj.input.mode) };
      })
      .filter((x) => x.km <= maxKm)
      .sort((a, b) => a.km - b.km)
      .slice(0, limit);
  }

  root.TripPlanner = { plan, summarize, accessOf, profile, localCost, tripCost, sortItems, unusedPlaces, nearbyPlaces, makePlaceItem, travelMins, distKm, roadKm, driveMins, fixedCost, province, zoneName, fmtTime, parseTime, uid, CATS, RESERVE };
})(typeof window !== 'undefined' ? window : globalThis);
