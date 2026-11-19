// =====================================================================
// ทะเบียนรับชำระ EDC (Phase 1) — ผู้รับชำระ + เครื่อง/MID/TID + บริการ
//   เก็บใน kv (เลขมาสก์) · ไม่ดึง MID/TID จริงจากชีท (อ่อนไหว)
// =====================================================================
import { db, kvGet, kvSet } from "../offline/db";
import type { Acquirer, EdcTerminal } from "../types";

const DEMO_ACQUIRERS: Acquirer[] = [
  { id: "acq-scb", code: "SCB", name: "ไทยพาณิชย์ (SCB)", verified: true },
  { id: "acq-kbank", code: "KBANK", name: "กสิกรไทย (KBANK)", verified: true },
  { id: "acq-uob", code: "UOB", name: "ยูโอบี (UOB)", verified: false, note: "มีในทะเบียน · ต้องยืนยันสถานะ/สัญญาก่อนเปิดใช้" },
  { id: "acq-ksa", code: "KSA", name: "กรุงศรี (Krungsri)", verified: false, note: "มีในทะเบียน · ต้องยืนยันสถานะ/สัญญาก่อนเปิดใช้" },
  { id: "acq-cardx", code: "CARDX", name: "CardX", verified: false, note: "ต้องยืนยัน processor/entity กับ SCB" },
];

export async function listAcquirers(): Promise<Acquirer[]> {
  const stored = await kvGet<Acquirer[]>("pay_acquirers_v1", []);
  if (stored.length) return stored;
  await kvSet("pay_acquirers_v1", DEMO_ACQUIRERS);
  return DEMO_ACQUIRERS;
}
export async function upsertAcquirer(a: Acquirer): Promise<void> {
  const all = await listAcquirers();
  const i = all.findIndex((x) => x.id === a.id);
  if (i >= 0) all[i] = a; else all.push(a);
  await kvSet("pay_acquirers_v1", all);
}

const tid = (last: string) => `•••• ${last}`;
async function seedTerminals(): Promise<EdcTerminal[]> {
  const branches = (await db().branches.toArray()).filter((b) => b.branch_type !== "warehouse");
  const bid = (code: string) => branches.find((b) => b.code === code)?.id ?? branches[0]?.id ?? null;
  const T = (o: Partial<EdcTerminal> & { id: string; asset_code: string; acquirer_id: string }): EdcTerminal => ({
    mid: null, tid: null, mer_no: null, legal_entity: "บริษัท เอสเอชดี เทคโนโลยี จำกัด", shop_name: null, branch_id: null, model: "PAX A920",
    services: ["card", "thaiqr"], installment_months: [], status: "installed", verified: false, note: null, ...o,
  });
  return [
    T({ id: "edc-s1", asset_code: "EDC-0001", acquirer_id: "acq-scb", mid: tid("2187"), tid: tid("0453"), branch_id: bid("70MAI-RAMINTRA"), shop_name: "70MAI RAMINTRA", services: ["card", "unionpay", "thaiqr", "qr_credit", "installment"], installment_months: [3, 6, 10], verified: true }),
    T({ id: "edc-s2", asset_code: "EDC-0002", acquirer_id: "acq-scb", mid: tid("2187"), tid: tid("0461"), branch_id: bid("DREAME-WESTGATE"), shop_name: "DREAME WESTGATE", services: ["card", "thaiqr", "qr_credit", "alipay", "wechat"], verified: true }),
    T({ id: "edc-k1", asset_code: "EDC-0101", acquirer_id: "acq-kbank", mid: tid("5520"), tid: tid("1188"), branch_id: bid("70MAI-KANJANA"), shop_name: "70MAI KANCHANA", services: ["card", "unionpay", "thaiqr", "installment"], installment_months: [3, 6], verified: true }),
    T({ id: "edc-k2", asset_code: "EDC-0102", acquirer_id: "acq-kbank", mid: tid("5520"), tid: tid("1192"), branch_id: bid("ANKER-CTW"), shop_name: "ANKER CENTRALWORLD", services: ["card", "thaiqr", "qr_credit"], verified: true }),
    T({ id: "edc-k3", asset_code: "EDC-0103", acquirer_id: "acq-kbank", mid: null, tid: null, branch_id: bid("ANKER-RAMA9"), shop_name: null, services: ["card"], status: "spare", verified: false, note: "เครื่องสำรอง · ยังไม่ผูก MID/TID" }),
    T({ id: "edc-u1", asset_code: "EDC-0201", acquirer_id: "acq-uob", mid: tid("7731"), tid: tid("0012"), branch_id: bid("DREAME-SEACON"), shop_name: "DREAME SEACON", services: ["card", "installment"], installment_months: [4, 6, 10], status: "installed", verified: false, note: "ผู้รับชำระยังไม่ยืนยัน — ห้ามเปิด checkout อัตโนมัติ" }),
    T({ id: "edc-r1", asset_code: "EDC-0301", acquirer_id: "acq-scb", mid: tid("2187"), tid: tid("0477"), branch_id: bid("70MAI-CHONBURI"), shop_name: "70MAI CHONBURI", services: ["card", "thaiqr"], status: "repair", verified: true, note: "ส่งซ่อม 2026-11-15" }),
  ];
}

export async function listTerminals(): Promise<EdcTerminal[]> {
  const stored = await kvGet<EdcTerminal[]>("edc_terminals_v1", []);
  if (stored.length) return stored;
  const seed = await seedTerminals();
  await kvSet("edc_terminals_v1", seed);
  return seed;
}
export async function upsertTerminal(t: EdcTerminal): Promise<void> {
  const all = await listTerminals();
  const i = all.findIndex((x) => x.id === t.id);
  if (i >= 0) all[i] = t; else all.push(t);
  await kvSet("edc_terminals_v1", all);
}
export async function deleteTerminal(id: string): Promise<void> {
  const all = (await listTerminals()).filter((t) => t.id !== id);
  await kvSet("edc_terminals_v1", all);
}

export const EDC_SERVICE_LABEL: Record<string, { th: string; en: string }> = {
  card: { th: "บัตร", en: "Card" },
  unionpay: { th: "UnionPay", en: "UnionPay" },
  thaiqr: { th: "Thai QR", en: "Thai QR" },
  qr_credit: { th: "QR เครดิต", en: "QR Credit" },
  alipay: { th: "Alipay+", en: "Alipay+" },
  wechat: { th: "WeChat", en: "WeChat" },
  installment: { th: "ผ่อน 0%", en: "Installment" },
};
