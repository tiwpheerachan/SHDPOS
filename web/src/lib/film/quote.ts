// =====================================================================
// งานติดฟิล์มรถยนต์ — ตัวคำนวณกลาง (ใช้ทั้งหน้าร้านและเซิร์ฟเวอร์ ผลต้องตรงกันทุกครั้ง)
//   ขนาดรถ + รุ่นฟิล์ม + ตำแหน่ง/ความเข้ม → ราคา + บรรทัดม้วนฟิล์มที่ตัดสต๊อก
//   ความยาวที่ใช้ (ฟุต) = ตร.ฟุต ÷ ความกว้างม้วน · หน่วยสต๊อก = ฟุต ÷ feet_per_unit (ปัดขึ้นได้)
//   ราคางานแบ่งลงบรรทัดม้วนตามสัดส่วนฟุต — ทุกบรรทัด ราคา × จำนวน ลงตัวพอดี (JST รับจำนวนเต็ม)
// =====================================================================

export type FilmRules = { one_series_per_car: boolean; full_car_only: boolean; mixed_shades: boolean; roll_width_ft: number; round_up_feet: boolean };
export type FilmSize = { code: string; name_th: string; name_en: string; name_zh: string; hint_th?: string | null; sort: number };
export type FilmPosition = { code: string; name_th: string; name_en: string; name_zh: string; sort: number };
export type FilmSeries = { code: string; name: string; tagline_th?: string | null; tagline_en?: string | null; tagline_zh?: string | null; sort: number; active: boolean };
export type FilmShade = { series_code: string; shade: number; model_code: string; stock_product_id: string | null; sku?: string | null; product_name?: string | null; feet_per_unit: number; active: boolean };
export type FilmConfigData = {
  rules: FilmRules;
  sizes: FilmSize[];
  positions: FilmPosition[];
  areas: Record<string, Record<string, number>>; // size → position → ตร.ฟุต
  series: FilmSeries[];
  shades: FilmShade[];
  prices: Record<string, number>;                 // `${series}|${size}|${position|ALL}` → ราคา
};
export type FilmJob = { size: string; series: string; positions: { code: string; shade: number; series?: string }[] };
export type FilmLine = { product_id: string; sku: string; qty: number; unit_price: number; label: string };
export type FilmQuote = { price: number; label: string; feet: number; positions: { code: string; series: string; shade: number; model_code: string; feet: number }[]; lines: FilmLine[] };

