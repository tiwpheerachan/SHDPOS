# 02 — Data Model

ไฟล์จริง: `supabase/migrations/0001_core.sql` … `0005_governance.sql`

## แผนผังความสัมพันธ์ (ย่อ)

```
brands ──< branches ──< terminals
   │          │  └──< employee_branches >── employees ──< employee_brands
   │          │                                │
   │          ├──< stock_levels >── products ──┤
   │          ├──< stock_movements            │
   │          ├──< shifts ──< shift_members >─┘
   │          │      └──< cash_movements
   │          ├──< orders ──< order_items ──< order_item_serials >── serials
   │          │      │           └── salesperson_id → employees
   │          │      ├──< order_payments
   │          │      ├──< returns ──< return_items
   │          │      └──< tax_documents
   │          ├──< quotations ──< quotation_items
   │          ├──< transfers ──< transfer_items / transfer_serials / transfer_events
   │          ├──< stock_counts ──< stock_count_items
   │          ├──< approvals
   │          ├──< notifications
   │          └──< audit_logs
   └──< products ──< product_barcodes / product_prices / product_bundle_items
customers ──< orders
```

## ตารางหลักและเหตุผลการออกแบบ

### branches — 29 สาขาจริง

| ฟิลด์สำคัญ | ทำไมต้องมี |
|---|---|
| `erp_store_code` | ชื่อร้านในระบบเดิม เช่น `[Brand Shop] 70mai - Ramindra` ใช้ map ข้อมูลย้อนหลัง |
| `branch_type` | แยก brand_shop / shop_in_shop / **vending** / popup / warehouse — ข้อมูลจริงมีตู้ Anker 2 ตู้ |
| `tax_branch_no` | รหัสสาขาบนใบกำกับภาษี (กรมสรรพากรบังคับ) |

หนึ่งสาขาขายได้หลายแบรนด์ผ่าน `branch_brands` (เช่น Anker shop ขาย Soundcore ด้วย)

### employees — 293 คนในข้อมูลจริง

- `nickname` = ชื่อที่ใช้ในรายงานยอดขายเดิม (`nattasak`, `พัชรา`, `ดา`, `queenkanok`)
  ข้อมูลเก่ามีทั้งภาษาไทย อังกฤษ และตัวพิมพ์ต่างกัน → ต้องมี field นี้แยกจากชื่อจริง
- `role` (6 ระดับ) + `data_scope` (own / branch / brand / company) แยกกันโดยตั้งใจ:
  ผู้จัดการสาขาหนึ่งอาจดูแล 2 สาขา = role `manager`, scope `branch`, มี 2 แถวใน `employee_branches`
- `max_discount_percent` override เพดานของ role ได้รายคน
- `pin_hash` เก็บ hash ไม่ใช่ PIN (ดู `08-api-reference.md` เรื่อง Edge Function)

### products

| ฟิลด์ | หมายเหตุ |
|---|---|
| `kind` | `goods` / `service` / `bundle` / `fee` — ข้อมูลจริงมี "บริการติดตั้ง" 21,068 บรรทัด และ "ค่าเดินทาง" 161 บรรทัด ซึ่ง **ไม่ตัดสต๊อก** |
| `track_serial` / `track_imei` | สินค้า electronics ต้องผูก SN (ข้อมูลเดิมมีคอลัมน์ `SN NO.`) |
| `vat_mode` | ค่าเริ่มต้น `inclusive` — ราคาป้ายรวม VAT แล้วตามค้าปลีกไทย |
| `cost` | ต้นทุนมาตรฐาน (ข้อมูลเดิม: `ค่าใช้จ่าย成本单价`) |

`product_prices` รองรับราคาเฉพาะสาขา/ช่วงโปรโมชัน โดยมี `priority` ตัดสินเมื่อทับซ้อน

### stock_levels + stock_movements — สองชั้นโดยตั้งใจ

- `stock_movements` = **source of truth** (append-only ledger) — ตอบได้ว่าของหายไปไหน ใครทำ เมื่อไร
- `stock_levels` = snapshot ที่อ่านเร็วสำหรับหน้าขาย

ทั้งสองอัปเดตในทรานแซกชันเดียวผ่าน `apply_stock_movement()` ไม่มีทางหลุดจากกัน

`movement_type` ครอบคลุม: sale, return, exchange_in/out, receive, transfer_in/out,
count_adjust, damage, claim_in/out, manual_adjust, opening

### orders — หัวใจ

