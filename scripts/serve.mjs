// เซิร์ฟเวอร์ไฟล์ static สำหรับทดสอบในเครื่อง: node scripts/serve.mjs [dir] (PORT=8080)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'dist');
const port = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export function serve(dir = root, p = port) {
  dir = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(p, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || import.meta.url.endsWith(path.basename(process.argv[1]))) {
  serve().then(() => console.log(`Serving ${root} at http://localhost:${port}/`));
}
