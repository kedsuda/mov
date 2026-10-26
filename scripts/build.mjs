// Build: คัดลอกเว็บไปที่ dist/ และสร้าง assets/js/config.js จาก environment variables
//   TMDB_API_KEY      TMDB API Key (v3) หรือ Read Access Token (v4)
//   TMDB_REGION       ประเทศสำหรับช่องทางรับชม/หนังเข้าโรง (ค่าเริ่มต้น TH)
//   TMDB_LANGUAGE     ภาษาข้อมูลหนัง (ค่าเริ่มต้น th-TH)
//   REFRESH_MINUTES   ความถี่อัปเดตอัตโนมัติ (ค่าเริ่มต้น 5)
//   OUT_DIR           โฟลเดอร์ผลลัพธ์ (ค่าเริ่มต้น dist)
// อ่านค่าจากไฟล์ .env ได้ด้วย (ค่าใน environment จริงมีสิทธิ์เหนือกว่า)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv(path.join(root, '.env'));

const env = (k, d = '') => (process.env[k] ?? '').trim() || d;
const out = path.resolve(root, env('OUT_DIR', 'dist'));
const FILES = ['index.html', 'watch.html', '.nojekyll', 'assets'];
const errors = [];

// ---------- Copy ----------
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of FILES) fs.cpSync(path.join(root, f), path.join(out, f), { recursive: true });

// ---------- Config from env ----------
const config = {
  TMDB_KEY: env('TMDB_API_KEY'),
  REGION: env('TMDB_REGION', 'TH'),
  LANGUAGE: env('TMDB_LANGUAGE', 'th-TH'),
  REFRESH_MINUTES: Number(env('REFRESH_MINUTES', '5')) || 5
};
// ใช้ระหว่างทดสอบเท่านั้น (ชี้ไปยัง TMDB จำลอง)
if (env('TMDB_API_BASE')) config.TMDB_API_BASE = env('TMDB_API_BASE');
if (env('TMDB_IMAGE_BASE')) config.TMDB_IMAGE_BASE = env('TMDB_IMAGE_BASE');
fs.writeFileSync(
  path.join(out, 'assets/js/config.js'),
  `// สร้างอัตโนมัติโดย scripts/build.mjs — อย่าแก้ไขไฟล์นี้ใน dist/\nwindow.CONFIG = ${JSON.stringify(config, null, 2)};\n`
);

// ---------- Subtitles ----------
// ไฟล์คำบรรยายใน Internet Archive ไม่ส่ง CORS header เบราว์เซอร์จึงโหลดตรงไม่ได้
// ตอน build จึงดาวน์โหลด .srt/.vtt ของหนังที่คัดไว้ แปลงเป็น WebVTT แล้วเก็บไว้ใน dist/subs/ (same-origin)
// ข้ามได้ด้วย SKIP_SUBTITLES=1
const IA = 'https://archive.org';
const srtToVtt = (s) => 'WEBVTT\n\n' + s.replace(/^﻿/, '').replace(/\r/g, '')
  .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').trim() + '\n';

async function fetchText(url, ms = 20000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function buildSubtitles() {
  const providersSrc = fs.readFileSync(path.join(root, 'assets/js/providers.js'), 'utf8');
  const coreSrc = fs.readFileSync(path.join(root, 'assets/js/core.js'), 'utf8');
  const ids = new Set([...providersSrc.matchAll(/archive: '([\w.-]+)'/g)].map((m) => m[1]));
  const maxYear = /ARCHIVE_MAX_YEAR = (\d+)/.exec(coreSrc)?.[1] || '1970';
  const search = new URL(IA + '/advancedsearch.php');
  search.searchParams.set('q', `collection:(feature_films) AND mediatype:(movies) AND licenseurl:(*publicdomain*) AND year:[1890 TO ${maxYear}]`);
  search.searchParams.append('fl[]', 'identifier');
  search.searchParams.append('sort[]', 'downloads desc');
  search.searchParams.set('rows', env('SUBTITLE_TOP_N', '60'));
  search.searchParams.set('output', 'json');
  try {
    JSON.parse(await fetchText(search)).response.docs.forEach((d) => ids.add(d.identifier));
  } catch (err) { console.warn(`  ! subtitle search failed: ${err.message}`); }

  const manifest = {};
  let files = 0;
  const queue = [...ids];
  async function worker() {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const meta = JSON.parse(await fetchText(`${IA}/metadata/${encodeURIComponent(id)}`));
        const subs = (meta.files || []).filter((f) => /\.(srt|vtt)$/i.test(f.name) && f.private !== 'true').slice(0, 8);
        for (const f of subs) {
          let text = await fetchText(`${IA}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`);
          if (/\.srt$/i.test(f.name)) text = srtToVtt(text);
          if (!/^﻿?WEBVTT/.test(text) || !/-->/.test(text)) continue;
          const name = path.basename(f.name).replace(/[^\w.-]/g, '_').replace(/\.(srt|vtt)$/i, '.vtt');
          fs.mkdirSync(path.join(out, 'subs', id), { recursive: true });
          fs.writeFileSync(path.join(out, 'subs', id, name), text);
          (manifest[id] ||= []).push({ src: `subs/${id}/${name}`, file: f.name });
          files++;
        }
      } catch (err) { console.warn(`  ! subtitles for ${id}: ${err.message}`); }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.mkdirSync(path.join(out, 'subs'), { recursive: true });
  fs.writeFileSync(path.join(out, 'subs/index.json'), JSON.stringify(manifest));
  console.log(`  Subtitles: ${files} files for ${Object.keys(manifest).length} of ${ids.size} films`);
}

if (env('SKIP_SUBTITLES') === '1') {
  fs.mkdirSync(path.join(out, 'subs'), { recursive: true });
  fs.writeFileSync(path.join(out, 'subs/index.json'), '{}');
} else {
  await buildSubtitles();
}

// ---------- Validate ----------
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

for (const file of walk(out).filter((f) => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) errors.push(`JS syntax error in ${path.relative(out, file)}\n${r.stderr}`);
}
for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    if (/^(https?:|data:|mailto:|tel:|\.\/?$)/.test(ref) || ref.startsWith('watch.html')) continue;
    if (!fs.existsSync(path.join(path.dirname(file), ref))) errors.push(`Missing file referenced in ${path.relative(out, file)}: ${ref}`);
  }
}

if (errors.length) {
  console.error('\n✖ Build failed:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✔ Built to ${path.relative(root, out) || '.'}/`);
console.log(`  TMDB key: ${config.TMDB_KEY ? 'set (' + config.TMDB_KEY.slice(0, 4) + '…)' : 'NOT SET — only free full-length films will be shown'}`);
console.log(`  Region: ${config.REGION} · Language: ${config.LANGUAGE} · Refresh: every ${config.REFRESH_MINUTES} min`);
