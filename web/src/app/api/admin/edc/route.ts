// /api/admin/edc — ทะเบียนเครื่อง EDC + อัตรา MDR (0080)
//   GET  → { terminals (+mids), branches, rates, canManage, canMdr } · เลข MID/TID เต็มเฉพาะผู้มีสิทธิ์ edc.manage (อื่น ๆ มาสก์)
//   POST { action: save_terminal | set_status | verify | import | add_rate | end_rate }
//   ข้อมูลนี้อยู่ฝั่งระบบเราเท่านั้น — ไม่เขียนกลับไปไฟล์/ชีทของธนาคารหรือ Lark
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ACQUIRERS, EDC_SERVICES, maskNo, validNo } from "@/lib/server/edc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
type Row = Record<string, unknown>;

async function ctx(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return null;
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !authz.employee_id) return null;
  const canManage = hasPerm(profile.email, authz, "edc.manage");
  const canMdr = hasPerm(profile.email, authz, "edc.mdr_manage");
  const canView = canManage || canMdr || hasPerm(profile.email, authz, "finance.view");
  return canView ? { me: authz.employee_id, canManage, canMdr } : null;
}
const audit = (me: string, action: string, ref: string | null, after: unknown, before?: unknown) =>
  supabaseAdmin().from("audit_logs").insert({ action, actor_id: me, ref_table: "pos_edc_terminals", ref_id: ref, before_data: before ?? null, after_data: after ?? null });
