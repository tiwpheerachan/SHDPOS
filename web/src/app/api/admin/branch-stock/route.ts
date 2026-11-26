// /api/admin/branch-stock — สต๊อกคงเหลือรายสาขา (สาขาไหนมี SKU/แบรนด์อะไร กี่ชิ้น)
//   GET → { branches, products, brands, categories, rows, ow_branch_ids }
//   สิทธิ์ inventory.view · ขอบเขตสาขา = visibleBranchIds · ขอบเขตแบรนด์ = visibleBrandIds
//   available = on_hand + otwo − reserved − reserved_order − quarantine (สูตรเดียวกับ pos_reserve_checkout 0039)
import { NextRequest, NextResponse } from "next/server";
import { SSO_COOKIE, readSession } from "@/lib/sso/session-cookie";
import { resolveAuthz } from "@/lib/sso/grants";
import { hasPerm } from "@/lib/sso/guard";
import { visibleBrandIds, visibleBranchIds } from "@/lib/sso/scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (d: unknown, s = 200) => NextResponse.json(d, { status: s, headers: { "Cache-Control": "no-store" } });
const PAGE = 1000; // PostgREST max rows ต่อครั้ง
const CHUNK = 150; // จำนวน id ต่อ .in() (กัน URL ยาวเกิน)
const num = (v: unknown) => Number(v ?? 0) || 0;

type Sb = ReturnType<typeof supabaseAdmin>;
interface StockRow { branch_id: string; product_id: string; qty_on_hand: number; qty_reserved: number; qty_otwo: number; qty_reserved_order: number; qty_quarantine: number }

/** อ่านทุกหน้า (range) จนหมด */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw Error(`${label}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const chunks = <T,>(a: T[], n = CHUNK) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function GET(req: NextRequest) {
  const profile = readSession(req.cookies.get(SSO_COOKIE)?.value);
  if (!profile) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  const authz = await resolveAuthz(profile);
  if (!authz.allowed) return reply({ error: "กรุณาเข้าสู่ระบบ" }, 401);
  if (!hasPerm(profile.email, authz, "inventory.view")) return reply({ error: "ไม่มีสิทธิ์ดูสต๊อก" }, 403);

  const empty = { branches: [], products: [], brands: [], categories: [], rows: [], ow_branch_ids: [] };
  const brandScope = visibleBrandIds(authz);
  if (brandScope !== null && !brandScope.length) return reply(empty);

  try {
    const sb: Sb = supabaseAdmin();
    const branchScope = await visibleBranchIds(authz);
    if (branchScope !== null && !branchScope.length) return reply(empty);

    // 1) สาขาที่เปิดใช้งาน (ในขอบเขต)
    let bq = sb.from("branches").select("id,code,name,name_th,brand_id,branch_type,province").eq("is_active", true).order("code");
    if (branchScope !== null) bq = bq.in("id", branchScope);
    const br = await bq;
    if (br.error) throw Error("อ่านสาขาไม่สำเร็จ");
    const branches = br.data ?? [];
    const branchIds = branches.map((b) => b.id as string);
    if (!branchIds.length) return reply(empty);

    // 2) stock_levels เฉพาะแถวที่มียอดใดยอดหนึ่ง ≠ 0
    const nonZero = "qty_on_hand.neq.0,qty_reserved.neq.0,qty_otwo.neq.0,qty_reserved_order.neq.0,qty_quarantine.neq.0";
    const stockParts = await Promise.all(chunks(branchIds).map((ids) => readAll<StockRow>(
      (f, t) => sb.from("stock_levels").select("branch_id,product_id,qty_on_hand,qty_reserved,qty_otwo,qty_reserved_order,qty_quarantine")
        .in("branch_id", ids).or(nonZero).order("branch_id").order("product_id").range(f, t),
      "อ่านสต๊อกไม่สำเร็จ",
    )));
    const stock = stockParts.flat();

    // 3) สินค้าที่ถูกอ้างถึง (กรองตามขอบเขตแบรนด์)
    const productIds = [...new Set(stock.map((s) => s.product_id))];
    const brandOk = brandScope === null ? null : new Set(brandScope);
    const prodParts = await Promise.all(chunks(productIds).map(async (ids) => {
      const { data, error } = await sb.from("products").select("id,sku,name_th,brand_id,category_id,price,is_active,track_serial,image_url").in("id", ids);
      if (error) throw Error("อ่านสินค้าไม่สำเร็จ");
      return data ?? [];
    }));
    const products = prodParts.flat()
      .filter((p) => brandOk === null || brandOk.has(p.brand_id as string))
      .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
    const prodSet = new Set(products.map((p) => p.id as string));

    // 4) นับ serial ที่อยู่ในสาขา (in_stock / reserved) เฉพาะสินค้า track_serial
    const serialProducts = products.filter((p) => p.track_serial).map((p) => p.id as string);
    const serialCount = new Map<string, number>();
    if (serialProducts.length) {
      const parts = await Promise.all(chunks(serialProducts).flatMap((pids) => chunks(branchIds, 60).map((bids) => readAll<{ branch_id: string; product_id: string }>(
        (f, t) => sb.from("serials").select("id,branch_id,product_id").in("product_id", pids).in("branch_id", bids).in("status", ["in_stock", "reserved"]).order("id").range(f, t),
        "อ่าน Serial ไม่สำเร็จ",
      ))));
      for (const s of parts.flat()) {
        const k = `${s.branch_id}|${s.product_id}`;
        serialCount.set(k, (serialCount.get(k) ?? 0) + 1);
      }
    }

    // 5) แบรนด์ / หมวด / ลิงก์คลัง OneWarehouse
    const [brandsRes, catsRes, owRes] = await Promise.all([
      sb.from("brands").select("id,name").order("name"),
      sb.from("categories").select("id,name_th").order("name_th"),
      sb.from("pos_warehouse_links").select("branch_id,warehouse_id,source").in("branch_id", branchIds),
    ]);
    const usedBrands = new Set(products.map((p) => p.brand_id as string));
    const usedCats = new Set(products.map((p) => p.category_id as string));
    const brands = (brandsRes.data ?? []).filter((b) => usedBrands.has(b.id) && (brandOk === null || brandOk.has(b.id)));
    const categories = (catsRes.data ?? []).filter((c) => usedCats.has(c.id)).map((c) => ({ id: c.id, name: c.name_th }));
    const ow_branch_ids = [...new Set((owRes.data ?? []).map((w) => w.branch_id as string))]; // ไม่มีตาราง (ยังไม่รัน 0040) → []

    const rows = stock.filter((s) => prodSet.has(s.product_id)).map((s) => {
      const on_hand = num(s.qty_on_hand), reserved = num(s.qty_reserved) + num(s.qty_reserved_order), quarantine = num(s.qty_quarantine);
      return {
        branch_id: s.branch_id, product_id: s.product_id, on_hand,
        available: on_hand + num(s.qty_otwo) - num(s.qty_reserved) - num(s.qty_reserved_order) - quarantine,
        reserved, quarantine, serials: serialCount.get(`${s.branch_id}|${s.product_id}`) ?? 0,
      };
    });

    return reply({ branches, products, brands, categories, rows, ow_branch_ids });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "ผิดพลาด" }, 503);
  }
}
