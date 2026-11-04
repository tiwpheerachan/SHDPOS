# 03 — สิทธิ์และขอบเขตข้อมูล

## สองมิติที่แยกกัน

| มิติ | ตอบคำถาม | ค่า |
|---|---|---|
| **Role** | ทำอะไรได้บ้าง | staff / supervisor / manager / brand_admin / hq / auditor |
| **Data scope** | เห็นข้อมูลของใคร | own / branch / brand / company |

แยกกันเพราะของจริงมีกรณีแบบ "หัวหน้ากะที่ดูแล 2 สาขา" (role=supervisor, scope=branch, 2 แถวใน `employee_branches`)
หรือ "auditor ที่เห็นทั้งบริษัทแต่แก้อะไรไม่ได้" (role=auditor, scope=company)

## Matrix หลัก

| ฟังก์ชัน | Staff | Supervisor | Manager | Brand Admin | HQ | Auditor |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| ขายสินค้า | ✓ | ✓ | ✓ | — | ✓ | — |
| ให้ส่วนลด | ≤5% | ≤10% | ≤20% | — | ✓ | — |
| แก้ราคาขาย | — | A | ✓ | — | ✓ | — |
| ยกเลิกบิล | A | ✓ | ✓ | — | ✓ | — |
| พิมพ์สลิปซ้ำ | A | ✓ | ✓ | — | ✓ | — |
| เปิดลิ้นชัก | — | ✓ | ✓ | — | ✓ | — |
| ใบเสนอราคา | ✓ | ✓ | ✓ | — | ✓ | — |
| รับคืนสินค้า | A | ✓ | ✓ | — | ✓ | — |
| อนุมัติการคืน | — | ✓ | ✓ | ✓ | ✓ | — |
| ดูสต๊อก | สาขา | สาขา | สาขา | แบรนด์ | ทั้งหมด | ทั้งหมด |
| ปรับสต๊อก | — | — | ✓ | ✓ | ✓ | — |
| นับสต๊อก | ✓ | ✓ | ✓ | — | ✓ | — |
| ขอโอนย้าย | — | ✓ | ✓ | ✓ | ✓ | — |
| อนุมัติโอนย้าย | — | — | ✓ | ✓ | ✓ | — |
| รับของโอน | — | ✓ | ✓ | — | ✓ | — |
| เปิด/ปิดกะ | ✓ | ✓ | ✓ | — | ✓ | — |
| ปิดกะแทนคนอื่น | — | — | ✓ | — | ✓ | — |
| ปรับยอดเงินสด | — | A | ✓ | — | ✓ | — |
| performance พนักงาน | ตัวเอง | สาขา | สาขา | แบรนด์ | ทั้งหมด | ทั้งหมด |
| ดูต้นทุน | — | — | ✓ (สาขา) | ✓ | ✓ | ✓ |
| ดูกำไรขั้นต้น | — | ✓ (สาขา) | ✓ | ✓ | ✓ | ✓ |
| จัดการพนักงาน | — | — | ✓ | ✓ | ✓ | — |
| กำหนดสิทธิ์ | — | — | — | ✓ | ✓ | — |
| จัดการสินค้า/ราคา | — | — | — | ✓ | ✓ | — |
| ตั้งค่าระบบ | — | — | — | — | ✓ | — |
| ดู audit log | — | — | ✓ | ✓ | ✓ | ✓ |

`✓` = ทำได้เอง · `A` = ทำได้แต่ต้องมี PIN ของระดับสูงกว่า · `—` = ไม่มีสิทธิ์

## เพดานส่วนลด

```
Sales Staff      ≤  5%
Supervisor       ≤ 10%
Store Manager    ≤ 20%
มากกว่า 20%       →  HQ approval
```

พอเกินเพดาน หน้าจอจะขึ้น:

```
ส่วนลด 15%
เกินสิทธิ์ของคุณ (5%) — ต้องให้หัวหน้าอนุมัติ
[ใส่ PIN หัวหน้า]
```

