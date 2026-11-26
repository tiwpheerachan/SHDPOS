"use client";
// เทมเพลตราคา (ดาวน์โหลด → แก้ใน Excel → นำเข้า) + ประวัติการนำเข้า/ย้อนกลับ + ไทม์ไลน์ราคารายสินค้า
//   ดาวน์โหลด: ป๊อปอัปกรองสินค้า (แบรนด์/หมวด/สถานะ/เลือก SKU/เฉพาะที่มีสต๊อกในสาขา — รวมทุกสาขาที่เลือก) + เติมค่าตั้งต้นให้ทุกแถว (กรอกน้อยสุด)
//   นำเข้า: อ่าน .xlsx/.csv → จับคอลัมน์อัตโนมัติ → พรีวิวทีละแถว (ผ่าน/เตือน/ผิด + ก่อน→หลัง) → ยืนยัน → เป็น 1 ชุด ย้อนกลับได้
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FileUp, X, Check, AlertTriangle, XCircle, Loader2, Undo2, History, RotateCcw, Search, Filter, ShieldCheck, Sparkle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Badge, Button, EmptyState, Field, Input, Modal, Segmented, Select, Skeleton } from "@/components/ui";
import { MultiSelect } from "@/components/ui/multi-select";
import { reviewImport, type ReviewRow, type Finding, type Verdict } from "@/lib/pricing/review";
import { useToast } from "@/components/toast-host";
import { formatTHB, formatInt } from "@/lib/money";
import { PRICE_TYPE, ROUNDING, bkkEndExclusive, bkkStart, describeRule, ruleValue, toBkkYmd, type PriceMode, type PriceType, type Rounding } from "@/lib/pricing/rules";
import { detectHeader, parseBranches, parseDateCell, parsePriceType, parsePriceValue, parseRounding, type ColKey } from "@/lib/pricing/import-parse";

