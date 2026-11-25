// /api/admin/search?q= — ช่องค้นหาอัจฉริยะ: ค้นทั้งระบบจากข้อมูลจริง แล้วบอกว่าจะพาไปไหน/เปิดเอกสารอะไร
//   บิล (เลข/เบอร์/ชื่อลูกค้า) · SN · สินค้า (SKU/ชื่อ/บาร์โค้ด) · ลูกค้า · ใบโอน · ใบกำกับ/ใบลดหนี้/ใบรับคืน · รอบนับ · ใบปรับสต๊อก · รอรับของ · พนักงาน · สาขา
//   ตัดตามสิทธิ์แต่ละประเภท + สาขาที่มองเห็น · เอกสารคืนลิงก์ลงลายเซ็น (เปิดดู/PDF ในหน้าต่างเดิม)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { docUrl } from "@/lib/server/order-docs";
import type { PermissionKey } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
type Item = { title: string; sub?: string; href?: string; doc?: { kind: string; url: string; title: string; doc_no: string }; badge?: string; at?: string };
type Group = { kind: string; label: string; items: Item[] };
const baht = (n: unknown) => `฿${Number(n ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" }) : "");
const ORDER_STATUS: Record<string, string> = { completed: "ขายแล้ว", partially_refunded: "คืนบางส่วน", refunded: "คืนครบ", voided: "ยกเลิก", draft: "ร่าง" };

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (raw.length < 2) return reply({ groups: [] });
  const can = (k: PermissionKey) => hasPerm(profile.email, authz, k);
  const allowed = await visibleBranchIds(authz);
  const inScope = (b: string | null | undefined) => allowed === null || (!!b && allowed.includes(b));
  const sb = supabaseAdmin();
  const like = `%${raw.replace(/[%_\\,()]/g, " ").trim()}%`;
  const up = raw.toUpperCase();
  const digits = raw.replace(/\D/g, "");
  const branchName = new Map<string, string>();
  const nameOf = (id?: string | null) => (id ? branchName.get(id) ?? "" : "");
  { const b = await sb.from("branches").select("id,name,name_th,code"); for (const x of b.data ?? []) branchName.set(x.id, x.name_th ?? x.name); }

  const jobs: Promise<Group | null>[] = [];
  // บิล — เลขบิล / เบอร์ / ชื่อลูกค้า
  if (can("sales.view")) jobs.push((async () => {
    const ors = [`order_no.ilike.${like}`, `customer_name.ilike.${like}`];
    if (digits.length >= 4) ors.push(`customer_phone.ilike.%${digits}%`);
    const r = await sb.from("orders").select("id,client_uuid,order_no,branch_id,status,grand_total,customer_name,created_at").or(ors.join(",")).order("created_at", { ascending: false }).limit(15);
    const items = (r.data ?? []).filter((o) => inScope(o.branch_id)).slice(0, 6).map((o) => ({
      title: o.order_no, sub: `${nameOf(o.branch_id)} · ${baht(o.grand_total)}${o.customer_name ? ` · ${o.customer_name}` : ""} · ${day(o.created_at)}`, badge: ORDER_STATUS[o.status] ?? o.status,
      href: `/admin/sales?tab=bills&q=${encodeURIComponent(o.order_no)}`, doc: { kind: "receipt", url: docUrl("receipt", o.client_uuid), title: "ใบเสร็จ", doc_no: o.order_no }, at: o.created_at }));
    return items.length ? { kind: "order", label: "บิลขาย", items } : null;
  })());
  // SN — ตามรอยการเดินทาง
  if (can("inventory.view") && raw.length >= 4) jobs.push((async () => {
    const r = await sb.from("serials").select("serial_no,status,branch_id,products(sku,name_th)").ilike("serial_no", `${up.replace(/[%_]/g, "")}%`).limit(8);
    const items = (r.data ?? []).map((s) => { const p = s.products as unknown as { sku: string; name_th: string } | null; return { title: s.serial_no, sub: `${p?.sku ?? ""} ${p?.name_th ?? ""} · ${nameOf(s.branch_id) || "—"}`, badge: s.status, href: `/admin/serials?sn=${encodeURIComponent(s.serial_no)}` }; });
    // SN ที่ไม่อยู่ใน POS (อยู่คลังกลาง) ก็ยังตามรอยได้
    if (!items.length && /^[A-Z0-9-]{6,}$/.test(up) && /[A-Z]/.test(up) && /\d/.test(up) && !/^(UAT|TF|TI|CN|RT|SC|ADJ)/.test(up)) items.push({ title: up, sub: "ตามรอย SN (ถามคลังกลางด้วย)", badge: "SN", href: `/admin/serials?sn=${encodeURIComponent(up)}` });
    return items.length ? { kind: "serial", label: "Serial (SN)", items } : null;
  })());
  // สินค้า — SKU / ชื่อ / บาร์โค้ด
  if (can("product.view") || can("inventory.view")) jobs.push((async () => {
    const [p, bc] = await Promise.all([
      sb.from("products").select("id,sku,name_th,price,is_active").or(`sku.ilike.${like},name_th.ilike.${like},name_en.ilike.${like}`).limit(8),
      sb.from("product_barcodes").select("barcode,products(id,sku,name_th,price,is_active)").ilike("barcode", `${raw.replace(/[%_]/g, "")}%`).limit(4),
    ]);
    const all = [...(p.data ?? []), ...((bc.data ?? []).map((x) => x.products as unknown as { id: string; sku: string; name_th: string; price: number; is_active: boolean }).filter(Boolean))];
    const seen = new Set<string>();
    const items = all.filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, 6).map((x) => ({ title: x.name_th, sub: `${x.sku} · ${baht(x.price)}`, badge: x.is_active ? undefined : "ปิดขาย", href: `/admin/products?q=${encodeURIComponent(x.sku)}` }));
    return items.length ? { kind: "product", label: "สินค้า", items } : null;
  })());
  // ลูกค้า — ชื่อ / เบอร์
  if (can("customer.manage") || can("sales.view")) jobs.push((async () => {
    const ors = [`name.ilike.${like}`];
    if (digits.length >= 4) ors.push(`phone.ilike.%${digits}%`);
    const r = await sb.from("customers").select("id,name,phone").or(ors.join(",")).limit(6);
    const items = (r.data ?? []).map((c) => ({ title: c.name ?? "ไม่ระบุชื่อ", sub: c.phone ? c.phone.replace(/^(\d{3})\d{3}(\d{4})$/, "$1-xxx-$2") : "ไม่มีเบอร์", href: `/admin/customers?id=${c.id}` }));
    return items.length ? { kind: "customer", label: "ลูกค้า", items } : null;
  })());
  // ใบโอน
  if (can("transfer.request")) jobs.push((async () => {
    const r = await sb.from("pos_ow_transfers").select("pos_transfer_id,transfer_no,from_branch_id,to_branch_id,pos_snapshot,updated_at").ilike("transfer_no", like).order("updated_at", { ascending: false }).limit(8);
    const items = (r.data ?? []).filter((t) => inScope(t.from_branch_id) || inScope(t.to_branch_id)).slice(0, 5).map((t) => ({
      title: t.transfer_no, sub: `${nameOf(t.from_branch_id)} → ${nameOf(t.to_branch_id)}`, badge: (t.pos_snapshot as { status?: string } | null)?.status, href: `/admin/transfers?doc=${encodeURIComponent(t.transfer_no)}`,
      doc: { kind: "transfer_out", url: docUrl("transfer_out", t.pos_transfer_id), title: "ใบส่งสินค้า (โอน)", doc_no: t.transfer_no } }));
    return items.length ? { kind: "transfer", label: "ใบโอน", items } : null;
  })());
  // เอกสารภาษี/คืนสินค้า — เลขเอกสาร
  if (can("sales.view") && raw.length >= 3) jobs.push((async () => {
    const [ti, cn, rt] = await Promise.all([
      sb.from("tax_invoices").select("id,invoice_no,branch_id,amount_total,status,issued_at,buyer").or(`invoice_no.ilike.${like},buyer->>name.ilike.${like}`).limit(5),
      sb.from("credit_notes").select("id,cn_no,branch_id,amount_total,issued_at,reason").ilike("cn_no", like).limit(5),
      sb.from("returns").select("id,return_no,branch_id,refund_amount,status,kind,created_at").ilike("return_no", like).limit(5),
    ]);
    const items: Item[] = [
      ...(ti.data ?? []).filter((x) => inScope(x.branch_id)).map((x) => ({ title: x.invoice_no, sub: `ใบกำกับภาษีเต็มรูป · ${(x.buyer as { name?: string })?.name ?? ""} · ${baht(x.amount_total)}`, badge: x.status === "cancelled" ? "ยกเลิก" : undefined, doc: { kind: "tax_invoice", url: docUrl("tax_invoice", x.id), title: "ใบกำกับภาษีเต็มรูป", doc_no: x.invoice_no } })),
      ...(cn.data ?? []).filter((x) => inScope(x.branch_id)).map((x) => ({ title: x.cn_no, sub: `ใบลดหนี้ · ${baht(x.amount_total)} · ${x.reason}`, doc: { kind: "credit_note", url: docUrl("credit_note", x.id), title: "ใบลดหนี้", doc_no: x.cn_no } })),
      ...(rt.data ?? []).filter((x) => inScope(x.branch_id)).map((x) => ({ title: x.return_no, sub: `${x.kind === "void" ? "ยกเลิกบิล" : "ใบรับคืน"} · ${baht(x.refund_amount)} · ${day(x.created_at)}`, badge: x.status, doc: { kind: "return", url: docUrl("return", x.id), title: x.kind === "void" ? "ใบยกเลิกบิล" : "ใบรับคืนสินค้า", doc_no: x.return_no } })),
    ];
    return items.length ? { kind: "doc", label: "เอกสาร", items: items.slice(0, 8) } : null;
  })());
  // งานสต๊อก — รอบนับ / ใบปรับ
  if (can("inventory.view") && /^(SC|ADJ)/i.test(raw)) jobs.push((async () => {
    const [sc, adj] = await Promise.all([
      sb.from("pos_count_sessions").select("id,count_no,branch_id,status,created_at").ilike("count_no", like).limit(5),
      sb.from("pos_stock_adjustments").select("id,adj_no,branch_id,status,reason_code,total_value").ilike("adj_no", like).limit(5),
    ]);
    const items: Item[] = [
      ...(sc.data ?? []).filter((x) => inScope(x.branch_id)).map((x) => ({ title: x.count_no, sub: `รอบตรวจนับ · ${nameOf(x.branch_id)} · ${day(x.created_at)}`, badge: x.status, href: "/pos/count" })),
      ...(adj.data ?? []).filter((x) => inScope(x.branch_id)).map((x) => ({ title: x.adj_no, sub: `ใบขอปรับสต๊อก · ${nameOf(x.branch_id)} · ${baht(x.total_value)}`, badge: x.status, href: "/pos/adjust" })),
    ];
    return items.length ? { kind: "stockdoc", label: "งานสต๊อก", items } : null;
  })());
  // พนักงาน — ไปหน้าผลงานรายบุคคล
  if (can("report.employee_perf")) jobs.push((async () => {
    const r = await sb.from("employees").select("id,first_name,last_name,nickname,employee_code,home_branch_id,status").or(`first_name.ilike.${like},last_name.ilike.${like},nickname.ilike.${like},employee_code.ilike.${like}`).eq("status", "active").limit(8);
    const items = (r.data ?? []).filter((e) => inScope(e.home_branch_id) || allowed === null).slice(0, 5).map((e) => ({ title: [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname, sub: `${e.employee_code} · ${nameOf(e.home_branch_id) || "—"}`, href: `/admin/sales?tab=staff&person=${e.id}` }));
    return items.length ? { kind: "employee", label: "พนักงาน (ผลงาน)", items } : null;
  })());
  // สาขา
  jobs.push((async () => {
    const items = [...branchName.entries()].filter(([id, n]) => inScope(id) && n.toLowerCase().includes(raw.toLowerCase())).slice(0, 5).map(([id, n]) => ({ title: n, sub: "ดูยอดขายรายสาขา", href: `/admin/sales?tab=branch&branch=${id}` }));
    return items.length ? { kind: "branch", label: "สาขา", items } : null;
  })());

  const settled = await Promise.allSettled(jobs);
  const groups = settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
  return reply({ groups, q: raw });
}
