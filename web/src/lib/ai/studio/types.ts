// =====================================================================
// AI Studio — ชนิดข้อมูลกลาง: ชุดข้อมูล (dataset) · คำสั่งคำนวณ (QuerySpec) · การ์ดแดชบอร์ด (StudioWidget)
//   AI สั่งคำนวณด้วย QuerySpec (ไม่เห็นข้อมูลรายแถว) · หน้าเว็บคำนวณจริงในเบราว์เซอร์ (lib/ai/studio/query)
// =====================================================================

export type FieldType = "number" | "string" | "date" | "boolean";
/** measure = ตัวเลขรวมได้ · dimension = จัดกลุ่ม · time = วันที่/เวลา · id = รหัส (นับไม่ซ้ำ) */
export type FieldRole = "measure" | "dimension" | "time" | "id";
export type Unit = "thb" | "qty" | "pct" | "days" | "count";

export type Field = { key: string; label: string; type: FieldType; role: FieldRole; unit?: Unit; description?: string };
export type Row = Record<string, string | number | boolean | null>;

export type Dataset = {
  id: string; label: string; description: string;
  fields: Field[]; rows: Row[];
  /** ฟิลด์เวลาหลัก + ช่วง "ปัจจุบัน" (แถวก่อนช่วงนี้ = ช่วงก่อนหน้าไว้เทียบ) */
  timeField?: string; range?: { from: string; to: string }; prevRange?: { from: string; to: string };
};

export type FilterOp = "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "between" | "contains" | "is_null" | "not_null";
export type Filter = { field: string; op: FilterOp; value?: unknown };
export type Bucket = "day" | "week" | "month" | "quarter" | "year" | "weekday" | "hour";
export type GroupBy = { field: string; bucket?: Bucket; as?: string };
export type Agg = "sum" | "avg" | "min" | "max" | "count" | "count_distinct" | "median";
export type Measure = { as: string; agg: Agg; field?: string; label?: string; unit?: Unit; share?: boolean };
export type Derived = { as: string; expr: string; label?: string; unit?: Unit };

export type QuerySpec = {
  dataset: string;
  /** current = ช่วงที่เลือก (ค่าเริ่มต้น) · previous = ช่วงก่อนหน้ายาวเท่ากัน · all = ทุกแถว */
  period?: "current" | "previous" | "all";
  filters?: Filter[];
  groupBy?: GroupBy[];
  measures: Measure[];
  derived?: Derived[];
  sort?: { by: string; dir?: "asc" | "desc" };
  limit?: number;
  /** ตัดเหลือ limit กลุ่มแรก แล้วรวมที่เหลือเป็น "อื่น ๆ" (เหมาะกับสัดส่วน) */
  others?: boolean;
};

export type ResultColumn = { key: string; label: string; kind: "dim" | "measure"; unit?: Unit };
export type QueryResult = { columns: ResultColumn[]; rows: Row[]; totals: Record<string, number>; rowCount: number; matched: number };

export type Viz = "kpi" | "line" | "area" | "bar" | "hbar" | "stacked_bar" | "donut" | "table" | "heatmap" | "scatter";
export type StudioWidget = {
  id: string; title: string; subtitle?: string; viz: Viz; query: QuerySpec;
  /** คอลัมน์แกน X/หมวด · ชุดค่าที่จะพล็อต · คอลัมน์แยกซีรีส์ (stacked/heatmap) */
  x?: string; y?: string[]; series?: string;
  /** KPI: เทียบช่วงก่อนหน้า */ compare?: boolean;
  span?: 1 | 2; note?: string;
};
export type Insight = { text: string; tone?: "good" | "warn" | "info"; evidence?: string };
export type StudioDashboard = { title: string; summary?: string; widgets: StudioWidget[]; insights?: Insight[]; questions?: string[] };
