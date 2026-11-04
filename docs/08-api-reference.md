# 08 — API Reference

## RPC (Postgres functions ผ่าน Supabase)

### `create_order(p_payload jsonb) → jsonb`
บันทึกบิลแบบ atomic + **idempotent** ใช้ได้ทั้งขายสดและ sync บิลออฟไลน์

```ts
const { data, error } = await supabase.rpc("create_order", {
  p_payload: {
    client_uuid: "3f2b...",          // บังคับ — กุญแจกันบิลซ้ำ
    branch_id: "uuid", terminal_id: "uuid", shift_id: "uuid",
    cashier_id: "uuid", salesperson_id: "uuid",
    customer_id: null, customer_name: "คุณภาคิน", customer_phone: "085-555-4649",
    channel: "offline",
    subtotal: 5589, discount_total: 0, discount_percent: 0,
    vat_amount: 365.55, grand_total: 5589,
    paid_total: 6000, change_amount: 411,
    is_offline_origin: false, device_created_at: "2026-09-16T14:22:10+07:00",
    discount_approved_by: null,
    items: [{
      product_id: "uuid", sku: "70M-A510-1", name: "70mai Dash Cam A510",
      kind: "goods", qty: 1, unit_price: 4990,
      discount_amount: 0, discount_percent: 0, line_total: 4990,
      unit_cost: 2890, cost_total: 2890, gross_profit: 1773.55,
      salesperson_id: "uuid", serials: ["2810B02YL3CP4602PTDS"]
    }],
    payments: [
      { method: "cash", amount: 2000 },
      { method: "credit_card", amount: 3589, acquirer_bank: "กสิกรไทย",
        card_brand: "VISA", card_last4: "4728", approval_code: "658047" }
    ]
  }
});
// → { order_id, order_no: "70M1-260916-0042", duplicate: false }
```

ทำอะไรให้บ้างในทรานแซกชันเดียว:
1. เช็ค `client_uuid` — ถ้ามีแล้วคืนบิลเดิม `duplicate: true`
2. ออกเลขที่บิลจาก `next_document_no()`
3. เขียน `orders` + `order_items` + `order_payments`
4. ตัดสต๊อกผ่าน `apply_stock_movement()` (ข้ามสินค้าที่ `is_stocked = false`)
5. ผูก serial → `serials` (สร้างใหม่ถ้ายังไม่มี) + `order_item_serials` + คำนวณวันหมดประกัน
6. อัปเดตยอดกะ
7. เขียน `audit_logs` action `sale`

### `void_order(p_order_id uuid, p_employee_id uuid, p_reason text)`
คืนสต๊อก, คืน serial เป็น `in_stock`, หักยอดกะ, เขียน audit `void`

### `close_shift(p_shift_id uuid, p_counted_cash numeric, p_employee_id uuid, p_note text) → jsonb`
```json
{ "expected_cash": 10450, "counted_cash": 10430, "variance": -20, "cash_sales": 8450 }
```

### `apply_stock_movement(...) → uuid`
เขียน ledger + อัปเดต snapshot + เรียก `check_low_stock()` ในทรานแซกชันเดียว

```sql
select apply_stock_movement(
  p_branch_id  => 'uuid',
  p_product_id => 'uuid',
  p_type       => 'manual_adjust',
  p_qty_delta  => -2,
  p_ref_table  => 'stock_counts',
  p_ref_id     => 'uuid',
  p_employee_id=> 'uuid',
  p_note       => 'ของแตกระหว่างจัดโชว์'
);
```

### `next_document_no(p_prefix text, p_scope text) → text`
ออกเลขรันนิ่งแบบ atomic ผ่าน `document_sequences` (upsert + returning)

---

## Views สำหรับรายงาน

| View | ใช้ทำอะไร |
|---|---|
| `v_daily_sales` | ยอดขาย/ต้นทุน/กำไร/บิล รายวัน × สาขา × แบรนด์ |
| `v_employee_performance` | ยอดขาย/ชิ้น/กำไร/ยอดเฉลี่ย รายวัน × สาขา × พนักงาน |
| `v_low_stock` | สินค้าที่ ≤ จุดสั่งซื้อ พร้อมระดับ `low` / `out_of_stock` |
| `v_payment_mix` | สัดส่วนช่องทางชำระ + ค่าธรรมเนียม รายวัน × สาขา |
| `v_orders_staff` | บิลแบบไม่มีคอลัมน์ต้นทุน/กำไร (ให้ role ที่ไม่มีสิทธิ์) |

