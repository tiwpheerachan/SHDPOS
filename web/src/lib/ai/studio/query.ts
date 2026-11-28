// =====================================================================
// AI Studio — ตัวคำนวณในเบราว์เซอร์: กรอง → จัดกลุ่ม (รวมแบ่งช่วงเวลา) → รวมค่า → สูตรต่อ → เรียง/ตัด/รวม "อื่น ๆ"
//   ไม่รันโค้ดที่ AI ส่งมา: สูตร (derived) แยกวิเคราะห์เองเฉพาะ ตัวเลข/ชื่อคอลัมน์/+ − × ÷/วงเล็บ
// =====================================================================
import type { Dataset, Derived, Filter, GroupBy, Measure, QueryResult, QuerySpec, ResultColumn, Row } from "./types";

export class QueryError extends Error {}
const WEEKDAY_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** วันที่/เวลา → ค่าตามช่วง (เวลาไทย) */
export function bucketOf(v: unknown, bucket: GroupBy["bucket"]): string | null {
  if (v == null || v === "") return null;
  const s = String(v);
  const t = s.length <= 10 ? new Date(`${s}T00:00:00+07:00`) : new Date(s);
  if (Number.isNaN(+t)) return null;
  const b = new Date(+t + 7 * 3600_000); // นาฬิกาไทยในรูป UTC
  const y = b.getUTCFullYear(), m = b.getUTCMonth(), d = b.getUTCDate();
  const p2 = (n: number) => String(n).padStart(2, "0");
  switch (bucket) {
    case "year": return String(y);
    case "quarter": return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "month": return `${y}-${p2(m + 1)}`;
    case "week": { const mon = new Date(Date.UTC(y, m, d - ((b.getUTCDay() + 6) % 7))); return mon.toISOString().slice(0, 10); }
    case "weekday": return `${b.getUTCDay()}-${WEEKDAY_TH[b.getUTCDay()]}`;
    case "hour": return p2(b.getUTCHours());
    default: return `${y}-${p2(m + 1)}-${p2(d)}`;
  }
}

const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v));
function cmp(a: unknown, b: unknown) { const x = num(a), y = num(b); return !Number.isNaN(x) && !Number.isNaN(y) ? x - y : String(a ?? "").localeCompare(String(b ?? ""), "th"); }

function matches(row: Row, f: Filter): boolean {
  const v = row[f.field];
  const val = f.value;
  switch (f.op) {
    case "eq": return String(v ?? "") === String(val ?? "");
    case "neq": return String(v ?? "") !== String(val ?? "");
    case "in": return Array.isArray(val) && val.map(String).includes(String(v ?? ""));
    case "nin": return !(Array.isArray(val) && val.map(String).includes(String(v ?? "")));
    case "gt": return cmp(v, val) > 0;
    case "gte": return cmp(v, val) >= 0;
    case "lt": return cmp(v, val) < 0;
    case "lte": return cmp(v, val) <= 0;
    case "between": return Array.isArray(val) && cmp(v, val[0]) >= 0 && cmp(v, val[1]) <= 0;
    case "contains": return String(v ?? "").toLowerCase().includes(String(val ?? "").toLowerCase());
    case "is_null": return v == null || v === "";
    case "not_null": return !(v == null || v === "");
    default: throw new QueryError(`ไม่รู้จักตัวกรอง op "${String(f.op)}"`);
  }
}

