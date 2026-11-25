// ทดสอบการสร้างบิลส่ง OneWarehouse /v1/sales + กติกาพัก/ผลตอบกลับ (รัน: npx tsx --tsconfig tsconfig.json scripts/test-ow-sale-body.ts)
import assert from "node:assert/strict";
import { buildSaleBody, holdReasonForChannel, holdReasonForOrderStatus, saleOutcome, jstReasonTh, HOLD_PREFIX, type PosSaleInput } from "@/lib/server/ow-sales";
import { bkkIso } from "@/lib/server/ow-write";
import { isOwSaleDone, isOwSaleFailed } from "@/lib/ow/sale-status";
import { maxRedeemablePoints } from "@/lib/loyalty";

let n = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error(`FAIL: ${name}`); throw e; } };
const base: PosSaleInput = {
  orderNo: "UAT-1", saleAt: "2026-11-25T03:00:00.000Z", owBranchId: "UAT-TEST",
  items: [{ sku: "A", qty: 2, unitPrice: 100, lineDiscount: 10, isGift: false, serials: ["SN1", "SN2"] }, { sku: "G", qty: 1, unitPrice: 50, lineDiscount: 0, isGift: true, serials: [] }],
  grandTotal: 175, payments: [{ method: "cash", amount: 175 }],
};

