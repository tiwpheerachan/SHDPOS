#!/usr/bin/env node
// =====================================================================
// ตรวจกฎ "ทุกฟีเจอร์ต้องติ๊กสิทธิ์ได้" — รัน: node scripts/check-permissions.cjs
//   1) ทุกคีย์ใน PERMISSION_KEYS อยู่ในกลุ่ม PERM_GROUPS (หน้า ผู้ใช้ & สิทธิ์)
//   2) ทุกเมนูใน shell.tsx มี perm และ perm นั้นมีจริง
//   3) ทุกหน้าใน src/app/admin/* ที่มีในเมนูถูกผูกสิทธิ์ (หน้าที่ไม่อยู่ในเมนูแสดงเป็นคำเตือน)
// ออกด้วย code 1 ถ้าผิดกฎ
// =====================================================================
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const perms = read("src/lib/permissions.ts");
const keys = [...perms.slice(perms.indexOf("PERMISSION_KEYS"), perms.indexOf("] as const")).matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]);
const ui = read("src/lib/permissions-ui.ts");
const grouped = new Set([...ui.slice(ui.indexOf("PERM_GROUPS"), ui.indexOf("PERM_LABEL")).matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]));
const shell = read("src/components/admin/shell.tsx");
const nav = [...shell.matchAll(/\{ href: "([^"]+)",[^}]*?key: "([^"]+)"(?:, perm: "([^"]+)")?[^}]*\}/g)].map((m) => ({ href: m[1], key: m[2], perm: m[3] }));

const errors = [];
for (const k of keys) if (!grouped.has(k)) errors.push(`สิทธิ์ ${k} ยังไม่อยู่ในกลุ่มใดใน PERM_GROUPS (ติ๊กในหน้าไม่ได้)`);
for (const n of nav) {
  if (!n.perm) errors.push(`เมนู ${n.href} ไม่มี perm`);
  else if (!keys.includes(n.perm)) errors.push(`เมนู ${n.href} ใช้ perm "${n.perm}" ที่ไม่มีใน PERMISSION_KEYS`);
}
const navHrefs = new Set(nav.map((n) => n.href));
const adminDir = path.join(root, "src/app/admin");
const pages = fs.readdirSync(adminDir).filter((d) => fs.existsSync(path.join(adminDir, d, "page.tsx"))).map((d) => `/admin/${d}`);
const offMenu = pages.filter((p) => !navHrefs.has(p));

console.log(`สิทธิ์ทั้งหมด ${keys.length} · อยู่ในหน้าสิทธิ์ ${grouped.size} · เมนู ${nav.length}`);
if (offMenu.length) console.log(`หมายเหตุ: หน้าที่ไม่อยู่ในเมนู (ตรวจเองว่าเช็กสิทธิ์ในหน้า/API): ${offMenu.join(", ")}`);
if (errors.length) {
  console.error("\n✕ ผิดกฎสิทธิ์:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log("✓ ทุกฟีเจอร์ในเมนูมีสิทธิ์ให้ติ๊กครบ");
