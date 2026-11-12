"use client";

import { useMemo, useState } from "react";
import { Boxes, AlertTriangle, PackageX, TrendingDown, ListPlus, Infinity as InfIcon } from "lucide-react";
import { Drawer, Badge, Table, Th, Td, EmptyState } from "@/components/ui";
import { formatTHB, formatInt } from "@/lib/money";
import type { StockAnalysis, StockRow, StockStatus } from "@/lib/ai/stock";

type LFn = (th: string, en: string, zh: string) => string;
type Filter = "all" | "restock" | "overstock" | "idle";

const STATUS: Record<StockStatus, { tone: "danger" | "warn" | "ok" | "neutral" | "brand"; th: string; en: string; zh: string }> = {
  out: { tone: "danger", th: "หมด", en: "Out", zh: "缺货" },
  critical: { tone: "danger", th: "ต้องเติมด่วน", en: "Critical", zh: "急补" },
  low: { tone: "warn", th: "เหลือน้อย", en: "Low", zh: "偏低" },
  healthy: { tone: "ok", th: "ปกติ", en: "Healthy", zh: "正常" },
  overstock: { tone: "brand", th: "ค้างเยอะ", en: "Overstock", zh: "积压" },
  idle: { tone: "neutral", th: "ไม่เคลื่อนไหว", en: "Idle", zh: "滞销" },
};

export function StockDrawer({ open, onClose, analysis, locale, L, onRestock }: {
  open: boolean; onClose: () => void; analysis: StockAnalysis;
  locale: "th" | "en" | "zh"; L: LFn; onRestock: (r: StockRow) => void;
}) {
  const [f, setF] = useState<Filter>("restock");
  const { rows, summary } = analysis;

  const shown = useMemo(() => rows.filter((r) =>
    f === "all" ? true : f === "restock" ? (r.status === "out" || r.status === "critical" || r.status === "low")
    : f === "overstock" ? r.status === "overstock" : r.status === "idle"), [rows, f]);

  const sL = (s: StockStatus) => STATUS[s][locale];
  const daysLabel = (r: StockRow) => r.status === "out" ? "0" : r.daysLeft == null ? null : r.daysLeft >= 999 ? "999+" : String(Math.round(r.daysLeft));

  const Chip = ({ id, label, n, tone }: { id: Filter; label: string; n?: number; tone?: string }) => (
    <button onClick={() => setF(id)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${f === id ? "bg-brand text-white border-brand" : "border-line text-muted hover:text-brand"}`}>
      {label}{n != null ? <span className={`ml-1 ${f === id ? "" : tone ?? ""}`}>{n}</span> : null}
    </button>
  );

  const Stat = ({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) => (
    <div className="rounded-xl border border-line bg-surface p-2.5">
      <div className={`flex items-center gap-1 text-[11px] ${tone}`}>{icon}{label}</div>
      <p className="text-lg font-bold tnum mt-0.5">{value}</p>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} width="xl"
      title={<span className="flex items-center gap-2"><Boxes size={17} className="text-brand" />{L("วิเคราะห์สต๊อก · Days-of-Stock", "Stock · Days-of-Stock", "库存 · 可售天数")}</span>}
      badge={<Badge tone="brand">{summary.skuCount} SKU</Badge>}
      subtitle={L(`ความเร็วขายจาก ${summary.periodDays} วันล่าสุด · เหลือพออีกกี่วัน`, `Velocity from last ${summary.periodDays}d · days of cover`, `按最近${summary.periodDays}天销速`)}
    >
      <div className="p-4 space-y-3">
        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat icon={<PackageX size={12} />} label={L("หมด", "Out", "缺货")} value={formatInt(summary.out)} tone="text-danger" />
          <Stat icon={<AlertTriangle size={12} />} label={L("ต้องเติมด่วน", "Critical", "急补")} value={formatInt(summary.critical)} tone="text-danger" />
          <Stat icon={<TrendingDown size={12} />} label={L("เหลือน้อย", "Low", "偏低")} value={formatInt(summary.low)} tone="text-amber-600" />
          <Stat icon={<Boxes size={12} />} label={L("มูลค่าสต๊อก", "Stock value", "库存值")} value={formatTHB(summary.totalValue, false)} tone="text-muted" />
        </div>

        {/* ฟิลเตอร์ */}
        <div className="flex flex-wrap gap-1.5">
          <Chip id="restock" label={L("ต้องเติม", "Needs restock", "需补货")} n={summary.out + summary.critical + summary.low} tone="text-danger" />
          <Chip id="all" label={L("ทั้งหมด", "All", "全部")} n={summary.skuCount} />
          <Chip id="overstock" label={L("ค้างเยอะ", "Overstock", "积压")} n={summary.overstock} />
          <Chip id="idle" label={L("ไม่เคลื่อนไหว", "Idle", "滞销")} n={summary.idle} />
        </div>

        {/* ตาราง */}
        {!shown.length ? (
          <EmptyState icon={<Boxes size={24} />} title={L("ไม่มีสินค้าในหมวดนี้", "Nothing here", "无数据")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead><tr>
                <Th>{L("สินค้า", "Product", "商品")}</Th>
                <Th align="right">{L("คงเหลือ", "On-hand", "在库")}</Th>
                <Th align="right">{L("ขาย/วัน", "Sold/day", "日销")}</Th>
                <Th align="right">{L("เหลือ (วัน)", "Days left", "可售天")}</Th>
                <Th>{L("สถานะ", "Status", "状态")}</Th>
                <Th align="right"></Th>
              </tr></thead>
              <tbody>{shown.map((r) => {
                const dl = daysLabel(r);
                return (
                  <tr key={r.productId}>
                    <Td className="max-w-[240px]"><div className="truncate font-medium">{r.name}</div><div className="text-[10px] text-muted">{r.sku}</div></Td>
                    <Td align="right" className={`tnum font-semibold ${r.onHand <= 0 ? "text-danger" : r.status === "critical" ? "text-danger" : ""}`}>{formatInt(r.onHand)}</Td>
                    <Td align="right" className="tnum text-muted">{r.velocity ? r.velocity : "—"}</Td>
                    <Td align="right" className="tnum">{dl == null ? <span className="text-muted inline-flex items-center gap-0.5"><InfIcon size={12} /></span> : <span className={r.status === "out" || r.status === "critical" ? "text-danger font-semibold" : r.status === "low" ? "text-amber-600" : ""}>{dl}</span>}</Td>
                    <Td><Badge tone={STATUS[r.status].tone}>{sL(r.status)}</Badge></Td>
                    <Td align="right">{(r.status === "out" || r.status === "critical" || r.status === "low") ? <button onClick={() => onRestock(r)} title={L("สร้างงานเติมสต๊อก", "Create restock task", "创建补货任务")} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-brand/30 text-brand hover:bg-brand/8"><ListPlus size={12} />{L("เติม", "Restock", "补货")}</button> : null}</Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          </div>
        )}
        <p className="text-[10.5px] text-muted">{L("เหลือ(วัน) = คงเหลือ ÷ ความเร็วขายต่อวัน · ∞ = ยังไม่มีการขายในช่วงนี้ · คิดในเครื่องตามสิทธิ์ของคุณ", "Days left = on-hand ÷ daily velocity · ∞ = no sales in period", "可售天 = 在库 ÷ 日销速")}</p>
      </div>
    </Drawer>
  );
}
