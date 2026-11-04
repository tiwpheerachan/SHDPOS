# 01 — สถาปัตยกรรม

## ภาพรวม

```
┌──────────────────────── เครื่อง POS (แท็บเล็ต / PC + จอลูกค้า) ────────────────────────┐
│                                                                                        │
│   Next.js PWA                          Print Bridge (Node, 127.0.0.1:9110)             │
│   ├── /pos/*     หน้าร้าน               ├── POST /print   → ESC/POS ไปเครื่องพิมพ์        │
│   ├── /admin/*   หลังบ้าน                ├── POST /drawer  → เปิดลิ้นชัก                  │
│   ├── /pos/display  จอลูกค้า             └── GET  /status  → รายชื่อเครื่องพิมพ์           │
│   │                                                                                    │
│   └── IndexedDB (Dexie)  ← แหล่งข้อมูลที่ POS อ่าน/เขียนเสมอ                             │
│         products · stock · orders · shifts · audit · pending queue                      │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │  ซิงก์เบื้องหลัง (HTTPS)
                                         ▼
┌──────────────────────────────── Supabase ─────────────────────────────────┐
│  PostgreSQL                                                                │
│  ├── ตาราง 40+ ตาราง (0001–0005)                                            │
│  ├── RPC: create_order / void_order / close_shift / apply_stock_movement    │
│  ├── RLS: บังคับขอบเขต branch / brand / own                                  │
│  ├── Views: v_daily_sales, v_employee_performance, v_low_stock              │
│  └── Trigger: audit_logs append-only                                        │
│  Realtime  → หลังบ้านเห็นบิลใหม่ทันที                                          │
│  Auth      → พนักงานหลังบ้าน (email) / POS ใช้ PIN + device token            │
│  Storage   → ไฟล์ใบกำกับภาษี, รูปสินค้า                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

## ทำไมเลือกแบบนี้

| ทางเลือก | เหตุผล |
|---|---|
| **Next.js (web) แทน Flutter** | เปิดได้ทุกเครื่องทันทีโดยไม่ต้องติดตั้ง — แท็บเล็ต, PC หน้าร้าน, มือถือผู้จัดการ, จอลูกค้าเป็นแค่อีกแท็บ; แก้ไข/ deploy เร็วกว่ามาก; ทีม Innovation คุ้นกับ React/Vite อยู่แล้วจาก ecom-data-platform |
| **Tailwind + คอมโพเนนต์เขียนเอง** | คุมหน้าตาได้ละเอียด เปลี่ยนธีมทั้งระบบจาก CSS variable ชุดเดียว (สว่าง/มืด) ไม่มี dependency หนัก |
| **กราฟ SVG เขียนเอง** | เลี่ยงปัญหา peer dependency ของ chart library, bundle เล็ก, สีเข้ากับธีมอัตโนมัติ |
| **IndexedDB เป็นแหล่งอ่านหลัก** | หน้าร้านตอบสนองทันทีและขายได้ตอนเน็ตหลุด (ข้อกำหนดข้อ 21) |
| **Supabase** | ได้ Postgres + RLS + Realtime + Auth ในตัวเดียว ทำ multi-tenant scoping ที่ระดับแถวได้ตรงกับที่ต้องการ |
| **Print Bridge แยก process** | เบราว์เซอร์คุย USB/LAN printer ตรง ๆ ไม่ได้ และต้องเปิดลิ้นชักผ่าน RJ11 หลังเครื่องพิมพ์ |

### ถ้าอยากได้แอปติดตั้งบนเครื่อง (ตัวเลือกเสริม)

ห่อเว็บเดิมด้วย **Tauri v2** ได้เลย (ไม่ต้องเขียนใหม่):

- ได้ไฟล์ `.exe` / `.dmg` / `.deb` สำหรับลงเครื่องหน้าร้าน
- เข้าถึง USB / Serial ได้ตรงโดยไม่ต้องมี bridge แยก
- ขนาดติดตั้ง ~8 MB (เล็กกว่า Electron ~10 เท่า)
- โค้ดหน้าเว็บใช้ของเดิม 100%

## การไหลของการขายหนึ่งบิล

```
1. สแกนบาร์โค้ด / กดการ์ดสินค้า
      → cart store (zustand)  →  ส่งภาพไปจอลูกค้า (BroadcastChannel)

