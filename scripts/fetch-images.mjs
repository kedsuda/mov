// ดาวน์โหลดภาพจังหวัดจาก Wikimedia Commons (เฉพาะสัญญาอนุญาตแบบเปิด) และสร้างไฟล์เครดิต
// ใช้ครั้งเดียวหรือเมื่ออยากเปลี่ยนภาพ: node scripts/fetch-images.mjs
// ผลลัพธ์: assets/img/provinces/<id>.jpg และ assets/js/credits.js (ผู้ถ่าย สัญญาอนุญาต ลิงก์ต้นฉบับ)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'User-Agent': 'TiewPodeeNgob/1.0 (budget trip planner; https://kedsuda.github.io/mov/)' };
const WIDTH = 420;

// จังหวัด → บทความ Wikipedia ภาษาอังกฤษของสถานที่เด่น (ใช้ภาพหลักของบทความ)
const ARTICLES = {
  bangkok: 'Wat_Arun',
  chiangmai: 'Wat_Phra_That_Doi_Suthep',
  phuket: 'Phuket_Big_Buddha',
  krabi: 'Railay_Beach',
  chiangrai: 'Wat_Rong_Khun',
  pattaya: 'Ko_Lan',
  huahin: 'Hua_Hin_railway_station',
  kanchanaburi: 'Erawan_National_Park',
  ayutthaya: 'Wat_Chaiwatthanaram',
  sukhothai: 'Sukhothai_Historical_Park',
  nan: 'Wat_Phumin',
  khaoyai: 'Khao_Yai_National_Park'
};
const OPEN_LICENSE = /^(CC BY|CC0|Public domain)/i;
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const api = async (url) => (await fetch(url, { headers: UA })).json();

const outDir = path.join(root, 'assets/img/provinces');
fs.mkdirSync(outDir, { recursive: true });
const credits = {};

for (const [id, article] of Object.entries(ARTICLES)) {
  const pg = Object.values((await api(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=name&titles=${article}`)).query.pages)[0];
  if (!pg.pageimage) throw new Error(`${id}: ${article} has no lead image`);
  const file = pg.pageimage;
  const cp = Object.values((await api(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${WIDTH}&titles=File:${encodeURIComponent(file)}`)).query.pages)[0];
  const ii = cp.imageinfo?.[0];
  const m = ii?.extmetadata || {};
  const license = strip(m.LicenseShortName?.value);
  if (!ii || !OPEN_LICENSE.test(license)) throw new Error(`${id}: ${file} is not openly licensed on Commons (${license || 'missing'})`);
  const img = await fetch(ii.thumburl, { headers: UA });
  if (!img.ok) throw new Error(`${id}: download failed ${img.status}`);
  const dest = path.join(outDir, `${id}.jpg`);
  fs.writeFileSync(dest, Buffer.from(await img.arrayBuffer()));
  credits[id] = {
    src: `assets/img/provinces/${id}.jpg`,
    title: strip(m.ObjectName?.value) || file.replace(/_/g, ' ').replace(/\.\w+$/, ''),
    artist: strip(m.Artist?.value) || 'ไม่ระบุ',
    license,
    licenseUrl: m.LicenseUrl?.value || '',
    source: ii.descriptionurl
  };
  console.log(`${id.padEnd(13)} ${license.padEnd(14)} ${(fs.statSync(dest).size / 1024).toFixed(0)} KB  ${credits[id].artist.slice(0, 40)}`);
}

fs.writeFileSync(path.join(root, 'assets/js/credits.js'),
  `// สร้างโดย scripts/fetch-images.mjs — ภาพจาก Wikimedia Commons ปรับขนาดเป็น ${WIDTH}px\n` +
  `(function (root) { root.PHOTO_CREDITS = ${JSON.stringify(credits, null, 2)}; })(typeof window !== 'undefined' ? window : globalThis);\n`);
console.log(`✔ ${Object.keys(credits).length} images + assets/js/credits.js`);
