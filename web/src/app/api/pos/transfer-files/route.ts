// /api/pos/transfer-files — ไฟล์แนบใบโอน (Supabase Storage แบบส่วนตัว · bucket transfer-files · 0071)
//   GET    ?id=<pos_transfer_id>            → รายการไฟล์ + signed URL (1 ชม.)
//   POST   multipart: id, stage?, file[]    → อัปโหลด (≤ 15MB/ไฟล์ · ≤ 20 ไฟล์/ครั้ง · รูป/PDF/Office/CSV)
//   DELETE ?file_id=                        → ลบ (เก็บประวัติ soft delete + ลบไฟล์จริง)
//   สิทธิ์: transfer.request + อยู่สาขาต้นทาง/ปลายทางของใบ
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { owConfig } from "@/lib/server/ow-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const BUCKET = "transfer-files";
const MAX = 15 * 1024 * 1024;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "application/pdf": "pdf", "text/csv": "csv",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });

async function guard(req: NextRequest, transferId: string) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return { err: reply({ error: "กรุณาเข้าสู่ระบบ" }, 401) };
  const authz = await resolveAuthz(profile);
  if (!authz.allowed || !hasPerm(profile.email, authz, "transfer.request")) return { err: reply({ error: "ไม่มีสิทธิ์" }, 403) };
  if (!transferId || transferId.length > 80) return { err: reply({ error: "ระบุใบโอนไม่ถูกต้อง" }, 400) };
  const tr = await supabaseAdmin().from("pos_ow_transfers").select("from_branch_id,to_branch_id,transfer_no").eq("source", owConfig().source).eq("pos_transfer_id", transferId).maybeSingle();
  if (tr.error) return { err: reply({ error: "อ่านใบโอนไม่สำเร็จ" }, 503) };
  if (!tr.data) return { err: reply({ error: "ไม่พบใบโอนในระบบกลาง" }, 404) };
  const allowed = await visibleBranchIds(authz);
  if (allowed !== null && ![tr.data.from_branch_id, tr.data.to_branch_id].some((b) => allowed.includes(b as string))) return { err: reply({ error: "ไม่มีสิทธิ์ในสาขาของใบนี้" }, 403) };
  return { actor: authz.employee_id ?? null, transfer: tr.data };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const g = await guard(req, id);
  if (g.err) return g.err;
  const sb = supabaseAdmin();
  const rows = await sb.from("pos_transfer_files").select("id,name,mime,size,path,stage,note,uploaded_by,created_at").eq("pos_transfer_id", id).is("deleted_at", null).order("created_at");
  if (rows.error) return reply({ error: "อ่านไฟล์แนบไม่สำเร็จ — ตรวจ migration 0071" }, 503);
  const list = rows.data ?? [];
  const signed = list.length ? await sb.storage.from(BUCKET).createSignedUrls(list.map((r) => r.path as string), 3600) : { data: [] as { signedUrl: string }[] };
  const ids = [...new Set(list.map((r) => r.uploaded_by).filter(Boolean))] as string[];
  const emps = ids.length ? ((await sb.from("employees").select("id,first_name,last_name,nickname").in("id", ids)).data ?? []) : [];
  const who = (eid: string | null) => { const e = emps.find((x) => x.id === eid); return e ? ([e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname) : null; };
  return reply({ files: list.map((r, i) => ({ id: r.id, name: r.name, type: r.mime, size: r.size, stage: r.stage, at: r.created_at, by: r.uploaded_by, by_name: who(r.uploaded_by as string | null), url: signed.data?.[i]?.signedUrl ?? null })) });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const form = await req.formData().catch(() => null);
  if (!form) return reply({ error: "ข้อมูลอัปโหลดไม่ถูกต้อง" }, 400);
  const id = String(form.get("id") ?? "");
  const g = await guard(req, id);
  if (g.err) return g.err;
  const stage = String(form.get("stage") ?? "").slice(0, 40) || null;
  const files = form.getAll("file").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f).slice(0, 20);
  if (!files.length) return reply({ error: "ยังไม่ได้เลือกไฟล์" }, 400);
  const sb = supabaseAdmin();
  const done: { name: string }[] = [], skipped: { name: string; reason: string }[] = [];
  for (const f of files) {
    const mime = (f.type || "").toLowerCase();
    const ext = EXT[mime];
    if (!ext) { skipped.push({ name: f.name, reason: "ชนิดไฟล์ไม่รองรับ (รูป/PDF/Word/Excel/CSV)" }); continue; }
    if (f.size > MAX) { skipped.push({ name: f.name, reason: "ใหญ่เกิน 15MB" }); continue; }
    const path = `${id}/${randomUUID()}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(path, Buffer.from(await f.arrayBuffer()), { contentType: mime, upsert: false });
    if (up.error) { skipped.push({ name: f.name, reason: `อัปโหลดไม่สำเร็จ: ${up.error.message}` }); continue; }
    const ins = await sb.from("pos_transfer_files").insert({ pos_transfer_id: id, name: f.name.slice(0, 200), mime, size: f.size, path, stage, uploaded_by: g.actor });
    if (ins.error) { await sb.storage.from(BUCKET).remove([path]); skipped.push({ name: f.name, reason: "บันทึกไม่สำเร็จ" }); continue; }
    done.push({ name: f.name });
  }
  if (done.length) await sb.from("audit_logs").insert({ action: "transfer_files_add", actor_id: g.actor, ref_table: "pos_ow_transfers", ref_no: g.transfer?.transfer_no, after_data: { files: done.map((d) => d.name) } });
  return reply({ ok: done.length > 0, uploaded: done.length, skipped }, done.length ? 200 : 400);
}

export async function DELETE(req: NextRequest) {
  if (req.headers.get("origin") && new URL(req.headers.get("origin")!).host !== req.nextUrl.host) return reply({ error: "origin" }, 403);
  const fileId = req.nextUrl.searchParams.get("file_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return reply({ error: "ระบุไฟล์ไม่ถูกต้อง" }, 400);
  const sb = supabaseAdmin();
  const row = await sb.from("pos_transfer_files").select("pos_transfer_id,path,name").eq("id", fileId).is("deleted_at", null).maybeSingle();
  if (!row.data) return reply({ error: "ไม่พบไฟล์" }, 404);
  const g = await guard(req, row.data.pos_transfer_id as string);
  if (g.err) return g.err;
  await sb.from("pos_transfer_files").update({ deleted_at: new Date().toISOString(), deleted_by: g.actor }).eq("id", fileId);
  await sb.storage.from(BUCKET).remove([row.data.path as string]);
  await sb.from("audit_logs").insert({ action: "transfer_files_remove", actor_id: g.actor, ref_table: "pos_ow_transfers", ref_no: g.transfer?.transfer_no, after_data: { file: row.data.name } });
  return reply({ ok: true });
}