2. ส่วนลด
      → ถ้าเกินเพดานของ role  →  ApprovalModal (PIN หัวหน้า)
      → บันทึก approvals + audit_logs

3. สินค้าที่ต้องมี serial
      → บังคับสแกนให้ครบจำนวนก่อนจ่ายเงิน

4. ชำระเงิน (แบ่งได้หลายช่องทาง)
      → cash / credit / QR / transfer / EDC / installment / gift card / store credit

5. commitSale()
      a. เขียน order ลง IndexedDB        ← ถือว่าขายสำเร็จตรงนี้
      b. ตัดสต๊อกในเครื่อง
      c. อัปเดตยอดกะ
      d. เขียน audit log
      e. enqueue('create_order', client_uuid, payload)

6. พิมพ์สลิป (แยกจากข้อ 5 โดยสิ้นเชิง)
      → สำเร็จ: ปิดหน้าต่าง
      → ล้มเหลว: แสดง "ขายสำเร็จ · พิมพ์ไม่สำเร็จ [ลองใหม่]"

7. เปิดลิ้นชักอัตโนมัติถ้ามีการรับเงินสด

8. Sync worker (ทุก 30 วิ / ตอนออนไลน์กลับมา / ตอนกลับมาที่แท็บ)
      → rpc('create_order', { p_payload })  → server เช็ค client_uuid กันซ้ำ
```

## โครงไฟล์ฝั่งเว็บ

```
web/src/
├── app/
│   ├── pos/            หน้าร้าน: login, shift, sell, orders, returns,
│   │                   stock, quotations, count, settings, display
│   ├── admin/          หลังบ้าน: dashboard, sales, employees, inventory,
│   │                   transfers, products, approvals, users, audit, settings
│   └── providers.tsx   bootstrap ข้อมูล + เริ่ม sync worker
├── components/
│   ├── ui.tsx          ปุ่ม/การ์ด/โมดัล/ตาราง/numpad/KPI
│   ├── charts.tsx      area / bar / donut / column / sparkline (SVG ล้วน)
│   ├── pos/            top bar, payment modal, approval modal, sale modals
│   └── admin/          shell (sidebar), filter bar
└── lib/
    ├── types.ts        โดเมนไทป์ตรงกับ schema
    ├── money.ts        การคำนวณเงิน/VAT รวมที่เดียว
    ├── permissions.ts  RBAC ฝั่ง client
    ├── analytics.ts    การรวมยอดสำหรับ dashboard
    ├── i18n/           ไทย / อังกฤษ / 中文
    ├── theme.tsx       สว่าง (ค่าเริ่มต้น) / มืด / ตามระบบ
    ├── offline/        db.ts (Dexie) · sync.ts (คิวซิงก์)
    ├── data/repo.ts    ชั้นเดียวที่ UI คุยด้วย
    ├── printing/       escpos.ts · receipt.ts · bridge.ts
    ├── supabase/       client
    └── customer-display.ts
```

## กฎการเขียนโค้ดที่ตั้งไว้

1. **UI ห้ามคุยกับ Dexie หรือ Supabase ตรง ๆ** — ผ่าน `lib/data/repo.ts` เท่านั้น
2. **การคำนวณเงินอยู่ใน `lib/money.ts` ที่เดียว** — ห้ามคูณ/หาร VAT กระจายในหน้า
3. **ข้อความทุกตัวผ่าน `useI18n()`** — ห้าม hardcode ภาษาใน component
4. **สีทุกสีมาจาก CSS variable** — ห้ามใส่ hex ตรงใน Tailwind class (ยกเว้นจานสีกราฟ)
5. **ทุก action ที่กระทบเงิน/สต๊อก/สิทธิ์ ต้องเรียก `writeAudit()`**
