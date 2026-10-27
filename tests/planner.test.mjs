// Unit tests ของเครื่องมือจัดแผน: node tests/planner.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['assets/js/data.js', 'assets/js/planner.js']) vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
const { TRIP_DATA: DATA, TripPlanner: P } = globalThis;

let pass = 0;
const fails = [];
function check(name, cond, info = '') { if (cond) pass++; else fails.push(`${name} ${info}`); }

// ---------- ทุกจังหวัด × จำนวนวัน × งบ × จำนวนคน ----------
let combos = 0;
for (const prov of DATA.PROVINCES) {
  for (const days of [1, 2, 3, 5, 7]) {
    for (const people of [1, 2, 4]) {
      for (const budget of [1500, 5000, 15000, 60000]) {
        for (const includeTravel of [false, true]) {
          combos++;
          const tag = `[${prov.id} ${days}d ${people}p ${budget}฿ travel=${includeTravel}]`;
          const plan = P.plan({ province: prov.id, days, people, budget, styles: [], includeTravel });
          const s = P.summarize(plan);
          check('days length', plan.days.length === days, tag);
          const names = plan.days.flatMap((d) => d.items.filter((i) => i.kind === 'place').map((i) => i.name));
          check('no duplicate places', names.length === new Set(names).size, tag);
          check('items sorted by time', plan.days.every((d) => d.items.every((it, i, a) => !i || P.parseTime(a[i - 1].time) <= P.parseTime(it.time))), tag);
          check('lodging nights = days-1', plan.days.flatMap((d) => d.items).filter((i) => i.kind === 'lodging').length === days - 1, tag);
          check('every day has lunch + dinner', plan.days.every((d) => d.items.filter((i) => i.kind === 'meal').length >= 2), tag);
          check('costs are non-negative numbers', plan.days.every((d) => d.items.every((i) => Number.isFinite(i.cost) && i.cost >= 0)), tag);
          check('sum matches summary', s.total === plan.days.flatMap((d) => d.items).reduce((a, i) => a + i.cost, 0), tag);
          if (plan.feasible) check('feasible plan fits budget', s.total <= budget, `${tag} total=${s.total}`);
          else check('infeasible → min budget suggested', plan.minBudget > budget, `${tag} min=${plan.minBudget}`);
          if (budget >= plan.minBudget) check('budget ≥ minimum → feasible', plan.feasible && s.total <= budget, `${tag} total=${s.total} min=${plan.minBudget}`);
          check('times within the day', plan.days.every((d) => d.items.every((i) => P.parseTime(i.time) >= 6 * 60 && P.parseTime(i.time) <= 23 * 60 + 30)), tag);
          check('trip travel only when requested', plan.days[0].items.some((i) => i.kind === 'trip') === (includeTravel && !!prov.fromBangkok), tag);
        }
      }
    }
  }
}

// ---------- พิกัดสำหรับแผนที่ ----------
const inThailand = ([lat, lng]) => lat > 5.5 && lat < 20.6 && lng > 97.3 && lng < 105.7;
for (const prov of DATA.PROVINCES) {
  check('province has center', Array.isArray(prov.center) && inThailand(prov.center), prov.id);
  for (const pl of prov.places) {
    check('place has coordinates in Thailand', Array.isArray(pl.ll) && inThailand(pl.ll), `${prov.id}: ${pl.n}`);
    // อยู่ไม่ไกลจากศูนย์กลางจังหวัดเกิน ~180 กม. (กันพิกัดสลับจังหวัด)
    const km = Math.hypot((pl.ll[0] - prov.center[0]) * 111, (pl.ll[1] - prov.center[1]) * 111 * Math.cos(prov.center[0] * Math.PI / 180));
    check('place near its province', km < 180, `${prov.id}: ${pl.n} ${km.toFixed(0)}km`);
  }
}
const mapPlan = P.plan({ province: 'chiangmai', days: 2, people: 2, budget: 12000 });
check('plan place items carry coordinates', mapPlan.days.flatMap((d) => d.items).filter((i) => i.kind === 'place').every((i) => Array.isArray(i.ll)));
check('lodging item carries hotel coordinates', mapPlan.days[0].items.find((i) => i.kind === 'lodging')?.ll?.length === 2);

