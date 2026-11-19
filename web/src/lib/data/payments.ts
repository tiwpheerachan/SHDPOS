// =====================================================================
// ทะเบียนรับชำระ EDC (Phase 1) — ผู้รับชำระ + เครื่อง/MID/TID + บริการ
//   เก็บใน kv (เลขมาสก์) · ไม่ดึง MID/TID จริงจากชีท (อ่อนไหว)
// =====================================================================
import { db, kvGet, kvSet } from "../offline/db";
import type { Acquirer, EdcTerminal, EdcService, PaymentTxn, StatementRow, StatementBatch } from "../types";

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

// ── Phase 2: รายการชำระ EDC (transaction ledger) ──────────────────
const TXN_KEY = "edc_txns_v1";
function rndKey() { return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

async function seedTxns(): Promise<PaymentTxn[]> {
  const terms = await listTerminals();
  const usable = terms.filter((t) => t.status === "installed" && t.verified && t.mid);
  if (!usable.length) return [];
  const rnd = (() => { let s = 20261119; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const out: PaymentTxn[] = [];
  for (let i = 0; i < 16; i++) {
    const t = pick(usable);
    const svc = pick(t.services.filter((s) => s !== "thaiqr") as EdcService[]) ?? "card";
    const dt = new Date(); dt.setDate(dt.getDate() - Math.floor(rnd() * 14)); dt.setHours(9 + Math.floor(rnd() * 11), Math.floor(rnd() * 60));
    const amount = Math.round((500 + rnd() * 40000) / 10) * 10;
    // ส่วนใหญ่ approved · 2 pending · 1 error · 1 voided
    let status: PaymentTxn["status"] = "approved";
    if (i === 3 || i === 9) status = "pending";
    else if (i === 6) status = "error";
    else if (i === 11) status = "voided";
    else if (i === 14) status = "declined";
    out.push({
      id: `txn-${i}`, op_key: rndKey(), at: dt.toISOString(),
      resolved_at: status === "pending" ? null : dt.toISOString(),
      order_no: `POS-${dt.toISOString().slice(2, 10).replace(/-/g, "")}-${String(1000 + i).slice(1)}`,
      terminal_id: t.id, acquirer_id: t.acquirer_id, method: svc, amount,
      installment_months: svc === "installment" ? pick(t.installment_months.length ? t.installment_months : [3, 6]) : null,
      status,
      approval_code: status === "approved" || status === "voided" ? String(100000 + Math.floor(rnd() * 899999)) : null,
      ref_no: status === "approved" || status === "voided" ? `•••• ${1000 + Math.floor(rnd() * 8999)}` : null,
      branch_id: t.branch_id, cashier_name: pick(["Nun", "Mhom", "Safe", "Apple"]),
      note: status === "error" ? "เครื่องไม่ตอบ/หมดเวลา — ต้องตรวจสลิปแล้วบันทึกผล" : status === "pending" ? "รอผลจากเครื่อง" : null,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export async function listPaymentTxns(): Promise<PaymentTxn[]> {
  const stored = await kvGet<PaymentTxn[]>(TXN_KEY, []);
  if (stored.length) return stored;
  const seed = await seedTxns();
  if (seed.length) await kvSet(TXN_KEY, seed);
  return seed;
}

/** สร้างรายการชำระ (pending) — idempotent: op_key ซ้ำ = คืนรายการเดิม ไม่สร้างซ้ำ */
export async function createPaymentTxn(input: {
  op_key?: string; order_no: string | null; terminal_id: string | null; acquirer_id: string | null;
  method: EdcService; amount: number; installment_months?: number | null; branch_id: string | null; cashier_name?: string | null;
}): Promise<{ txn: PaymentTxn; duplicate: boolean }> {
  const all = await listPaymentTxns();
  const key = input.op_key || rndKey();
  const existing = all.find((t) => t.op_key === key);
  if (existing) return { txn: existing, duplicate: true };
  const txn: PaymentTxn = {
    id: `txn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, op_key: key, at: new Date().toISOString(), resolved_at: null,
    order_no: input.order_no, terminal_id: input.terminal_id, acquirer_id: input.acquirer_id, method: input.method, amount: input.amount,
    installment_months: input.installment_months ?? null, status: "pending", approval_code: null, ref_no: null,
    branch_id: input.branch_id, cashier_name: input.cashier_name ?? null, note: null,
  };
  await kvSet(TXN_KEY, [txn, ...all]);
  return { txn, duplicate: false };
}

/** บันทึกผลรายการ (จาก pending/error เท่านั้น) — กันบันทึกซ้ำถ้า resolved แล้ว */
export async function resolvePaymentTxn(id: string, status: "approved" | "declined" | "error", patch: { approval_code?: string | null; ref_no?: string | null; note?: string | null } = {}): Promise<void> {
  const all = await listPaymentTxns();
  const i = all.findIndex((t) => t.id === id);
  if (i < 0) return;
  const cur = all[i];
  if (cur.status === "approved" || cur.status === "declined" || cur.status === "voided") return; // resolved แล้ว ห้ามทับ
  all[i] = { ...cur, status, resolved_at: new Date().toISOString(), approval_code: patch.approval_code ?? cur.approval_code, ref_no: patch.ref_no ?? cur.ref_no, note: patch.note ?? cur.note };
  await kvSet(TXN_KEY, all);
}

/** ยกเลิกรายการที่อนุมัติแล้ว (void ก่อนปิดยอด) */
export async function voidPaymentTxn(id: string, note?: string): Promise<void> {
  const all = await listPaymentTxns();
  const i = all.findIndex((t) => t.id === id);
  if (i < 0 || all[i].status !== "approved") return;
  all[i] = { ...all[i], status: "voided", resolved_at: new Date().toISOString(), note: note ?? all[i].note };
  await kvSet(TXN_KEY, all);
}

// ── Phase 5: statement ธนาคาร + จับคู่ ───────────────────────────
const STMT_ROWS = "edc_stmt_rows_v1";
const STMT_BATCH = "edc_stmt_batches_v1";
export async function listStatementRows(): Promise<StatementRow[]> { return kvGet<StatementRow[]>(STMT_ROWS, []); }
export async function listStatementBatches(): Promise<StatementBatch[]> { return kvGet<StatementBatch[]>(STMT_BATCH, []); }
export async function clearStatements(): Promise<void> { await kvSet(STMT_ROWS, []); await kvSet(STMT_BATCH, []); }

export async function importStatementRows(rows: Omit<StatementRow, "id" | "batch_id">[], meta: { name: string; acquirer_id?: string | null }): Promise<{ batch: StatementBatch; added: number }> {
  const batch: StatementBatch = { id: `stmt-${Date.now().toString(36)}`, name: meta.name, acquirer_id: meta.acquirer_id ?? null, uploaded_at: new Date().toISOString(), count: rows.length };
  const newRows: StatementRow[] = rows.map((r, i) => ({ id: `${batch.id}-${i}`, batch_id: batch.id, ...r }));
  const [curR, curB] = await Promise.all([listStatementRows(), listStatementBatches()]);
  await kvSet(STMT_ROWS, [...newRows, ...curR]);
  await kvSet(STMT_BATCH, [batch, ...curB]);
  return { batch, added: newRows.length };
}

/** parse ข้อความ CSV → แถว statement (คอลัมน์ยืดหยุ่น: date, amount, approval_code, ref_no) */
export function parseStatementCsv(text: string): Omit<StatementRow, "id" | "batch_id">[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase();
  const hasHeader = /date|amount|approval|ref|วันที่|จำนวน|อนุมัติ/.test(header);
  const body = hasHeader ? lines.slice(1) : lines;
  const idx = (() => {
    if (!hasHeader) return { date: 0, amount: 1, approval: 2, ref: 3 };
    const cols = header.split(",").map((c) => c.trim());
    const find = (keys: string[]) => cols.findIndex((c) => keys.some((k) => c.includes(k)));
    return { date: Math.max(0, find(["date", "วันที่"])), amount: Math.max(1, find(["amount", "จำนวน", "ยอด"])), approval: find(["approval", "อนุมัติ", "auth"]), ref: find(["ref", "อ้างอิง", "trace"]) };
  })();
  const out: Omit<StatementRow, "id" | "batch_id">[] = [];
  for (const line of body) {
    const c = line.split(",").map((x) => x.trim());
    const amount = parseFloat((c[idx.amount] ?? "").replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(amount)) continue;
    const rawDate = c[idx.date] ?? "";
    const at = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? new Date(rawDate).toISOString() : new Date().toISOString();
    out.push({ at, amount, approval_code: idx.approval >= 0 ? (c[idx.approval] || null) : null, ref_no: idx.ref >= 0 ? (c[idx.ref] || null) : null, acquirer_code: null, note: null });
  }
  return out;
}

/** สร้าง statement ตัวอย่างจาก ledger (จับคู่ส่วนใหญ่ + จงใจให้มีขาด/เกิน/ยอดต่าง เพื่อสาธิต) */
export async function generateSampleStatement(): Promise<{ batch: StatementBatch; added: number }> {
  const txns = (await listPaymentTxns()).filter((t) => t.status === "approved" && t.approval_code);
  const rows: Omit<StatementRow, "id" | "batch_id">[] = [];
  txns.forEach((t, i) => {
    if (i === 2) return;                                   // 1 รายการ "ขาด" ในธนาคาร (ยังไม่มา)
    const amount = i === 5 ? t.amount - 100 : t.amount;    // 1 รายการ "ยอดต่าง"
    rows.push({ at: t.at, amount, approval_code: t.approval_code ?? null, ref_no: t.ref_no ?? null, acquirer_code: null, note: null });
  });
  // 1 รายการ "เกิน" ในธนาคาร (ไม่มีใน POS)
  rows.push({ at: new Date().toISOString(), amount: 1990, approval_code: "999001", ref_no: "•••• 9999", acquirer_code: null, note: "ไม่พบใน POS" });
  return importStatementRows(rows, { name: `ตัวอย่าง-${new Date().toISOString().slice(0, 10)}.csv` });
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
