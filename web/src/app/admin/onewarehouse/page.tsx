"use client";

// =====================================================================
// คอนโซลเชื่อมต่อคลังกลาง (OneWarehouse /v1) — เห็นสถานะ + ดึงข้อมูลสดจริง
//   reads: status · warehouses · carriers · products · stock · serial
//   ⚠️ ปลายทางเป็น JST UAT (test) — SKU/สาขาจริงของเรายังไม่โหลดเข้า
// =====================================================================
import { useEffect, useState } from "react";
import { Cloud, CloudOff, Warehouse, Truck, Package, Boxes, ScanLine, Search, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Card, Button, Input, Badge, Select } from "@/components/ui";
import {
  owStatus, owWarehouses, owCarriersApi, owProductBySku, owStock, owSerial,
  type OwStatus, type OwWarehouse, type OwCarrier, type OwProduct, type OwStock, type OwSerial,
} from "@/lib/onewarehouse/ow-client";

export default function AdminOneWarehousePage() {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [status, setStatus] = useState<OwStatus | null>(null);
  const [warehouses, setWarehouses] = useState<OwWarehouse[]>([]);
  const [carriers, setCarriers] = useState<OwCarrier[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);

  // product + stock lookup
  const [pSku, setPSku] = useState("MOVA-Z200");
  const [prod, setProd] = useState<OwProduct | null>(null);
  const [prodMsg, setProdMsg] = useState("");
  const [pBusy, setPBusy] = useState(false);

  const [sSku, setSSku] = useState("MOVA-Z200");
  const [sWh, setSWh] = useState("33856");
  const [stock, setStock] = useState<OwStock | null>(null);
  const [stockMsg, setStockMsg] = useState("");
  const [sBusy, setSBusy] = useState(false);

  const [sn, setSn] = useState("");
  const [serial, setSerial] = useState<OwSerial | null>(null);
  const [snMsg, setSnMsg] = useState("");
  const [snBusy, setSnBusy] = useState(false);

  async function loadBase() {
    setLoadingBase(true);
    const st = await owStatus().catch(() => null);
    setStatus(st);
    if (st?.authConfigured) {
      const [w, c] = await Promise.all([owWarehouses(), owCarriersApi()]);
      setWarehouses(w.ok ? (w.data ?? []) : []);
      setCarriers(c.ok ? (c.data ?? []) : []);
      if (w.ok && w.data?.length && !w.data.find((x) => x.warehouse_id === sWh)) setSWh(w.data[0].warehouse_id);
    }
    setLoadingBase(false);
  }
  useEffect(() => { void loadBase(); /* eslint-disable-next-line */ }, []);

  async function lookupProduct() {
    const sku = pSku.trim(); if (!sku) return;
    setPBusy(true); setProd(null); setProdMsg("");
    const p = await owProductBySku(sku).catch(() => null);
    if (p) setProd(p); else setProdMsg(L(`ไม่พบ SKU "${sku}" ใน JST UAT`, `SKU "${sku}" not found in JST UAT`, `UAT无此SKU`));
    setPBusy(false);
  }
  async function lookupStock() {
    const sku = sSku.trim(); if (!sku || !sWh) return;
    setSBusy(true); setStock(null); setStockMsg("");
    const r = await owStock(sWh, [sku]).catch(() => null);
    if (r?.ok && r.data?.length) setStock(r.data[0]); else setStockMsg(r?.ok ? L("ไม่พบสต๊อก SKU นี้ในคลังนี้", "No stock for this SKU/warehouse", "无此库存") : L(`ผิดพลาด (${r?.error ?? "?"})`, `Error (${r?.error ?? "?"})`, "错误"));
    setSBusy(false);
  }
  async function lookupSerial() {
    const v = sn.trim(); if (!v) return;
    setSnBusy(true); setSerial(null); setSnMsg("");
    const r = await owSerial(v).catch(() => null);
    if (r?.ok && r.data) setSerial(r.data); else setSnMsg(L("ไม่พบ SN นี้ในคลังกลาง", "Serial not found in central WMS", "中央仓无此序列号"));
    setSnBusy(false);
  }

  const connected = !!status?.authConfigured;
  const baseHost = "onestock-…run.app"; // ไม่โชว์เต็ม/ไม่มี secret

  const money = (n: number | null) => (n == null ? L("— (ไม่ตั้ง)", "— (unset)", "—") : n === 0 ? "0" : n.toLocaleString());

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      {/* HEADER + STATUS */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={`w-11 h-11 rounded-2xl grid place-items-center ${connected ? "bg-emerald-500/12" : "bg-surface2"}`}>
            {connected ? <Cloud size={22} className="text-emerald-600" /> : <CloudOff size={22} className="text-muted" />}
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{L("เชื่อมต่อคลังกลาง", "OneWarehouse", "中央仓连接")}</h1>
            <p className="text-[11px] text-muted">{L("ดึงสินค้า/สต๊อก/SN สดจาก JST ผ่าน OneWarehouse /v1", "Live products/stock/SN from JST via OneWarehouse", "经OneWarehouse读取JST")}</p>
          </div>
        </div>
        <Button variant="soft" loading={loadingBase} onClick={() => void loadBase()}><RefreshCw size={14} /> {L("รีเฟรช", "Refresh", "刷新")}</Button>
      </div>

      {/* CONNECTION CARD */}
      <Card>
        <div className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            {connected ? <CheckCircle2 size={18} className="text-emerald-600" /> : <XCircle size={18} className="text-rose-500" />}
            <span className="font-semibold">{connected ? L("เชื่อมต่อแล้ว (สด)", "Connected (live)", "已连接") : status?.configured ? L("ยังไม่ครบ (ไม่มี token/sub)", "Not authed", "未认证") : L("ยังไม่ตั้งค่า", "Not configured", "未配置")}</span>
          </div>
          <Stat label={L("ปลายทาง", "Endpoint", "端点")} value={`${baseHost} · /v1`} />
          <Stat label={L("บัญชี (sub)", "Account (sub)", "账号")} value={status?.subNumeric ? "✓ 16" : "—"} />
          <Stat label="token" value={connected ? "✓" : "—"} />
        </div>
      </Card>

      {/* UAT NOTICE */}
      <div className="rounded-2xl border border-amber-400/40 bg-amber-50/60 dark:bg-amber-500/5 px-4 py-3 flex items-start gap-2 text-[12px] text-amber-800 dark:text-amber-300">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <span>{L("ปลายทางตอนนี้เป็น JST UAT (ทดสอบ) — SKU/สาขาจริงของเรายังไม่ถูกโหลดเข้า ลองด้วย SKU ตัวอย่าง MOVA-Z200 เพื่อเห็นข้อมูลสด พอโหลดของจริงเข้า UAT แล้วจะสลับ catalog/สต๊อกเป็น OW ได้",
          "Endpoint is JST UAT (test) — our real SKUs/branches not loaded yet. Try sample SKU MOVA-Z200 to see live data; once real data lands we switch catalog/stock to OW.",
          "当前为JST UAT测试环境")}</span>
      </div>

      {/* WAREHOUSES + CARRIERS */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <div className="px-4 pt-3 pb-1 text-sm font-semibold inline-flex items-center gap-1.5"><Warehouse size={15} className="text-brand" /> {L("คลังกลาง", "Warehouses", "中央仓")} <Badge tone="neutral">{warehouses.length}</Badge></div>
          <div className="p-4 pt-2 space-y-1.5">
            {warehouses.length ? warehouses.map((w) => (
              <div key={w.warehouse_id} className="flex items-center justify-between text-[12px] rounded-lg bg-surface2 border border-line px-3 py-2">
                <span className="font-mono">{w.warehouse_id}</span>
                <span className="text-muted truncate ml-2">{w.name_en || w.name_th || "—"}</span>
                <Badge tone={w.status === "active" ? "ok" : "neutral"}>{w.type}</Badge>
              </div>
            )) : <p className="text-[12px] text-muted">{connected ? L("ไม่มีข้อมูลคลัง", "No warehouses", "无") : L("เชื่อมต่อก่อน", "Connect first", "未连接")}</p>}
          </div>
        </Card>
        <Card>
          <div className="px-4 pt-3 pb-1 text-sm font-semibold inline-flex items-center gap-1.5"><Truck size={15} className="text-brand" /> {L("ขนส่ง", "Carriers", "承运")} <Badge tone="neutral">{carriers.length}</Badge></div>
          <div className="p-4 pt-2 flex flex-wrap gap-1.5">
            {carriers.length ? carriers.map((c) => (
              <span key={c.id} className="text-[11px] px-2 py-1 rounded-lg bg-surface2 border border-line">{c.name}</span>
            )) : <p className="text-[12px] text-muted">{connected ? L("ไม่มีข้อมูล", "None", "无") : L("เชื่อมต่อก่อน", "Connect first", "未连接")}</p>}
          </div>
        </Card>
      </div>

      {/* PRODUCT LOOKUP */}
      <Card>
        <div className="px-4 pt-3 pb-1 text-sm font-semibold inline-flex items-center gap-1.5"><Package size={15} className="text-brand" /> {L("ค้นสินค้า (JST สด)", "Product lookup (live)", "查商品")}</div>
        <div className="p-4 pt-2 space-y-3">
          <div className="flex gap-2">
            <Input value={pSku} onChange={(e) => setPSku(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void lookupProduct(); }} placeholder={L("พิมพ์ SKU เป๊ะ (เช่น MOVA-Z200)", "Exact SKU", "SKU")} className="font-mono text-sm" />
            <Button variant="primary" loading={pBusy} disabled={!connected} onClick={() => void lookupProduct()}><Search size={15} /> {L("ค้น", "Find", "查")}</Button>
          </div>
          {prod ? (
            <div className="rounded-xl border border-line bg-surface2 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div><p className="font-semibold">{prod.name || "—"}</p><p className="text-[11px] text-muted font-mono">{prod.sku}{prod.brand ? ` · ${prod.brand}` : ""}</p></div>
                <div className="flex gap-1.5">
                  {prod.is_combined ? <Badge tone="warn">{L("ชุดคอมโบ", "Combo", "套装")}</Badge> : null}
                  <Badge tone={prod.serial_tracking === true ? "brand" : prod.serial_tracking === null ? "danger" : "neutral"}>{prod.serial_tracking === true ? L("มี SN", "Serialized", "序列") : prod.serial_tracking === null ? L("ยังไม่จัดประเภท", "Unclassified", "未分类") : L("ไม่มี SN", "No SN", "无序列")}</Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[12px]">
                <PriceTile label={L("ขาย", "Sale", "售价")} v={money(prod.sale_price)} hi />
                <PriceTile label={L("สมาชิก", "Member", "会员")} v={money(prod.member_price)} />
                <PriceTile label={L("ส่ง", "Wholesale", "批发")} v={money(prod.wholesale_price)} />
                <PriceTile label={L("ป้าย", "Tag", "标价")} v={money(prod.tag_price)} />
                <PriceTile label={L("ทุน", "Cost", "成本")} v={money(prod.cost_price)} />
              </div>
              <p className="text-[10px] text-muted">{L("ราคา/ชื่อ = ค่า JST ตรง (0=ตั้ง 0 จริง · — = ไม่ตั้ง) · รูปมาจากแคตตาล็อกเรา", "JST-faithful (0=real 0, —=unset) · image from our catalog", "JST原值")}</p>
            </div>
          ) : prodMsg ? <p className="text-[12px] text-muted">{prodMsg}</p> : null}
        </div>
      </Card>

      {/* STOCK + SERIAL */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card>
          <div className="px-4 pt-3 pb-1 text-sm font-semibold inline-flex items-center gap-1.5"><Boxes size={15} className="text-brand" /> {L("เช็คสต๊อก (on-hand JST)", "Stock on-hand", "查库存")}</div>
          <div className="p-4 pt-2 space-y-3">
            <div className="flex gap-2">
              <Input value={sSku} onChange={(e) => setSSku(e.target.value)} placeholder="SKU" className="font-mono text-sm" />
              <Select value={sWh} onChange={(e) => setSWh(e.target.value)} className="w-28">{(warehouses.length ? warehouses.map((w) => w.warehouse_id) : ["33856", "33857"]).map((id) => <option key={id} value={id}>{id}</option>)}</Select>
            </div>
            <Button variant="primary" className="w-full" loading={sBusy} disabled={!connected} onClick={() => void lookupStock()}><Search size={15} /> {L("เช็ค", "Check", "查")}</Button>
            {stock ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
                <p className="text-[11px] text-muted">{stock.sku} @ {stock.warehouseId}</p>
                <p className="text-3xl font-bold text-emerald-600 tabular-nums">{stock.qty}</p>
                <p className="text-[11px] text-muted">{L("ชิ้น (on-hand สดจาก JST)", "pcs on-hand (live)", "件现货")}</p>
              </div>
            ) : stockMsg ? <p className="text-[12px] text-muted">{stockMsg}</p> : null}
          </div>
        </Card>
        <Card>
          <div className="px-4 pt-3 pb-1 text-sm font-semibold inline-flex items-center gap-1.5"><ScanLine size={15} className="text-brand" /> {L("ตรวจ Serial (OW)", "Serial lookup", "查序列")}</div>
          <div className="p-4 pt-2 space-y-3">
            <div className="flex gap-2">
              <Input value={sn} onChange={(e) => setSn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void lookupSerial(); }} placeholder={L("ยิง/พิมพ์ SN", "Scan/type SN", "SN")} className="font-mono text-sm" />
              <Button variant="primary" loading={snBusy} disabled={!connected} onClick={() => void lookupSerial()}><Search size={15} /></Button>
            </div>
            {serial ? (
              <div className="rounded-xl border border-line bg-surface2 p-3 space-y-1 text-[12px]">
                <p className="font-mono font-semibold">{serial.serialNo}</p>
                <p>{L("สถานะ", "Status", "状态")}: <b>{serial.status}</b></p>
                <p className="text-muted">{L("SKU", "SKU", "SKU")}: {serial.sku || "—"} · {L("คลัง", "WH", "仓")}: {serial.warehouseId || "—"}</p>
              </div>
            ) : snMsg ? <p className="text-[12px] text-muted">{snMsg}</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-muted uppercase tracking-wide">{label}</p><p className="text-sm font-medium font-mono">{value}</p></div>;
}
function PriceTile({ label, v, hi }: { label: string; v: string; hi?: boolean }) {
  return <div className={`rounded-lg px-2 py-1.5 text-center border ${hi ? "border-brand/40 bg-brand/5" : "border-line bg-surface"}`}><p className="text-[10px] text-muted">{label}</p><p className={`font-semibold tabular-nums ${hi ? "text-brand" : ""}`}>{v}</p></div>;
}