```ts
const { data } = await supabase
  .from("v_employee_performance")
  .select("*")
  .gte("sale_date", "2026-09-01")
  .eq("branch_id", branchId)
  .order("sales_amount", { ascending: false });
```

---

## Realtime

```ts
supabase
  .channel("pos-live")
  .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "orders", filter: `branch_id=eq.${branchId}` },
      (payload) => addToLiveFeed(payload.new))
  .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications" },
      (payload) => showAlert(payload.new))
  .subscribe();
```

ใช้กับ: live feed บน dashboard, แจ้งเตือนสต๊อกใกล้หมด, คำขออนุมัติที่เข้ามาใหม่

---

## การยืนยันตัวตน

| ผู้ใช้ | วิธี |
|---|---|
| หลังบ้าน (ผู้จัดการ, HQ) | Supabase Auth ด้วยอีเมล + รหัสผ่าน → `employees.auth_user_id` |
| หน้าร้าน (พนักงานขาย) | **PIN + device token** ไม่ใช่ Supabase Auth |

### ทำไม POS ไม่ใช้ email login
พนักงานสลับกันใช้เครื่องเดียวทั้งวัน การพิมพ์อีเมล/รหัสผ่านทุกครั้งช้าเกินไป

### รูปแบบที่แนะนำ
1. ผู้จัดการลงทะเบียนเครื่อง POS ครั้งเดียว → ได้ **device token** อายุยาว เก็บใน IndexedDB
2. พนักงานกด PIN 4–6 หลัก → เรียก Edge Function `pos-login`
3. Edge Function ตรวจ PIN กับ `employees.pin_hash` (bcrypt/argon2) แล้วออก JWT อายุสั้น
   ที่มี claim `employee_id`, `branch_id`, `role`, `scope`
4. RLS อ่าน claim จาก JWT → บังคับขอบเขตข้อมูล

```ts
// supabase/functions/pos-login/index.ts (ต้องเขียนเพิ่มตอนขึ้น production)
const ok = await bcrypt.compare(pin, employee.pin_hash);
if (!ok) return json(401, { error: "invalid pin" });
const jwt = await signJwt({ employee_id, branch_id, role, scope }, { expiresIn: "12h" });
```

> ในแพ็กนี้โหมดสาธิตเทียบ PIN ในเครื่อง (`1234`) — **ห้ามใช้แบบนี้ใน production**

---

## การนำเข้าข้อมูลสินค้าจริง

สินค้าจริง 1,250 SKU ให้ import ผ่านสคริปต์ฝั่ง server ด้วย service role key

```ts
// scripts/import-products.ts
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const rows = parseCsv("products.csv").map((r) => ({
  sku: r.sku,
  brand_id: brandMap[r.brand],
  kind: r.type === "บริการติดตั้ง" ? "service" : "goods",
  name_th: r.name_th,
  name_en: r.name_en,
  price: Number(r.price),
  cost: Number(r.cost),
  track_serial: r.has_serial === "1",
  is_stocked: r.type !== "บริการติดตั้ง",
  reorder_point: Number(r.reorder ?? 0),
}));

await sb.from("products").upsert(rows, { onConflict: "sku" });
```

**ลำดับที่ต้อง import**: brands → categories → branches → employees → products →
product_barcodes → stock_levels (ยอดตั้งต้นเป็น movement type `opening`)

### ถ้าจะ sync กับ JST (ERP) ภายหลัง
ออกแบบไว้เป็น adapter แยก ไม่ผูกกับ POS:
- ขาเข้า: product master + ราคา + สต๊อกตั้งต้น → `products`, `stock_levels`
- ขาออก: บิลขายรายวัน → JST (ผ่าน `v_daily_sales` หรือ webhook หลัง `create_order`)
- คีย์ที่ใช้เชื่อม: `products.sku` (เหมือน ecom-data-platform ที่ join ด้วย SKU อยู่แล้ว)

---

## ขนาดข้อมูลที่ควรเผื่อ

จากข้อมูลจริงปี 2024: 98,445 บรรทัด/ปี ≈ **270 บรรทัด/วัน** จาก 29 สาขา

| ตาราง | แถว/ปี (ประมาณ) |
|---|---|
| `orders` | ~45,000 |
| `order_items` | ~100,000 |
| `order_payments` | ~50,000 |
| `stock_movements` | ~150,000 |
| `audit_logs` | ~400,000 |

ปริมาณนี้ Postgres รับได้สบายหลายปี — เริ่มพิจารณา partition `audit_logs` และ
`stock_movements` แบบรายปีเมื่อเกิน ~5 ล้านแถว
