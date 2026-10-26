# LUMIÈRE 🎬

เว็บดูหนังสไตล์หรูหรา โทนดำ–ทอง ไม่มีโฆษณา อัปเดตอัตโนมัติ และถูกลิขสิทธิ์

## ฟีเจอร์

- **ตารางโปสเตอร์ + หมวดหมู่** — หนังใหม่, แอ็กชัน, ตลก, สยองขวัญ, อนิเมะ, ไซไฟ พร้อมระบบแบ่งหน้า รองรับมือถือ (3 คอลัมน์) และคอมพิวเตอร์
- **2 แหล่งในทุกหมวด**
  - *หนังทั้งหมด* — ข้อมูลจริงจาก [TMDB](https://www.themoviedb.org/) (โปสเตอร์ ชื่อ ปี คะแนน)
  - *ดูฟรีเต็มเรื่อง* — ภาพยนตร์สาธารณสมบัติจาก [Internet Archive](https://archive.org/details/feature_films) และหนัง Creative Commons ของ Blender Studio
- **ค้นหาชื่อหนัง** พร้อมแบ่งหน้า (ทั้ง TMDB และหนังดูฟรี)
- **เพิ่มเข้ามาล่าสุด** — เรียงตามวันที่เพิ่มเข้าคลัง
- **อัปเดตอัตโนมัติ** ทุก 5 นาที (ตั้งค่าได้) ไม่สร้างรายการซ้ำ เรื่องใหม่มีป้าย **NEW** ถ้าโหลดไม่สำเร็จจะแสดงข้อความชัดเจน พร้อมปุ่มลองใหม่ และคงข้อมูลเดิมไว้
- **กดโปสเตอร์ → `watch.html`**
  - มีวิดีโอเต็มเรื่องถูกลิขสิทธิ์ → เล่นทันทีในเครื่องเล่น 16:9
  - ไม่มี → แสดงตัวอย่างหนังอย่างเป็นทางการ + ลิงก์บริการรับชมที่ถูกกฎหมาย (Netflix, Disney+ ฯลฯ ข้อมูลจาก JustWatch)

## เริ่มใช้งานในเครื่อง

ต้องมี Node.js 20 ขึ้นไป (ไม่มี dependency ภายนอก)

```bash
cp .env.example .env       # แล้วใส่ TMDB_API_KEY (สมัครฟรีที่ https://www.themoviedb.org/settings/api)
npm run dev                # build แล้วเปิด http://localhost:8080
```

| Environment variable | ความหมาย | ค่าเริ่มต้น |
|---|---|---|
| `TMDB_API_KEY` | TMDB API Key (v3) หรือ Read Access Token (v4) | — |
| `TMDB_REGION` | ประเทศสำหรับช่องทางรับชม/หนังเข้าโรง | `TH` |
| `TMDB_LANGUAGE` | ภาษาข้อมูลหนัง | `th-TH` |
| `REFRESH_MINUTES` | ความถี่อัปเดตอัตโนมัติ (นาที) | `5` |

> ⚠️ เว็บนี้เป็น static site คีย์ที่ build เข้าไปจะมองเห็นได้ในเบราว์เซอร์ของผู้ชม — TMDB อนุญาตให้ใช้แบบนี้ได้ แต่ควรใช้คีย์สำหรับเว็บนี้โดยเฉพาะ
> ถ้าไม่ใส่คีย์ เว็บยังใช้งานได้ โดยแสดงเฉพาะหนังดูฟรีเต็มเรื่อง และผู้ชมใส่คีย์ของตัวเองได้จากปุ่ม ⚙️

## ทดสอบ

```bash
npm run build   # ตรวจ syntax และไฟล์ที่อ้างอิงทั้งหมด
npm test        # E2E 27 รายการ ด้วย Edge/Chrome headless (TMDB จำลอง + Internet Archive จริง)
```

## Deploy (GitHub Pages อัตโนมัติ)

1. Push โค้ดขึ้น GitHub
2. **Settings → Secrets and variables → Actions → New repository secret** ชื่อ `TMDB_API_KEY`
3. **Settings → Pages → Source: GitHub Actions**
4. ทุกครั้งที่ push ไป `main` workflow `.github/workflows/deploy.yml` จะ build และเผยแพร่ที่ `https://<username>.github.io/<repo>/`

## แหล่งวิดีโอและลิขสิทธิ์

ป้ายสัญญาอนุญาตใน Internet Archive ผู้อัปโหลดเป็นผู้กำหนดเอง และพบหนังมีลิขสิทธิ์ที่ติดป้าย Creative Commons อยู่จริง
เว็บนี้จึงเล่นเฉพาะ:

| provider | เงื่อนไข |
|---|---|
| `open` | รายการ Blender Studio ที่ตรวจสอบแล้ว (`OPEN_FILMS` ใน `providers.js`) |
| `archive` | ระบุเป็นสาธารณสมบัติ และออกฉายไม่เกินปี 1970 (`ARCHIVE_MAX_YEAR` ใน `core.js`) |
| `tmdb` | ไม่เล่นหนังเต็มเรื่อง — แสดงตัวอย่าง + ช่องทางรับชมถูกกฎหมาย |

หากได้รับแจ้งเรื่องลิขสิทธิ์ ให้เพิ่มรหัสรายการใน `ARCHIVE_BLOCKED` (`assets/js/core.js`)

### เพิ่มแหล่งวิดีโอใหม่

เรียก `Providers.register({...}, { before: 'tmdb' })` ใน `assets/js/providers.js` — ดูรูปแบบและตัวอย่างที่หัวไฟล์
ใช้กับแหล่งที่คุณมีสิทธิ์เผยแพร่และฝังวิดีโออย่างถูกต้องเท่านั้น

## โครงสร้าง

```
index.html                 หน้าแรก
watch.html                 หน้าเล่นวิดีโอ
assets/css/style.css       ดีไซน์
assets/js/config.js        ค่าเริ่มต้น (ใน dist/ สร้างจาก env ตอน build)
assets/js/core.js          ส่วนกลาง: TMDB, Internet Archive, การ์ดโปสเตอร์
assets/js/providers.js     ระบบแหล่งวิดีโอ
assets/js/catalog.js       หมวดหมู่ ตาราง แบ่งหน้า ค้นหา เพิ่มเข้ามาล่าสุด
assets/js/app.js           hero, แถวไฮไลต์, รายละเอียด, ตั้งค่า, อัปเดตอัตโนมัติ
assets/js/watch.js         หน้าเล่นวิดีโอ
scripts/build.mjs          build + ตรวจสอบ
scripts/serve.mjs          เซิร์ฟเวอร์ทดสอบในเครื่อง
tests/e2e.mjs              ชุดทดสอบ
.github/workflows/deploy.yml  deploy ไป GitHub Pages
```

## เครดิต

This product uses the TMDB API but is not endorsed or certified by TMDB.
ภาพยนตร์เต็มเรื่องมาจาก Internet Archive และ Blender Studio (Creative Commons) เว็บไซต์นี้ไม่โฮสต์หรือเผยแพร่เนื้อหาละเมิดลิขสิทธิ์