/** สูตรปลอดภัย: ตัวเลข · ชื่อคอลัมน์ · + - * / · วงเล็บ (หารด้วย 0 = null) */
export function evalExpr(expr: string, vars: Record<string, number | null>): number | null {
  const toks = expr.match(/\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[-+*/()])\s*/g)?.map((t) => t.trim());
  if (!toks || toks.join("") !== expr.replace(/\s+/g, "")) throw new QueryError(`สูตรไม่ถูกต้อง: ${expr}`);
  let i = 0;
  const peek = () => toks[i];
  const atom = (): number | null => {
    const t = toks[i++];
    if (t === "(") { const v = add(); if (toks[i++] !== ")") throw new QueryError(`วงเล็บไม่ครบ: ${expr}`); return v; }
    if (t === "-") { const v = atom(); return v == null ? null : -v; }
    if (t != null && /^\d/.test(t)) return Number(t);
    if (t != null && /^[A-Za-z_]/.test(t)) { if (!(t in vars)) throw new QueryError(`สูตรอ้างถึง "${t}" ที่ไม่มีในผลรวม`); return vars[t]; }
    throw new QueryError(`สูตรไม่ถูกต้อง: ${expr}`);
  };
  const mul = (): number | null => { let v = atom(); while (peek() === "*" || peek() === "/") { const op = toks[i++]; const r = atom(); v = v == null || r == null ? null : op === "*" ? v * r : r === 0 ? null : v / r; } return v; };
  const add = (): number | null => { let v = mul(); while (peek() === "+" || peek() === "-") { const op = toks[i++]; const r = mul(); v = v == null || r == null ? null : op === "+" ? v + r : v - r; } return v; };
  const out = add();
  if (i !== toks.length) throw new QueryError(`สูตรไม่ถูกต้อง: ${expr}`);
  return out == null || !Number.isFinite(out) ? null : out;
}

function aggregate(rows: Row[], m: Measure): number | null {
  if (m.agg === "count") return rows.length;
  if (!m.field) throw new QueryError(`ตัวชี้วัด "${m.as}" ต้องระบุ field`);
  if (m.agg === "count_distinct") return new Set(rows.map((r) => r[m.field!]).filter((v) => v != null && v !== "")).size;
  const vals = rows.map((r) => num(r[m.field!])).filter((v) => !Number.isNaN(v));
  if (!vals.length) return m.agg === "sum" ? 0 : null;
  switch (m.agg) {
    case "sum": return vals.reduce((a, b) => a + b, 0);
    case "avg": return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "min": return Math.min(...vals);
    case "max": return Math.max(...vals);
    case "median": { const s = [...vals].sort((a, b) => a - b); const h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; }
    default: throw new QueryError(`ไม่รู้จักการรวมค่า "${String(m.agg)}"`);
  }
}

const inRange = (v: unknown, r?: { from: string; to: string }) => { if (!r) return true; const s = String(v ?? ""); return s >= r.from && s <= r.to + "￿"; };

