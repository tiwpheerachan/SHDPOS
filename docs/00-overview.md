# 00 — ภาพรวมระบบ SHD POS

## ปัญหาที่ระบบนี้แก้

SHD ขายหน้าร้าน 29 สาขา 4+ แบรนด์ ปัจจุบันข้อมูลการขายอยู่ในสเปรดชีตหลายมิติ
(ดูไฟล์ `2024-offline 线下销售`) ซึ่งทำให้เกิดปัญหา:

| ปัญหาปัจจุบัน | สิ่งที่ POS นี้ทำแทน |
|---|---|
| คีย์ยอดขายย้อนหลังด้วยมือ ผิดพลาดง่าย | บันทึกทันทีที่ขาย พร้อม audit log |
| ไม่รู้ว่าสต๊อกแต่ละสาขาเหลือเท่าไรตอนนี้ | stock ledger รายสาขา realtime |
| performance รายคนต้องมานั่งรวมเอง | ผูกทุกบรรทัดกับ `salesperson_id` |
| ส่วนลดคุมไม่ได้ | เพดานตามระดับ + PIN approval |
| ต้นทุน/กำไรรู้ตอนปิดเดือน | snapshot ต้นทุนทุกบรรทัดตอนขาย |
| serial number อยู่คนละที่กับบิล | ผูก serial → order → customer → warranty |

## ขอบเขต 10 โมดูล

```
1  POS Checkout            ขายหน้าร้าน สแกน ตะกร้า ส่วนลด ชำระเงิน
2  Orders & Receipt        บิล ใบกำกับภาษีอย่างย่อ พิมพ์ซ้ำ ยกเลิก
3  Return / Exchange       คืนเงิน เปลี่ยนสินค้า เคลมประกัน
4  Inventory               สต๊อกรายสาขา ledger แจ้งเตือนใกล้หมด
5  Transfer & Stock Count  โอนย้ายระหว่างสาขา + cycle count
6  Employee/Shift/Cash     เปิด-ปิดกะ หลายคนต่อกะ ลิ้นชักเงินสด
7  Customer / Member       ลูกค้า แต้ม ข้อมูลใบกำกับภาษี
8  Admin/Permission        สิทธิ์ 6 ระดับ ขอบเขตข้อมูล 4 ระดับ อนุมัติ
9  Analytics & Performance dashboard รายสาขา/แบรนด์/คน + แจ้งเตือน
10 Audit Log               บันทึกทุก action สำคัญ แก้ไม่ได้
```

## 5 หลักการที่ไม่ยอมประนีประนอม

### 1. POS ต้องไม่ค้างเพราะเครื่องพิมพ์

```
Payment  →  Save Order ✅  →  Commit Inventory ✅  →  Print Receipt
                                                         ↓ ถ้าพัง
                                              "ขายสำเร็จแล้ว · พิมพ์ไม่สำเร็จ [ลองใหม่]"
```

บิลถูกบันทึกและตัดสต๊อกก่อนเสมอ การพิมพ์เป็นขั้นตอนแยกที่ล้มเหลวได้โดยไม่กระทบยอดขาย
(โค้ด: `web/src/app/pos/sell/page.tsx` → `confirmSale()` แล้วค่อย `doPrint()`)

### 2. เน็ตหลุดต้องขายต่อได้

POS อ่าน/เขียน IndexedDB (Dexie) เสมอ ไม่ว่าออนไลน์หรือไม่
งานที่ต้องส่งขึ้น server จะเข้าคิว `pending` แล้วซิงก์อัตโนมัติเมื่อเน็ตกลับมา

```
🟠 ออฟไลน์ — 14 รายการรอซิงก์        →     ซิงก์อยู่... 14/14 เสร็จ
```

### 3. บิลห้ามซ้ำ

ทุกบิลมี `client_uuid` ที่ POS สร้างเอง RPC `create_order(payload)` เช็ค `client_uuid`
ก่อนเสมอ — retry กี่ครั้งก็ได้บิลเดียว (idempotent)

### 4. สิทธิ์บังคับที่ database ไม่ใช่ที่ UI

`web/src/lib/permissions.ts` ใช้แค่ซ่อน/ปิดปุ่ม
ตัวจริงคือ Row Level Security ใน `supabase/migrations/0007_rls.sql`
พนักงานสาขา A ต่อให้ยิง API ตรง ๆ ก็อ่านบิลสาขา B ไม่ได้

### 5. ตัวเลขเป็น snapshot

`order_items.unit_cost`, `cost_total`, `gross_profit` ถูกเขียนตอนขาย
เปลี่ยนราคาทุน master ทีหลัง รายงานย้อนหลังไม่เพี้ยน

## แผนที่เอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| `01-architecture.md` | ภาพรวมสถาปัตยกรรม, การไหลของข้อมูล, ทางเลือกเทคโนโลยี |
| `02-data-model.md` | ตารางทั้งหมด + ความสัมพันธ์ + เหตุผลการออกแบบ |
| `03-permissions.md` | matrix สิทธิ์เต็ม, ขอบเขตข้อมูล, RLS |
| `04-modules.md` | สเปกราย module ทั้ง 10 + state machine |
| `05-offline-sync.md` | offline-first, conflict, การกันบิลซ้ำ |
| `06-hardware.md` | เครื่องพิมพ์, ลิ้นชัก, จอลูกค้า, บาร์โค้ด, แท็บเล็ต |
| `07-etax-invoice.md` | ใบกำกับภาษีไทย, e-Tax Invoice, ใบลดหนี้ |
| `08-api-reference.md` | RPC, REST, realtime, การ import สินค้า |
| `09-ui-ux.md` | design system, layout, คีย์ลัด, 3 ภาษา, โหมดสี |
| `10-deployment.md` | deploy, ฮาร์ดแวร์ที่ควรซื้อ, ต้นทุน, backup |
| `11-audit-log.md` | action ที่บันทึก, การสืบสวน, retention |
| `12-roadmap.md` | ลำดับการทำจริง, สิ่งที่ยังไม่ทำ, ประมาณการ |
| `reference/legacy-data-columns.md` | map 57 คอลัมน์จากไฟล์เดิม → ตารางใหม่ |
