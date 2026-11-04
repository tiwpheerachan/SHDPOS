# SHD POS

ระบบขายหน้าร้านหลายสาขา หลายแบรนด์ สำหรับ SHD Technology
**Next.js (web) + Supabase (Postgres / Realtime / Auth) + Print Bridge (Node)**

> ออกแบบจากข้อมูลจริง: ไฟล์ยอดขายหน้าร้านปี 2024 จำนวน 98,445 บรรทัด
> 4 แบรนด์ · 29 สาขา · 293 พนักงานขาย · 1,250 SKU
> โครงสร้างฟิลด์ทั้งหมดถูก map ไว้ที่ [`docs/reference/legacy-data-columns.md`](docs/reference/legacy-data-columns.md)

---

## สิ่งที่อยู่ในแพ็กนี้

| โฟลเดอร์ | คืออะไร |
|---|---|
| `web/` | แอป Next.js — หน้าร้าน (POS) + หลังบ้าน (Admin) ในตัวเดียว **รันได้จริง** |
| `supabase/` | SQL migrations ครบทั้ง 10 โมดูล + RLS + RPC + seed |
| `bridge/` | เอเจนต์ Node สำหรับเครื่องพิมพ์สลิป + ลิ้นชักเงินสด (รันบนเครื่อง POS) |
| `docs/` | สเปกเต็ม 13 ไฟล์ — สถาปัตยกรรม, data model, สิทธิ์, offline, ฮาร์ดแวร์, e-Tax, API, UI, deploy, roadmap |

---

## เริ่มใช้ใน 2 นาที (โหมดสาธิต ไม่ต้องต่อฐานข้อมูล)

```bash
cd web
npm install
npm run dev
# เปิด http://localhost:3000
```

โหมดสาธิตใช้ข้อมูลตัวอย่างใน IndexedDB ของเบราว์เซอร์ (29 สาขาจริง, ยอดขายย้อนหลัง 60 วัน)
**PIN ของทุกคนคือ `1234`**

| อยากดูอะไร | ล็อกอินเป็น |
|---|---|
| ขายหน้าร้าน + เปิดลิ้นชัก | `nattasak` (ผู้จัดการร้าน — ส่วนลดได้ถึง 20%) |
| พนักงานขายทั่วไป (ต้องขออนุมัติ) | `nichakan` (ส่วนลดได้ 5%) |
| เห็นทุกสาขา ทุกแบรนด์ | `rice` (HQ) |
| เห็นเฉพาะแบรนด์ตัวเอง | `ba70mai` / `baanker` |

### เครื่องพิมพ์ + ลิ้นชัก (ไม่บังคับ)

```bash
cd bridge
node src/server.js          # ค่าเริ่มต้นเขียนไฟล์ไว้ดูก่อน ยังไม่ต้องมีเครื่องพิมพ์จริง
```

ต่อเครื่องพิมพ์จริง:

```bash
PRINTER_TYPE=network PRINTER_HOST=192.168.1.50 node src/server.js   # เครื่องพิมพ์ LAN
PRINTER_TYPE=usb PRINTER_DEVICE=/dev/usb/lp0 node src/server.js     # USB (Linux)
```

---

## ต่อ Supabase จริง

```bash
# 1) สร้างโปรเจกต์ที่ supabase.com แล้วรัน migrations ตามลำดับ
psql "$DATABASE_URL" -f supabase/migrations/0001_core.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_catalog.sql
psql "$DATABASE_URL" -f supabase/migrations/0003_inventory.sql
psql "$DATABASE_URL" -f supabase/migrations/0004_sales.sql
psql "$DATABASE_URL" -f supabase/migrations/0005_governance.sql
psql "$DATABASE_URL" -f supabase/migrations/0006_functions.sql
psql "$DATABASE_URL" -f supabase/migrations/0007_rls.sql
psql "$DATABASE_URL" -f supabase/seed.sql

# 2) ตั้ง env ให้เว็บ
cd web && cp .env.example .env.local     # ใส่ URL + anon key
npm run dev
```

พอมี env ครบ ระบบจะสลับจากโหมดสาธิตเป็นโหมดจริงเอง — UI ไม่ต้องแก้อะไรเลย

---

## 10 โมดูลหลัก

| # | โมดูล | สถานะในแพ็กนี้ |
|---|---|---|
| 1 | POS Checkout | ✅ ใช้งานได้จริง — สแกน/ค้นหา, ตะกร้า, ส่วนลด, serial, mixed payment |
| 2 | Orders & Receipt | ✅ รายการบิล, พิมพ์ซ้ำ, ยกเลิกบิล, สลิป ESC/POS ภาษาไทย |
| 3 | Return / Exchange | ✅ ค้นบิลเดิม, เลือกรายการ, สภาพสินค้า, คืนเข้าสต๊อก, ขออนุมัติ |
| 4 | Inventory | ✅ สต๊อกรายสาขา, ledger, แจ้งเตือนใกล้หมด |
| 5 | Transfer & Stock Count | ✅ ใบโอน 10 สถานะ + รับไม่ครบ, cycle count |
| 6 | Employee / Shift / Cash Drawer | ✅ เปิด–ปิดกะ, หลายคนต่อกะ, นับเงิน, drawer kick |
| 7 | Customer / Member | 🟡 โครงสร้างครบใน DB, UI ระดับพื้นฐาน |
| 8 | Admin / Permission / Approval | ✅ matrix 6 ระดับ, ขอบเขตข้อมูล 4 ระดับ, PIN approval |
| 9 | Analytics & Performance | ✅ dashboard + filter + performance รายคน/สาขา/แบรนด์ |
| 10 | Audit Log | ✅ 17 action, append-only บังคับที่ database |

---

## หลักการออกแบบที่ยึดไว้

1. **เครื่องพิมพ์พังต้องไม่ทำให้ขายไม่ได้** — ลำดับคือ `Payment → Save Order → Commit Inventory → Print`
2. **เน็ตหลุดต้องขายต่อได้** — POS อ่าน/เขียน IndexedDB เสมอ แล้วซิงก์เบื้องหลัง
3. **บิลห้ามซ้ำ** — ทุกบิลมี `client_uuid` ที่สร้างจากเครื่อง; RPC ฝั่ง server เป็น idempotent
4. **อย่าเชื่อ frontend** — สิทธิ์บังคับจริงที่ Postgres RLS ไม่ใช่แค่ซ่อนปุ่ม
5. **ยอด/ต้นทุน snapshot ณ เวลาขาย** — ไม่คำนวณย้อนหลังจาก master ที่เปลี่ยนไปแล้ว

อ่านรายละเอียดทั้งหมดที่ [`docs/00-overview.md`](docs/00-overview.md)
