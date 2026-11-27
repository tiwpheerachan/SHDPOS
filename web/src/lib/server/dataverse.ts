// =====================================================================
// Dataverse API (อ่านอย่างเดียว) → ยอดขายระบบเดิม Lark (หน้าร้าน + อีเวนต์) ลงตาราง legacy_sales_lines
//   env: DATAVERSE_API_BASE (ค่าเริ่มต้น https://api.dataverse.shd-technology.co.th/v1), DATAVERSE_API_KEY (ห้าม log)
//   syncLegacyRange(from,to): ดึงทุกหน้า → จับคู่ร้าน/สินค้า/แบรนด์ → upsert ตาม line_id → ลบบรรทัดในช่วงที่ต้นทางไม่มีแล้ว
//   ระบบเดิมยังใช้อยู่ → งานอัตโนมัติดึงเดือนนี้ + เดือนก่อนซ้ำทุกชั่วโมง
// =====================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

const BASE = () => (process.env.DATAVERSE_API_BASE || "https://api.dataverse.shd-technology.co.th/v1").replace(/\/$/, "");
export const dataverseReady = () => !!process.env.DATAVERSE_API_KEY;

type DvLine = {
  line_id: string; channel: string; order_no: string | null; sale_date: string; place_id: string | null; place_name: string | null;
  sku_id: string | null; jst_sku_id: string | null; sku_code: string | null; sku_name: string | null; brand_id: string | null;
  category_l1: string | null; category_l2: string | null; category_l3: string | null;
  qty: number | null; unit_price_thb: number | null; discount_thb: number | null; sales_amount_thb: number | null; vat_amount_thb: number | null;
  payment_method: string | null; status: string | null; is_sellout: boolean | null; is_demo: boolean | null;
  is_sku_unmapped: boolean | null; is_place_unmapped: boolean | null; source: string | null; updated_at: string | null;
};