const ACQ = new Set<string>(ACQUIRERS), SVC = new Set<string>(EDC_SERVICES);
const MONTHS = new Set([0, 3, 4, 6, 9, 10, 12, 18, 24, 36]);
const STATUS = new Set(["active", "spare", "repair", "no_txn", "retired"]);
const txt = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MidIn = { service: string; installment_months?: number; mid: string; tid?: string | null; merchant_no?: string | null; note?: string | null };
function cleanMids(raw: unknown): { ok: MidIn[]; err?: string } {
  const out: MidIn[] = [];
  const seen = new Set<string>();
  for (const m of Array.isArray(raw) ? raw : []) {
    const r = m as Row;
    const service = String(r.service ?? ""), months = service === "installment" ? Number(r.installment_months) || 0 : 0;
    if (!SVC.has(service)) return { ok: [], err: `บริการไม่ถูกต้อง: ${service}` };
    if (service === "installment" && !months) return { ok: [], err: "แผนผ่อนต้องระบุจำนวนเดือน" };
    if (!MONTHS.has(months)) return { ok: [], err: `จำนวนเดือนผ่อนไม่ถูกต้อง: ${months}` };
    if (!validNo(r.mid)) return { ok: [], err: `MID ไม่ถูกต้อง (${service}${months ? ` ${months} เดือน` : ""})` };
    if (r.tid != null && r.tid !== "" && !validNo(r.tid)) return { ok: [], err: `TID ของแผนไม่ถูกต้อง (${service})` };
    const key = `${service}:${months}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ service, installment_months: months, mid: String(r.mid).trim(), tid: txt(r.tid, 32), merchant_no: txt(r.merchant_no, 40), note: txt(r.note) });
  }
  return { ok: out };
}

export async function GET(req: NextRequest) {
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const sb = supabaseAdmin();
  const [t, m, b, r] = await Promise.all([
    sb.from("pos_edc_terminals").select("*").order("acquirer").order("label"),
    sb.from("pos_edc_mids").select("*"),
    sb.from("branches").select("id,code,name,name_th,brand_id,is_active").order("code"),
    sb.from("pos_mdr_rates").select("*").order("acquirer").order("service").order("installment_months").order("effective_from", { ascending: false }),
  ]);
  if (t.error || m.error) return reply({ error: (t.error ?? m.error)!.message }, 503);
  const show = (v: string | null) => (c.canManage ? v : maskNo(v));
  const mids = (m.data ?? []) as Row[];
  const terminals = ((t.data ?? []) as Row[]).map((x) => ({
    ...x, tid: show(x.tid as string), sim_no: show(x.sim_no as string | null),
    mids: mids.filter((y) => y.terminal_id === x.id).map((y) => ({ ...y, mid: show(y.mid as string), tid: show(y.tid as string | null) })),
  }));
  return reply({ terminals, branches: b.data ?? [], rates: r.data ?? [], canManage: c.canManage, canMdr: c.canMdr, full: c.canManage });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const c = await ctx(req); if (!c) return reply({ error: "ไม่มีสิทธิ์" }, 403);
  const b = ((await req.json().catch(() => null)) ?? {}) as Row;
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // ── อัตรา MDR ──
  if (b.action === "add_rate" || b.action === "end_rate") {
    if (!c.canMdr) return reply({ error: "ไม่มีสิทธิ์ตั้งอัตรา MDR (edc.mdr_manage)" }, 403);
    if (b.action === "end_rate") {
      if (!UUID.test(String(b.id))) return reply({ error: "id" }, 400);
      const to = txt(b.effective_to, 10) ?? now.slice(0, 10);
      const before = (await sb.from("pos_mdr_rates").select("*").eq("id", b.id).maybeSingle()).data;
      const u = await sb.from("pos_mdr_rates").update({ effective_to: to, ended_by: c.me }).eq("id", b.id).is("effective_to", null).select("id").maybeSingle();
      if (u.error) return reply({ error: u.error.message }, 400);
      if (!u.data) return reply({ error: "อัตรานี้สิ้นสุดไปแล้ว" }, 409);
      await sb.from("audit_logs").insert({ action: "mdr_rate_end", actor_id: c.me, ref_table: "pos_mdr_rates", ref_id: b.id, before_data: before, after_data: { effective_to: to } });
      return reply({ ok: true });
    }
    const acquirer = String(b.acquirer ?? ""), service = String(b.service ?? ""), months = service === "installment" ? Number(b.installment_months) || 0 : 0;
    const rate = Number(b.rate_pct), fixed = Number(b.fixed_fee ?? 0);
    if (!ACQ.has(acquirer) || !SVC.has(service)) return reply({ error: "ธนาคาร/บริการไม่ถูกต้อง" }, 400);
    if (service === "installment" && !months) return reply({ error: "แผนผ่อนต้องระบุจำนวนเดือน" }, 400);
    if (!(rate >= 0 && rate <= 20) || !(fixed >= 0)) return reply({ error: "อัตรา % ต้องอยู่ระหว่าง 0–20 และค่าคงที่ต้องไม่ติดลบ" }, 400);
    const from = txt(b.effective_from, 10) ?? now.slice(0, 10);
    const card = String(b.card_type ?? "all");
    // ปิดอัตราเดิมของชุดเดียวกันอัตโนมัติ (วันก่อนวันเริ่มใหม่)
    const prevDay = new Date(Date.parse(from) - 86400_000).toISOString().slice(0, 10);
    await sb.from("pos_mdr_rates").update({ effective_to: prevDay, ended_by: c.me }).eq("acquirer", acquirer).eq("service", service).eq("installment_months", months).eq("card_type", card).is("effective_to", null).lt("effective_from", from);
    const ins = await sb.from("pos_mdr_rates").insert({ acquirer, service, card_type: card, installment_months: months, rate_pct: rate, fixed_fee: fixed, vat_on_fee: b.vat_on_fee !== false, effective_from: from, note: txt(b.note), created_by: c.me }).select("*").single();
    if (ins.error) return reply({ error: ins.error.message }, 400);
    await sb.from("audit_logs").insert({ action: "mdr_rate_add", actor_id: c.me, ref_table: "pos_mdr_rates", ref_id: ins.data.id, after_data: ins.data });
    return reply({ rate: ins.data });
  }

  if (!c.canManage) return reply({ error: "ไม่มีสิทธิ์จัดการเครื่อง EDC (edc.manage)" }, 403);

  if (b.action === "set_status" || b.action === "verify") {
    if (!UUID.test(String(b.id))) return reply({ error: "id" }, 400);
    const patch: Row = { updated_by: c.me, updated_at: now };
    if (b.action === "verify") Object.assign(patch, { verified: b.verified !== false, verified_by: c.me, verified_at: now });
    else { if (!STATUS.has(String(b.status))) return reply({ error: "สถานะไม่ถูกต้อง" }, 400); patch.status = b.status; if (b.replaced_by && UUID.test(String(b.replaced_by))) patch.replaced_by = b.replaced_by; }
    const before = (await sb.from("pos_edc_terminals").select("status,verified").eq("id", b.id).maybeSingle()).data;
    const u = await sb.from("pos_edc_terminals").update(patch).eq("id", b.id);
    if (u.error) return reply({ error: u.error.message }, 400);
    await audit(c.me, `edc_${b.action}`, String(b.id), patch, before);
    return reply({ ok: true });
  }

  if (b.action === "save_terminal") {
    const t = (b.terminal ?? {}) as Row;
    const acquirer = String(t.acquirer ?? "");
    if (!ACQ.has(acquirer)) return reply({ error: "เลือกธนาคาร" }, 400);
    if (!validNo(t.tid)) return reply({ error: "TID ไม่ถูกต้อง (ตัวเลข/ตัวอักษร 4–32 ตัว)" }, 400);
    if (t.branch_id && !UUID.test(String(t.branch_id))) return reply({ error: "สาขาไม่ถูกต้อง" }, 400);
    const mids = cleanMids(t.mids);
    if (mids.err) return reply({ error: mids.err }, 400);
    const row = { acquirer, tid: String(t.tid).trim(), branch_id: t.branch_id || null, label: txt(t.label), status: STATUS.has(String(t.status)) ? t.status : "active",
      shared_note: txt(t.shared_note), sim_no: txt(t.sim_no, 30), sim_monthly_fee: t.sim_monthly_fee === "" || t.sim_monthly_fee == null ? null : Number(t.sim_monthly_fee), note: txt(t.note, 500), updated_by: c.me, updated_at: now };
    let id = UUID.test(String(t.id)) ? String(t.id) : null;
    const before = id ? (await sb.from("pos_edc_terminals").select("*").eq("id", id).maybeSingle()).data : null;
    if (id) {
      const u = await sb.from("pos_edc_terminals").update(row).eq("id", id);
      if (u.error) return reply({ error: u.error.code === "23505" ? "มี TID นี้ของธนาคารนี้อยู่แล้ว" : u.error.message }, 400);
    } else {
      const ins = await sb.from("pos_edc_terminals").insert({ ...row, source: "manual", created_by: c.me }).select("id").single();
      if (ins.error) return reply({ error: ins.error.code === "23505" ? "มี TID นี้ของธนาคารนี้อยู่แล้ว" : ins.error.message }, 400);
      id = ins.data.id as string;
    }
    // MID ของเครื่อง = ชุดที่ส่งมา (ข้อมูลตั้งค่า ไม่ใช่เอกสารบัญชี)
    await sb.from("pos_edc_mids").delete().eq("terminal_id", id);
    if (mids.ok.length) {
      const m = await sb.from("pos_edc_mids").insert(mids.ok.map((x) => ({ ...x, terminal_id: id })));
      if (m.error) return reply({ error: m.error.message }, 400);
    }
    await audit(c.me, before ? "edc_update" : "edc_create", id, { ...row, tid: maskNo(row.tid), sim_no: maskNo(row.sim_no), mids: mids.ok.map((x) => ({ ...x, mid: maskNo(x.mid), tid: maskNo(x.tid ?? null) })) },
      before ? { ...before, tid: maskNo(before.tid as string), sim_no: maskNo(before.sim_no as string | null) } : undefined);
    return reply({ id });
  }

  if (b.action === "import") {
    // นำเข้าจากไฟล์ทะเบียนของธนาคาร (อ่านในเบราว์เซอร์แล้วส่งเป็นแถว) — upsert ตาม (ธนาคาร, TID) · MID รวมเข้าของเดิม
    const rows = Array.isArray(b.rows) ? (b.rows as Row[]) : [];
    const source = `import:${txt(b.filename, 120) ?? "file"}`;
    if (!rows.length || rows.length > 1000) return reply({ error: "ไม่มีแถวให้นำเข้า หรือมากเกินไป" }, 400);
    let created = 0, updated = 0, midsUp = 0;
    const errors: string[] = [];
    for (const [i, r] of rows.entries()) {
      const acquirer = String(r.acquirer ?? "");
      if (!ACQ.has(acquirer) || !validNo(r.tid)) { errors.push(`แถว ${i + 1}: ธนาคาร/TID ไม่ถูกต้อง`); continue; }
      const mids = cleanMids(r.mids);
      if (mids.err) { errors.push(`แถว ${i + 1}: ${mids.err}`); continue; }
      const tid = String(r.tid).trim();
      const ex = (await sb.from("pos_edc_terminals").select("id,branch_id,label,status,note").eq("acquirer", acquirer).eq("tid", tid).maybeSingle()).data;
      const base = { label: txt(r.label) ?? ex?.label ?? null, branch_id: r.branch_id && UUID.test(String(r.branch_id)) ? r.branch_id : ex?.branch_id ?? null,
        status: STATUS.has(String(r.status)) ? r.status : ex?.status ?? "active", note: txt(r.note, 500) ?? ex?.note ?? null, updated_by: c.me, updated_at: now,
        ...(txt(r.sim_no, 30) ? { sim_no: txt(r.sim_no, 30) } : {}) };
      let id = ex?.id as string | undefined;
      if (id) { const u = await sb.from("pos_edc_terminals").update(base).eq("id", id); if (u.error) { errors.push(`แถว ${i + 1}: ${u.error.message}`); continue; } updated++; }
      else {
        const ins = await sb.from("pos_edc_terminals").insert({ ...base, acquirer, tid, source, created_by: c.me }).select("id").single();
        if (ins.error) { errors.push(`แถว ${i + 1}: ${ins.error.message}`); continue; }
        id = ins.data.id as string; created++;
      }
      if (mids.ok.length) {
        const up = await sb.from("pos_edc_mids").upsert(mids.ok.map((x) => ({ ...x, terminal_id: id })), { onConflict: "terminal_id,service,installment_months" });
        if (up.error) errors.push(`แถว ${i + 1}: MID ${up.error.message}`); else midsUp += mids.ok.length;
      }
    }
    // เครื่องเดิม → เครื่องใหม่ (NEW TID ในไฟล์)
    for (const r of rows) {
      if (!validNo(r.replaced_by_tid) || !validNo(r.tid)) continue;
      const nu = (await sb.from("pos_edc_terminals").select("id").eq("acquirer", String(r.acquirer)).eq("tid", String(r.replaced_by_tid).trim()).maybeSingle()).data;
      if (nu) await sb.from("pos_edc_terminals").update({ replaced_by: nu.id }).eq("acquirer", String(r.acquirer)).eq("tid", String(r.tid).trim());
    }
    await sb.from("audit_logs").insert({ action: "edc_import", actor_id: c.me, ref_table: "pos_edc_terminals", after_data: { source, rows: rows.length, created, updated, mids: midsUp, errors: errors.length } });
    return reply({ created, updated, mids: midsUp, errors });
  }

  return reply({ error: "action" }, 400);
}
