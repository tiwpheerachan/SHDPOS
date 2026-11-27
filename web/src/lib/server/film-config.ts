// โหลดค่าตั้งงานติดฟิล์มจากฐานข้อมูล → FilmConfigData (ใช้คำนวณราคา/ตัดสต๊อกฝั่งเซิร์ฟเวอร์)
import type { SupabaseClient } from "@supabase/supabase-js";
import { priceKey, type FilmConfigData } from "@/lib/film/quote";

export async function loadFilmConfig(sb: SupabaseClient): Promise<FilmConfigData & { brand_id: string | null }> {
  const [cfg, sizes, positions, areas, series, shades, prices] = await Promise.all([
    sb.from("film_config").select("*").eq("id", 1).maybeSingle(),
    sb.from("film_sizes").select("*").order("sort"),
    sb.from("film_positions").select("*").order("sort"),
    sb.from("film_size_areas").select("*"),
    sb.from("film_series").select("*").order("sort"),
    sb.from("film_shades").select("series_code,shade,model_code,stock_product_id,feet_per_unit,active,products:stock_product_id(sku,name_th)").order("shade"),
    sb.from("film_prices").select("*"),
  ]);
  const err = [cfg, sizes, positions, areas, series, shades, prices].find((r) => r.error);
  if (err?.error) throw Error(err.error.message);
  const c = cfg.data ?? {};
  const areaMap: Record<string, Record<string, number>> = {};
  for (const a of areas.data ?? []) (areaMap[a.size_code] ??= {})[a.position_code] = Number(a.sqft);
  const priceMap: Record<string, number> = {};
  for (const p of prices.data ?? []) priceMap[priceKey(p.series_code, p.size_code, p.position_code)] = Number(p.price);
  return {
    brand_id: c.brand_id ?? null,
    rules: { one_series_per_car: c.one_series_per_car ?? true, full_car_only: c.full_car_only ?? true, mixed_shades: c.mixed_shades ?? true, roll_width_ft: Number(c.roll_width_ft ?? 5), round_up_feet: c.round_up_feet ?? true },
    sizes: sizes.data ?? [], positions: positions.data ?? [], areas: areaMap, series: series.data ?? [],
    shades: (shades.data ?? []).map((s) => {
      const pr = (Array.isArray(s.products) ? s.products[0] : s.products) as { sku?: string; name_th?: string } | null | undefined;
      return { series_code: String(s.series_code), shade: Number(s.shade), model_code: String(s.model_code), stock_product_id: (s.stock_product_id as string | null) ?? null,
        sku: pr?.sku ?? null, product_name: pr?.name_th ?? null, feet_per_unit: Number(s.feet_per_unit), active: !!s.active };
    }),
    prices: priceMap,
  };
}