t("ยอดลงตัว: ส่วนลดบรรทัด + ส่วนลดท้ายบิล = ยอดสุทธิ · ของแถมราคา 0 + isFreebie", () => {
  const b = buildSaleBody(base, "k1");
  assert.equal(b.lines[0].lineDiscount, 10);
  assert.deepEqual([b.lines[1].unitPrice, b.lines[1].isFreebie], [0, true]);
  assert.equal(b.billDiscount, 15); // 200 − 10 − 175
  assert.deepEqual(b.lines[0].serials, ["SN1", "SN2"]);
  assert.equal("serials" in b.lines[1], false);
});
t("ไม่มีส่วนลดท้ายบิล = ไม่ส่ง billDiscount", () => {
  assert.equal("billDiscount" in buildSaleBody({ ...base, grandTotal: 190, payments: [{ method: "cash", amount: 190 }] }, "k"), false);
});
t("เงินทอน: ตัดออกจากเงินสด ให้ยอดชำระ = ยอดสุทธิ", () => {
  const b = buildSaleBody({ ...base, payments: [{ method: "qr_promptpay", amount: 75 }, { method: "cash", amount: 200 }] }, "k");
  assert.deepEqual(b.payments, [{ method: "qr_promptpay", amount: 75 }, { method: "cash", amount: 100 }]);
});
t("ยอดชำระไม่พอ / ยอดสุทธิเกินราคา / จำนวนทศนิยม = ไม่ส่ง (โยน error ไทย)", () => {
  assert.throws(() => buildSaleBody({ ...base, payments: [{ method: "cash", amount: 100 }] }, "k"), /ยอดชำระ/);
  assert.throws(() => buildSaleBody({ ...base, grandTotal: 500, payments: [{ method: "cash", amount: 500 }] }, "k"), /สูงกว่า/);
  assert.throws(() => buildSaleBody({ ...base, items: [{ ...base.items[0], qty: 1.5 }] }, "k"), /จำนวนเต็ม/);
});
t("ลูกค้า (ผู้ซื้อ) ไปหมายเหตุ JST: มีชื่อหรือเบอร์อย่างใดอย่างหนึ่งก็ส่ง · ไม่มีเลย = null", () => {
  assert.deepEqual(buildSaleBody({ ...base, customer: { name: " ก ", phone: null } }, "k").customer, { name: "ก", phone: "-" });
  assert.equal(buildSaleBody({ ...base, customer: { name: "  ", phone: "" } }, "k").customer, null);
});
t("salespersonId ส่งเฉพาะพนักงานที่ผูกแล้ว", () => {
  assert.equal(buildSaleBody({ ...base, salespersonId: "275491" }, "k").salespersonId, "275491");
  assert.equal("salespersonId" in buildSaleBody({ ...base, salespersonId: null }, "k"), false);
});
t("หมายเหตุ: เลขบิล POS + ที่มาส่วนลด + test (UAT) · ไม่เกิน 1000 ตัวอักษร", () => {
  const b = buildSaleBody({ ...base, test: true, discountNote: "คูปอง X".repeat(300) }, "k");
  assert.ok(b.remark!.startsWith("POS UAT-1 · คูปอง X"));
  assert.ok(b.remark!.length <= 1000);
  assert.ok(buildSaleBody({ ...base, test: true }, "k").remark!.endsWith(" · test"));
});
t("orderTime เป็นเวลาไทย +07:00", () => {
  assert.equal(bkkIso("2026-11-25T03:00:00.000Z"), "2026-11-25T10:00:00+07:00");
  assert.equal(buildSaleBody(base, "k").orderTime, "2026-11-25T10:00:00+07:00");
});
t("ช่องทาง: หน้าร้าน/อีเวนต์ส่ง · ขายส่ง/ออนไลน์/อื่น ๆ พักไว้ไม่ส่ง", () => {
  for (const c of ["offline", "event", null]) assert.equal(holdReasonForChannel(c), null);
  for (const c of ["b2b", "online_shopee", "online_website", "other"]) assert.ok(holdReasonForChannel(c)!.startsWith(HOLD_PREFIX), c);
  assert.match(holdReasonForChannel("b2b")!, /ERIS-256/);
  assert.match(holdReasonForChannel("online_lazada")!, /ห้ามส่งซ้ำ/);
});
t("บิลยกเลิก/คืนก่อนถึง JST = ห้ามส่ง", () => {
  for (const s of ["voided", "refunded", "partially_refunded"]) assert.ok(holdReasonForOrderStatus(s)!.startsWith(HOLD_PREFIX), s);
  for (const s of ["completed", null]) assert.equal(holdReasonForOrderStatus(s), null);
});
t("ผล OW: jst_confirmed/shipped/submitted = ส่งแล้ว · failed = blocked พร้อมเหตุผลไทย · sn_pending = blocked", () => {
  const ok = (status: string, extra = {}) => saleOutcome({ ok: true, status: 201, data: { id: "s", saleNo: "1", status, version: 1, ...extra } as never }, 0);
  assert.equal(ok("jst_confirmed").state, "delivered");
  assert.equal(ok("shipped").state, "delivered");
  assert.equal(ok("submitted").state, "delivered");
  const f = ok("failed", { statusReason: "商品MOVA-Z70库存不足" });
  assert.equal(f.state, "blocked"); assert.match(f.reason!, /สต๊อกใน JST ไม่พอ/); assert.match(f.reason!, /MOVA-Z70/);
  assert.equal(ok("sn_pending", { problems: [{ code: "sn", message: "SN X ไม่รู้จัก" }] }).state, "blocked");
  assert.ok(isOwSaleDone("shipped") && isOwSaleDone("jst_confirmed") && !isOwSaleDone("failed") && isOwSaleFailed("failed"));
});
t("ผล OW ล้มชั่วคราว: 5xx/429/เครือข่าย = ลองใหม่ · ครบ 12 ครั้ง = dead · 4xx อื่น = blocked", () => {
  const err = (status: number, code = "x") => ({ ok: false, status, error: { code, message: "m" } } as never);
  assert.equal(saleOutcome(err(503), 1).state, "retry");
  assert.equal(saleOutcome(err(0), 1).state, "retry");
  assert.equal(saleOutcome(err(429), 12).state, "dead");
  assert.equal(saleOutcome(err(400, "validation"), 1).state, "blocked");
  assert.equal(saleOutcome(err(409, "sale_op_key_conflict"), 1).state, "blocked");
});
t("jstReasonTh: รหัส jst_stock_insufficient แปลไทย · ข้อความอื่นคงเดิม", () => {
  assert.match(jstReasonTh("anything", "jst_stock_insufficient"), /ไม่พอจัดส่ง/);
  assert.equal(jstReasonTh("other"), "other");
});
t("ใช้แต้ม: ต้องเหลือยอดชำระ ≥ 1 บาท และไม่เกินแต้มที่มี", () => {
  assert.equal(maxRedeemablePoints(30, 100), 30);
  assert.equal(maxRedeemablePoints(500, 100), 99);
  assert.equal(maxRedeemablePoints(10, 1), 0);
  assert.equal(maxRedeemablePoints(-5, 100), 0);
});
console.log(`PASS: ${n} OW sale-body / hold / outcome / loyalty-cap regressions`);
