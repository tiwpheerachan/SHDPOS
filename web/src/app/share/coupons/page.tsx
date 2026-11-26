"use client";
// ─────────────────────────────────────────────────────────────
// หน้าแชร์รายงานการใช้คูปอง (อ่านอย่างเดียว) — /share/coupons
//   ไม่มีเมนู/แถบนำทาง · มี KPI + Top แคมเปญ + รายการใช้ล่าสุด + ปริ้น/ดาวน์โหลด
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { Ticket, Printer, Download, TrendingDown, Receipt, Tag } from "lucide-react";
import { bootstrap } from "@/lib/data/repo";
import { listCouponUsages, type CouponUsage } from "@/lib/data/coupons";
import { downloadExcel } from "@/lib/export";
import { useL } from "@/lib/i18n/provider";

const thb = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
const fmtDate = (s: string) => s.slice(0, 10);
const fmtTime = (s: string) => new Date(s).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

export default function ShareCouponsPage() {
  const L = useL();
  const [ready, setReady] = useState(false);
  const [usages, setUsages] = useState<CouponUsage[]>([]);

  useEffect(() => { (async () => { try { await bootstrap(); setUsages(await listCouponUsages()); } finally { setReady(true); } })(); }, []);

  const kpi = useMemo(() => {
    const discount = usages.reduce((s, u) => s + u.discount, 0);
    const bill = usages.reduce((s, u) => s + u.bill_total, 0);
    return { uses: usages.length, discount, bill, avg: usages.length ? discount / usages.length : 0 };
  }, [usages]);

  const top = useMemo(() => {
    const m = new Map<string, { name: string; count: number; discount: number }>();
    usages.forEach((u) => { const k = u.campaign_id || u.code; const c = m.get(k) ?? { name: u.campaign_name, count: 0, discount: 0 }; c.count++; c.discount += u.discount; m.set(k, c); });
    return [...m.values()].sort((a, b) => b.discount - a.discount);
  }, [usages]);
  const maxD = Math.max(1, ...top.map((t) => t.discount));

  const period = usages.length ? `${fmtDate(usages[usages.length - 1].at)} → ${fmtDate(usages[0].at)}` : "";

  function exportXls() {
    downloadExcel("coupons-usage", [
      { key: "at", label: L("วันที่", "Date", "日期"), map: (r: CouponUsage) => fmtDate(r.at) },
      { key: "time", label: L("เวลา", "Time", "时间"), map: (r: CouponUsage) => fmtTime(r.at) },
      { key: "order_no", label: L("เลขบิล", "Bill no.", "单号") },
      { key: "campaign_name", label: L("แคมเปญ", "Campaign", "活动") },
      { key: "code", label: L("โค้ด", "Code", "代码") },
      { key: "products", label: L("สินค้า", "Products", "商品"), map: (r: CouponUsage) => r.products.map((p) => `${p.name}×${p.qty}`).join(", ") },
      { key: "branch_name", label: L("สาขา", "Branch", "门店") },
      { key: "customer_name", label: L("ลูกค้า", "Customer", "客户"), map: (r: CouponUsage) => r.customer_name ?? "-" },
      { key: "discount", label: L("ส่วนลด", "Discount", "折扣"), map: (r: CouponUsage) => thb(r.discount) },
      { key: "bill_total", label: L("ยอดสุทธิ", "Net total", "净额"), map: (r: CouponUsage) => thb(r.bill_total) },
    ], usages, L("รายการใช้คูปอง", "Coupon usage", "优惠券使用记录"));
  }

  if (!ready) return <div className="min-h-screen grid place-items-center text-slate-400 text-sm">{L("กำลังโหลด…", "Loading…", "加载中…")}</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-5xl mx-auto p-4 sm:p-8">
        {/* หัว */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-2xl bg-slate-900 grid place-items-center"><Ticket size={20} className="text-white" /></span>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{L("รายงานการใช้คูปอง", "Coupon usage report", "优惠券使用报告")}</h1>
              <p className="text-xs text-slate-500">SHD POS · {period}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-sm hover:bg-slate-100"><Printer size={15} /> {L("พิมพ์", "Print", "打印")}</button>
            <button onClick={exportXls} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-slate-900 text-white text-sm hover:bg-slate-800"><Download size={15} /> {L("ดาวน์โหลด Excel", "Download Excel", "下载 Excel")}</button>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {[
            { icon: <Ticket size={15} />, label: L("จำนวนการใช้", "Uses", "使用次数"), value: kpi.uses.toLocaleString() },
            { icon: <TrendingDown size={15} />, label: L("ส่วนลดรวม", "Total discount", "折扣总额"), value: `฿${thb(kpi.discount)}` },
            { icon: <Receipt size={15} />, label: L("ยอดบิลรวม", "Total bill amount", "单据总额"), value: `฿${thb(kpi.bill)}` },
            { icon: <Tag size={15} />, label: L("เฉลี่ยส่วนลด/บิล", "Avg discount/bill", "平均每单折扣"), value: `฿${thb(kpi.avg)}` },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl bg-white border border-slate-200 p-4">
              <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-2">{k.icon}{k.label}</div>
              <div className="text-2xl font-bold tnum">{k.value}</div>
            </div>
          ))}
        </div>

        {/* Top แคมเปญ */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5 mb-5">
          <h2 className="font-semibold mb-4">{L("Top แคมเปญ (ตามส่วนลดรวม)", "Top campaigns (by total discount)", "热门活动（按折扣总额）")}</h2>
          <div className="space-y-3">
            {top.map((t) => (
              <div key={t.name}>
                <div className="flex items-baseline justify-between text-sm mb-1"><span className="font-medium">{t.name} <span className="text-slate-400 text-xs">· {t.count} {L("ครั้ง", "uses", "次")}</span></span><span className="tnum font-semibold">฿{thb(t.discount)}</span></div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-slate-900" style={{ width: `${(t.discount / maxD) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        {/* รายการใช้ล่าสุด */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5">
          <h2 className="font-semibold mb-3">{L("รายการใช้ล่าสุด", "Recent usage", "最近使用")} <span className="text-slate-400 text-sm font-normal">({usages.length} {L("รายการ", "items", "条")})</span></h2>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 px-2">{L("วัน-เวลา", "Date-time", "日期时间")}</th><th className="px-2">{L("เลขบิล", "Bill no.", "单号")}</th><th className="px-2">{L("แคมเปญ", "Campaign", "活动")}</th><th className="px-2">{L("สินค้า", "Products", "商品")}</th><th className="px-2">{L("สาขา", "Branch", "门店")}</th><th className="px-2 text-right">{L("ส่วนลด", "Discount", "折扣")}</th><th className="px-2 text-right">{L("ยอดสุทธิ", "Net total", "净额")}</th>
              </tr></thead>
              <tbody>
                {usages.slice(0, 200).map((u) => (
                  <tr key={u.id} className="border-b border-slate-50">
                    <td className="py-2 px-2 whitespace-nowrap text-xs">{fmtDate(u.at)} <span className="text-slate-400">{fmtTime(u.at)}</span></td>
                    <td className="px-2 font-mono text-[11px] text-slate-400" translate="no">{u.order_no}</td>
                    <td className="px-2 text-xs">{u.campaign_name} <span className="text-slate-400" translate="no">· {u.code}</span></td>
                    <td className="px-2 text-xs max-w-[200px] truncate" translate="no" title={u.products.map((p) => `${p.name}×${p.qty}`).join(", ")}>{u.products.map((p) => `${p.name}×${p.qty}`).join(", ") || "—"}</td>
                    <td className="px-2 text-xs text-slate-500">{u.branch_name}</td>
                    <td className="px-2 text-right tnum text-rose-600">-฿{thb(u.discount)}</td>
                    <td className="px-2 text-right tnum">฿{thb(u.bill_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">{L("สร้างโดย SHD POS · ลิงก์อ่านอย่างเดียว", "Generated by SHD POS · read-only link", "由 SHD POS 生成 · 只读链接")}</p>
      </div>
    </div>
  );
}
