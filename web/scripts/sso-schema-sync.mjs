#!/usr/bin/env node
// ประกาศ resource / capability / มิติขอบเขตข้อมูล ของ SHDPOS ให้ระบบสิทธิ์กลาง
// เรียกตอน deploy (ยิงซ้ำได้ ไม่พัง · prune:false = เพิ่ม/อัปเดตอย่างเดียว)
//   รัน:  CENTRAL_API_KEY=... node scripts/sso-schema-sync.mjs
// หรือผ่าน npm:  npm run sso:sync   (โหลด .env.local ให้เองถ้ามี)
import fs from "node:fs";
import path from "node:path";

// โหลด .env.local แบบง่าย ๆ (ไม่พึ่ง dependency)
try {
  const envPath = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
} catch {}

const BASE = process.env.CENTRAL_SSO_BASE || "https://sso.shd-technology.co.th";
const KEY = process.env.CENTRAL_API_KEY;
if (!KEY) {
  console.error("✗ ไม่มี CENTRAL_API_KEY (ใส่ใน .env.local หรือ env ตอนรัน)");
  process.exit(1);
}

// รายการหน้าจอ/ข้อมูลหลักของ POS → resource
const resources = [
  { key: "sell", name: "ขายหน้าร้าน (POS)", rtype: "page" },
  { key: "orders", name: "บิล/คำสั่งขาย", rtype: "table" },
  { key: "returns", name: "รับคืนสินค้า", rtype: "table" },
  { key: "holds", name: "พักบิล", rtype: "table" },
  { key: "stock", name: "สต็อกสินค้า", rtype: "table" },
  { key: "transfers", name: "โอนย้ายสินค้า", rtype: "table" },
  { key: "receive", name: "รับสินค้าเข้า", rtype: "table" },
  { key: "quotation", name: "ใบเสนอราคา", rtype: "table" },
  { key: "count", name: "ตรวจนับสต็อก", rtype: "table" },
  { key: "adjust", name: "ปรับปรุงสต็อก", rtype: "table" },
  { key: "dashboard", name: "แดชบอร์ด/รายงาน", rtype: "page" },
  { key: "shift", name: "กะ/ลิ้นชักเงินสด", rtype: "table" },
  { key: "settings", name: "ตั้งค่าระบบ", rtype: "page" },
];

// สิทธิ์เฉพาะกิจ (ต้องเข้าไปติ๊กให้บทบาทเองที่ระบบกลาง)
const capabilities = [
  { key: "discount.override", name: "ให้ส่วนลดเกินเพดาน" },
  { key: "sale.void", name: "ยกเลิก/วอยด์บิล" },
  { key: "refund.approve", name: "อนุมัติคืนเงิน" },
  { key: "price.edit", name: "แก้ราคาตอนขาย" },
  { key: "drawer.open", name: "เปิดลิ้นชักเงินสด" },
  { key: "shift.close", name: "ปิดกะ/สรุปเงิน" },
  { key: "stock.adjust.approve", name: "อนุมัติปรับสต็อก" },
  { key: "transfer.approve", name: "อนุมัติโอนย้าย" },
];

// มิติขอบเขตข้อมูล: จำกัดว่าเห็น "แถวไหน" (ค่าในมิติให้แอดมินผูกเองทีหลัง)
const scopes = [
  { key: "branch", name: "สาขา", values: [] },
  { key: "brand", name: "แบรนด์", values: [] },
];

const body = { resources, capabilities, scopes, prune: false };

const r = await fetch(`${BASE}/api/v1/apps/schema/sync`, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await r.text();
if (!r.ok) {
  console.error(`✗ schema/sync ล้มเหลว (${r.status}): ${text}`);
  process.exit(1);
}
console.log("✓ ประกาศ schema สำเร็จ:", text);
