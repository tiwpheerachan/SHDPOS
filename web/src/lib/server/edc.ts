// ทะเบียนเครื่อง EDC + อัตรา MDR (0080) — ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น
//   • maskNo: หน้าจอทั่วไปเห็นแค่ 4 ตัวท้าย · เลขเต็มส่งให้เฉพาะผู้มีสิทธิ์ edc.manage
//   • enrichEdcPayments: ตอนปิดบิล — ตรวจเครื่องเป็นของสาขานี้และใช้งานอยู่ → เติมธนาคาร/MID/TID + ค่าธรรมเนียมจากอัตรา MDR ที่มีผล ณ วันนี้
import type { SupabaseClient } from "@supabase/supabase-js";

export const ACQUIRERS = ["SCB", "KBANK", "UOB", "KRUNGSRI", "CARDX", "BBL", "KTB", "TTB", "OTHER"] as const;
export type AcquirerCode = (typeof ACQUIRERS)[number];
export const EDC_SERVICES = ["card", "debit", "unionpay", "alipay", "wechat", "thqr", "qr_credit", "promptpay", "installment", "other"] as const;
export type EdcServiceCode = (typeof EDC_SERVICES)[number];
export const ACQUIRER_TH: Record<string, string> = { SCB: "ไทยพาณิชย์ (SCB)", KBANK: "กสิกรไทย (KBANK)", UOB: "ยูโอบี (UOB)", KRUNGSRI: "กรุงศรี (BAY)", CARDX: "CardX (SCB)", BBL: "กรุงเทพ (BBL)", KTB: "กรุงไทย (KTB)", TTB: "ทีทีบี (TTB)", OTHER: "อื่น ๆ" };

export const maskNo = (v: string | null | undefined) => (v ? (v.length <= 4 ? v : `${"•".repeat(Math.min(6, v.length - 4))}${v.slice(-4)}`) : null);

export type EdcMidRow = { id: string; terminal_id: string; service: EdcServiceCode; installment_months: number; mid: string; tid: string | null; merchant_no: string | null; note: string | null };
export type EdcTerminalRow = {
  id: string; acquirer: AcquirerCode; branch_id: string | null; label: string | null; tid: string; status: string; replaced_by: string | null;
  shared_note: string | null; sim_no: string | null; sim_monthly_fee: number | null; note: string | null; verified: boolean; source: string | null; updated_at: string;
};

/** ค่าธรรมเนียม = ยอด × % + ค่าคงที่ (+VAT 7% บนค่าธรรมเนียมถ้าตั้งไว้) ปัด 2 ตำแหน่ง */
export function computeFee(amount: number, rate: { rate_pct: number; fixed_fee: number; vat_on_fee: boolean } | null): number {
  if (!rate || !(amount > 0)) return 0;
  const base = (amount * Number(rate.rate_pct)) / 100 + Number(rate.fixed_fee || 0);
  return Math.round((rate.vat_on_fee ? base * 1.07 : base) * 100) / 100;
}

/** วิธีชำระของ POS → บริการของเครื่อง EDC */
export function serviceForMethod(method: string, months?: number | null): { service: EdcServiceCode; months: number } | null {
  if (method === "edc" || method === "credit_card") return { service: "card", months: 0 };
  if (method === "debit_card") return { service: "debit", months: 0 };
  if (method === "installment") return { service: "installment", months: Number(months) || 0 };
  return null;
}

