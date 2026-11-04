# 11 — Audit Log

## หลักการ

ทุก action ที่กระทบ **เงิน · สต๊อก · สิทธิ์** ต้องถูกบันทึก และบันทึกนั้น **แก้ไขหรือลบไม่ได้**

```sql
create trigger trg_audit_immutable before update or delete on audit_logs
for each row execute function audit_immutable();   -- raise exception เสมอ
```

แม้ผู้ใช้ระดับ HQ ก็แก้ไม่ได้ — ต้องใช้สิทธิ์ database owner เท่านั้น
(นี่คือจุดที่ทำให้ audit log มีค่าในการสืบสวนจริง)

## 17 action ที่บันทึก

| action | เกิดเมื่อไร | ข้อมูลที่เก็บเพิ่ม |
|---|---|---|
| `login` | เข้าสู่ระบบ POS | terminal, is_offline |
| `logout` | ออกจากระบบ | — |
| `sale` | ขายสำเร็จ | จำนวนรายการ, ช่องทาง, ส่วนลด, ยอด |
| `void` | ยกเลิกบิล | เหตุผล, ยอดที่ยกเลิก |
| `refund` | คืนเงิน | ประเภท, จำนวนรายการ, เหตุผล, ยอดคืน |
| `exchange` | เปลี่ยนสินค้า | รายการเก่า/ใหม่ |
| `discount` | ให้ส่วนลดเกินสิทธิ์ | %, ผู้ขอ, ผู้อนุมัติ |
| `price_override` | แก้ราคาขาย | ราคาเดิม → ราคาใหม่ |
| `cash_drawer` | เปิดลิ้นชักโดยไม่ขาย | — |
| `cash_adjust` | ปรับยอดเงินสด | ประเภท, จำนวน, เหตุผล |
| `stock_adjust` | ปรับสต๊อก | สินค้า, ส่วนต่าง, เหตุผล |
| `transfer` | สร้าง/เดินสถานะใบโอน | สถานะใหม่, ปลายทาง |
| `user_permission` | เปลี่ยนสิทธิ์/เพิ่มพนักงาน | role, scope, สาขา, แบรนด์ (before/after) |
| `reprint` | พิมพ์สลิปซ้ำ | เลขที่บิล |
| `shift_open` | เปิดกะ | เงินตั้งต้น, จำนวนคนในกะ |
| `shift_close` | ปิดกะ | ควรมี / นับได้ / ส่วนต่าง |
| `stock_count` | ส่งผลการนับสต๊อก | โซน, จำนวนรายการที่ปรับ |

## โครงสร้างแถว

```
id            bigserial
action        text
actor_id      → employees          ใครทำ
actor_code    text                 snapshot รหัสพนักงาน (เผื่อพนักงานถูกลบภายหลัง)
actor_name    text                 snapshot ชื่อ
branch_id     → branches
terminal_id   → terminals          เครื่องไหน
ref_table     text                 'orders' / 'transfers' / …
ref_id        uuid
ref_no        text                 เลขที่เอกสารแบบอ่านได้
amount        numeric
before_data   jsonb                ค่าก่อนแก้ (เฉพาะ action ที่แก้ของเดิม)
after_data    jsonb                ค่าหลังแก้ / รายละเอียดเพิ่ม
ip_address    inet
user_agent    text
app_version   text
is_offline    boolean              ทำตอนออฟไลน์หรือไม่
occurred_at   timestamptz          เวลาที่เกิดจริง (จากเครื่อง)
created_at    timestamptz          เวลาที่ถึง server
```

`occurred_at` แยกจาก `created_at` โดยตั้งใจ — บิลที่ออกตอนออฟไลน์เมื่อวาน
อาจถึง server วันนี้ ทั้งสองเวลาต้องเก็บไว้ทั้งคู่

## คำถามที่ audit log ต้องตอบได้

| คำถาม | วิธีหา |
|---|---|
| เงินในลิ้นชักหายไป 500 บาทเมื่อวาน ใครเปิดลิ้นชักบ้าง | filter `cash_drawer` + `cash_adjust` ช่วงเวลานั้น |
| ทำไมสต๊อกสินค้านี้ไม่ตรง | `stock_movements` where product + branch เรียงตามเวลา แล้วโยงไป audit ผ่าน `ref_id` |
| ใครให้ส่วนลด 25% บิลนี้ | filter `discount` → ดู `after_data.requested_by` และ `actor_id` (ผู้อนุมัติ) |
| บิลนี้ถูกยกเลิกเพราะอะไร | filter `void` where `ref_no` = เลขบิล |
| พนักงานคนนี้เคยพิมพ์สลิปซ้ำกี่ครั้ง | filter `reprint` + `actor_id` (ซ้ำบ่อยผิดปกติ = สัญญาณต้องตรวจ) |
| ใครเปลี่ยนสิทธิ์ให้คนนี้ | filter `user_permission` + `ref_no` = รหัสพนักงาน |

## สิ่งที่ควรตั้งเป็นการแจ้งเตือนอัตโนมัติ

| สัญญาณ | เกณฑ์ที่แนะนำ |
|---|---|
| ส่วนต่างเงินสดตอนปิดกะ | เกิน ±100 ฿ |
| ยกเลิกบิลบ่อย | > 3 บิล/กะ ของพนักงานคนเดียว |
| พิมพ์สลิปซ้ำบ่อย | > 5 ครั้ง/วัน ของพนักงานคนเดียว |
| เปิดลิ้นชักโดยไม่ขาย | > 5 ครั้ง/กะ |
| ส่วนลดสูงสุดกระจุกที่คนเดียว | > 30% ของบิลที่มีส่วนลดในสาขา |
| ปรับสต๊อกลบ | ยอดรวมเกิน 5,000 ฿/เดือน/สาขา |

(ยังไม่ได้ทำใน v1 — อยู่ใน roadmap ข้อ "Alert rules")

## การเก็บและการดู

- เก็บ **อย่างน้อย 2 ปี** (แนะนำ 5 ปีให้ตรงกับเอกสารภาษี)
- หน้า `/admin/audit` กรองตาม action / สาขา / พนักงาน / เลขที่เอกสาร + export CSV
- สิทธิ์ดู: manager (เฉพาะสาขาตัวเอง) · brand_admin (แบรนด์ตัวเอง) · hq · auditor
- เมื่อข้อมูลโตมาก ให้ partition ตามปี:

```sql
create table audit_logs_2026 partition of audit_logs
  for values from ('2026-01-01') to ('2027-01-01');
```
