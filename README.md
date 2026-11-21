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

## Secure checkout / real-user rollout (22 Nov 2026)

The application and migration `0039_secure_checkout.sql` must be released together. This change has **not** applied any migration to a hosted database. Back up the selected UAT database, confirm its environment, and stop old POS clients before applying the migration; old public sale/stock/refund mutation RPCs are intentionally no longer accepted. Existing migration 0033 requires `ALTER TYPE employee_role ADD VALUE IF NOT EXISTS 'owner'` to have been committed separately first, as documented in that migration.

Live checkout now requires an authenticated One Login session linked to an active employee, branch scope, a synced open shift, server-approved prices, and a central inventory reservation. Cash is disabled. A reservation is persisted before collecting money and lasts 15 minutes; an open payment screen renews it every three minutes. Each manually confirmed payment is saved to the central hold before it is added to the bill. Holds with recorded payments continue to block inventory after expiry until reviewed, and cannot be released as unpaid. Do not collect again after a timeout: use **POS → ตรวจรายการรับชำระ** (`/pos/recovery`) to inspect the original operation. A recorded POS order does not establish bank settlement.

PromptPay QR requires a verified branch record in `pos_payment_accounts` (payee name and registered mobile number). No example recipient is used. QR and EDC remain **manual confirmations with a required reference**, not automatic bank notifications or refunds. Configure real payee details only after company verification. Browser-generated amount-specific QR is not a bank-issued, single-use payment session.

### Features deliberately held back in live mode

- Direct void/refund cannot pretend that bank money was returned or immediately restock goods. Those actions require a separately verified central refund workflow; existing demo flows remain available in explicit demo mode.
- Points, coupons, gifts, stored value, price overrides, and delayed delivery are not accepted by secure checkout until their validation/approval and inventory effects are included in the same central transaction. An arbitrary approver ID from the browser is not authorization.
- Transfers and manual goods receipt cannot change only local stock in live mode while the OneWarehouse inbound-document and movement-write APIs remain unavailable. The branch must receive against the warehouse's original shipment; branch-to-branch transfers must publish ordered, idempotent events back. No unknown API contract has been invented.
- Count/adjustment approvals now use the central ledger and reject changed stock or active checkouts. Serialized quantity adjustments require serial reconciliation rather than inventing SN records.
- Warehouse mapping is still a deployment prerequisite. A branch-scoped account cannot read an unmapped warehouse. The integration console distinguishes failed/not-yet-checked lookups from actual missing products and never substitutes a failed stock read with zero.
- Live held bills are drafts; they do **not** reserve central inventory until checkout. Central snapshots are refreshed after successful sync and periodically; unsent local movements prevent stock overwrite. The recent-order snapshot is bounded to 200 orders, not a complete reporting archive.

### Verification

From the repository root:

```bash
npm --prefix web run test:real-users
npm --prefix web run test:sale-validation
npm --prefix web run test:checkout-db
npm --prefix web run test:schema
npm --prefix web run typecheck -- --incremental false
NEXT_BUILD_DIR=.next-check npm --prefix web run build
```

PostgreSQL tests run with PGlite in memory, never UAT. They exercise all migrations using minimal Supabase auth/storage shims and the documented owner-role prerequisite, plus the actual legacy order writer through the secure wrapper. Focused tests cover repeat commits, reservations, forged quotes, cash rejection, insufficient inventory, permission revocation, and count rollback. These tests do not replace a two-device pilot or tests against the bank/OneWarehouse services.

Before enabling a pilot, verify user suspension during an open session, two cashiers competing for the last unit/SN, network interruption after a payment, expired reservations with an unknown payment outcome, cancellation/commit races, and safe recovery of unsent jobs. Anonymous legacy catalog/customer read endpoints and the wider historical RLS policy set require a separate access audit before public exposure. No bank, JST, or OneWarehouse production write has been executed by these tests.

## Paginated OneWarehouse catalog import

Open **Admin → นำเข้าแคตตาล็อก** (`/admin/catalog-sync`). Apply migration `0040_catalog_sync.sql` after 0039 to the confirmed UAT database before enabling this screen. No hosted database has been migrated by the test commands.

1. Select an optional warehouse for stock observations and create a sync run. With branch-management permission, explicitly map that warehouse to a POS branch.
2. Choose **ทำต่อจนพร้อมตรวจนำเข้า**. The browser advances durable server-side chunks: `/v1/products?limit=200&cursor=…`, then exact `?q=<sku>`, optional per-warehouse stock and bundle BOM. A chunk processes one SKU to stay within request timeouts and limit upstream concurrency. Close/pause the page and resume the stored run later; this is not a headless background worker.
3. Review existing/new/conflicting matches. SKU, barcode, prior mapping, SN policy, and bundle-policy conflicts prevent automatic import. Pages show 100 rows; selection/import is limited to 50 rows per transaction request.
4. Confirm import. Existing product IDs, local display names, images, cost and explicit SN settings are preserved. New barcodes are added without deleting existing ones. Updating an existing sale price requires opting in in the confirmation dialog; `null` never clears a price, while an explicit zero remains zero and is flagged. Each successful import records actor and before/after product snapshots.
5. New products remain inactive. Imported does not mean sellable: review price, cost, brand/category, SN classification, warehouse mapping, stock receipt and bundle setup. A stock observation is not a goods receipt; catalog sync never changes stock quantities, sales or transfer history.
6. Review run-wide counters and per-item errors. Retry only failed/missing/unavailable items. Systemic auth/rate-limit/upstream outages pause the run with its checkpoint intact. Repeated page/import requests are guarded by run versions, cursor-loop checks, SKU locks and stored import receipts.

`/v1/products` without `q` must return `{items,has_more,next_cursor}`; exact lookup still returns an array. List-mode null prices and `is_combined` are unknown, not zero/false. There is no assumed delta/deletion feed: run a new full sync to refresh, and never deactivate products merely because a run did not enumerate them. If an upstream cursor expires, keep the old run for review and start a new run.

`ONEWAREHOUSE_ENV` is `uat` by default (`production` must be explicit). `ONEWAREHOUSE_SOURCE_ID` defaults to `onewarehouse`; keep it stable when only the gateway domain changes. Source/environment, warehouse and checkpoints are stored per run. Import actions require an active employee with company-wide `admin.product_manage` and `report.cost`; mapping additionally requires `admin.branch_manage`. Source credentials remain server-only.

After import, the authorized, paginated POS catalog endpoint refreshes the device cache; other open POS devices check periodically (catalog refresh is throttled to five minutes). Updates merge by the same product IDs and do not delete absent products or rewrite historical orders. Explicit demo mode shows clearly marked, read-only example rows; it never imports them.

Run `npm --prefix web run test:catalog` for decoder/access tests and the PostgreSQL lifecycle tests. `npm --prefix web run test:readiness` includes the catalog tests with prior checkout regressions.
