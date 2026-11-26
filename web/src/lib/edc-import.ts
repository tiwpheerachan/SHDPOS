// อ่านไฟล์ทะเบียน MID/TID ของธนาคาร (.xlsx) → แถวพร้อมนำเข้าทะเบียน EDC (0080)
//   อ่านอย่างเดียว ไม่แก้ไฟล์ต้นฉบับ · ทำงานได้ทั้งเบราว์เซอร์และ Node (ใช้ fflate + แยก XML เอง)
//   รองรับรูปแบบที่พบในไฟล์จริง: ชีทแยกตามธนาคาร (SCB/KBANK/UOB/krungsri/card x scb) · คอลัมน์ A = สาขา (ว่าง = ต่อจากแถวบน)
//   หัวคอลัมน์: TID · NEW TID · MID · MID UNIONPAY · MID QR CREDIT · MID TH QR · MID ALIPAY · MID WECHAT · TID / 0% Nmonth · MID / 0% Nmonth
import { unzipSync, strFromU8 } from "fflate";
import { tr } from "@/lib/i18n/tr";

export type ImportMid = { service: string; installment_months: number; mid: string; tid?: string | null; merchant_no?: string | null };
export type ImportRow = { sheet: string; row: number; acquirer: string; label: string; tid: string; status: "active" | "no_txn" | "retired"; note: string | null; mids: ImportMid[]; sim_no?: string | null; replaced_by_tid?: string | null; branch_id?: string | null };
export type ImportResult = { rows: ImportRow[]; warnings: string[]; sheets: { name: string; acquirer: string | null; rows: number; skipped: string | null }[] };

