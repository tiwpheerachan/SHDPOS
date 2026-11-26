// ราคาช่วงเวลา — ชนิดข้อมูล + สูตรคิดราคา (ต้องตรงกับ SQL pos_price_rule_value · 0081) + ป้ายภาษา
import { tr } from "@/lib/i18n/tr";

export type PriceMode = "price" | "amount" | "percent";
export type Rounding = "none" | "baht" | "down10" | "end9";
export type PriceType = "monthly" | "launch" | "clearance" | "event" | "member" | "other";
export type PriceScope = "sku" | "category" | "brand";
export type PriceRule = {
  id: string; name: string; price_type: PriceType; scope: PriceScope; brand_id: string | null; category_id: string | null; product_ids: string[];
  mode: PriceMode; value: number; rounding: Rounding; branch_ids: string[]; starts_at: string; ends_at: string;
  status: "active" | "paused" | "cancelled"; note: string | null; created_by: string | null; created_at: string; updated_by: string | null; updated_at: string; version: number;
};

/** ราคาจริงจากกฎ 1 ข้อ — สูตรเดียวกับ SQL (null = ใช้ไม่ได้ เช่นลดจนติดลบ) */
export function ruleValue(mode: PriceMode, value: number, list: number, rounding: Rounding): number | null {
  const raw = mode === "price" ? value : mode === "amount" ? list - value : list * (1 - value / 100);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (mode === "price") return Math.round(raw * 100) / 100;
  // ปัดครึ่งขึ้นแบบ SQL round()
  const half = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
  if (rounding === "baht") return half(raw);
  if (rounding === "down10") return Math.max(Math.floor(raw / 10) * 10, 1);
  if (rounding === "end9") return Math.max(Math.floor((raw + 1) / 10) * 10 - 1, 1);
  return Math.round(raw * 100) / 100;
}

export const PRICE_TYPE = (): Record<PriceType, { label: string; cls: string }> => ({
  monthly: { label: tr("ราคาประจำเดือน", "Monthly price", "月度价格"), cls: "bg-brand/12 text-brand" },
  launch: { label: tr("ราคาเปิดตัว", "Launch price", "上市价"), cls: "bg-sky-500/12 text-sky-600" },
  clearance: { label: tr("ราคาเคลียร์สต๊อก", "Clearance", "清仓价"), cls: "bg-amber-500/15 text-amber-700" },
  event: { label: tr("ราคาอีเวนต์", "Event price", "活动价"), cls: "bg-rose-500/12 text-rose-600" },
  member: { label: tr("ราคาสมาชิก", "Member price", "会员价"), cls: "bg-emerald-500/12 text-emerald-600" },
  other: { label: tr("ราคาพิเศษอื่น ๆ", "Other special price", "其他特价"), cls: "bg-surface2 text-muted" },
});
export const ROUNDING = (): Record<Rounding, string> => ({
  baht: tr("ปัดเป็นบาท (1,691.50 → 1,692)", "Round to baht (1,691.50 → 1,692)", "取整到元（1,691.50 → 1,692）"),
  down10: tr("ปัดลงหลักสิบ (1,692 → 1,690)", "Round down to 10 (1,692 → 1,690)", "向下取整到十（1,692 → 1,690）"),
  end9: tr("ลงท้ายด้วย 9 (1,692 → 1,689)", "End with 9 (1,692 → 1,689)", "尾数为9（1,692 → 1,689）"),
  none: tr("ไม่ปัด (ทศนิยม 2 ตำแหน่ง)", "No rounding (2 decimals)", "不取整（2位小数）"),
});
export function describeRule(r: Pick<PriceRule, "mode" | "value">): string {
  const n = (x: number) => x.toLocaleString("th-TH", { maximumFractionDigits: 2 });
  return r.mode === "price" ? tr(`ราคา ${n(r.value)} บาท`, `Price ${n(r.value)}`, `价格 ${n(r.value)}`)
    : r.mode === "amount" ? tr(`ลด ${n(r.value)} บาท`, `${n(r.value)} off`, `减 ${n(r.value)}`)
    : tr(`ลด ${n(r.value)}%`, `${n(r.value)}% off`, `减 ${n(r.value)}%`);
}
/** วันที่ (Asia/Bangkok) → ช่วงเวลา [00:00 วันแรก, 00:00 วันถัดจากวันสุดท้าย) */
export const bkkStart = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`).toISOString();
export const bkkEndExclusive = (ymd: string) => new Date(new Date(`${ymd}T00:00:00+07:00`).getTime() + 86400000).toISOString();
export const toBkkYmd = (iso: string, endExclusive = false) => {
  const d = new Date(new Date(iso).getTime() - (endExclusive ? 1 : 0) + 7 * 3600000);
  return d.toISOString().slice(0, 10);
};
