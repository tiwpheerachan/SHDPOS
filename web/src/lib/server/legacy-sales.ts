// =====================================================================
// ยอดขายระบบเดิม (Lark) → บิลแบบเดียวกับ POS ให้หน้ายอดขายวิเคราะห์รวมได้ (source: "lark")
//   รวมบรรทัดเป็นบิลตาม ร้าน + วัน + เลขบิล · คืนสินค้า = บิลยกเลิก (ไม่นับยอด) · บรรทัดว่างไม่มี SKU/ยอด = ข้าม
//   ร้านที่ยังไม่จับคู่/อีเวนต์ → "สาขา" สมมุติ id = lark:<place_key> ชื่อตามระบบเดิม
//   สาขาที่ตั้งวันเริ่มใช้ POS แล้ว → ตั้งแต่วันนั้นไม่นับยอด Lark (กันซ้ำ)
// =====================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

type Line = {
  line_id: string; channel: string; order_no: string | null; sale_date: string; place_key: string | null; place_name: string | null; branch_id: string | null;
  sku_code: string | null; jst_sku_id: string | null; sku_name: string | null; product_id: string | null; brand_id: string | null;
  qty: number | null; unit_price: number | null; discount: number | null; amount: number | null; vat: number | null; payment_method: string | null; status: string | null;
};