type Ref = { id: string; name: string };
type BranchRef = { id: string; code: string; name: string; name_th: string | null; brand_id: string | null };
export type PProd = { id: string; sku: string; name_th: string; brand_id: string | null; category_id: string | null; price: number; cost: number | null; is_active: boolean; current_price: number };
export type PData = { products: PProd[]; brands: Ref[]; categories: Ref[]; branches: BranchRef[]; perms: { list: boolean; period: boolean; cost: boolean } };
const baht = (n: number) => formatTHB(n, false);
const todayYmd = () => toBkkYmd(new Date().toISOString());
const monthEnd = (ymd: string) => { const [y, m] = ymd.split("-").map(Number); return `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

// ═════════════ ดาวน์โหลดเทมเพลต ═════════════
export function ExportTemplateModal({ data, onClose }: { data: PData; onClose: () => void }) {
  const { L, locale } = useI18n();
  const toast = useToast();
  const [brands, setBrands] = useState<string[]>([]), [cats, setCats] = useState<string[]>([]), [status, setStatus] = useState<"all" | "on" | "off">("all");
  const [stockBranches, setStockBranches] = useState<string[]>([]), [onlyStock, setOnlyStock] = useState(false), [stockCols, setStockCols] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [prefill, setPrefill] = useState({ action: "none" as "none" | "percent" | "amount" | "price_list", value: "", from: todayYmd(), to: monthEnd(todayYmd()), branches: [] as string[], type: "monthly" as PriceType, promo: "", rounding: "baht" as Rounding });
  const [stock, setStock] = useState<{ rows: { branch_id: string; product_id: string; available: number }[] } | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/admin/branch-stock", { cache: "no-store" }).then((r) => r.json()).then((j) => setStock(j.rows ? j : { rows: [] })).catch(() => setStock({ rows: [] })); }, []);
  const stockBy = useMemo(() => { const m = new Map<string, Map<string, number>>(); for (const r of stock?.rows ?? []) { const x = m.get(r.product_id) ?? new Map(); x.set(r.branch_id, Number(r.available)); m.set(r.product_id, x); } return m; }, [stock]);
  // ไม่เลือกสาขา = ทุกสาขา
  const scopeBranches = stockBranches.length ? stockBranches : data.branches.map((b) => b.id);
  const list = useMemo(() => data.products.filter((p) => (!brands.length || brands.includes(p.brand_id ?? "")) && (!cats.length || cats.includes(p.category_id ?? ""))
    && (status === "all" || (status === "on" ? p.is_active : !p.is_active)) && (!picked.length || picked.includes(p.id))
    && (!onlyStock || scopeBranches.some((b) => (stockBy.get(p.id)?.get(b) ?? 0) > 0))), [data.products, brands, cats, status, picked, onlyStock, scopeBranches, stockBy]);
  // คอลัมน์สต๊อก: สาขาที่เลือก หรือ (ไม่เลือก) เฉพาะสาขาที่มีของของสินค้าในไฟล์จริง — ไม่ใส่ครบทุกสาขา
  const stockBranchList = useMemo(() => data.branches.filter((b) => stockBranches.length ? stockBranches.includes(b.id) : list.some((p) => (stockBy.get(p.id)?.get(b.id) ?? 0) !== 0)), [data.branches, stockBranches, list, stockBy]);
  const names = (ids: string[], src: { id: string; name: string }[]) => src.filter((x) => ids.includes(x.id)).map((x) => x.name);
  const brandTxt = brands.length ? names(brands, data.brands).join("+") : L("ทุกแบรนด์", "All brands", "全部品牌");
  const branchTxt = stockBranches.length ? data.branches.filter((b) => stockBranches.includes(b.id)).map((b) => b.code).join("+") : L("ทุกสาขา", "All branches", "所有门店");
  const monthTxt = new Date(`${(prefill.action !== "none" ? prefill.from : todayYmd())}T00:00:00`).toLocaleDateString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { month: "short", year: "2-digit" });
  const safe = (s: string, n: number) => s.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  const fileName = `${safe(`${L("ราคา", "Prices", "价格")}_${brandTxt}_${branchTxt}${prefill.action !== "none" && prefill.promo ? `_${prefill.promo}` : ""}_${todayYmd()}`, 120).replace(/ /g, "_")}.xlsx`;
  const sheetName = safe(`${L("ราคา", "Prices", "价格")} ${brands.length === 1 ? names(brands, data.brands)[0] : brands.length ? `${brands.length} ${L("แบรนด์", "brands", "品牌")}` : L("ทุกแบรนด์", "all", "全部")} ${monthTxt}`, 31);
  async function download() {
    setBusy(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook(); wb.creator = "SHD POS";
      const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
      const bn = new Map(data.brands.map((b) => [b.id, b.name])), cn = new Map(data.categories.map((c) => [c.id, c.name]));
      const stockHeads = stockCols ? stockBranchList.map((b) => `${L("สต๊อก", "Stock", "库存")} ${b.code}`) : [];
      const pfVal = prefill.action === "percent" && prefill.value ? `${prefill.value}%` : prefill.action === "amount" && prefill.value ? `-${prefill.value}` : "";
      const head = ["SKU", L("ชื่อสินค้า", "Product", "商品名称"), L("แบรนด์", "Brand", "品牌"), L("หมวด", "Category", "类别"), L("สต๊อกรวม", "Total stock", "库存合计"), ...stockHeads,
        L("ราคาหลักปัจจุบัน", "Current list price", "当前标价"), L("ราคาขายตอนนี้", "Selling now", "当前售价"),
        L("ราคาหลักใหม่", "New list price", "新标价"), L("ราคาพิเศษ / ส่วนลด", "Special price / discount", "特价 / 折扣"), L("เริ่ม", "Start", "开始"), L("ถึง", "End", "结束"),
        L("สาขา", "Branches", "门店"), L("ประเภทราคา", "Price type", "价格类型"), L("ชื่อโปร", "Promo name", "促销名称"), L("ปัดเศษ", "Rounding", "取整")];
      // แถวชื่อไฟล์ (อ่านรู้เรื่องว่าเป็นไฟล์อะไร) — ตอนนำเข้าระบบหาหัวตารางเอง
      ws.addRow([`${L("เทมเพลตราคา", "Price template", "价格模板")} · ${L("แบรนด์", "Brand", "品牌")}: ${brandTxt} · ${L("สาขา", "Branches", "门店")}: ${branchTxt} · ${list.length} ${L("สินค้า", "products", "商品")} · ${L("สร้าง", "Created", "创建")} ${todayYmd()} — ${L("กรอกเฉพาะช่องสีเหลืองที่ต้องการเปลี่ยน ช่องสาขาเว้นว่าง = ทุกสาขา", "Fill only yellow cells you want to change; blank branches = all branches", "只填需要修改的黄色单元格；门店留空=所有门店")}`]);
      ws.mergeCells(1, 1, 1, head.length); ws.getRow(1).font = { bold: true, color: { argb: "FF7950D8" } }; ws.getRow(1).height = 22;
      ws.addRow(head);
      const fromD = prefill.from ? new Date(`${prefill.from}T00:00:00Z`) : null, toD = prefill.to ? new Date(`${prefill.to}T00:00:00Z`) : null;
      const branchCell = prefill.branches.length ? data.branches.filter((b) => prefill.branches.includes(b.id)).map((b) => b.code).join(", ") : ""; // ว่าง = ทุกสาขา
      for (const p of list) {
        const perBranch = stockBranchList.map((b) => stockBy.get(p.id)?.get(b.id) ?? 0);
        const total = [...(stockBy.get(p.id)?.entries() ?? [])].filter(([b]) => scopeBranches.includes(b)).reduce((a, [, v]) => a + v, 0);
        const special = prefill.action === "price_list" ? Number(p.price) || "" : pfVal;
        const has = special !== "";
        ws.addRow([p.sku, p.name_th, bn.get(p.brand_id ?? "") ?? "", cn.get(p.category_id ?? "") ?? "", total, ...(stockCols ? perBranch : []),
          Number(p.price), Number(p.current_price), "", special, has ? fromD : "", has ? toD : "", has ? branchCell : "",
          has ? PRICE_TYPE()[prefill.type].label : "", has ? prefill.promo : "", has ? ROUNDING()[prefill.rounding].split(" (")[0] : ""]);
      }
      const editFrom = head.indexOf(L("ราคาหลักใหม่", "New list price", "新标价")) + 1;
      ws.getRow(2).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(2).height = 28;
      head.forEach((_, i) => { const c = ws.getCell(2, i + 1); c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i + 1 >= editFrom ? "FF7950D8" : "FF132436" } }; c.alignment = { vertical: "middle", wrapText: true }; });
      ws.columns.forEach((col, i) => { col.width = i === 1 ? 36 : i === 0 ? 22 : i + 1 >= editFrom ? 16 : 12; });
      for (let r = 3; r <= list.length + 2; r++) for (let c = editFrom; c <= head.length; c++) ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } };
      [editFrom + 2, editFrom + 3].forEach((c) => { ws.getColumn(c).numFmt = "dd/mm/yyyy"; });
      ws.getColumn(editFrom - 2).numFmt = "#,##0.00"; ws.getColumn(editFrom - 1).numFmt = "#,##0.00";
      ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: head.length } };
      const types = Object.values(PRICE_TYPE()).map((t) => t.label).join(","), rounds = Object.values(ROUNDING()).map((t) => t.split(" (")[0]).join(",");
      for (let r = 3; r <= Math.max(list.length + 2, 3); r++) {
        ws.getCell(r, editFrom + 5).dataValidation = { type: "list", allowBlank: true, formulae: [`"${types}"`] };
        ws.getCell(r, editFrom + 7).dataValidation = { type: "list", allowBlank: true, formulae: [`"${rounds}"`] };
      }
      const help = wb.addWorksheet(L("วิธีใช้", "How to", "使用说明"));
      help.columns = [{ width: 28 }, { width: 90 }];
      [[L("คอลัมน์", "Column", "列"), L("วิธีกรอก", "How to fill", "填写方法")],
        [L("ราคาหลักใหม่", "New list price", "新标价"), L("ว่าง = ไม่เปลี่ยน · ใส่ตัวเลข = ราคาหลักใหม่ (รวม VAT)", "Blank = unchanged · number = new list price (incl. VAT)", "留空=不变 · 数字=新标价（含税）")],
        [L("ราคาพิเศษ / ส่วนลด", "Special price / discount", "特价 / 折扣"), L("ว่าง = ไม่มีราคาช่วงเวลา · 1490 = ขายราคา 1,490 · -100 หรือ “ลด 100” = ลด 100 บาท · 15% = ลด 15%", "Blank = none · 1490 = sell at 1,490 · -100 = 100 off · 15% = 15% off", "留空=无 · 1490=售价1490 · -100=减100 · 15%=减15%")],
        [L("เริ่ม / ถึง", "Start / End", "开始 / 结束"), L("วันที่ เช่น 1/12/2569, 1/12/2026, 2026-12-01 · ว่าง = ใช้วันที่ตั้งต้นตอนนำเข้า", "Dates like 1/12/2026 or 2026-12-01 · blank = default at import", "日期如 2026-12-01 · 留空=导入时默认")],
        [L("สาขา", "Branches", "门店"), L("เว้นว่าง = ทุกสาขา · ระบุเฉพาะเมื่อราคานี้ใช้บางสาขา (รหัสสาขาคั่นด้วย , ดูแท็บ “สาขา”)", "Leave blank = all branches · fill only for branch-specific prices (codes separated by ,)", "留空=所有门店 · 仅特定门店时填写代码")],
        [L("ลบแถว", "Removing rows", "删除行"), L("ลบแถวที่ไม่ต้องการได้ · ย้ายคอลัมน์ได้ ระบบจับจากหัวตาราง", "Delete rows you don't need · columns are detected by header", "可删除不需要的行 · 按表头识别列")],
      ].forEach((r) => help.addRow(r));
      help.getRow(1).font = { bold: true };
      const br = wb.addWorksheet(L("สาขา", "Branches", "门店"));
      br.columns = [{ header: L("รหัสสาขา", "Code", "代码"), width: 22 }, { header: L("ชื่อสาขา", "Name", "名称"), width: 48 }];
      for (const b of data.branches) br.addRow([b.code, b.name_th ?? b.name]);
      br.getRow(1).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url);
      toast.push({ tone: "ok", title: L(`ดาวน์โหลด ${fileName}`, `Downloaded ${fileName}`, `已下载 ${fileName}`), body: L(`${list.length} สินค้า`, `${list.length} products`, `${list.length} 个商品`) });
      onClose();
    } catch (e) { toast.push({ tone: "danger", title: L("สร้างไฟล์ไม่สำเร็จ", "Couldn't build the file", "生成文件失败"), body: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  }
  const brOpts = data.branches.map((b) => ({ value: b.id, label: b.name_th ?? b.name, sub: b.code }));
  return (
    <Modal open onClose={onClose} size="lg" title={<span className="inline-flex items-center gap-2"><FileDown size={16} />{L("ดาวน์โหลดเทมเพลตราคา", "Download price template", "下载价格模板")}</span>}
      footer={<div className="flex items-center justify-between w-full gap-2 flex-wrap">
        <span className="text-[11px] text-muted min-w-0"><b className="text-ink">{formatInt(list.length)}</b> {L("สินค้า", "products", "商品")} · <span translate="no" className="font-mono">{fileName}</span></span>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!list.length || stock === null} onClick={() => void download()}><FileDown size={14} />{L("ดาวน์โหลด .xlsx", "Download .xlsx", "下载 .xlsx")}</Button></div></div>}>
      <div className="space-y-4 text-sm">
        <section className="space-y-2">
          <p className="text-[13px] font-semibold flex items-center gap-1.5"><Filter size={14} />{L("สินค้าที่จะอยู่ในไฟล์", "Products in the file", "文件包含的商品")}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <MultiSelect label={L("แบรนด์", "Brand", "品牌")} placeholder={L("ทุกแบรนด์", "All brands", "全部品牌")} options={data.brands.map((b) => ({ value: b.id, label: b.name }))} value={brands} onChange={setBrands} noTranslate />
            <MultiSelect label={L("หมวด", "Category", "类别")} placeholder={L("ทุกหมวด", "All categories", "全部类别")} options={data.categories.map((c) => ({ value: c.id, label: c.name }))} value={cats} onChange={setCats} />
            <MultiSelect label={L("เฉพาะบาง SKU (ไม่บังคับ)", "Specific SKUs (optional)", "特定 SKU（可选）")} placeholder={L("ทุก SKU ตามตัวกรอง", "All SKUs in filter", "筛选内全部 SKU")} options={data.products.map((p) => ({ value: p.id, label: p.sku, sub: p.name_th }))} value={picked} onChange={setPicked} noTranslate />
            <div><span className="block text-[11px] text-muted mb-1">{L("สถานะ", "Status", "状态")}</span><Segmented size="sm" value={status} onChange={setStatus} options={[{ value: "all", label: L("ทั้งหมด", "All", "全部") }, { value: "on", label: L("เปิดขาย", "On sale", "在售") }, { value: "off", label: L("ปิดขาย", "Off", "未上架") }]} /></div>
          </div>
        </section>
        <section className="rounded-xl border border-line p-3 space-y-2">
          <p className="text-[13px] font-semibold">{L("สต๊อกสาขา", "Branch stock", "门店库存")}</p>
          <MultiSelect placeholder={L("ทุกสาขา (ไม่ต้องเลือก)", "All branches (no need to pick)", "所有门店（无需选择）")} options={brOpts} value={stockBranches} onChange={setStockBranches} noTranslate />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} className="accent-[rgb(var(--c-brand))]" />{L("เอาเฉพาะสินค้าที่มีสต๊อก (รวมทุกสาขาข้างบน — สาขาไหนมีอะไรรวมกันหมด)", "Only products in stock (union of the branches above)", "仅有库存的商品（合并上述门店）")}</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={stockCols} onChange={(e) => setStockCols(e.target.checked)} className="accent-[rgb(var(--c-brand))]" />{L(`ใส่คอลัมน์สต๊อกแยกรายสาขา (${stockBranchList.length} สาขาที่มีของ)`, `Per-branch stock columns (${stockBranchList.length} branches with stock)`, `分门店库存列（${stockBranchList.length} 家有库存）`)}</label>
        </section>
        <section className="rounded-xl border border-brand/30 bg-brand/[0.03] p-3 space-y-2">
          <p className="text-[13px] font-semibold">{L("เติมค่าตั้งต้นให้ทุกแถว (แก้ในไฟล์ได้)", "Pre-fill every row (editable in the file)", "为每行预填（可在文件中修改）")}</p>
          <Segmented size="sm" value={prefill.action} onChange={(v) => setPrefill({ ...prefill, action: v })} options={[{ value: "none", label: L("ไม่เติม", "None", "不填") }, { value: "percent", label: L("ลด %", "% off", "按%减") }, { value: "amount", label: L("ลดบาท", "Baht off", "按金额减") }, { value: "price_list", label: L("ใช้ราคาหลักเป็นราคาพิเศษ", "Copy list price", "复制标价") }]} />
          {prefill.action !== "none" ? (
            <div className="grid sm:grid-cols-3 gap-2">
              {prefill.action === "percent" || prefill.action === "amount" ? <Field label={prefill.action === "percent" ? L("ลดกี่ %", "Percent", "百分比") : L("ลดกี่บาท", "Baht", "金额")}><Input inputMode="decimal" value={prefill.value} onChange={(e) => setPrefill({ ...prefill, value: e.target.value.replace(/[^\d.]/g, "") })} /></Field> : null}
              <Field label={L("เริ่ม", "Start", "开始")}><Input type="date" value={prefill.from} onChange={(e) => setPrefill({ ...prefill, from: e.target.value })} /></Field>
              <Field label={L("ถึง", "End", "结束")}><Input type="date" value={prefill.to} onChange={(e) => setPrefill({ ...prefill, to: e.target.value })} /></Field>
              <Field label={L("ประเภทราคา", "Price type", "价格类型")}><Select value={prefill.type} onChange={(e) => setPrefill({ ...prefill, type: e.target.value as PriceType })}>{(Object.keys(PRICE_TYPE()) as PriceType[]).map((k) => <option key={k} value={k}>{PRICE_TYPE()[k].label}</option>)}</Select></Field>
              <Field label={L("ชื่อโปร", "Promo name", "促销名称")}><Input value={prefill.promo} onChange={(e) => setPrefill({ ...prefill, promo: e.target.value })} /></Field>
              <Field label={L("ปัดเศษ", "Rounding", "取整")}><Select value={prefill.rounding} onChange={(e) => setPrefill({ ...prefill, rounding: e.target.value as Rounding })}>{(Object.keys(ROUNDING()) as Rounding[]).map((k) => <option key={k} value={k}>{ROUNDING()[k]}</option>)}</Select></Field>
              <div className="sm:col-span-3"><MultiSelect label={L("ราคานี้ใช้กับสาขา", "Applies to branches", "适用门店")} placeholder={L("ทุกสาขา (เว้นว่างในไฟล์)", "All branches (left blank in file)", "所有门店（文件中留空）")} options={brOpts} value={prefill.branches} onChange={(v) => setPrefill({ ...prefill, branches: v })} noTranslate /></div>
            </div>
          ) : <p className="text-[11px] text-muted">{L("ไฟล์จะมีราคาปัจจุบันให้ดู · กรอกเฉพาะแถวที่ต้องการเปลี่ยน", "The file shows current prices · fill only rows you want to change", "文件显示当前价格 · 只需填写要修改的行")}</p>}
        </section>
      </div>
    </Modal>
  );
}

// ═════════════ นำเข้า + พรีวิว ═════════════
type PreviewRow = { line: number; sku: string; product?: PProd; status: "ok" | "warn" | "error" | "skip"; msgs: string[];
  newList: number | null; rule: { mode: PriceMode; value: number; rounding: Rounding; from: string; to: string; branch_ids: string[]; type: PriceType; name: string } | null; finalPrice: number | null };

export function ImportPricesModal({ data, onClose, onDone }: { data: PData; onClose: () => void; onDone: () => void }) {
  const { L } = useI18n();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState(""), [rows, setRows] = useState<PreviewRow[] | null>(null), [err, setErr] = useState(""), [parsing, setParsing] = useState(false);
  const [defaults, setDefaults] = useState({ from: todayYmd(), to: monthEnd(todayYmd()) });
  const [raw, setRaw] = useState<{ grid: unknown[][]; hdr: NonNullable<ReturnType<typeof detectHeader>> } | null>(null);
  const [filter, setFilter] = useState<"all" | "ok" | "warn" | "error">("all"), [title, setTitle] = useState(""), [busy, setBusy] = useState(false);
  const bySku = useMemo(() => new Map(data.products.map((p) => [p.sku.trim().toLowerCase().replace(/\s+/g, " "), p])), [data.products]);
  // จับคู่สำรองเมื่อ SKU ไม่ตรงเป๊ะ: (1) สะกดต่างแค่ช่องว่าง/ขีด/จุด (2) ชื่อสินค้าตรงกันพอดี — ต้องมีตัวเดียวเท่านั้น ไม่งั้นแค่เสนอ
  const loose = (x: string) => x.toLowerCase().replace(/[\s\-_./]/g, "");
  const byLoose = useMemo(() => { const m = new Map<string, PProd[]>(); for (const p of data.products) for (const k of new Set([loose(p.sku), loose(p.name_th)])) m.set(k, [...(m.get(k) ?? []), p]); return m; }, [data.products]);
  const suggest = (raw: string) => { const k = loose(raw); if (k.length < 3) return []; return data.products.filter((p) => loose(p.sku).includes(k) || k.includes(loose(p.sku)) || loose(p.name_th).includes(k)).slice(0, 3); };
  const [ack, setAck] = useState(false), [focus, setFocus] = useState<Finding | null>(null);
  const [ai, setAi] = useState<{ state: "idle" | "loading" | "done" | "none"; verdict?: Verdict; summary?: string; findings?: Finding[] }>({ state: "idle" });
  async function readFile(f: File) {
    setParsing(true); setErr(""); setRows(null); setFileName(f.name); setTitle(f.name.replace(/\.(xlsx|csv)$/i, ""));
    try {
      let grid: unknown[][] = [];
      if (/\.csv$/i.test(f.name)) {
        const text = (await f.text()).replace(/^﻿/, "");
        grid = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => { const out: string[] = []; let cur = "", qd = false; for (const ch of l) { if (ch === '"') qd = !qd; else if (ch === "," && !qd) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; });
      } else {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await f.arrayBuffer());
        const ws = wb.worksheets.find((w) => detectHeader(sheetGrid(w, 15))) ?? wb.worksheets[0];
        grid = sheetGrid(ws, 100000);
      }
      const hdr = detectHeader(grid);
      if (!hdr) throw Error(L("ไม่พบหัวตาราง — ต้องมีคอลัมน์ SKU และ “ราคาหลักใหม่” หรือ “ราคาพิเศษ / ส่วนลด” (ใช้เทมเพลตจากปุ่มดาวน์โหลด)", "Header not found — need SKU and “New list price” or “Special price / discount” columns", "未找到表头 — 需要 SKU 和“新标价”或“特价/折扣”列"));
      setRaw({ grid, hdr });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setParsing(false); }
  }
  // แปลงทุกครั้งที่ค่าเริ่มต้นวันที่เปลี่ยน
  useEffect(() => {
    if (!raw) return;
    const { grid, hdr } = raw; const col = (k: ColKey, r: unknown[]) => (hdr.map[k] != null ? r[hdr.map[k]!] : undefined);
    const seen = new Set<string>(); const out: PreviewRow[] = [];
    for (let i = hdr.row + 1; i < grid.length; i++) {
      const r = grid[i]; const skuRaw = String(col("sku", r) ?? "").trim();
      if (!skuRaw) continue;
      const row: PreviewRow = { line: i + 1, sku: skuRaw, status: "ok", msgs: [], newList: null, rule: null, finalPrice: null };
      let p = bySku.get(skuRaw.toLowerCase().replace(/\s+/g, " "));
      if (!p) {
        const cand = byLoose.get(loose(skuRaw)) ?? [];
        if (cand.length === 1) { p = cand[0]; row.status = "warn"; row.msgs.push(L(`จับคู่กับ ${p.sku} (สะกด/ชื่อต่างเล็กน้อย) — ตรวจว่าถูกตัว`, `Matched to ${p.sku} (slightly different spelling) — check`, `匹配到 ${p.sku}（拼写略有不同）— 请核对`)); }
        else {
          const sg = cand.length ? cand : suggest(skuRaw);
          row.status = "error"; row.msgs.push(L("ไม่พบ SKU นี้ (หรืออยู่นอกแบรนด์ที่คุณดูแล)", "SKU not found (or outside your brands)", "未找到 SKU（或不在您负责的品牌）") + (sg.length ? L(` — หมายถึง ${sg.map((x) => x.sku).join(" / ")} ไหม? แก้ในไฟล์แล้วนำเข้าใหม่`, ` — did you mean ${sg.map((x) => x.sku).join(" / ")}?`, ` — 是否指 ${sg.map((x) => x.sku).join(" / ")}？`) : ""));
          out.push(row); continue;
        }
      }
      row.product = p;
      if (seen.has(p.id)) { row.status = "error"; row.msgs.push(L("SKU ซ้ำในไฟล์ — ใช้แถวแรก", "Duplicate SKU — first row used", "SKU 重复 — 使用第一行")); out.push(row); continue; }
      seen.add(p.id);
      const nl = col("new_list", r);
      if (nl != null && String(nl).trim() !== "") {
        const v = typeof nl === "number" ? nl : Number(String(nl).replace(/[,\s฿]|บาท/g, ""));
        if (!Number.isFinite(v) || v <= 0) { row.status = "error"; row.msgs.push(L(`ราคาหลักใหม่ “${nl}” ไม่ถูกต้อง`, `Invalid new list price “${nl}”`, `新标价“${nl}”无效`)); }
        else if (Math.round(v * 100) / 100 === Number(p.price)) row.msgs.push(L("ราคาหลักเท่าเดิม — ข้าม", "List price unchanged — skipped", "标价未变 — 跳过"));
        else row.newList = Math.round(v * 100) / 100;
      }
      const sp = parsePriceValue(col("special", r), hdr.percentHint);
      if (sp && "error" in sp) { row.status = "error"; row.msgs.push(sp.error); }
      else if (sp) {
        const f = parseDateCell(col("start", r)), t = parseDateCell(col("end", r)), br = parseBranches(col("branches", r), data.branches);
        const from = f && typeof f === "object" ? null : (f ?? defaults.from), to = t && typeof t === "object" ? null : (t ?? defaults.to);
        if (f && typeof f === "object") { row.status = "error"; row.msgs.push(f.error); }
        if (t && typeof t === "object") { row.status = "error"; row.msgs.push(t.error); }
        if (!Array.isArray(br)) { row.status = "error"; row.msgs.push(br.error); }
        if (from && to && to < from) { row.status = "error"; row.msgs.push(L("วันสิ้นสุดก่อนวันเริ่ม", "End before start", "结束早于开始")); }
        if (to && to < todayYmd()) { row.status = row.status === "error" ? "error" : "warn"; row.msgs.push(L("ช่วงนี้หมดไปแล้ว — จะไม่มีผล", "Period already ended — no effect", "时段已结束 — 不会生效")); }
        if (!col("start", r) || !col("end", r)) row.msgs.push(L("ใช้วันที่ตั้งต้น", "Default dates used", "使用默认日期"));
        if (from && to && Array.isArray(br)) {
          row.rule = { mode: sp.mode, value: sp.value, rounding: parseRounding(col("rounding", r)) ?? "baht", from, to, branch_ids: br, type: parsePriceType(col("type", r)) ?? "monthly", name: String(col("promo", r) ?? "").trim() };
        }
      }
      if (row.newList == null && !row.rule && row.status !== "error") { row.status = "skip"; if (!row.msgs.length) row.msgs.push(L("ไม่มีการเปลี่ยน", "No change", "无变化")); }
      const list = row.newList ?? Number(p.price);
      if (row.rule) {
        row.finalPrice = ruleValue(row.rule.mode, row.rule.value, list, row.rule.rounding);
        if (row.finalPrice == null) { row.status = "error"; row.msgs.push(L("ราคาหลังลดติดลบ/เป็นศูนย์", "Price would be ≤ 0", "价格将≤0")); }
        else {
          if (row.rule.mode === "price" && row.rule.value > list) { row.status = row.status === "error" ? "error" : "warn"; row.msgs.push(L("ราคาพิเศษสูงกว่าราคาหลัก", "Special price above list price", "特价高于标价")); }
          if (row.rule.mode === "price" && hdr.percentHint === false && row.rule.value < 1) { row.status = row.status === "error" ? "error" : "warn"; row.msgs.push(L("ราคาต่ำผิดปกติ — ตั้งใจใส่ % หรือไม่?", "Unusually low — did you mean %?", "价格异常低 — 是否应为%？")); }
          if (data.perms.cost && p.cost != null && row.finalPrice / 1.07 < p.cost) { row.status = row.status === "error" ? "error" : "warn"; row.msgs.push(L("ต่ำกว่าต้นทุน", "Below cost", "低于成本")); }
          if (pctOff(list, row.finalPrice) > 50) { row.status = row.status === "error" ? "error" : "warn"; row.msgs.push(L("ลดเกิน 50% — ตรวจอีกครั้ง", "More than 50% off — double-check", "折扣超过50% — 请复核")); }
        }
        if (row.rule && !data.perms.period) { row.status = "error"; row.msgs.push(L("ไม่มีสิทธิ์ตั้งราคาช่วงเวลา", "No permission for period prices", "无时段价格权限")); }
      }
      if (row.newList != null && !data.perms.list) { row.status = "error"; row.msgs.push(L("ไม่มีสิทธิ์ตั้งราคาหลัก", "No permission for list price", "无标价权限")); }
      out.push(row);
    }
    setRows(out);
  }, [raw, defaults, bySku, byLoose]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => ({ ok: rows?.filter((r) => r.status === "ok").length ?? 0, warn: rows?.filter((r) => r.status === "warn").length ?? 0, error: rows?.filter((r) => r.status === "error").length ?? 0, skip: rows?.filter((r) => r.status === "skip").length ?? 0 }), [rows]);
  // ตรวจทั้งไฟล์ (กฎ) — หาความผิดปกติ/ตกหล่นที่การตรวจรายแถวมองไม่เห็น
  const review = useMemo(() => {
    if (!rows) return null;
    const rr: ReviewRow[] = rows.filter((r) => r.product && r.status !== "error").map((r) => ({ sku: r.sku, product_id: r.product!.id, brand_id: r.product!.brand_id, category_id: r.product!.category_id,
      list: Number(r.product!.price), newList: r.newList, mode: r.rule?.mode ?? null, value: r.rule?.value ?? null, final: r.finalPrice, from: r.rule?.from ?? null, to: r.rule?.to ?? null,
      branchCount: r.rule?.branch_ids.length ?? 0, cost: data.perms.cost ? r.product!.cost : null, currentRule: Number(r.product!.current_price) !== Number(r.product!.price) ? baht(Number(r.product!.current_price)) : null, changed: r.status !== "skip" }));
    return { ...reviewImport(rr, data.products, todayYmd()), rr };
  }, [rows, data.products, data.perms.cost]);
  // AI ตรวจเพิ่ม (อัตโนมัติเมื่อพรีวิวพร้อม) — ส่งเฉพาะ SKU/ราคา/สถิติ ไม่มีข้อมูลส่วนบุคคล
  useEffect(() => {
    if (!review || !review.rr.some((r) => r.changed)) { setAi({ state: "idle" }); return; }
    setAck(false); setAi({ state: "loading" });
    let off = false;
    const t = setTimeout(() => {
      const sample = review.rr.filter((r) => r.changed).slice(0, 60).map((r) => ({ sku: r.sku, list: r.list, new_list: r.newList, mode: r.mode, value: r.value, final: r.final, from: r.from, to: r.to, branches: r.branchCount || "all" }));
      void fetch("/api/admin/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ai_review", stats: review.stats, findings: review.findings, sample }) })
        .then((r) => r.json()).then((j) => { if (!off) setAi(j.source === "ai" ? { state: "done", verdict: j.verdict, summary: j.summary, findings: j.findings } : { state: "none" }); })
        .catch(() => { if (!off) setAi({ state: "none" }); });
    }, 600);
    return () => { off = true; clearTimeout(t); };
  }, [review]);
  const allFindings = [...(review?.findings ?? []), ...(ai.findings ?? [])];
  const rank = { ok: 0, review: 1, stop: 2 } as const;
  const verdict: Verdict = !review ? "ok" : (ai.verdict && rank[ai.verdict] > rank[review.verdict] ? ai.verdict : review.verdict);
  const needAck = verdict !== "ok" || counts.warn > 0;
  const focusSet = focus ? new Set(focus.skus.map((x) => x.toLowerCase())) : null;
  const shown = (rows ?? []).filter((r) => focusSet ? focusSet.has(r.sku.toLowerCase()) : r.status !== "skip" && (filter === "all" || r.status === filter));
  const ready = (rows ?? []).filter((r) => r.status === "ok" || r.status === "warn");
  async function confirm() {
    setBusy(true);
    try {
      const payload = ready.map((r) => ({ product_id: r.product!.id, ...(r.newList != null ? { list_price: r.newList } : {}),
        ...(r.rule ? { rule: { name: r.rule.name || title, price_type: r.rule.type, mode: r.rule.mode, value: r.rule.value, rounding: r.rule.rounding, starts_at: bkkStart(r.rule.from), ends_at: bkkEndExclusive(r.rule.to), branch_ids: r.rule.branch_ids } } : {}) }));
      const res = await fetch("/api/admin/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", title, file_name: fileName, rows: payload }) });
      const j = await res.json(); if (!res.ok) throw Error(j.error);
      toast.push({ tone: "ok", title: L(`นำเข้าแล้ว: ราคาหลัก ${j.list_changed} · ราคาช่วงเวลา ${j.rules_created}`, `Imported: ${j.list_changed} list · ${j.rules_created} period`, `已导入：标价 ${j.list_changed} · 时段价 ${j.rules_created}`), body: L("ย้อนกลับได้ที่แท็บ “ประวัติราคา”", "Undo from the “Price history” tab", "可在“价格历史”中撤销") });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const stCls = { ok: "text-ok", warn: "text-warn", error: "text-danger", skip: "text-muted" } as const;
  return (
    <Modal open onClose={onClose} size="xl" title={<span className="inline-flex items-center gap-2"><FileUp size={16} />{L("นำเข้าราคาจากไฟล์", "Import prices from file", "从文件导入价格")}</span>}
      footer={<div className="flex items-center justify-between w-full gap-2">
        <span className="text-xs text-muted">{rows ? L(`จะนำเข้า ${ready.length} แถว · ข้าม ${counts.error} แถวที่ผิด`, `Will import ${ready.length} · skip ${counts.error} errors`, `将导入 ${ready.length} 行 · 跳过 ${counts.error} 行错误`) : ""}</span>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!ready.length || !title.trim() || (needAck && !ack) || ai.state === "loading"} onClick={() => void confirm()}><Check size={14} />{verdict === "ok" ? L("ยืนยันนำเข้า", "Confirm import", "确认导入") : L("ยืนยันนำเข้า (ตรวจแล้ว)", "Confirm (reviewed)", "确认导入（已复核）")}</Button></div></div>}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.currentTarget.value = ""; }} />
          <Button variant="soft" onClick={() => fileRef.current?.click()}>{parsing ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}{fileName || L("เลือกไฟล์ .xlsx / .csv", "Choose .xlsx / .csv", "选择 .xlsx / .csv")}</Button>
          <span className="text-[11px] text-muted">{L("ระบบจับคอลัมน์จากหัวตารางเอง · แถวที่ไม่มีการเปลี่ยนจะถูกข้าม", "Columns detected from the header · unchanged rows are skipped", "自动识别表头 · 无变化的行将被跳过")}</span>
        </div>
        {err ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-[12.5px] text-danger">{err}</p> : null}
        {rows ? (
          <>
            <div className="grid sm:grid-cols-3 gap-2">
              <Field label={L("ชื่อชุดนำเข้า (ใช้เป็นชื่อโปรถ้าแถวไม่ได้ตั้ง)", "Batch title (default promo name)", "批次名称（默认促销名）")}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label={L("วันเริ่มตั้งต้น (แถวที่ไม่ใส่)", "Default start", "默认开始")}><Input type="date" value={defaults.from} onChange={(e) => setDefaults({ ...defaults, from: e.target.value })} /></Field>
              <Field label={L("วันสิ้นสุดตั้งต้น", "Default end", "默认结束")}><Input type="date" value={defaults.to} onChange={(e) => setDefaults({ ...defaults, to: e.target.value })} /></Field>
            </div>
            {review && review.rr.some((r) => r.changed) ? (
              <div className={`rounded-xl border p-3 space-y-2 ${verdict === "stop" ? "border-danger/40 bg-danger/[0.04]" : verdict === "review" ? "border-warn/40 bg-warn/[0.05]" : "border-ok/40 bg-ok/[0.05]"}`}>
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 ${verdict === "stop" ? "text-danger" : verdict === "review" ? "text-warn" : "text-ok"}`}>{verdict === "ok" ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[13.5px]">{verdict === "ok" ? L("ตรวจแล้วไม่พบความผิดปกติ — ยืนยันได้", "No anomalies found — safe to confirm", "未发现异常 — 可以确认") : verdict === "review" ? L(`พบ ${allFindings.filter((x) => x.severity !== "info").length} จุดที่ควรดูก่อนยืนยัน`, `${allFindings.filter((x) => x.severity !== "info").length} item(s) worth checking first`, `发现 ${allFindings.filter((x) => x.severity !== "info").length} 处建议先检查`) : L("แนะนำให้หยุดตรวจก่อน — น่าจะมีพิมพ์ผิด", "Recommend stopping to check — likely typos", "建议先停下检查 — 可能有输入错误")}</p>
                    <p className="text-[11.5px] text-muted">{L(`${review.stats.changed} สินค้าจะเปลี่ยน · ส่วนลดกลาง ${review.stats.median_off}% · สูงสุด ${review.stats.max_off}% · ราคาหลักเปลี่ยน ${review.stats.list_changes}`, `${review.stats.changed} changing · median ${review.stats.median_off}% off · max ${review.stats.max_off}% · ${review.stats.list_changes} list changes`, `${review.stats.changed} 个变更 · 中位折扣 ${review.stats.median_off}% · 最高 ${review.stats.max_off}% · 标价变更 ${review.stats.list_changes}`)}</p>
                  </div>
                  <span className="text-[11px] text-muted inline-flex items-center gap-1 shrink-0">{ai.state === "loading" ? <><Loader2 size={12} className="animate-spin" />{L("AI กำลังตรวจ…", "AI checking…", "AI 检查中…")}</> : ai.state === "done" ? <><Sparkle size={12} />{L("ตรวจด้วยกฎ + AI", "Rules + AI", "规则 + AI")}</> : L("ตรวจด้วยกฎ", "Rule check", "规则检查")}</span>
                </div>
                {ai.state === "done" && ai.summary ? <p className="text-[12px] rounded-lg bg-surface/70 border border-line px-2.5 py-1.5"><Sparkle size={11} className="inline mr-1 text-brand" />{ai.summary}</p> : null}
                {allFindings.length ? (
                  <ul className="space-y-1">
                    {allFindings.map((x) => (
                      <li key={x.id} className="text-[12px] flex items-start gap-2">
                        <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${x.severity === "high" ? "bg-danger" : x.severity === "medium" ? "bg-warn" : "bg-muted/50"}`} />
                        <div className="flex-1 min-w-0"><b className="font-medium">{x.title}</b>{x.detail ? <span className="block text-muted text-[11px] break-words" translate="no">{x.detail}</span> : null}</div>
                        {x.skus.length && x.id !== "group_gap" ? <button type="button" className={`text-[11px] shrink-0 ${focus?.id === x.id ? "text-ink font-semibold" : "text-brand"}`} onClick={() => setFocus(focus?.id === x.id ? null : x)}>{focus?.id === x.id ? L("แสดงทั้งหมด", "Show all", "显示全部") : L("ดูแถว", "Show rows", "查看行")}</button> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {needAck ? <label className="flex items-center gap-2 text-[12px] font-medium pt-1"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-[rgb(var(--c-brand))]" />{L("ตรวจข้อสังเกตข้างบนแล้ว ยืนยันว่าตั้งใจนำเข้าตามนี้", "I've reviewed the notes above and intend to import as shown", "已复核上述提示，确认按此导入")}</label> : null}
              </div>
            ) : null}
            {focus ? <p className="text-[11.5px] text-brand">{L(`กำลังแสดงเฉพาะแถว: ${focus.title}`, `Showing only: ${focus.title}`, `仅显示：${focus.title}`)} · <button type="button" className="underline" onClick={() => setFocus(null)}>{L("แสดงทั้งหมด", "Show all", "显示全部")}</button></p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Segmented size="sm" value={filter} onChange={setFilter} options={[
                { value: "all", label: `${L("ทั้งหมด", "All", "全部")} ${counts.ok + counts.warn + counts.error}` },
                { value: "ok", label: <span className="text-ok">{L("ผ่าน", "OK", "通过")} {counts.ok}</span> },
                { value: "warn", label: <span className="text-warn">{L("เตือน", "Warn", "警告")} {counts.warn}</span> },
                { value: "error", label: <span className="text-danger">{L("ผิด", "Error", "错误")} {counts.error}</span> },
              ]} />
              {counts.skip ? <span className="text-[11px] text-muted">{L(`ไม่มีการเปลี่ยน ${counts.skip} แถว`, `${counts.skip} unchanged`, `${counts.skip} 行无变化`)}</span> : null}
            </div>
            <div className="rounded-xl border border-line overflow-auto max-h-[52vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface2 text-[10.5px] text-muted"><tr>
                  <th className="text-left font-medium px-2 py-2">#</th><th className="text-left font-medium px-2 py-2">SKU</th>
                  <th className="text-right font-medium px-2 py-2">{L("ราคาหลัก", "List", "标价")}</th><th className="text-left font-medium px-2 py-2">{L("ราคาช่วงเวลา", "Period price", "时段价")}</th>
                  <th className="text-right font-medium px-2 py-2">{L("ราคาขายจริง", "Final price", "最终售价")}</th><th className="text-left font-medium px-2 py-2">{L("ช่วง / สาขา", "Period / branches", "时段 / 门店")}</th><th className="text-left font-medium px-2 py-2">{L("ผลตรวจ", "Check", "检查")}</th>
                </tr></thead>
                <tbody className="divide-y divide-line/60">
                  {shown.map((r) => {
                    const list = r.product ? Number(r.product.price) : 0;
                    return (
                      <tr key={r.line} className={r.status === "error" ? "bg-danger/[0.04]" : r.status === "warn" ? "bg-warn/[0.05]" : ""}>
                        <td className="px-2 py-1.5 text-muted tnum">{r.line}</td>
                        <td className="px-2 py-1.5" translate="no"><span className="font-mono">{r.sku}</span>{r.product ? <span className="block text-[10.5px] text-muted truncate max-w-[180px]">{r.product.name_th}</span> : null}</td>
                        <td className="px-2 py-1.5 text-right tnum whitespace-nowrap">{r.newList != null ? <><span className="line-through text-muted">{baht(list)}</span> → <b>{baht(r.newList)}</b></> : r.product ? baht(list) : "—"}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{r.rule ? <>{describeRule(r.rule)}{r.rule.mode !== "price" ? <span className="text-muted"> · {ROUNDING()[r.rule.rounding].split(" (")[0]}</span> : null}<span className={`ml-1 text-[10px] px-1 rounded ${PRICE_TYPE()[r.rule.type].cls}`}>{PRICE_TYPE()[r.rule.type].label}</span></> : <span className="text-muted">—</span>}</td>
                        <td className="px-2 py-1.5 text-right tnum font-semibold text-danger whitespace-nowrap">{r.finalPrice != null ? <>{baht(r.finalPrice)}<span className="block text-[10px] font-normal">−{pctOff(r.newList ?? list, r.finalPrice)}%</span></> : r.newList != null ? <span className="text-ink">{baht(r.newList)}</span> : "—"}</td>
                        <td className="px-2 py-1.5 text-[11px] whitespace-nowrap">{r.rule ? <>{r.rule.from} → {r.rule.to}<span className="block text-muted">{r.rule.branch_ids.length ? data.branches.filter((b) => r.rule!.branch_ids.includes(b.id)).map((b) => b.code).join(", ") : L("ทุกสาขา", "All branches", "所有门店")}</span></> : ""}</td>
                        <td className={`px-2 py-1.5 text-[11px] ${stCls[r.status]}`}>
                          <span className="inline-flex items-center gap-1 font-medium">{r.status === "ok" ? <Check size={12} /> : r.status === "warn" ? <AlertTriangle size={12} /> : <XCircle size={12} />}{r.status === "ok" ? L("ผ่าน", "OK", "通过") : r.status === "warn" ? L("ตรวจอีกครั้ง", "Review", "请复核") : L("ไม่นำเข้า", "Not imported", "不导入")}</span>
                          {r.msgs.length ? <span className="block text-muted">{r.msgs.join(" · ")}</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!shown.length ? <p className="text-center text-xs text-muted py-6">{L("ไม่มีแถวในตัวกรองนี้", "No rows", "没有数据")}</p> : null}
            </div>
          </>
        ) : !parsing ? <EmptyState icon={<FileUp size={24} />} title={L("เลือกไฟล์ราคาที่แก้แล้ว", "Choose an edited price file", "选择已编辑的价格文件")} body={L("ใช้เทมเพลตจากปุ่ม “ดาวน์โหลดเทมเพลต” · ระบบจะแสดงตัวอย่างให้ตรวจก่อนยืนยันทุกครั้ง", "Use the template from “Download template” · you'll always review a preview before confirming", "使用“下载模板”的文件 · 确认前会先预览")} /> : <Skeleton className="h-40" />}
      </div>
    </Modal>
  );
}
const pctOff = (list: number, price: number) => (list > 0 ? Math.round(((list - price) / list) * 1000) / 10 : 0);
function sheetGrid(ws: import("exceljs").Worksheet, max: number): unknown[][] {
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > max) return;
    const vals: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      let v: unknown = cell.value;
      if (v && typeof v === "object" && !(v instanceof Date)) { const o = v as { result?: unknown; text?: string; richText?: { text: string }[] }; v = o.result ?? o.text ?? (o.richText ? o.richText.map((t) => t.text).join("") : ""); }
      vals[c - 1] = v;
    });
    out[n - 1] = vals;
  });
  return out.map((r) => r ?? []);
}

// ═════════════ ประวัติการนำเข้า / ย้อนกลับ ═════════════
type Batch = { id: string; title: string; file_name: string | null; status: "applied" | "reverted"; summary: { rows?: number; list_changed?: number; rules_created?: number }; created_by: string | null; created_at: string; reverted_by: string | null; reverted_at: string | null; revert_reason: string | null; revert_result: { conflicts?: { sku: string; current: number }[] } | null };
export function PriceHistoryTab({ canEdit, onChanged }: { canEdit: boolean; onChanged?: () => void }) {
  const { L, locale } = useI18n();
  const toast = useToast();
  const [d, setD] = useState<{ batches: Batch[]; names: Record<string, string> } | null>(null);
  const [revert, setRevert] = useState<Batch | null>(null), [reason, setReason] = useState(""), [busy, setBusy] = useState(false);
  const load = async () => { const r = await fetch("/api/admin/pricing?view=batches", { cache: "no-store" }); const j = await r.json(); setD(r.ok ? j : { batches: [], names: {} }); };
  useEffect(() => { void load(); }, []);
  const dt = (s: string) => new Date(s).toLocaleString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  async function doRevert() {
    if (!revert) return;
    setBusy(true);
    const r = await fetch("/api/admin/pricing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revert_batch", batch_id: revert.id, reason }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { toast.push({ tone: "danger", title: j.error }); return; }
    toast.push({ tone: j.conflicts?.length ? "warn" : "ok", title: L(`ย้อนกลับแล้ว: คืนราคาหลัก ${j.list_restored} · ยกเลิกราคาช่วงเวลา ${j.rules_cancelled}`, `Reverted: ${j.list_restored} list restored · ${j.rules_cancelled} period cancelled`, `已撤销：恢复标价 ${j.list_restored} · 取消时段价 ${j.rules_cancelled}`),
      body: j.conflicts?.length ? L(`${j.conflicts.length} สินค้ามีคนแก้ราคาหลังนำเข้า — ไม่ทับ: ${j.conflicts.map((c: { sku: string }) => c.sku).join(", ")}`, `${j.conflicts.length} product(s) edited after import were left as-is`, `${j.conflicts.length} 个商品导入后已被修改，未覆盖`) : undefined });
    setRevert(null); setReason(""); void load(); onChanged?.();
  }
  return (
    <div className="card overflow-hidden">
      <p className="px-4 py-3 border-b border-line text-sm font-semibold flex items-center gap-2"><History size={15} />{L("ประวัติการนำเข้าราคา", "Price import history", "价格导入历史")}</p>
      {!d ? <Skeleton className="h-24 m-4" /> : d.batches.length ? d.batches.map((b) => (
        <div key={b.id} className="px-4 py-3 border-b border-line/70 flex flex-wrap items-start gap-3">
          <span className={`h-9 w-9 rounded-xl grid place-items-center shrink-0 ${b.status === "reverted" ? "bg-surface2 text-muted" : "bg-brand/10 text-brand"}`}>{b.status === "reverted" ? <Undo2 size={16} /> : <FileUp size={16} />}</span>
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-semibold flex flex-wrap items-center gap-1.5">{b.title}{b.status === "reverted" ? <Badge tone="neutral">{L("ย้อนกลับแล้ว", "Reverted", "已撤销")}</Badge> : <Badge tone="ok">{L("ใช้อยู่", "Applied", "已应用")}</Badge>}</p>
            <p className="text-[11.5px] text-muted">{b.file_name ? <span translate="no">{b.file_name} · </span> : null}{L(`ราคาหลัก ${b.summary.list_changed ?? 0} · ราคาช่วงเวลา ${b.summary.rules_created ?? 0} · ${b.summary.rows ?? 0} แถว`, `${b.summary.list_changed ?? 0} list · ${b.summary.rules_created ?? 0} period · ${b.summary.rows ?? 0} rows`, `标价 ${b.summary.list_changed ?? 0} · 时段价 ${b.summary.rules_created ?? 0} · ${b.summary.rows ?? 0} 行`)}</p>
            <p className="text-[11px] text-muted">{dt(b.created_at)} · {d.names[b.created_by ?? ""] ?? "—"}{b.status === "reverted" ? ` · ${L("ย้อนกลับ", "reverted", "撤销")} ${b.reverted_at ? dt(b.reverted_at) : ""} ${L("โดย", "by", "由")} ${d.names[b.reverted_by ?? ""] ?? "—"} — “${b.revert_reason}”` : ""}</p>
            {b.revert_result?.conflicts?.length ? <p className="text-[11px] text-warn">{L("ไม่ได้ย้อน (มีคนแก้ต่อ)", "Not reverted (edited later)", "未撤销（后续已修改）")}: <span translate="no">{b.revert_result.conflicts.map((c) => c.sku).join(", ")}</span></p> : null}
          </div>
          {canEdit && b.status === "applied" ? <Button variant="ghost" onClick={() => setRevert(b)}><Undo2 size={14} />{L("ย้อนกลับทั้งชุด", "Undo batch", "撤销整批")}</Button> : null}
        </div>
      )) : <EmptyState icon={<History size={24} />} title={L("ยังไม่มีการนำเข้าราคา", "No imports yet", "暂无导入")} body={L("การนำเข้าแต่ละครั้งจะเก็บเป็นชุด ย้อนกลับได้", "Each import is kept as a batch you can undo", "每次导入保存为一批，可撤销")} />}
      <Modal open={!!revert} onClose={() => setRevert(null)} size="sm" title={L("ย้อนกลับการนำเข้า", "Undo import", "撤销导入")}
        footer={<><Button variant="ghost" onClick={() => setRevert(null)}>{L("ปิด", "Close", "关闭")}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void doRevert()}><Undo2 size={14} />{L("ยืนยันย้อนกลับ", "Confirm undo", "确认撤销")}</Button></>}>
        <p className="text-sm">{L("ราคาหลักจะกลับเป็นค่าก่อนนำเข้า และราคาช่วงเวลาที่ชุดนี้สร้างจะถูกยกเลิก · ถ้าสินค้าไหนมีคนแก้ราคาหลังนำเข้า ระบบจะไม่ทับและแจ้งให้ทราบ", "List prices return to pre-import values and this batch's period prices are cancelled · products edited after the import are left untouched and reported", "标价恢复到导入前，本批时段价取消 · 导入后被修改的商品不会被覆盖并会提示")}</p>
        <Field label={L("เหตุผล (บังคับ)", "Reason (required)", "原因（必填）")}><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </Modal>
    </div>
  );
}

// ═════════════ ไทม์ไลน์ราคารายสินค้า ═════════════
type Ev = { id: number; kind: "list_price" | "rule_create" | "rule_update" | "rule_status"; rule_id: string | null; batch_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; actor_id: string | null; at: string };
export function ProductPriceTimeline({ product, canEdit, onClose, onRestoreList, onReuseRule }: { product: PProd; canEdit: { list: boolean; period: boolean }; onClose: () => void; onRestoreList: (price: number) => void; onReuseRule: (rule: Record<string, unknown>) => void }) {
  const { L, locale } = useI18n();
  const [d, setD] = useState<{ events: Ev[]; names: Record<string, string>; batches: Record<string, { title: string; status: string }> } | null>(null), [err, setErr] = useState("");
  useEffect(() => { void fetch(`/api/admin/pricing?view=history&product_id=${product.id}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) setErr(j.error); else setD(j); }); }, [product.id]);
  const dt = (s: string) => new Date(s).toLocaleString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  const ST: Record<string, string> = { active: L("ใช้งาน", "active", "启用"), paused: L("หยุด", "paused", "暂停"), cancelled: L("ยกเลิก", "cancelled", "取消") };
  return (
    <Modal open onClose={onClose} size="lg" title={<span className="inline-flex items-center gap-2" translate="no"><History size={16} />{L("ประวัติราคา", "Price history", "价格历史")} · {product.sku}</span>}>
      {err ? <p className="text-danger text-sm">{err}</p> : !d ? <Skeleton className="h-40" /> : !d.events.length ? <EmptyState icon={<History size={24} />} title={L("ยังไม่มีการเปลี่ยนราคา", "No price changes yet", "暂无价格变更")} body={L("ทุกการเปลี่ยนราคาหลักและราคาช่วงเวลาจะถูกบันทึกที่นี่", "Every list/period price change is recorded here", "所有标价与时段价变更都会记录在此")} /> : (
        <ol className="relative border-l-2 border-line ml-3 space-y-3 py-1">
          {d.events.map((e) => {
            const a = e.after ?? {}, b = e.before ?? {};
            const isList = e.kind === "list_price";
            const rule = !isList ? a : null;
            const title = isList ? L("เปลี่ยนราคาหลัก", "List price changed", "标价变更") : e.kind === "rule_create" ? L("สร้างราคาช่วงเวลา", "Period price created", "创建时段价") : e.kind === "rule_status" ? L("เปลี่ยนสถานะราคาช่วงเวลา", "Period price status", "时段价状态") : L("แก้ราคาช่วงเวลา", "Period price edited", "编辑时段价");
            return (
              <li key={e.id} className="ml-4">
                <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-surface ${isList ? "bg-brand" : e.kind === "rule_status" ? "bg-warn" : "bg-danger"}`} />
                <div className="rounded-xl border border-line px-3 py-2">
                  <p className="text-[12.5px] font-semibold flex flex-wrap items-center gap-1.5">{title}
                    {e.batch_id && d.batches[e.batch_id] ? <span className="text-[10.5px] px-1.5 rounded bg-surface2 font-normal">{L("ชุดนำเข้า", "Import", "导入")}: {d.batches[e.batch_id].title}{d.batches[e.batch_id].status === "reverted" ? ` (${L("ย้อนแล้ว", "reverted", "已撤销")})` : ""}</span> : null}</p>
                  {isList ? <p className="text-[12px] tnum">{baht(Number(b.price ?? 0))} → <b>{baht(Number(a.price ?? 0))}</b></p> : (
                    <p className="text-[12px]">{String(rule?.name ?? "")} · <b>{describeRule({ mode: rule?.mode as PriceMode, value: Number(rule?.value) })}</b>
                      <span className="text-muted"> · {toBkkYmd(String(rule?.starts_at))} – {toBkkYmd(String(rule?.ends_at), true)} · {Array.isArray(rule?.branch_ids) && (rule?.branch_ids as unknown[]).length ? L(`${(rule?.branch_ids as unknown[]).length} สาขา`, `${(rule?.branch_ids as unknown[]).length} branches`, `${(rule?.branch_ids as unknown[]).length} 家门店`) : L("ทุกสาขา", "All branches", "所有门店")}</span>
                      {e.kind === "rule_status" ? <span className="text-muted"> · {ST[String(b.status)] ?? b.status} → <b className="text-ink">{ST[String(a.status)] ?? a.status}</b></span> : null}</p>)}
                  <p className="text-[11px] text-muted">{dt(e.at)} · {d.names[e.actor_id ?? ""] ?? "—"}</p>
                  <div className="flex gap-1.5 mt-1.5">
                    {isList && canEdit.list && Number(b.price) > 0 ? <button onClick={() => onRestoreList(Number(b.price))} className="h-7 px-2 rounded-lg border border-line text-[11px] inline-flex items-center gap-1 hover:border-brand/50 hover:text-brand"><RotateCcw size={12} />{L(`ใช้ราคาเดิม ${baht(Number(b.price))} อีกครั้ง`, `Restore ${baht(Number(b.price))}`, `恢复为 ${baht(Number(b.price))}`)}</button> : null}
                    {!isList && canEdit.period && rule ? <button onClick={() => onReuseRule(rule)} className="h-7 px-2 rounded-lg border border-line text-[11px] inline-flex items-center gap-1 hover:border-brand/50 hover:text-brand"><RotateCcw size={12} />{L("ใช้ราคานี้อีกครั้ง (ตั้งช่วงใหม่)", "Reuse this price (new period)", "再次使用此价格（新时段）")}</button> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