/** รันคำสั่งคำนวณบนชุดข้อมูล */
export function runQuery(ds: Dataset, q: QuerySpec): QueryResult {
  if (!q || !Array.isArray(q.measures) || !q.measures.length) throw new QueryError("ต้องมี measures อย่างน้อย 1 ตัว");
  const fieldKeys = new Set(ds.fields.map((f) => f.key));
  const need = (k: string, where: string) => { if (!fieldKeys.has(k)) throw new QueryError(`${where}: ไม่มีฟิลด์ "${k}" ในชุดข้อมูล ${ds.id} (มี: ${[...fieldKeys].join(", ")})`); };
  for (const f of q.filters ?? []) need(f.field, "filters");
  for (const g of q.groupBy ?? []) need(g.field, "groupBy");
  for (const m of q.measures) if (m.agg !== "count") need(m.field ?? "", `measure ${m.as}`);
  if ((q.groupBy?.length ?? 0) > 2) throw new QueryError("groupBy ได้สูงสุด 2 มิติ");

  // ช่วงเวลา
  let rows = ds.rows;
  const period = q.period ?? "current";
  if (ds.timeField && period !== "all") rows = rows.filter((r) => inRange(r[ds.timeField!], period === "previous" ? ds.prevRange : ds.range));
  if (period === "previous" && !ds.prevRange) rows = [];
  for (const f of q.filters ?? []) rows = rows.filter((r) => matches(r, f));
  const matched = rows.length;

  const gb = q.groupBy ?? [];
  const keyOf = (r: Row) => gb.map((g) => (g.bucket ? bucketOf(r[g.field], g.bucket) : r[g.field] == null || r[g.field] === "" ? "(ไม่ระบุ)" : String(r[g.field])));
  const groups = new Map<string, { key: (string | null)[]; rows: Row[] }>();
  for (const r of rows) { const k = keyOf(r); const s = JSON.stringify(k); const g = groups.get(s); if (g) g.rows.push(r); else groups.set(s, { key: k, rows: [r] }); }
  if (!gb.length && !groups.size) groups.set("[]", { key: [], rows: [] });

  const dimCols: ResultColumn[] = gb.map((g) => ({ key: g.as ?? g.field, label: ds.fields.find((f) => f.key === g.field)?.label ?? g.field, kind: "dim" }));
  const mCols: ResultColumn[] = q.measures.map((m) => ({ key: m.as, label: m.label ?? m.as, kind: "measure", unit: m.unit ?? (m.field ? ds.fields.find((f) => f.key === m.field)?.unit : "count") }));
  const dCols: ResultColumn[] = (q.derived ?? []).map((d) => ({ key: d.as, label: d.label ?? d.as, kind: "measure", unit: d.unit }));
  const shareCols: ResultColumn[] = q.measures.filter((m) => m.share).map((m) => ({ key: `${m.as}_share`, label: `${m.label ?? m.as} (%)`, kind: "measure", unit: "pct" }));

  const compute = (gRows: Row[], key: (string | null)[]): Row => {
    const out: Row = {};
    dimCols.forEach((c, i) => { out[c.key] = key[i]; });
    const vars: Record<string, number | null> = {};
    for (const m of q.measures) { const v = aggregate(gRows, m); out[m.as] = v; vars[m.as] = v; }
    for (const d of q.derived ?? []) { const v = evalExpr(d.expr, vars); out[d.as] = v; vars[d.as] = v; }
    return out;
  };
  let outRows = [...groups.values()].map((g) => compute(g.rows, g.key));

  // ผลรวมทั้งชุด (ไว้คิดสัดส่วน/แสดงยอดรวม)
  const totalsRow = compute(rows, []);
  const totals: Record<string, number> = {};
  for (const c of [...mCols, ...dCols]) totals[c.key] = Number(totalsRow[c.key] ?? 0);
  for (const m of q.measures.filter((x) => x.share)) for (const r of outRows) r[`${m.as}_share`] = totals[m.as] ? (Number(r[m.as] ?? 0) / totals[m.as]) * 100 : null;

  // เรียง: ระบุเอง · เวลา = ตามลำดับเวลา · อื่น ๆ = ค่าแรกมากไปน้อย
  const sortBy = q.sort?.by ?? (gb[0]?.bucket ? dimCols[0].key : mCols[0].key);
  if (![...dimCols, ...mCols, ...dCols, ...shareCols].some((c) => c.key === sortBy)) throw new QueryError(`sort.by "${sortBy}" ไม่มีในผลลัพธ์`);
  const dir = q.sort?.dir ?? (gb[0]?.bucket && !q.sort ? "asc" : "desc");
  outRows.sort((a, b) => (dir === "asc" ? 1 : -1) * cmp(a[sortBy], b[sortBy]));

  const limit = Math.max(1, Math.min(500, Number(q.limit) || 500));
  if (outRows.length > limit) {
    if (q.others && gb.length === 1) {
      const rest = outRows.slice(limit - 1);
      const restKeys = new Set(rest.map((r) => String(r[dimCols[0].key])));
      const restRows = rows.filter((r) => restKeys.has(keyOf(r)[0] ?? ""));
      const o = compute(restRows, ["อื่น ๆ"]);
      for (const m of q.measures.filter((x) => x.share)) o[`${m.as}_share`] = totals[m.as] ? (Number(o[m.as] ?? 0) / totals[m.as]) * 100 : null;
      outRows = [...outRows.slice(0, limit - 1), o];
    } else outRows = outRows.slice(0, limit);
  }
  return { columns: [...dimCols, ...mCols, ...dCols, ...shareCols], rows: outRows, totals, rowCount: outRows.length, matched };
}

/** ผลลัพธ์ย่อให้ AI อ่าน (ไม่เกิน N แถว ปัดทศนิยม) */
export function compactResult(r: QueryResult, maxRows = 40) {
  const round = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
  return {
    columns: r.columns.map((c) => `${c.key}${c.unit ? `(${c.unit})` : ""}`),
    rows: r.rows.slice(0, maxRows).map((row) => r.columns.map((c) => round(row[c.key]))),
    totals: Object.fromEntries(Object.entries(r.totals).map(([k, v]) => [k, round(v)])),
    groups: r.rowCount, matched_rows: r.matched, truncated: r.rowCount > maxRows,
  };
}

export { type Derived };
