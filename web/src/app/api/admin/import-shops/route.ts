import { NextRequest, NextResponse } from "next/server";
import { requireEmployeeAdmin } from "@/lib/sso/guard";
import { searchDirectory } from "@/lib/sso/central";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// นำเข้าบัญชี "[Brand Shop] <แบรนด์> - <ห้าง>" จาก directory (Lark/SSO) → ผูกเข้าสาขาเป็นพนักงานหน้าร้าน (PC)
//   POST body: { dryRun?: boolean }  · dryRun=true = ดูผลจับคู่โดยไม่เขียน
const norm = (s: string) => (s || "").toLowerCase().replace(/[\s._\-\[\]()]+/g, "").replace(/centralworld/g, "centralwld");
// แก้สะกดที่ต่างกันบ่อย (directory vs สาขาเรา)
const fixes: [RegExp, string][] = [
  [/nothville/g, "northville"], [/ngarmwongwan/g, "ngamwongwan"],
  [/ramindra/g, "ramintra"], [/ratchaphreuk/g, "ratchaphruek"], [/thapra/g, "thaphra"],
];
const canon = (s: string) => { let x = norm(s); for (const [re, to] of fixes) x = x.replace(re, to); return x; };

/** ดึง "ชื่อห้าง/สถานที่" จากชื่อบัญชี: "[Brand Shop] Anker - Central Chiang Mai" → "Central Chiang Mai" */
function locationOf(accountName: string, brandName: string): string {
  let s = accountName.replace(/\[brand shop\]/i, "").trim();
  // ตัดแบรนด์ออก (รองรับ "- Anker -" / "Anker -")
  s = s.replace(new RegExp(`^[-\\s]*${brandName}[-\\s]*`, "i"), "").replace(/^[-\s]+/, "").trim();
  return s;
}

export async function POST(req: NextRequest) {
  const ctx = await requireEmployeeAdmin(req);
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = body.dryRun !== false; // default = ดูก่อน (ปลอดภัย)
  const sb = supabaseAdmin();

  const [{ data: branches }, { data: brands }] = await Promise.all([
    sb.from("branches").select("id,name,name_th,brand_id"),
    sb.from("brands").select("id,name"),
  ]);
  const brandList = (brands ?? []) as { id: string; name: string }[];
  const branchList = (branches ?? []) as { id: string; name: string; name_th: string | null; brand_id: string | null }[];

  type ShopAcc = { name: string; email: string | null; union_id: string; brandId: string; location: string };
  const shops: ShopAcc[] = [];
  const seen = new Set<string>();
  // ค้นหาบัญชีหน้าร้านต่อแบรนด์
  for (const br of brandList) {
    let items: Awaited<ReturnType<typeof searchDirectory>> = [];
    try { items = await searchDirectory(br.name, 50); } catch { items = []; }
    for (const p of items) {
      const isShop = (p.departments ?? []).some((d) => /brand\s*shop/i.test(d)) || /\[brand shop\]/i.test(p.name);
      if (!isShop || !p.union_id || seen.has(p.union_id)) continue;
      seen.add(p.union_id);
      shops.push({ name: p.name, email: p.email ?? null, union_id: p.union_id, brandId: br.id, location: locationOf(p.name, br.name) });
    }
  }

  // จับคู่สาขา (แบรนด์ตรง + ชื่อห้างตรง/ครอบ)
  const assigned: { shop: string; branch: string; email: string | null }[] = [];
  const unmatched: { shop: string; reason: string }[] = [];
  const toWrite: { shop: ShopAcc; branchId: string; branchName: string }[] = [];
  for (const s of shops) {
    const loc = canon(s.location);
    const cand = branchList.filter((b) => b.brand_id === s.brandId);
    const hit = cand.find((b) => { const bn = canon(b.name); return bn.includes(loc) || loc.includes(canon(b.name.replace(/^[^\s]+\s/, ""))); });
    if (hit) { assigned.push({ shop: s.name, branch: hit.name, email: s.email }); toWrite.push({ shop: s, branchId: hit.id, branchName: hit.name }); }
    else unmatched.push({ shop: s.name, reason: `ไม่พบสาขา "${s.location}" ของแบรนด์นี้` });
  }

  let created = 0, updated = 0;
  if (!dryRun) {
    for (const w of toWrite) {
      const { shop, branchId } = w;
      // หาคนเดิม (union_id/email)
      let empId: string | null = null;
      const { data: byU } = await sb.from("employees").select("id").eq("union_id", shop.union_id).maybeSingle();
      empId = byU?.id ?? null;
      if (!empId && shop.email) { const { data } = await sb.from("employees").select("id").ilike("email", shop.email).maybeSingle(); empId = data?.id ?? null; }
      const common = { union_id: shop.union_id, job_title: "PC", central_department: "Brand Shop", home_branch_id: branchId, sso_synced_at: new Date().toISOString() };
      if (empId) { await sb.from("employees").update(common).eq("id", empId); updated++; }
      else {
        const { error } = await sb.from("employees").insert({
          employee_code: shop.email || shop.union_id, first_name: shop.name, nickname: shop.name, email: shop.email,
          role: "staff", data_scope: "own", status: "active", app_access: false, ...common,
        });
        if (!error) created++;
      }
    }
  }

  return NextResponse.json({
    ok: true, dryRun, shopsFound: shops.length,
    willAssign: assigned.length, unmatchedCount: unmatched.length,
    created, updated, assigned, unmatched,
  });
}