type Pay = Record<string, unknown> & { method: string; amount: number; installment_months?: number | null; edc_terminal_id?: string | null; card_brand?: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_TYPES = new Set(["visa", "mastercard", "jcb", "amex", "unionpay", "debit", "local"]);

/**
 * เติมข้อมูลเครื่อง EDC ให้การรับชำระก่อนบันทึกบิล
 *  - เลือกเครื่องมา → ต้องเป็นของสาขานี้ (หรือเครื่องกลาง) + สถานะใช้งาน + มี MID ของบริการ/แผนผ่อนนั้น
 *  - สาขามีเครื่องในทะเบียนแล้ว → ชำระบัตร/ผ่อนต้องเลือกเครื่อง (กันกรอกธนาคารมั่ว)
 *  - สาขายังไม่มีเครื่องในทะเบียน → ผ่านแบบเดิม (ธนาคารที่พนักงานพิมพ์) ค่าธรรมเนียม 0
 */
export async function enrichEdcPayments(sb: SupabaseClient, branchId: string, payments: Pay[], on = new Date()): Promise<Pay[]> {
  const needs = payments.filter((p) => serviceForMethod(p.method));
  if (!needs.length) return payments;
  const terms = await sb.from("pos_edc_terminals").select("id,acquirer,branch_id,tid,status").or(`branch_id.eq.${branchId},branch_id.is.null`).eq("status", "active");
  if (terms.error) throw new Error(`อ่านทะเบียนเครื่อง EDC ไม่สำเร็จ: ${terms.error.message}`);
  const branchHas = (terms.data ?? []).some((t) => t.branch_id === branchId);
  const day = on.toISOString().slice(0, 10);
  const out: Pay[] = [];
  for (const p of payments) {
    const svc = serviceForMethod(p.method, p.installment_months);
    if (!svc) { out.push(p); continue; }
    const tid = typeof p.edc_terminal_id === "string" && UUID.test(p.edc_terminal_id) ? p.edc_terminal_id : null;
    if (!tid) {
      if (branchHas) throw new Error("กรุณาเลือกเครื่อง EDC ที่ใช้รูดบัตร");
      out.push({ ...p, edc_terminal_id: null });
      continue;
    }
    const t = (terms.data ?? []).find((x) => x.id === tid);
    if (!t) throw new Error("เครื่อง EDC นี้ไม่ใช่ของสาขานี้ หรือไม่ได้อยู่ในสถานะใช้งาน");
    let m = await sb.from("pos_edc_mids").select("mid,tid").eq("terminal_id", t.id).eq("service", svc.service).eq("installment_months", svc.months).maybeSingle();
    if (m.error) throw new Error(m.error.message);
    // บัตรเดบิต: เครื่องส่วนใหญ่ใช้ MID เดียวกับบัตรเครดิต
    if (!m.data && svc.service === "debit") { m = await sb.from("pos_edc_mids").select("mid,tid").eq("terminal_id", t.id).eq("service", "card").eq("installment_months", 0).maybeSingle(); if (m.error) throw new Error(m.error.message); }
    // บัตรปกติ: ถ้าเครื่องไม่ได้ตั้ง MID แยกบริการ ให้ใช้ MID 'card' · ผ่อน: ต้องมีแผนนั้นจริง
    if (!m.data && svc.service === "installment") throw new Error(`เครื่องนี้ไม่มีแผนผ่อน ${svc.months} เดือน`);
    const midRow = m.data ?? null;
    const cardType = typeof p.card_brand === "string" && CARD_TYPES.has(p.card_brand.toLowerCase()) ? p.card_brand.toLowerCase() : null;
    const rate = await sb.rpc("pos_mdr_rate_for", { p_acquirer: t.acquirer, p_service: svc.service, p_months: svc.months, p_card_type: cardType, p_on: day });
    if (rate.error) throw new Error(rate.error.message);
    const r = Array.isArray(rate.data) ? rate.data[0] : rate.data;
    out.push({
      ...p,
      edc_terminal_id: t.id,
      acquirer_bank: t.acquirer,
      mid: midRow?.mid ?? null,
      tid: midRow?.tid ?? t.tid,
      fee_amount: computeFee(Number(p.amount), r && r.id ? r : null),
    });
  }
  return out;
}

/** ตัวช่วยตรวจรูปแบบเลข (MID/TID) — ตัวเลข/ตัวอักษร 4–32 ตัว */
export const validNo = (v: unknown) => typeof v === "string" && /^[0-9A-Za-z-]{4,32}$/.test(v.trim());
