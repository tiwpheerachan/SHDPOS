import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { catalogAccess } from "@/lib/server/catalog-access";
import { PosError, requireSameOrigin } from "@/lib/server/pos-context";
import { gatewayRead, owConfig, GatewayError } from "@/lib/server/ow-gateway";
import { hasPerm } from "@/lib/sso/guard";
import { UUID, object } from "@/lib/server/sale-validation";
import {
  decodePage,
  decodeProduct,
  skuKey,
  matchProduct,
  readiness,
  type CatalogProduct,
  type StageItem,
} from "@/lib/catalog-sync/model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
function systemic(error: unknown) {
  return (
    error instanceof GatewayError &&
    [401, 403, 429, 500, 502, 503, 504].includes(error.status)
  );
}
function fail(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ" },
    {
      status:
        error instanceof PosError
          ? error.status
          : error instanceof GatewayError
            ? 502
            : 400,
    },
  );
}
async function catalog() {
  const sb = supabaseAdmin();
  const items: CatalogProduct[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from("products")
      .select(
        "id,sku,name_th,price,cost,kind,track_serial,brand_id,category_id,image_url,updated_at,product_barcodes(barcode)",
      )
      .order("id")
      .range(offset, offset + 999);
    if (error || !data) throw new PosError("อ่านแคตตาล็อก POS ไม่สำเร็จ", 503);
    items.push(
      ...data.map((p) => ({
        ...p,
        barcodes: p.product_barcodes.map((b: { barcode: string }) => b.barcode),
      })),
    );
    if (data.length < 1000) break;
    offset += 1000;
  }
  return items;
}
async function getRun(id: string) {
  if (!UUID.test(id)) throw new PosError("รหัสรอบซิงก์ไม่ถูกต้อง");
  const { data, error } = await supabaseAdmin()
    .from("pos_catalog_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error)
    throw new PosError("ยังไม่พร้อมอ่านรอบซิงก์ กรุณาตรวจ migration 0040", 503);
  if (!data) throw new PosError("ไม่พบรอบซิงก์", 404);
  return data;
}
async function runResponse(run: { id: string }) {
  const stats = await supabaseAdmin().rpc("pos_catalog_stats", {
    p_id: run.id,
  });
  return NextResponse.json({ run, stats: stats.error ? null : stats.data });
}
export async function GET(req: NextRequest) {
  try {
    await catalogAccess(req);
    const sb = supabaseAdmin(),
      config = owConfig();
    const id = req.nextUrl.searchParams.get("run_id");
    if (!id) {
      const [{ data: runs, error }, { data: branches }, { data: maps }] =
        await Promise.all([
          sb
            .from("pos_catalog_runs")
            .select("*")
            .eq("source", config.source)
            .order("created_at", { ascending: false })
            .limit(20),
          sb.from("branches").select("id,code,name,name_th").eq("is_active",true).order("code"),
          sb
            .from("pos_warehouse_links")
            .select("*")
            .eq("source", config.source),
        ]);
      if (error)
        throw new PosError(
          "ยังไม่ได้ติดตั้งทะเบียนซิงก์แคตตาล็อก (migration 0040)",
          503,
        );
      const warehouses = await gatewayRead("warehouses");
      return NextResponse.json({
        runs,
        branches: branches ?? [],
        mappings: maps ?? [],
        warehouses,
        environment: config.environment,
      });
    }
    const run = await getRun(id);
    const offset = Math.max(
      0,
      Math.floor(Number(req.nextUrl.searchParams.get("offset")) || 0),
    );
    const [rows, stats, products, mapping] = await Promise.all([
      sb
        .from("pos_catalog_items")
        .select("*")
        .eq("run_id", id)
        .order("sku_key")
        .range(offset, offset + 99),
      sb.rpc("pos_catalog_stats", { p_id: id }),
      catalog(),
      sb
        .from("pos_warehouse_links")
        .select("branch_id")
        .eq("source", run.source)
        .eq("warehouse_id", run.warehouse_id ?? "")
        .maybeSingle(),
    ]);
    if (rows.error || stats.error || mapping.error)
      throw new PosError("อ่านผลซิงก์ไม่สำเร็จ", 503);
    // Links are looked up only for this page, avoiding a 1,000-row truncation.
    const keys = (rows.data ?? []).map((i) => i.sku_key);
    const links = keys.length
      ? await sb
          .from("pos_catalog_links")
          .select("sku_key,product_id")
          .eq("source", run.source)
          .in("sku_key", keys)
      : { data: [], error: null };
    if (links.error) throw new PosError("อ่านการจับคู่ไม่สำเร็จ", 503);
    return NextResponse.json({
      run,
      stats: stats.data,
      offset,
      mappedBranch: mapping.data?.branch_id ?? null,
      items: (rows.data ?? []).map((i: StageItem) => {
        const match = matchProduct(
          i,
          products,
          links.data?.find((l) => l.sku_key === i.sku_key)?.product_id,
        );
        return {
          ...i,
          match,
          blockers: readiness(i, match, Boolean(mapping.data)),
        };
      }),
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(req: NextRequest) {
  let activeRun: { id: string; version: number } | null = null;
  try {
    requireSameOrigin(req);
    const ctx = await catalogAccess(req),
      body = object(await req.json()),
      sb = supabaseAdmin(),
      config = owConfig();
    if (body.action === "map") {
      if (!hasPerm(ctx.profile.email, ctx.authz, "admin.branch_manage"))
        throw new PosError("ไม่มีสิทธิ์ผูกคลังกับสาขา", 403);
      if (typeof body.warehouse_id !== "string" || !UUID.test(body.branch_id))
        throw new PosError("รหัสคลังหรือสาขาไม่ถูกต้อง");
      const warehouses = await gatewayRead("warehouses");
      if (
        !Array.isArray(warehouses) ||
        !warehouses.some(
          (w) => w.warehouse_id === body.warehouse_id && w.status === "active",
        )
      )
        throw new PosError("ไม่พบคลังที่ใช้งานอยู่");
      const {data:branchRecord,error:branchError}=await sb.from("branches").select("id").eq("id",body.branch_id).eq("is_active",true).maybeSingle();
      if(branchError || !branchRecord)throw new PosError("ไม่พบสาขาที่ใช้งานอยู่");
      const r = await sb.from("pos_warehouse_links").upsert(
        {
          source: config.source,
          warehouse_id: body.warehouse_id,
          branch_id: body.branch_id,
          updated_by: ctx.actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "source,warehouse_id" },
      );
      if (r.error) throw new PosError("บันทึกการผูกคลังไม่สำเร็จ", 409);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "create") {
      if (body.warehouse_id != null) {
        const warehouses = await gatewayRead("warehouses");
        if (
          !Array.isArray(warehouses) ||
          !warehouses.some(
            (w) =>
              w.warehouse_id === body.warehouse_id && w.status === "active",
          )
        )
          throw new PosError("ไม่พบคลังที่เลือก");
      }
      const r = await sb
        .from("pos_catalog_runs")
        .insert({
          source: config.source,
          environment: config.environment,
          created_by: ctx.actorId,
          warehouse_id: body.warehouse_id || null,
        })
        .select("*")
        .single();
      if (r.error)
        throw new PosError(
          "สร้างรอบซิงก์ไม่สำเร็จ กรุณาตรวจ migration 0040",
          503,
        );
      return runResponse(r.data);
    }
    const run = await getRun(body.run_id);
    activeRun = run;
    if (run.source !== config.source)
      throw new PosError(
        "รอบนี้เป็นคนละ environment/แหล่งข้อมูล ห้ามทำต่อด้วยการเชื่อมปัจจุบัน",
        409,
      );
    if (!Number.isInteger(body.version) || body.version !== run.version)
      throw new PosError("มีการเปลี่ยนแปลงรอบซิงก์ กรุณาโหลดล่าสุด", 409);
    let action = "",
      data: Record<string, unknown> = {};
    if (body.action === "page") {
      const params = new URLSearchParams({ limit: "200" });
      if (run.cursor) params.set("cursor", run.cursor);
      const page = decodePage(
        await gatewayRead(`products?${params}`),
        run.cursor,
      );
      action = "page";
      data = { ...page, cursor: run.cursor };
    } else if (body.action === "hydrate") {
      const { data: pending, error } = await sb
        .from("pos_catalog_items")
        .select("*")
        .eq("run_id", run.id)
        .eq("detail_status", "pending")
        .order("sku_key")
        .limit(1);
      if (error) throw new PosError("อ่านคิวเติมรายละเอียดไม่สำเร็จ", 503);
      const results = [];
      for (const item of pending ?? []) {
        const result: Record<string, unknown> = {
          sku_key: item.sku_key,
          detail: null,
          detail_status: "error",
          detail_error: null,
          stock_qty: null,
          stock_error: null,
          bom_status: "unknown",
          bom: null,
        };
        try {
          const raw = await gatewayRead(
            `products?q=${encodeURIComponent(item.sku)}`,
          );
          if (!Array.isArray(raw)) throw Error("exact lookup ต้องตอบ array");
          const products = raw.map(decodeProduct),
            detail = products.find((p) => skuKey(p.sku) === item.sku_key);
          if (!detail) {
            result.detail_status = "missing";
            result.detail_error = "ไม่พบ SKU ใน exact lookup";
          } else {
            result.detail = detail;
            result.detail_status = "ok";
            if (run.warehouse_id)
              try {
                const stock = await gatewayRead(
                  `stock?${new URLSearchParams({ warehouseId: run.warehouse_id, skus: item.sku })}`,
                );
                if (!Array.isArray(stock)) throw Error("รูปแบบสต๊อกไม่ถูกต้อง");
                const matches = stock.filter(
                  (s) =>
                    typeof s.sku === "string" &&
                    skuKey(s.sku) === item.sku_key &&
                    s.warehouseId === run.warehouse_id,
                );
                if (
                  matches.length !== 1 ||
                  typeof matches[0].qty !== "number" ||
                  !Number.isFinite(matches[0].qty)
                )
                  throw Error("ไม่พบยอดคลังที่ยืนยันได้");
                result.stock_qty = matches[0].qty;
              } catch (e) {
                if (systemic(e)) throw e;
                result.stock_error =
                  e instanceof Error ? e.message : "อ่านสต๊อกไม่สำเร็จ";
              }
            if (detail.is_combined === true)
              try {
                const bom = object(
                  await gatewayRead(
                    `products/${encodeURIComponent(detail.sku)}/components`,
                  ),
                );
                if (
                  bom.available !== true ||
                  !Array.isArray(bom.components) ||
                  !bom.components.length ||
                  bom.components.some((c: unknown) => {
                    const v = object(c);
                    return (
                      typeof v.sku !== "string" ||
                      !v.sku.trim() ||
                      typeof v.qty !== "number" ||
                      !Number.isFinite(v.qty) ||
                      v.qty <= 0
                    );
                  })
                )
                  throw Error("BOM ยังไม่ครบ");
                result.bom = bom;
                result.bom_status = "ok";
              } catch (e) {
                if (systemic(e)) throw e;
                result.bom_status = "unavailable";
                result.bom = {
                  reason: e instanceof Error ? e.message : "BOM ยังไม่พร้อม",
                };
              }
          }
        } catch (e) {
          if (systemic(e)) throw e;
          result.detail_error =
            e instanceof Error ? e.message : "อ่านรายละเอียดไม่สำเร็จ";
        }
        results.push(result);
      }
      action = "hydrate";
      data = { items: results };
    } else if (body.action === "retry") {
      if (
        body.keys != null &&
        (!Array.isArray(body.keys) ||
          body.keys.length > 100 ||
          body.keys.some((k: unknown) => typeof k !== "string"))
      )
        throw new PosError("รายการลองใหม่ไม่ถูกต้อง");
      action = "retry";
      data = body.keys ? { keys: body.keys } : {};
    } else if (body.action === "import") {
      if (
        !Array.isArray(body.keys) ||
        !body.keys.length ||
        body.keys.length > 50 ||
        body.keys.some((k: unknown) => typeof k !== "string")
      )
        throw new PosError("เลือกนำเข้าได้ครั้งละ 1–50 รายการ");
      const r = await sb.rpc("pos_catalog_import", {
        p_id: run.id,
        p_actor: ctx.actorId,
        p_version: run.version,
        p_keys: body.keys,
        p_expected: object(body.expected),
        p_update_prices: body.update_prices === true,
      });
      if (r.error)
        throw new PosError(`นำเข้าไม่สำเร็จ: ${r.error.message}`, 409);
      return runResponse(r.data);
    } else throw new PosError("ไม่รองรับคำสั่งนี้");
    const r = await sb.rpc("pos_catalog_checkpoint", {
      p_id: run.id,
      p_actor: ctx.actorId,
      p_version: run.version,
      p_action: action,
      p_data: data,
    });
    if (r.error)
      throw new PosError(`บันทึกจุดทำต่อไม่สำเร็จ: ${r.error.message}`, 409);
    return runResponse(r.data);
  } catch (error) {
    if (activeRun)
      await supabaseAdmin()
        .from("pos_catalog_runs")
        .update({
          last_error:
            error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ",
        })
        .eq("id", activeRun.id)
        .eq("version", activeRun.version);
    return fail(error);
  }
}