export class FilmError extends Error {}
export const priceKey = (series: string, size: string, pos: string) => `${series}|${size}|${pos}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function quoteFilmJob(cfg: FilmConfigData, job: FilmJob, L: (th: string, en: string, zh: string) => string = (th) => th): FilmQuote {
  const R = cfg.rules;
  const size = cfg.sizes.find((s) => s.code === job.size);
  if (!size) throw new FilmError(L("เลือกขนาดรถก่อน", "Choose a car size first", "请先选择车型尺寸"));
  if (!job.positions?.length) throw new FilmError(L("เลือกตำแหน่งที่ติดอย่างน้อย 1 ตำแหน่ง", "Pick at least one position", "请至少选择一个位置"));
  const codes = job.positions.map((p) => p.code);
  if (new Set(codes).size !== codes.length) throw new FilmError(L("ตำแหน่งซ้ำ", "Duplicate position", "位置重复"));
  const allPos = cfg.positions.map((p) => p.code);
  const fullCar = allPos.every((c) => codes.includes(c)) && codes.length === allPos.length;
  if (R.full_car_only && !fullCar) throw new FilmError(L("ตอนนี้ขายเฉพาะติดรอบคัน", "Only full-car installs are sold right now", "目前仅销售全车安装"));

  const used = job.positions.map((p) => {
    const series = R.one_series_per_car ? job.series : p.series ?? job.series;
    const se = cfg.series.find((s) => s.code === series && s.active);
    if (!se) throw new FilmError(L("เลือกรุ่นฟิล์มก่อน", "Choose a film series", "请选择膜系列"));
    const sh = cfg.shades.find((x) => x.series_code === series && x.shade === p.shade && x.active);
    if (!sh) throw new FilmError(L(`${se.name} ไม่มีความเข้ม ${p.shade}%`, `${se.name} has no ${p.shade}% shade`, `${se.name} 无 ${p.shade}% 深度`));
    if (!sh.stock_product_id) throw new FilmError(L(`ยังไม่ได้ผูกม้วนฟิล์ม ${sh.model_code}`, `${sh.model_code} has no film roll linked`, `${sh.model_code} 未关联膜卷`));
    if (!allPos.includes(p.code)) throw new FilmError(L("ตำแหน่งไม่ถูกต้อง", "Invalid position", "位置无效"));
    const sqft = cfg.areas[job.size]?.[p.code];
    if (!sqft) throw new FilmError(L("ยังไม่ได้ตั้งพื้นที่ของตำแหน่งนี้", "Area not set for this position", "该位置未设置面积"));
    return { code: p.code, series, shade: p.shade, model_code: sh.model_code, sh, feet: sqft / (R.roll_width_ft || 5) };
  });
  if (R.one_series_per_car && new Set(used.map((u) => u.series)).size > 1) throw new FilmError(L("ต้องเป็นรุ่นฟิล์มเดียวทั้งคัน", "One film series per car", "整车需同一膜系列"));
  if (!R.mixed_shades && new Set(used.map((u) => u.shade)).size > 1) throw new FilmError(L("ต้องเป็นความเข้มเดียวทั้งคัน", "One shade per car", "整车需同一深度"));

  // ราคา: รอบคัน (รุ่นเดียว) ใช้ราคา ALL · ไม่งั้นรวมราคารายตำแหน่ง
  let price: number;
  const oneSeries = new Set(used.map((u) => u.series)).size === 1;
  const all = cfg.prices[priceKey(used[0].series, job.size, "ALL")];
  if (fullCar && oneSeries && all) price = all;
  else {
    price = 0;
    for (const u of used) {
      const p = cfg.prices[priceKey(u.series, job.size, u.code)];
      if (!p) throw new FilmError(L("ยังไม่ได้ตั้งราคาติดรายตำแหน่ง — ให้หัวหน้าตั้งที่หลังบ้าน", "Per-position prices aren't set yet — ask a manager", "尚未设置分位置价格 — 请主管设置"));
      price += p;
    }
  }
  price = r2(price);

  // ตัดสต๊อกต่อม้วน (รวมทุกตำแหน่งที่ใช้ม้วนเดียวกัน)
  const byRoll = new Map<string, { sh: FilmShade; feet: number }>();
  for (const u of used) {
    const k = u.sh.stock_product_id!;
    const cur = byRoll.get(k) ?? { sh: u.sh, feet: 0 };
    cur.feet += u.feet;
    byRoll.set(k, cur);
  }
  const rolls = [...byRoll.entries()].map(([pid, v]) => {
    const raw = v.feet / (v.sh.feet_per_unit || 1);
    const qty = R.round_up_feet ? Math.ceil(raw - 1e-9) : Math.round(raw * 1000) / 1000;
    return { pid, sh: v.sh, feet: v.feet, qty: Math.max(qty, R.round_up_feet ? 1 : 0.001) };
  }).sort((a, b) => a.sh.model_code.localeCompare(b.sh.model_code));

  // แบ่งราคาเป็นสตางค์ตามสัดส่วนฟุต (เศษให้ตัวที่เศษมากสุด) แล้วแตกบรรทัดให้ ราคา×จำนวน ลงตัว
  const totalFeet = rolls.reduce((s, r) => s + r.feet, 0);
  const satang = Math.round(price * 100);
  const shares = rolls.map((r) => (satang * r.feet) / totalFeet);
  const base = shares.map(Math.floor);
  let left = satang - base.reduce((s, n) => s + n, 0);
  shares.map((s, i) => ({ i, f: s - Math.floor(s) })).sort((a, b) => b.f - a.f).forEach(({ i }) => { if (left > 0) { base[i]++; left--; } });

  const sizeName = L(size.name_th, size.name_en, size.name_zh);
  const seriesName = cfg.series.find((s) => s.code === used[0].series)?.name ?? "";
  const posLabel = fullCar ? L("รอบคัน", "Full car", "全车") : used.map((u) => { const p = cfg.positions.find((x) => x.code === u.code)!; return L(p.name_th, p.name_en, p.name_zh); }).join(" + ");
  const label = `${L("ติดฟิล์ม", "Window film", "贴膜")} ${seriesName} · ${sizeName} · ${posLabel}`;

  const lines: FilmLine[] = [];
  rolls.forEach((r, i) => {
    const total = base[i];
    const intQty = Number.isInteger(r.qty);
    const lineLabel = `${label} · ${r.sh.model_code}`;
    if (!intQty) { lines.push({ product_id: r.pid, sku: r.sh.sku ?? "", qty: r.qty, unit_price: r2(total / 100 / r.qty), label: lineLabel }); return; }
    const u = Math.floor(total / r.qty), rem = total - u * r.qty;
    if (rem === 0) lines.push({ product_id: r.pid, sku: r.sh.sku ?? "", qty: r.qty, unit_price: u / 100, label: lineLabel });
    else {
      if (r.qty > 1) lines.push({ product_id: r.pid, sku: r.sh.sku ?? "", qty: r.qty - 1, unit_price: u / 100, label: lineLabel });
      lines.push({ product_id: r.pid, sku: r.sh.sku ?? "", qty: 1, unit_price: (u + rem) / 100, label: lineLabel });
    }
  });
  if (lines.some((l) => l.unit_price <= 0)) throw new FilmError(L("ราคางานต่ำเกินไปสำหรับจำนวนฟุต", "Job price too low for the footage", "价格相对用量过低"));

  return { price, label, feet: r2(totalFeet), positions: used.map(({ code, series, shade, model_code, feet }) => ({ code, series, shade, model_code, feet: r2(feet) })), lines };
}

/** ตรวจว่าบรรทัดที่เครื่องส่งมา ตรงกับที่คำนวณได้ทุกบรรทัด (ใช้ฝั่งเซิร์ฟเวอร์) */
export function sameFilmLines(a: { product_id: string; qty: number; unit_price: number }[], b: FilmLine[]): boolean {
  const key = (x: { product_id: string; qty: number; unit_price: number }) => `${x.product_id}|${x.qty}|${r2(x.unit_price).toFixed(2)}`;
  const A = a.map(key).sort(), B = b.map(key).sort();
  return A.length === B.length && A.every((k, i) => k === B[i]);
}