// ---------- เวลาเดินทางจากพิกัด และสถานที่ใกล้เคียง ----------
const wp = P.province('bangkok').places;
const kmPhoWatPhraKaew = P.distKm(wp[0].ll, wp[1].ll);
check('distKm Wat Phra Kaew ↔ Wat Pho ≈ 0.6 km', kmPhoWatPhraKaew > 0.3 && kmPhoWatPhraKaew < 1.2, kmPhoWatPhraKaew.toFixed(2));
check('driveMins short hop ≤ 15 min', P.driveMins(wp[0].ll, wp[1].ll) <= 15);
const cmP = P.province('chiangmai').places;
check('driveMins to Doi Inthanon from old city ≥ 90 min', P.driveMins(P.province('chiangmai').center, cmP.find((x) => x.n.includes('อินทนนท์')).ll) >= 90);
const legPlan = P.plan({ province: 'chiangmai', days: 3, people: 2, budget: 20000 });
const legs = legPlan.days.flatMap((d) => d.items).filter((i) => i.kind === 'place');
check('place items have travel minutes and km', legs.every((i) => i.travel >= 5 && typeof i.km === 'number'), JSON.stringify(legs.map((i) => [i.travel, i.km])));
const near = P.nearbyPlaces(legPlan);
check('nearbyPlaces returns unused places only', near.every((x) => !legPlan.days.some((d) => d.items.some((i) => i.name === x.place.n))));
check('nearbyPlaces sorted by distance and within limit', near.every((x, i, a) => x.km <= 15 && (!i || a[i - 1].km <= x.km)), JSON.stringify(near.map((x) => x.km)));
check('nearbyPlaces gives a day and an estimated time', near.length > 0 && near.every((x) => Number.isInteger(x.day) && x.mins >= 5));

// ---------- ระดับความสบายเพิ่มตามงบ ----------
let prevTier = -1;
for (const budget of [2000, 6000, 12000, 25000, 80000]) {
  const t = P.plan({ province: 'chiangmai', days: 3, people: 2, budget }).tier;
  check('tier non-decreasing with budget', t >= prevTier, `budget=${budget} tier=${t}`);
  prevTier = t;
}
check('very high budget → สบาย', P.plan({ province: 'phuket', days: 3, people: 2, budget: 200000 }).tier === 2);
check('low budget → ประหยัด', P.plan({ province: 'phuket', days: 3, people: 2, budget: 5000 }).tier === 0);

// ---------- สไตล์การเที่ยว ----------
const firstTypes = (styles, prov = 'phuket') => P.plan({ province: prov, days: 2, people: 2, budget: 20000, styles }).days[0].items.filter((i) => i.kind === 'place').map((i) => i.type);
check('style ทะเล puts beaches first (ภูเก็ต)', firstTypes(['beach']).filter((t) => t === 'beach').length >= 1, JSON.stringify(firstTypes(['beach'])));
check('style คาเฟ่ includes a cafe (เชียงใหม่)', P.plan({ province: 'chiangmai', days: 2, people: 2, budget: 15000, styles: ['cafe'] }).days.flatMap((d) => d.items).some((i) => i.type === 'cafe'));
check('style ประวัติศาสตร์ (อยุธยา) day 1 mostly culture', firstTypes(['history'], 'ayutthaya').filter((t) => t === 'culture').length >= 2);

// ---------- ค่าเข้าชมไม่เกินงบที่เหลือ ----------
const tight = P.plan({ province: 'phuket', days: 2, people: 2, budget: 6000 });
check('tight budget avoids expensive tour', !tight.days.flatMap((d) => d.items).some((i) => i.name.includes('พีพี')), JSON.stringify(P.summarize(tight)));
const rich = P.plan({ province: 'phuket', days: 3, people: 2, budget: 60000 });
check('ample budget includes the Phi Phi day tour', rich.days.flatMap((d) => d.items).some((i) => i.name.includes('พีพี')));

// ---------- เวลาเดินทาง ----------
const cm = P.province('chiangmai');
check('same zone travel = 15 min', P.travelMins(cm, 'oldcity', 'oldcity') === 15);
check('far zone takes longer', P.travelMins(cm, 'oldcity', 'inthanon') > P.travelMins(cm, 'oldcity', 'nimman'));