const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const textOf = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join("");
const colIdx = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** xlsx → { ชื่อชีท: ตาราง string[][] } (ค่าตัวเลขคงรูปข้อความดิบจากไฟล์) */
export function readXlsx(bytes: Uint8Array): { name: string; grid: string[][] }[] {
  const z = unzipSync(bytes);
  const get = (p: string) => (z[p] ? strFromU8(z[p]) : "");
  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rels = Object.fromEntries([...get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = [...get("xl/workbook.xml").matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  return sheets.map(([, name, rid]) => {
    const target = rels[rid] ?? "";
    const path = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`;
    const grid: string[][] = [];
    for (const rm of get(path).matchAll(/<row[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells: string[] = [];
      for (const cm of (rm[1] ?? "").matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], body = cm[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]; if (!ref) continue;
        const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const val = t === "s" && v != null ? shared[+v] ?? "" : t === "inlineStr" ? textOf(body) : v != null ? unesc(v) : "";
        cells[colIdx(ref)] = val.trim();
      }
      grid.push(Array.from(cells, (x) => x ?? ""));
    }
    return { name: unesc(name), grid };
  });
}

/** เลขจากเซลล์ → ข้อความตัวเลข · ตัวเลขแบบ 6.58E7 แปลงคืน (เตือนถ้าเกิน 15 หลัก = เสี่ยงคลาดเคลื่อน) */
export function cleanNo(raw: string, warn?: (m: string) => void): string | null {
  const s = raw.replace(/[\s,]/g, "");
  if (!s) return null;
  if (/^[0-9]+(\.[0-9]+)?E[+-]?[0-9]+$/i.test(s) || /^[0-9]+\.0+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    const digits = BigInt(Math.round(n)).toString();
    if (digits.length > 15) warn?.(tr(`เลข ${digits.slice(0, 2)}…${digits.slice(-3)} ยาว ${digits.length} หลัก ถูกเก็บเป็นตัวเลขในไฟล์ อาจคลาดเคลื่อน — ตรวจกับเอกสารธนาคาร`, `Number ${digits.slice(0, 2)}…${digits.slice(-3)} has ${digits.length} digits and was stored as a number in the file — may be inaccurate, check against bank documents`, `号码 ${digits.slice(0, 2)}…${digits.slice(-3)} 共 ${digits.length} 位，文件中以数字存储，可能有误 — 请与银行文件核对`));
    return digits;
  }
  return /^[0-9A-Za-z-]{4,32}$/.test(s) ? s : null;
}

const SHEET_ACQ: [RegExp, string][] = [[/card\s*x/i, "CARDX"], [/kbank|kasikorn|กสิกร/i, "KBANK"], [/uob/i, "UOB"], [/krungsri|bay|กรุงศรี/i, "KRUNGSRI"], [/scb|ไทยพาณิชย์/i, "SCB"], [/bbl|bangkok bank/i, "BBL"], [/ktb|กรุงไทย/i, "KTB"], [/ttb/i, "TTB"]];

type ColRole = { kind: "tid" } | { kind: "new_tid" } | { kind: "mid"; service: string; months: number } | { kind: "plan_tid"; service: string; months: number } | { kind: "label" } | { kind: "mer_no" };
function roleOf(h: string): ColRole | null {
  const x = h.toUpperCase().replace(/\s+/g, " ").trim();
  if (!x) return null;
  const mon = /0%\s*(\d+)\s*MONTH/.exec(x);
  if (mon) return x.startsWith("MID") ? { kind: "mid", service: "installment", months: +mon[1] } : { kind: "plan_tid", service: "installment", months: +mon[1] };
  if (x === "TID UNIONPAY") return { kind: "plan_tid", service: "unionpay", months: 0 };
  if (x === "TID") return { kind: "tid" };
  if (x === "NEW TID") return { kind: "new_tid" };
  if (x === "MER_NO") return { kind: "mer_no" };
  if (x === "EN_NAME_ON_B2K") return { kind: "label" };
  if (!x.startsWith("MID")) return null;
  if (/UNIONPAY/.test(x)) return { kind: "mid", service: "unionpay", months: 0 };
  if (/QR CREDIT/.test(x)) return { kind: "mid", service: "qr_credit", months: 0 };
  if (/TH QR/.test(x)) return { kind: "mid", service: "thqr", months: 0 };
  if (/PROMPTPAY/.test(x)) return { kind: "mid", service: "promptpay", months: 0 };
  if (/ALIPAY/.test(x)) return { kind: "mid", service: "alipay", months: 0 };
  if (/WECHAT/.test(x)) return { kind: "mid", service: "wechat", months: 0 };
  if (x === "MID") return { kind: "mid", service: "card", months: 0 };
  return null;
}

/** ตาราง → แถวเครื่อง EDC (หนึ่ง TID = หนึ่งเครื่อง) */
export function parseEdcWorkbook(sheets: { name: string; grid: string[][] }[]): ImportResult {
  const rows: ImportRow[] = [], warnings: string[] = [], summary: ImportResult["sheets"] = [];
  for (const { name, grid } of sheets) {
    const acquirer = SHEET_ACQ.find(([re]) => re.test(name))?.[1] ?? null;
    const hi = grid.findIndex((r) => r.some((c) => /^TID$/i.test(c.trim())));
    if (!acquirer || hi < 0) { summary.push({ name, acquirer, rows: 0, skipped: !acquirer ? tr("ไม่รู้ว่าเป็นธนาคารไหน", "Unknown bank", "无法识别银行") : tr("ไม่พบหัวคอลัมน์ TID", "TID column header not found", "未找到 TID 列标题") }); continue; }
    const header = grid[hi];
    const roles = header.map(roleOf);
    const isCardX = acquirer === "CARDX";
    const lastRoleCol = roles.reduce((a, r, i) => (r ? i : a), 0);
    let label = "";
    let count = 0;
    const cardMidOf = new Map<string, string>(); // MID บัตรปกติล่าสุดของสาขา (แถวต่อเนื่องใช้ร่วม)
    for (let ri = hi + 1; ri < grid.length; ri++) {
      const r = grid[ri];
      if (!r.some((c) => c)) continue;
      const w = (m: string) => warnings.push(`${name} ${tr("แถว", "row", "行")} ${ri + 1}: ${m}`);
      if (!isCardX && r[0]) label = r[0];
      // ข้อความหมายเหตุในช่องที่ไม่ใช่หัวคอลัมน์ที่รู้จัก (ภายในช่วงตาราง) เช่น "ไม่มียอดชำระ", "ตัวเดียวกัน"
      const notes = r.map((c, i) => (i > 0 && i <= lastRoleCol && !roles[i] && c && !/^[0-9.E+-]+$/i.test(c) ? c : "")).filter(Boolean);
      // เบอร์ซิมของเครื่อง (ช่องไม่มีหัว ตัวเลข 10 หลักขึ้นต้น 0)
      let sim: string | null = null;
      r.forEach((c, i) => { if (i > 0 && !roles[i] && !sim) { const m = /(^|\D)(0\d{9})(\D|$)/.exec(c.replace(/[\s-]/g, " ")); if (m) sim = m[2]; } });
      const tids: string[] = [], newTids: string[] = [];
      const mids: ImportMid[] = [];
      let merNo: string | null = null, cardLabel = "";
      roles.forEach((role, i) => {
        const v = r[i] ?? "";
        if (!role || !v) return;
        if (role.kind === "label") { cardLabel = v; return; }
        if (role.kind === "mer_no") { merNo = cleanNo(v, w); return; }
        // ช่องเดียวอาจมีหลายค่า: "TID xxx / MID yyy" · ขึ้นบรรทัดใหม่ · "xxx/yyy" (2 TID)
        const parts = v.split(/[\/|\n]+/).map((p) => p.trim()).filter(Boolean);
        const labeled = parts.map((p) => ({ isTid: /^TID/i.test(p), no: cleanNo(p.replace(/^(TID|MID)\s*:?\s*/i, ""), w) }));
        if (labeled.every((x) => !x.no)) { if (v.length > 2) notes.push(v); return; }
        if (role.kind === "tid" || role.kind === "new_tid") { for (const x of labeled) if (x.no) (role.kind === "tid" ? tids : newTids).push(x.no); return; }
        const tidPart = labeled.find((x) => x.isTid && x.no)?.no ?? null;
        const midPart = labeled.find((x) => !x.isTid && x.no)?.no ?? null;
        const ex = mids.find((m) => m.service === role.service && m.installment_months === role.months);
        const target = ex ?? (() => { const n: ImportMid = { service: role.service, installment_months: role.months, mid: "" }; mids.push(n); return n; })();
        if (role.kind === "mid") { if (midPart) target.mid = midPart; if (tidPart) target.tid = tidPart; }
        else {
          // คอลัมน์ "TID / 0% N เดือน" บางเซลล์ใส่เลขยาวแบบ MID (TID จริงยาว 8 หลัก) → เก็บเป็น MID ของแผน
          const t = tidPart ?? midPart;
          if (t && !tidPart && t.length > 10) target.mid = t; else if (t) target.tid = t;
        }
      });
      if (!tids.length && !newTids.length) { if (mids.length) w(tr("มี MID แต่ไม่มี TID — ข้าม", "Has MID but no TID — skipped", "有 MID 但无 TID — 已跳过")); continue; }
      const key = isCardX ? cardLabel : label;
      const own = mids.find((m) => m.service === "card")?.mid;
      if (own) cardMidOf.set(key, own);
      const card = own ?? cardMidOf.get(key);
      // แผน/บริการที่มีแต่ TID (ไม่มี MID แยก) → ใช้ MID บัตรปกติของเครื่อง
      for (const m of mids) if (!m.mid) { if (card) m.mid = card; else w(`${m.service}${m.installment_months ? ` ${m.installment_months} ${tr("เดือน", "months", "个月")}` : ""} ${tr("มีแต่ TID ไม่มี MID — ข้ามบริการนี้", "has TID but no MID — service skipped", "只有 TID 没有 MID — 已跳过此服务")}`); }
      if (merNo) for (const m of mids) m.merchant_no = merNo;
      const good = mids.filter((m) => m.mid);
      const status = notes.some((n) => /ไม่มียอด/.test(n)) ? "no_txn" : "active";
      // TID เดิม + NEW TID ในแถวเดียว = เปลี่ยนเครื่อง → เครื่องเดิมเลิกใช้ (ชี้ไปเครื่องใหม่) · หลาย TID ในช่อง TID = หลายเครื่องสาขาเดียวกัน
      const note = notes.length ? notes.join(" · ").slice(0, 300) : null;
      const lbl = key || "(ไม่ระบุ)";
      const replacement = newTids[0] ?? null;
      for (const tid of [...new Set(tids)]) {
        const retired = !!replacement && !newTids.includes(tid);
        rows.push({ sheet: name, row: ri + 1, acquirer, label: lbl, tid, status: retired ? "retired" : status, note, mids: good.map((m) => ({ ...m })), sim_no: retired ? null : sim, replaced_by_tid: retired ? replacement : null });
        count++;
      }
      for (const tid of [...new Set(newTids)]) {
        if (tids.includes(tid)) continue;
        rows.push({ sheet: name, row: ri + 1, acquirer, label: lbl, tid, status, note, mids: good.map((m) => ({ ...m })), sim_no: sim, replaced_by_tid: null });
        count++;
      }
    }
    summary.push({ name, acquirer, rows: count, skipped: null });
  }
  // TID ซ้ำในไฟล์ (ธนาคารเดียวกัน) → รวม MID
  const merged = new Map<string, ImportRow>();
  for (const r of rows) {
    const k = `${r.acquirer}:${r.tid}`;
    const ex = merged.get(k);
    if (!ex) { merged.set(k, r); continue; }
    for (const m of r.mids) if (!ex.mids.some((x) => x.service === m.service && x.installment_months === m.installment_months)) ex.mids.push(m);
    if (r.note) ex.note = [ex.note, r.note].filter(Boolean).join(" · ");
  }
  return { rows: [...merged.values()], warnings: [...new Set(warnings)], sheets: summary };
}

/** ชื่อในไฟล์ → สาขาในระบบ (เดาจากคำที่ตรงกัน ให้ผู้ใช้แก้ได้ก่อนยืนยัน) */
export function guessBranch(label: string, branches: { id: string; code?: string | null; name: string; name_th?: string | null }[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ก-๙]+/g, " ").trim();
  const STOP = new Set(["central", "the", "mall", "event", "shop", "brand", "เซ็นทรัล"]);
  const words = norm(label).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return null;
  let best: { id: string; score: number } | null = null;
  for (const b of branches) {
    const hay = norm(`${b.name} ${b.name_th ?? ""} ${b.code ?? ""}`);
    const score = words.filter((w) => hay.includes(w) || (w.length >= 5 && hay.includes(w.slice(0, 5)))).length;
    if (score > (best?.score ?? 0)) best = { id: b.id, score };
  }
  return best && best.score >= Math.min(2, words.length) ? best.id : null;
}
