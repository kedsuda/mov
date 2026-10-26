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
