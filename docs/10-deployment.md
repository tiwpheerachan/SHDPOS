# 10 — การนำขึ้นใช้งานจริง

## 1. ฐานข้อมูล

```bash
# สร้างโปรเจกต์ที่ supabase.com (เลือก region Singapore — ใกล้ไทยที่สุด)
psql "$DATABASE_URL" -f supabase/migrations/0001_core.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_catalog.sql
psql "$DATABASE_URL" -f supabase/migrations/0003_inventory.sql
psql "$DATABASE_URL" -f supabase/migrations/0004_sales.sql
psql "$DATABASE_URL" -f supabase/migrations/0005_governance.sql
psql "$DATABASE_URL" -f supabase/migrations/0006_functions.sql
psql "$DATABASE_URL" -f supabase/migrations/0007_rls.sql
psql "$DATABASE_URL" -f supabase/seed.sql      # permission matrix + 29 สาขา + ตัวอย่างสินค้า
```

หลัง seed ให้ import ข้อมูลจริง (สินค้า 1,250 SKU, พนักงาน 293 คน, สต๊อกตั้งต้น)
ตามลำดับใน `08-api-reference.md`

### ตั้งค่าเพิ่มใน Supabase
- **Auth**: ปิดการสมัครเอง (`Disable signup`) — พนักงานถูกสร้างโดยแอดมินเท่านั้น
- **Database → Extensions**: เปิด `pg_cron` (สำหรับคิว e-Tax และรายงานรายวัน)
- **Backup**: Point-in-time recovery — จำเป็นสำหรับข้อมูลการขาย

## 2. เว็บแอป

### ตัวเลือก A — Vercel (ง่ายที่สุด)
```bash
cd web
vercel --prod
# ตั้ง env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### ตัวเลือก B — VPS ในไทย (latency ต่ำกว่า, คุมต้นทุนได้)
เหมาะกับ SHD เพราะกำลังประเมิน Metrabyte Cloud อยู่แล้ว

```bash
cd web && npm ci && npm run build
pm2 start npm --name shd-pos -- start
# วาง Nginx/Caddy หน้า พร้อม HTTPS
```

### ตัวเลือก C — Tauri (แอปติดตั้งบนเครื่องหน้าร้าน)
ห่อเว็บเดิม ได้ `.exe` / `.dmg` เข้าถึง USB/Serial ตรงโดยไม่ต้องมี bridge แยก
โค้ดหน้าเว็บใช้ของเดิม 100%

## 3. เครื่อง POS แต่ละจุด

```bash
# 1) ลง Node 20+
# 2) คัดลอกโฟลเดอร์ bridge/ ไปที่เครื่อง
# 3) ตั้งค่า
PRINTER_TYPE=network
PRINTER_HOST=192.168.1.50
ALLOW_ORIGIN=https://pos.shd-technology.co.th
# 4) ตั้งให้รันตอนบูต
```

**Windows** — ใช้ `nssm` ทำเป็น service:
```
nssm install SHDPosBridge "C:\Program Files\nodejs\node.exe" "C:\shd-pos\bridge\src\server.js"
nssm set SHDPosBridge AppEnvironmentExtra PRINTER_TYPE=network PRINTER_HOST=192.168.1.50
nssm start SHDPosBridge
```

**Linux/macOS** — systemd หรือ launchd (ตัวอย่างอยู่ใน `bridge/README` ที่สร้างเพิ่มได้)

### ตั้งค่าเบราว์เซอร์หน้าร้าน
- เปิด Chrome/Edge แบบ kiosk: `chrome --kiosk --app=https://pos.shd-technology.co.th/pos`
- ใช้โปรไฟล์แยกสำหรับเครื่อง POS (กันคนเผลอเคลียร์ข้อมูล = งานที่ค้างซิงก์หาย)
- ปิด auto-update ที่รีสตาร์ทเองกลางวัน

## 4. ลำดับการเปิดใช้งาน (แนะนำ)

```
สัปดาห์ 1–2   นำร่อง 1 สาขา (แนะนำ 70mai รามอินทรา — ยอดสูงสุด 23,024 บรรทัด/ปี)
              ขายคู่ขนานกับระบบเดิม เทียบยอดทุกวัน
สัปดาห์ 3     แก้ตามที่หน้าร้านสะท้อนกลับ
สัปดาห์ 4–5   ขยายเป็น 3 สาขา (คนละแบรนด์: 70mai / Anker / Dreame)
              เพื่อทดสอบ scope รายแบรนด์จริง
สัปดาห์ 6–8   ทยอยเปิดที่เหลือ สาขาละ 2–3 แห่งต่อสัปดาห์
              (เริ่มจากสาขายอดน้อยไปหายอดมาก)
```