ระบบเลือกระดับผู้อนุมัติอัตโนมัติจาก `discountApprovalLevel(percent)` แล้วแสดงเฉพาะคนที่มีสิทธิ์
ในสาขานั้นให้เลือก การอนุมัติทุกครั้งเขียนลง `approvals` + `audit_logs` พร้อมชื่อผู้อนุมัติ

`employees.max_discount_percent` override รายคนได้ (เช่น พนักงานอาวุโสให้ 8%)

## ตัวอย่างการตั้งค่าใน UI

```
พนักงาน: กล้วย (EMP-0207)
ตำแหน่ง: พนักงานขาย
ขอบเขตข้อมูล: ○ ตัวเอง  ● สาขา  ○ แบรนด์  ○ ทั้งบริษัท

แบรนด์ที่เห็น
[✓] Anker   [✓] Soundcore   [ ] Dreame   [ ] 70mai

สาขาที่เข้าได้
[✓] Anker Central Rama 9
[ ] Anker Central World
[ ] Anker Mega Bangna

ส่วนลดสูงสุด: 5%
[ ] เปิดลิ้นชักเงินสดได้
```

## การบังคับจริง — 3 ชั้น

### ชั้นที่ 1: UI (`web/src/lib/permissions.ts`)
ซ่อน/ปิดปุ่ม — เพื่อ UX เท่านั้น **ไม่ใช่ security**

### ชั้นที่ 2: Row Level Security (`supabase/migrations/0007_rls.sql`)
ตัวจริง — พนักงานสาขา A ต่อให้ยิง REST API เองก็อ่านบิลสาขา B ไม่ได้

```sql
create or replace function visible_branch_ids() returns setof uuid ...
-- company → ทุกสาขา
-- brand   → สาขาที่อยู่ในแบรนด์ที่ถูก assign
-- own/branch → สาขาที่อยู่ใน employee_branches

create policy orders_read on orders for select to authenticated
  using (
    can_see_branch(branch_id)
    and (current_scope() <> 'own'
         or salesperson_id = current_employee_id()
         or cashier_id = current_employee_id())
  );
```

### ชั้นที่ 3: คอลัมน์อ่อนไหว
RLS คุมได้แค่ระดับแถว ต้นทุน/กำไรจึงคุมด้วย view แยก:

```sql
create view v_orders_staff as
select id, order_no, ..., grand_total, created_at   -- ไม่มี cost_total / gross_profit
from orders;
```
ให้ role ที่ไม่มี `report.cost` query จาก view นี้แทน

## Permission key ทั้งหมด (30 รายการ)

```
pos.sell              pos.discount          pos.price_override    pos.void
pos.reprint           pos.open_drawer       pos.quotation
return.create         return.approve
inventory.view        inventory.adjust      inventory.count
transfer.request      transfer.approve      transfer.receive
shift.open            shift.close           shift.force_close     cash.adjust
report.employee_perf  report.cost           report.gross_profit
admin.employee_manage admin.permission_manage admin.product_manage
admin.branch_manage   admin.settings        audit.view
customer.manage       tax.issue_full
```

เพิ่ม permission ใหม่ = เพิ่มใน `permissions` (seed) + `ROLE_MATRIX` (client) + policy ที่เกี่ยวข้อง

## สิ่งที่ต้องบันทึกเสมอเมื่อสิทธิ์ถูกใช้แบบพิเศษ

| เหตุการณ์ | ตาราง |
|---|---|
| อนุมัติส่วนลด/ยกเลิก/คืน/ปรับสต๊อก | `approvals` + `audit_logs` |
| เปลี่ยนสิทธิ์พนักงาน | `audit_logs` (action = `user_permission`) พร้อม before/after |
| เปิดลิ้นชักโดยไม่มีการขาย | `cash_movements` (type = `open_no_sale`) + `audit_logs` |