| ฟิลด์ | ทำไม |
|---|---|
| `client_uuid` (unique) | กันบิลซ้ำตอน sync ออฟไลน์ |
| `cashier_id` vs `salesperson_id` | คนกดเครื่องกับคนได้ยอดคนละคนได้ — จำเป็นเมื่อ 2 คนเข้ากะพร้อมกัน |
| `order_items.salesperson_id` | แบ่งยอดได้ถึงระดับ**บรรทัด** (ลูกค้าคนเดียว พนักงานสองคนช่วยขาย) |
| `cost_total`, `gross_profit` | snapshot ต้นทุน ณ เวลาขาย |
| `channel` | offline / shopee / lazada / tiktok / website / event / b2b — ตรงกับ `ช่องทาง订单来源` เดิม |
| `is_offline_origin`, `synced_at` | สืบย้อนได้ว่าบิลไหนออกตอนเน็ตหลุด |
| `reference_no` | เลขออเดอร์จากมาร์เก็ตเพลสเวลาลูกค้ามารับของหน้าร้าน (`รับสินค้าหน้าร้าน自提` 2,292 บรรทัด) |

### order_payments — mixed payment

หนึ่งบิลมีได้หลายแถว เช่น เงินสด ฿5,000 + บัตรเครดิต ฿10,000
เก็บ `acquirer_bank`, `card_last4`, `approval_code`, `mid`, `installment_months`, `fee_amount`
(ตรงกับคอลัมน์เดิม: `POSธนาคาร刷卡机银行`, `หมายเลขวีซ่าMID详细`, `รายการผ่อน`, `ค่าธรรมเนียมธนาคาร`)

### serials

```
serial_no / imei / mac_address
  → product_id → branch_id → status
  → sold_order_id → customer_id
  → warranty_start / warranty_end
```

`status`: in_stock → reserved → sold → returned / transferred / defective / scrapped
ทำให้ตอบได้ทันทีว่า "เครื่องนี้ซื้อจากสาขาไหน ใครขาย ประกันถึงเมื่อไร"

### shifts + shift_members

`shift_members` เป็น many-to-many เพราะบางสาขามีพนักงาน 2 คนเข้ากะพร้อมกัน
ยอดของแต่ละคนมาจาก `order_items.salesperson_id` ไม่ใช่จาก "ใครเปิดกะ"

### transfers — 10 สถานะ

```
draft → pending_approval → approved → picking → packed → shipped
      → in_transit → received ─┬→ completed
                               └→ partial_received → (discrepancy workflow) → completed
      ↘ cancelled / rejected
```

`transfer_serials` ให้ปลายทางสแกนรับทีละชิ้น — `qty_requested` vs `qty_received` เห็นส่วนต่างทันที

### audit_logs — append-only จริง

```sql
create trigger trg_audit_immutable before update or delete on audit_logs
for each row execute function audit_immutable();   -- raise exception เสมอ
```

แม้แอดมินก็ลบไม่ได้ ต้องไปทำที่ระดับ database owner เท่านั้น

### tax_documents

แยกจาก `orders` เพราะหนึ่งบิลอาจออกเอกสารหลายใบ
(ใบกำกับอย่างย่อตอนขาย → ลูกค้ากลับมาขอใบเต็มรูปทีหลัง → ต่อมาคืนของออกใบลดหนี้)
`etax_status` รองรับ flow ของ e-Tax Invoice by Email (ดู `07-etax-invoice.md`)

## เลขที่เอกสาร

| เอกสาร | รูปแบบ | ตัวอย่าง |
|---|---|---|
| บิลขาย | `{prefix เครื่อง}-{YYMMDD}-{running 4 หลัก}` | `70M1-260916-0042` |
| ใบคืน | `RT-{YYMMDD}-{running}` | `RT-260916-0007` |
| ใบเสนอราคา | `QT-{YYMMDD}-{running}` | `QT-260916-0003` |
| ใบโอน | `TF-{YYMMDD}-{running}` | `TF-260916-0011` |
| นับสต๊อก | `SC-{YYMMDD}-{running}` | `SC-260916-0002` |
| ใบกำกับภาษี | `IV{YYMMDD}{running}` | `IV6909160042` |

prefix รายเครื่อง (`terminals.receipt_prefix`) ทำให้บิลที่ออกตอนออฟไลน์จากหลายเครื่องไม่ชนกัน

## ดัชนีที่สำคัญต่อประสิทธิภาพ

```sql
idx_orders_branch_date       (branch_id, created_at desc)   -- หน้ารายการบิล
idx_orders_salesperson       (salesperson_id, created_at)   -- performance รายคน
idx_moves_branch_product     (branch_id, product_id, occurred_at desc)
idx_stock_low                partial index where qty_on_hand <= reorder_point
idx_audit_branch_time        (branch_id, occurred_at desc)
idx_serials_serial / _imei                                  -- ค้นหาเวลาเคลม
```