**อย่าเปิดพร้อมกัน 29 สาขา** — ปัญหาฮาร์ดแวร์และการอบรมจะถาโถมพร้อมกันจนแก้ไม่ทัน

## 5. Checklist ก่อนเปิดแต่ละสาขา

```
[ ] เครื่องพิมพ์ + ลิ้นชักทดสอบผ่าน (หน้า /pos/settings → ทดสอบพิมพ์ / ทดสอบเปิดลิ้นชัก)
[ ] สแกนบาร์โค้ดสินค้าจริงในร้านครบทุกรายการ
[ ] สต๊อกตั้งต้นนับแล้วและตรงกับระบบ (movement type = opening)
[ ] พนักงานทุกคนมีรหัส + PIN ของตัวเอง (ห้ามใช้ PIN ร่วมกัน)
[ ] ตั้งเพดานส่วนลดตามระดับแล้ว
[ ] ทดสอบขายจริง 3 บิล: เงินสด / บัตร / แบ่งจ่าย
[ ] ทดสอบยกเลิกบิล + คืนสินค้า
[ ] ทดสอบตัดเน็ต → ขาย 3 บิล → ต่อเน็ต → ตรวจว่าซิงก์ครบ ไม่ซ้ำ
[ ] ทดสอบเปิด–ปิดกะ พร้อมนับเงิน
[ ] จอลูกค้าแสดงผลถูกต้อง
[ ] อบรมพนักงาน: ขาย / คืน / ปิดกะ / ทำยังไงเมื่อเน็ตหลุด / ทำยังไงเมื่อเครื่องพิมพ์พัง
```

## 6. ต้นทุนโดยประมาณ

| รายการ | ต่อเดือน |
|---|---|
| Supabase Pro (8GB DB, PITR) | ~$25 (≈ 900 ฿) |
| Vercel Pro **หรือ** VPS ไทย | ~$20 / 250–599 ฿ |
| รวมซอฟต์แวร์ | **~1,200–1,800 ฿/เดือน** สำหรับทั้ง 29 สาขา |
| ฮาร์ดแวร์ต่อจุดขาย (ครั้งเดียว) | ~19,000–31,000 ฿ (ดู `06-hardware.md`) |

ถูกกว่า POS สำเร็จรูปแบบรายสาขาอย่างมีนัยสำคัญ (ทั่วไป 800–2,500 ฿/สาขา/เดือน
= 23,000–72,000 ฿/เดือนสำหรับ 29 สาขา)

## 7. Backup และแผนสำรอง

| ความเสี่ยง | แผนรับมือ |
|---|---|
| Supabase ล่ม | POS ขายต่อได้จาก IndexedDB แล้วซิงก์ทีหลัง (นี่คือเหตุผลหลักของ offline-first) |
| เน็ตร้านล่ม | เหมือนข้างบน — พนักงานเห็นแถบส้มแต่ขายต่อได้ |
| เครื่อง POS พัง | เปิดเว็บจากเครื่องอื่น/แท็บเล็ตสำรอง ล็อกอินใหม่ได้ทันที (งานที่ค้างในเครื่องเดิมจะซิงก์เมื่อเปิดเครื่องนั้นอีกครั้ง) |
| เครื่องพิมพ์พัง | ขายต่อได้ ออกใบเสร็จย้อนหลังจากหน้ารายการบิล |
| ข้อมูลเสียหาย | Supabase PITR ย้อนได้ถึงระดับวินาที + export รายวันเข้า BigQuery |

## 8. การเฝ้าระวังหลังเปิดใช้

ดูทุกวันในสัปดาห์แรก แล้วค่อยลดเป็นสัปดาห์ละครั้ง:

- จำนวนงานค้างซิงก์รวมทุกสาขา (ควรเป็น 0 ตอนปิดร้าน)
- `sync_conflicts` ที่ยังไม่ถูกแก้
- ส่วนต่างเงินสดตอนปิดกะ
- บิลที่ `is_offline_origin = true` (บอกว่าสาขาไหนเน็ตมีปัญหา)
- สินค้าที่สต๊อกติดลบ (สัญญาณว่าสต๊อกตั้งต้นไม่ตรง)