// ---------- แก้ไข/เพิ่มรายการ ----------
const edit = P.plan({ province: 'bangkok', days: 2, people: 2, budget: 10000 });
const before = P.summarize(edit).total;
edit.days[0].items = edit.days[0].items.filter((i) => i.kind !== 'lodging');
check('deleting an item lowers total', P.summarize(edit).total < before);
const extra = P.unusedPlaces(edit)[0];
const item = P.makePlaceItem(edit, extra.n, 1);
check('makePlaceItem builds a place item', item && item.kind === 'place' && item.name === extra.n && /^\d\d:\d\d$/.test(item.time));
check('unusedPlaces excludes planned places', !P.unusedPlaces(edit).some((pl) => edit.days.some((d) => d.items.some((i) => i.name === pl.n))));
check('startDate is kept when valid', P.plan({ province: 'nan', days: 2, people: 1, budget: 5000, startDate: '2026-11-07' }).input.startDate === '2026-11-07');
check('invalid startDate is dropped', P.plan({ province: 'nan', days: 2, people: 1, budget: 5000, startDate: '7/11/2026' }).input.startDate === '');
check('invalid province throws', (() => { try { P.plan({ province: 'nope', days: 1, people: 1, budget: 1 }); return false; } catch { return true; } })());
check('input is clamped', (() => { const x = P.plan({ province: 'nan', days: 99, people: 0, budget: -5 }); return x.input.days === 10 && x.input.people === 1 && x.input.budget === 0; })());

// ---------- วิธีเดินทาง ----------
const allNames = (pl) => pl.days.flatMap((d) => d.items);
for (const prov of DATA.PROVINCES) {
  for (const mode of ['auto', 'public', 'drive', 'rent']) {
    const tag = `[${prov.id} ${mode}]`;
    const pl = P.plan({ province: prov.id, days: 3, people: 3, budget: 20000, styles: [], includeTravel: true, mode });
    const s = P.summarize(pl);
    check('mode kept in input', pl.input.mode === mode, tag);
    check('mode: one local transport item per day', pl.days.every((d) => d.items.filter((i) => i.kind === 'local').length === 1), tag);
    check('mode: sum matches summary', s.total === allNames(pl).reduce((a, i) => a + i.cost, 0), tag);
    check('mode: costs non-negative', allNames(pl).every((i) => Number.isFinite(i.cost) && i.cost >= 0), tag);
    if (mode === 'drive' && prov.fromBangkok) check('drive: trip is fuel, no tolls', /ขับรถ/.test(pl.days[0].items.find((i) => i.kind === 'trip').name), tag);
    if (mode === 'rent') check('rent: includes daily car hire', pl.days.every((d) => d.items.find((i) => i.kind === 'local').cost >= DATA.TRAVEL.rentPerDay), tag);
  }
}
const legSum = (pl) => allNames(pl).reduce((a, i) => a + (i.travel || 0), 0);
const byMode = (mode) => P.plan({ province: 'chiangmai', days: 3, people: 2, budget: 20000, mode });
check('public transport takes longer than driving', legSum(byMode('public')) > legSum(byMode('drive')), `${legSum(byMode('public'))} vs ${legSum(byMode('drive'))}`);
check('public transport scales with people', P.localCost(P.province('phuket'), 0, { mode: 'public', people: 4 }) === 2 * P.localCost(P.province('phuket'), 0, { mode: 'public', people: 2 }));
check('rent: 6 people need 2 cars', P.localCost(P.province('phuket'), 0, { mode: 'rent', people: 6 }, 40) >= 2 * DATA.TRAVEL.rentPerDay);
check('drive: farther day costs more fuel', P.localCost(P.province('nan'), 0, { mode: 'drive', people: 2 }, 200) > P.localCost(P.province('nan'), 0, { mode: 'drive', people: 2 }, 40));
check('unknown mode falls back to auto', P.plan({ province: 'nan', days: 1, people: 1, budget: 5000, mode: 'jetpack' }).input.mode === 'auto');