const PAY: [RegExp, string][] = [[/บัตรเครดิต|credit|信用卡/i, "credit_card"], [/เดบิต|debit/i, "debit_card"], [/qr|扫码|พร้อมเพย์|promptpay/i, "qr_promptpay"], [/โอน|转账|transfer/i, "bank_transfer"], [/เงินสด|cash|现金/i, "cash"], [/ผ่อน|installment|分期/i, "installment"]];
const payMethod = (s: string | null) => { if (!s) return "other"; for (const [re, m] of PAY) if (re.test(s)) return m; return "other"; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** ระบบเดิมบันทึกยอดอีเวนต์เป็นตัวเลขติดลบ (ตัดของออก) และติดสถานะ "returned" — ตั้งแต่ ต.ค. 2025 ติดลบทุกบรรทัด
 *  → อีเวนต์: ใช้ค่าสัมบูรณ์ + ถือเป็นยอดขาย · หน้าร้าน: ใช้ตามต้นทาง (ไม่มี returned) */
export function normalizeLegacyLine<T extends { channel: string; qty: number | null; amount: number | null; discount: number | null; vat: number | null; status: string | null }>(l: T): T {
  if (l.channel !== "event") return l;
  const a = (n: number | null) => (n == null ? n : Math.abs(Number(n)));
  return { ...l, qty: a(l.qty), amount: a(l.amount), discount: a(l.discount), vat: a(l.vat), status: l.status === "returned" ? "normal" : l.status };
}

export async function legacyOrders(sb: SupabaseClient, fromIso: string, toIso: string, allowedBranches: string[] | null, opts: { max?: number } = {}) {
  const bkk = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const from = bkk(fromIso), to = bkk(toIso);
  const max = opts.max ?? 60000;
  const lines: Line[] = [];
  let truncated = false;
  for (let i = 0; ; i += 1000) {
    let q = sb.from("legacy_sales_lines")
      .select("line_id,channel,order_no,sale_date,place_key,place_name,branch_id,sku_code,jst_sku_id,sku_name,product_id,brand_id,qty,unit_price,discount,amount,vat,payment_method,status")
      .gte("sale_date", from).lte("sale_date", to).order("sale_date", { ascending: false }).order("line_id").range(i, i + 999);
    if (allowedBranches !== null) q = q.in("branch_id", allowedBranches.length ? allowedBranches : ["00000000-0000-0000-0000-000000000000"]);
    const r = await q;
    if (r.error) throw Error(`อ่านยอดขายระบบเดิมไม่สำเร็จ: ${r.error.message}`);
    lines.push(...((r.data ?? []) as Line[]).map(normalizeLegacyLine));
    if ((r.data ?? []).length < 1000) break;
    if (lines.length >= max) { truncated = true; break; }
  }

  // วันเริ่มใช้ POS รายสาขา
  const ids = [...new Set(lines.map((l) => l.branch_id).filter((x): x is string => !!x))];
  const goLive = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await sb.from("branches").select("id,pos_go_live_date").in("id", ids.slice(i, i + 200)).not("pos_go_live_date", "is", null);
    for (const b of r.data ?? []) goLive.set(b.id, b.pos_go_live_date as string);
  }

  const groups = new Map<string, Line[]>();
  let skipped = 0, overlapped = 0;
  for (const l of lines) {
    if (!Number(l.amount) && !l.sku_code && !l.jst_sku_id) { skipped++; continue; } // บรรทัดว่างในระบบเดิม
    const gl = l.branch_id ? goLive.get(l.branch_id) : undefined;
    if (gl && l.sale_date >= gl) { overlapped++; continue; }
    const k = `${l.place_key ?? "?"}|${l.sale_date}|${l.order_no ?? l.line_id}|${l.status === "returned" ? "R" : "N"}`;
    const g = groups.get(k); if (g) g.push(l); else groups.set(k, [l]);
  }

  const pseudo = new Map<string, { id: string; code: string; name: string; name_th: string; brand_id: null; province: null; branch_type: string; is_active: true; source: "lark" }>();
  const orders = [...groups.entries()].map(([k, ls]) => {
    const f = ls[0];
    const branchId = f.branch_id ?? `lark:${f.place_key ?? "unknown"}`;
    if (!f.branch_id && !pseudo.has(branchId)) {
      const nm = f.place_name || (f.channel === "event" ? "อีเวนต์ (ระบบเดิม)" : "ร้านที่ยังไม่จับคู่");
      pseudo.set(branchId, { id: branchId, code: f.channel === "event" ? "EVENT" : "LARK", name: nm, name_th: nm, brand_id: null, province: null, branch_type: f.channel === "event" ? "popup" : "brand_shop", is_active: true, source: "lark" });
    }
    const returned = f.status === "returned";
    const gross = r2(ls.reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.discount) || 0), 0));
    const disc = r2(ls.reduce((s, l) => s + (Number(l.discount) || 0), 0));
    const total = r2(ls.reduce((s, l) => s + (Number(l.amount) || 0), 0));
    const vat = r2(ls.some((l) => l.vat != null) ? ls.reduce((s, l) => s + (Number(l.vat) || 0), 0) : total * 7 / 107);
    const pays = new Map<string, number>();
    ls.forEach((l) => { const m = payMethod(l.payment_method); pays.set(m, r2((pays.get(m) ?? 0) + (Number(l.amount) || 0))); });
    const id = `lark:${k}`;
    return {
      id, client_uuid: id, order_no: f.order_no ?? f.line_id.replace(/^.*:/, ""), branch_id: branchId, terminal_id: null, shift_id: null,
      cashier_id: null, salesperson_id: null, customer_id: null, customer_name: null, customer_phone: null,
      status: returned ? "voided" : "completed", channel: f.channel === "event" ? "event" : "offline",
      subtotal: gross, discount_total: disc, vat_amount: vat, grand_total: total, paid_total: total, change_amount: 0, cost_total: 0, gross_profit: 0,
      created_at: `${f.sale_date}T05:00:00.000Z`, // ระบบเดิมไม่มีเวลา → เที่ยงวันเวลาไทย
      void_reason: returned ? "คืนสินค้า (ระบบเดิม Lark)" : null, is_offline_origin: false, synced: true, source: "lark" as const,
      items: ls.map((l) => ({
        id: l.line_id, product_id: l.product_id, sku: l.jst_sku_id ?? l.sku_code ?? "", name: l.sku_name ?? l.sku_code ?? l.jst_sku_id ?? "—", kind: "goods",
        qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || r2((Number(l.amount) || 0) / (Number(l.qty) || 1)), discount_amount: Number(l.discount) || 0,
        line_total: Number(l.amount) || 0, unit_cost: 0, cost_total: 0, gross_profit: 0, serials: [], salesperson_id: null, returned_qty: returned ? Number(l.qty) || 1 : 0,
        is_gift: false, brand_id: l.brand_id,
      })),
      payments: [...pays.entries()].filter(([, a]) => a > 0).map(([method, amount]) => ({ method, amount })),
    };
  });
  return { orders, pseudoBranches: [...pseudo.values()], truncated, skipped, overlapped, lines: lines.length };
}
