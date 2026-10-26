// Build: คัดลอกเว็บไปที่ dist/ แล้วตรวจสอบ syntax ของ JavaScript และไฟล์ที่ HTML อ้างอิง
//   OUT_DIR  โฟลเดอร์ผลลัพธ์ (ค่าเริ่มต้น dist)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, (process.env.OUT_DIR || '').trim() || 'dist');
const FILES = ['index.html', '.nojekyll', 'assets'];
const errors = [];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of FILES) fs.cpSync(path.join(root, f), path.join(out, f), { recursive: true });

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

for (const file of walk(out).filter((f) => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) errors.push(`JS syntax error in ${path.relative(out, file)}\n${r.stderr}`);
}
for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
    if (/^(https?:|data:|mailto:|tel:)/.test(ref)) continue;
    if (!fs.existsSync(path.join(path.dirname(file), ref))) errors.push(`Missing file referenced in ${path.relative(out, file)}: ${ref}`);
  }
}

if (errors.length) {
  console.error('\n✖ Build failed:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`✔ Built to ${path.relative(root, out) || '.'}/`);