// ---------- ข้อจำกัดของผู้เดินทาง ----------
const ACC = DATA.ACCESS;
const known = new Set(DATA.PROVINCES.flatMap((p) => p.places.map((pl) => pl.n)));
check('ACCESS names exist in data', [...ACC.hard, ...ACC.some, ...ACC.adult].every((n) => known.has(n)), [...ACC.hard, ...ACC.some, ...ACC.adult].filter((n) => !known.has(n)).join(', '));
for (const prov of DATA.PROVINCES) {
  for (const needs of [['wheelchair'], ['elderly'], ['lowwalk'], ['kids'], ['elderly', 'kids']]) {
    const tag = `[${prov.id} ${needs}]`;
    const pl = P.plan({ province: prov.id, days: 4, people: 2, budget: 60000, styles: ['nature', 'beach'], needs });
    const places = allNames(pl).filter((i) => i.kind === 'place');
    const avoid = P.profile(pl.input).avoid;
    check('needs: no unsuitable places', places.every((i) => !avoid.has(P.accessOf(i.name))), `${tag} ${places.map((i) => i.name).join(', ')}`);
    check('needs: still has lunch + dinner', pl.days.every((d) => d.items.filter((i) => i.kind === 'meal').length >= 2), tag);
    if (!needs.includes('kids') || needs.length > 1) check('needs: at most 3 daytime places', pl.days.every((d) => d.items.filter((i) => i.kind === 'place' && P.parseTime(i.time) < 17 * 60).length <= 3), tag);
  }
}
const krabiAll = P.plan({ province: 'krabi', days: 3, people: 2, budget: 40000, styles: ['beach'] });
const krabiWheel = P.plan({ province: 'krabi', days: 3, people: 2, budget: 40000, styles: ['beach'], needs: ['wheelchair'] });
check('wheelchair skips boat tours', allNames(krabiAll).some((i) => i.name.includes('4 เกาะ')) && !allNames(krabiWheel).some((i) => i.name.includes('4 เกาะ')));
check('skipped lists filtered places', krabiWheel.skipped.includes('ทัวร์ 4 เกาะ (ทะเลแหวก เกาะไก่ เกาะปอดะ)') && krabiAll.skipped.length === 0);
check('kids skip nightlife', !allNames(P.plan({ province: 'phuket', days: 4, people: 2, budget: 60000, styles: ['beach'], needs: ['kids'] })).some((i) => i.name.includes('บางลา')));
check('place items carry access tag', allNames(krabiAll).some((i) => i.access === 'hard'));
check('unknown needs are dropped', P.plan({ province: 'nan', days: 1, people: 1, budget: 5000, needs: ['x', 'kids', 'kids'] }).input.needs.join() === 'kids');

// ---------- งบต่อมื้อ ----------
const food = (mealCap) => P.summarize(P.plan({ province: 'phuket', days: 3, people: 2, budget: 80000, mealCap })).byCat.food;
check('meal cap lowers food cost', food(120) < food(0), `${food(120)} vs ${food(0)}`);
const meals = allNames(P.plan({ province: 'phuket', days: 3, people: 2, budget: 80000, mealCap: 120 })).filter((i) => i.kind === 'meal').reduce((a, i) => a + i.cost, 0);
check('meal cap: meals ≤ 3 × cap per person per day', meals <= 3 * 2 * 120 * 3, String(meals));
check('meal cap is clamped', P.plan({ province: 'nan', days: 1, people: 1, budget: 5000, mealCap: -5 }).input.mealCap === 0 && P.plan({ province: 'nan', days: 1, people: 1, budget: 5000, mealCap: 1e9 }).input.mealCap === 10000);

// ---------- ราคาที่พักที่กำหนดเอง ----------
const stay = P.plan({ province: 'nan', days: 3, people: 3, budget: 50000, lodgingRate: 1234 });
check('custom lodging rate used per room per night', stay.days.flatMap((d) => d.items).filter((i) => i.kind === 'lodging').every((i) => i.cost === 2 * 1234 && i.zone));

console.log(`${combos} plan combinations generated`);
if (fails.length) {
  console.log(`FAIL ${fails.length} checks:\n  ` + [...new Set(fails)].slice(0, 25).join('\n  '));
  process.exit(1);
}
console.log(`PASS all ${pass} checks`);
