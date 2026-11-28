// AI Studio — ตัวคำนวณ/ตัวตรวจ/ตัววางแผน (ข้อมูลสมมุติ คำนวณมือเทียบ)
import { runQuery, evalExpr, bucketOf, QueryError } from "../src/lib/ai/studio/query";
import { lintDashboard } from "../src/lib/ai/studio/lint";
import { planLocal } from "../src/lib/ai/studio/planner";
import type { Dataset } from "../src/lib/ai/studio/types";
let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); n++; };
const throws = (f: () => unknown, m: string) => { try { f(); } catch (e) { if (e instanceof QueryError) { n++; return; } throw e; } throw Error(`${m}: ควร error`); };
const ds: Dataset = { id: "s", label: "s", description: "", timeField: "date", range: { from: "2026-11-01", to: "2026-11-30" }, prevRange: { from: "2026-10-01", to: "2026-10-31" },
  fields: [{ key: "bill", label: "บิล", type: "string", role: "id" }, { key: "date", label: "วันที่", type: "date", role: "time" }, { key: "branch", label: "สาขา", type: "string", role: "dimension" },
    { key: "net", label: "ยอด", type: "number", role: "measure", unit: "thb" }, { key: "units", label: "ชิ้น", type: "number", role: "measure", unit: "qty" }],
  rows: [
    { bill: "a", date: "2026-11-02", branch: "A", net: 100, units: 1 }, { bill: "b", date: "2026-11-02", branch: "B", net: 300, units: 3 },
    { bill: "c", date: "2026-11-20", branch: "A", net: 200, units: 2 }, { bill: "d", date: "2026-10-15", branch: "A", net: 50, units: 1 },
    { bill: "e", date: "2026-11-25", branch: "C", net: 0, units: 0 },
  ] };
let r = runQuery(ds, { dataset: "s", measures: [{ as: "sales", agg: "sum", field: "net" }, { as: "bills", agg: "count_distinct", field: "bill" }], derived: [{ as: "aov", expr: "sales / bills" }] });
eq([r.rows[0].sales, r.rows[0].bills, r.rows[0].aov], [600, 4, 150], "ช่วงปัจจุบันไม่รวมเดือนก่อน + สูตร AOV");
r = runQuery(ds, { dataset: "s", period: "previous", measures: [{ as: "sales", agg: "sum", field: "net" }] }); eq(r.rows[0].sales, 50, "ช่วงก่อนหน้า");
r = runQuery(ds, { dataset: "s", groupBy: [{ field: "branch" }], measures: [{ as: "sales", agg: "sum", field: "net", share: true }] });
eq(r.rows.map((x) => [x.branch, x.sales, Math.round(Number(x.sales_share))]), [["A", 300, 50], ["B", 300, 50], ["C", 0, 0]], "จัดกลุ่ม + สัดส่วน + เรียงมากไปน้อย");
r = runQuery(ds, { dataset: "s", groupBy: [{ field: "branch" }], measures: [{ as: "sales", agg: "sum", field: "net" }], limit: 2, others: true });
eq(r.rows.map((x) => [x.branch, x.sales]), [["A", 300], ["อื่น ๆ", 300]], "ตัด + รวมอื่น ๆ");
r = runQuery(ds, { dataset: "s", groupBy: [{ field: "date", bucket: "month" }], measures: [{ as: "sales", agg: "sum", field: "net" }], period: "all" });
eq(r.rows.map((x) => [x.date, x.sales]), [["2026-10", 50], ["2026-11", 600]], "รายเดือน เรียงตามเวลา");
r = runQuery(ds, { dataset: "s", filters: [{ field: "net", op: "gt", value: 0 }, { field: "branch", op: "in", value: ["A", "C"] }], measures: [{ as: "n", agg: "count" }] }); eq(r.rows[0].n, 2, "ตัวกรองหลายเงื่อนไข");
eq(evalExpr("(a - b) / b * 100", { a: 120, b: 100 }), 20, "สูตร %เติบโต"); eq(evalExpr("a / b", { a: 1, b: 0 }), null, "หาร 0 = null");
throws(() => evalExpr("a; alert(1)", { a: 1 }), "สูตรอันตราย"); throws(() => runQuery(ds, { dataset: "s", measures: [{ as: "x", agg: "sum", field: "nope" }] }), "ฟิลด์ไม่มีจริง");
eq(bucketOf("2026-11-28", "weekday"), "6-ส", "วันในสัปดาห์"); eq(bucketOf("2026-11-28T18:30:00Z", "day"), "2026-11-29", "ข้ามวันตามเวลาไทย");
const lint = lintDashboard({ title: "t", widgets: [
  { id: "1", title: "เส้นผิด", viz: "line", query: { dataset: "s", groupBy: [{ field: "branch" }], measures: [{ as: "s", agg: "sum", field: "net" }] } },
  { id: "2", title: "kpi", viz: "kpi", query: { dataset: "s", measures: [{ as: "s", agg: "sum", field: "net" }] } },
  { id: "3", title: "พัง", viz: "bar", query: { dataset: "s", groupBy: [{ field: "zzz" }], measures: [{ as: "s", agg: "sum", field: "net" }] } },
] }, [ds]);
eq(lint.dashboard.widgets.map((w) => [w.title, w.viz]), [["kpi", "kpi"], ["เส้นผิด", "bar"]], "ตัวตรวจ: เส้นที่ไม่ใช่เวลา→แท่ง, KPI ขึ้นก่อน");
eq(lint.errors.length, 1, "ตัวตรวจ: คำสั่งผิดถูกรายงาน");
const plan = lintDashboard(planLocal(ds), [ds]); eq(plan.errors.length, 0, "ตัววางแผนสำรองไม่มี error"); eq(plan.dashboard.widgets.some((w) => w.viz === "area"), true, "มีแนวโน้มตามเวลา");
console.log(`PASS: ${n} AI Studio checks (query engine, safe formulas, periods, others, lint auto-fix, local planner)`);