/** เรียก API พร้อมลองใหม่เมื่อโดนจำกัดอัตรา (429) หรือฝั่งเขาล้ม (5xx) — log เฉพาะ request_id */
export async function dvGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<{ data: T[]; next: string | null; requestId?: string }> {
  const key = process.env.DATAVERSE_API_KEY;
  if (!key) throw Error("ยังไม่ได้ตั้งค่า DATAVERSE_API_KEY");
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${BASE()}/${path}?${qs}`, { headers: { "X-API-Key": key, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const wait = Number(r.headers.get("retry-after")) || 2 ** attempt * 2;
      await new Promise((res) => setTimeout(res, Math.min(30, wait) * 1000));
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(`Dataverse ${r.status} ${j?.error?.code ?? ""}${j?.error?.request_id ? ` (request_id ${j.error.request_id})` : ""}`.trim());
    return { data: j.data ?? [], next: j.page?.next_cursor ?? null, requestId: j.meta?.request_id };
  }
}

const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^a-z0-9ก-๙]+/g, "");
function trigrams(s: string) { const t = new Set<string>(); const x = `  ${s} `; for (let i = 0; i < x.length - 2; i++) t.add(x.slice(i, i + 3)); return t; }
function similarity(a: string, b: string) { const A = trigrams(norm(a)), B = trigrams(norm(b)); let n = 0; A.forEach((g) => { if (B.has(g)) n++; }); return A.size + B.size ? (2 * n) / (A.size + B.size) : 0; }
const tokenKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).sort().join(" ");

type Branch = { id: string; code: string; name: string; name_th: string | null; brand_id: string | null };
/** หาสาขาที่ตรงกับชื่อร้านใน Dataverse — เทียบชื่อ EN/รหัสสาขา (ตรงตัว · ลำดับคำ · ความคล้าย ≥ 0.62) */
export function matchBranch(placeName: string, branches: Branch[]): { branch_id: string; score: number } | null {
  if (!placeName) return null;
  let best: { branch_id: string; score: number } | null = null;
  for (const b of branches) {
    const cands = [b.name, b.code.replace(/-/g, " "), b.name_th ?? ""].filter(Boolean);
    for (const c of cands) {
      const sc = norm(c) === norm(placeName) || tokenKey(c) === tokenKey(placeName) ? 1 : similarity(c, placeName);
      if (!best || sc > best.score) best = { branch_id: b.id, score: sc };
    }
  }
  return best && best.score >= 0.62 ? { branch_id: best.branch_id, score: Math.round(best.score * 1000) / 1000 } : null;
}

const placeKeyOf = (l: Pick<DvLine, "place_id" | "place_name">) => l.place_id || (l.place_name ? `name:${l.place_name.trim()}` : null);

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const r = await build(i, i + 999);
    if (r.error) throw Error(r.error.message);
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
  }
  return out;
}

/** ดึง + บันทึกยอดขาย Lark ช่วง from–to (YYYY-MM-DD รวมปลาย, ไม่เกิน 366 วัน) */
export async function syncLegacyRange(sb: SupabaseClient, from: string, to: string, kind: "backfill" | "auto" | "manual", actor?: string | null) {
  const run = await sb.from("legacy_sync_runs").insert({ kind, date_from: from, date_to: to, actor: actor ?? null }).select("id").single();
  const runId = run.data?.id;
  try {
    // 1) ดึงทุกหน้า
    const lines: DvLine[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: DvLine[]; next: string | null } = await dvGet<DvLine>("commerce/offline-sales", { from, to, limit: 500, cursor: cursor ?? undefined });
      lines.push(...page.data);
      cursor = page.next;
    } while (cursor);

    // 2) ข้อมูลอ้างอิงสำหรับจับคู่
    const [branches, brands, mapRows] = await Promise.all([
      readAll<Branch>((a, b) => sb.from("branches").select("id,code,name,name_th,brand_id").range(a, b)),
      readAll<{ id: string; name: string; code: string | null }>((a, b) => sb.from("brands").select("id,name,code").range(a, b)),
      readAll<{ place_key: string; branch_id: string | null; matched_by: string }>((a, b) => sb.from("dv_place_map").select("place_key,branch_id,matched_by").range(a, b)),
    ]);
    const brandBySlug = new Map<string, string>();
    for (const b of brands) { brandBySlug.set(norm(b.name), b.id); if (b.code) brandBySlug.set(norm(b.code), b.id); }
    const skuKeys = [...new Set(lines.flatMap((l) => [l.jst_sku_id, l.sku_code]).filter((x): x is string => !!x))];
    const productBySku = new Map<string, string>();
    for (let i = 0; i < skuKeys.length; i += 300) {
      const part = skuKeys.slice(i, i + 300);
      const r = await sb.from("products").select("id,sku").in("sku", part);
      for (const p of r.data ?? []) productBySku.set(p.sku.toLowerCase(), p.id);
      // ไม่สนตัวพิมพ์: ลองตัวเล็ก
      const lower = part.map((x) => x.toLowerCase()).filter((x) => !productBySku.has(x));
      if (lower.length) { const r2 = await sb.from("products").select("id,sku").in("sku", lower); for (const p of r2.data ?? []) productBySku.set(p.sku.toLowerCase(), p.id); }
    }

    // 3) ร้าน/อีเวนต์: อัปเดตตารางจับคู่ (ไม่ทับที่แก้มือ)
    const mapped = new Map(mapRows.map((m) => [m.place_key, m]));
    const places = new Map<string, { key: string; id: string | null; name: string; channel: string; brands: Set<string>; lines: number; last: string }>();
    for (const l of lines) {
      const k = placeKeyOf(l);
      if (!k) continue;
      const p = places.get(k) ?? { key: k, id: l.place_id, name: l.place_name ?? "", channel: l.channel, brands: new Set<string>(), lines: 0, last: l.sale_date };
      p.lines++; if (l.brand_id) p.brands.add(l.brand_id); if (l.sale_date > p.last) p.last = l.sale_date;
      places.set(k, p);
    }
    const placeRows = [...places.values()].map((p) => {
      const cur = mapped.get(p.key);
      const auto = cur?.matched_by === "manual" ? null : p.channel === "event" ? null : matchBranch(p.name, branches);
      const branch_id = cur?.matched_by === "manual" ? cur.branch_id : auto?.branch_id ?? null;
      mapped.set(p.key, { place_key: p.key, branch_id, matched_by: cur?.matched_by === "manual" ? "manual" : auto ? "auto" : "none" });
      return { place_key: p.key, dv_place_id: p.id, place_name: p.name, channel: p.channel, brand_ids: [...p.brands], branch_id,
        matched_by: cur?.matched_by === "manual" ? "manual" : auto ? "auto" : "none", score: auto?.score ?? null, lines: p.lines, last_sale: p.last, updated_at: new Date().toISOString() };
    });
    for (let i = 0; i < placeRows.length; i += 500) {
      const r = await sb.from("dv_place_map").upsert(placeRows.slice(i, i + 500), { onConflict: "place_key" });
      if (r.error) throw Error(`บันทึกการจับคู่ร้านไม่สำเร็จ: ${r.error.message}`);
    }

    // 4) บรรทัดยอดขาย
    const now = new Date().toISOString();
    const rows = lines.map((l) => {
      const k = placeKeyOf(l);
      const sku = (l.jst_sku_id ?? l.sku_code ?? "").toLowerCase();
      return {
        line_id: l.line_id, source: "lark", channel: l.channel === "event" ? "event" : "store", order_no: l.order_no, sale_date: l.sale_date,
        place_key: k, place_id: l.place_id, place_name: l.place_name, branch_id: k ? mapped.get(k)?.branch_id ?? null : null,
        sku_id: l.sku_id, sku_code: l.sku_code, jst_sku_id: l.jst_sku_id, sku_name: l.sku_name,
        product_id: productBySku.get(sku) ?? (l.sku_code ? productBySku.get(l.sku_code.toLowerCase()) : undefined) ?? null,
        dv_brand_id: l.brand_id, brand_id: l.brand_id ? brandBySlug.get(norm(l.brand_id)) ?? null : null,
        category_l1: l.category_l1, category_l2: l.category_l2, category_l3: l.category_l3,
        qty: l.qty, unit_price: l.unit_price_thb, discount: l.discount_thb, amount: l.sales_amount_thb ?? 0, vat: l.vat_amount_thb,
        payment_method: l.payment_method, status: l.status, is_sellout: l.is_sellout, is_demo: l.is_demo,
        is_sku_unmapped: l.is_sku_unmapped, is_place_unmapped: l.is_place_unmapped, dv_source: l.source, dv_updated_at: l.updated_at, synced_at: now,
      };
    });
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const r = await sb.from("legacy_sales_lines").upsert(rows.slice(i, i + 500), { onConflict: "line_id" });
      if (r.error) throw Error(`บันทึกยอดขายไม่สำเร็จ: ${r.error.message}`);
      upserted += Math.min(500, rows.length - i);
    }

    // 5) ช่วงนี้ต้นทางไม่มีแล้ว (ถูกลบ/แก้ในระบบเดิม) → ลบออกให้ตรงกัน
    const seen = new Set(rows.map((r) => r.line_id));
    const existing = await readAll<{ line_id: string }>((a, b) => sb.from("legacy_sales_lines").select("line_id").eq("source", "lark").gte("sale_date", from).lte("sale_date", to).range(a, b));
    const gone = existing.map((x) => x.line_id).filter((id) => !seen.has(id));
    for (let i = 0; i < gone.length; i += 300) {
      const r = await sb.from("legacy_sales_lines").delete().in("line_id", gone.slice(i, i + 300));
      if (r.error) throw Error(r.error.message);
    }

    if (runId) await sb.from("legacy_sync_runs").update({ status: "ok", fetched: lines.length, upserted, removed: gone.length, finished_at: new Date().toISOString() }).eq("id", runId);
    return { fetched: lines.length, upserted, removed: gone.length, places: placeRows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId) await sb.from("legacy_sync_runs").update({ status: "error", error: msg.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", runId);
    throw e;
  }
}

/** ช่วงวันที่ของเดือน (YYYY-MM) แบบรวมปลาย */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** อัปเดตอัตโนมัติ: เดือนนี้ + เดือนก่อน (ระบบเดิมยังแก้ย้อนหลังได้) */
export async function syncLegacyRecent(sb: SupabaseClient, opts: { includePrev?: boolean } = {}) {
  const now = new Date(Date.now() + 7 * 3600_000);
  const cur = now.toISOString().slice(0, 7);
  const prevD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prev = prevD.toISOString().slice(0, 7);
  const out = [];
  for (const ym of opts.includePrev === false ? [cur] : [prev, cur]) { const { from, to } = monthRange(ym); out.push(await syncLegacyRange(sb, from, to, "auto")); }
  return out;
}
