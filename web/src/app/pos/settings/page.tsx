"use client";
// =====================================================================
// หน้าร้าน → ตั้งค่าเครื่องนี้
//   สถานะรวม (เครื่องพิมพ์/จอลูกค้า/ข้อมูล) · เครื่องพิมพ์ (เลือกช่องทาง → เชื่อมต่อ → ทดสอบ) + ตัวอย่างใบเสร็จจริง
//   จอลูกค้า · การแสดงผล · ข้อมูลในเครื่อง
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings2, Printer, Inbox, Monitor, Database, Palette, Usb, MonitorSmartphone, Router, Cable, Smartphone, CheckCircle2, AlertCircle, Loader2, RefreshCw, Wifi, WifiOff, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { Button, Card, Input, Field, Select, Segmented, Badge } from "@/components/ui";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dict";
import { bridgeStatus, connectWebSerial, openCashDrawer, printEscPos, webSerialSupported, type PrintTransport } from "@/lib/printing/bridge";
import { buildReceipt } from "@/lib/printing/receipt";
import { connectUsbPrinter, reconnectUsbPrinter, usbPrinterName, webUsbSupported } from "@/lib/printing/webusb";
import { shellInfo, type ShellInfo } from "@/lib/printing/shell";
import { openDisplayWindow } from "@/lib/customer-display";
import { isLiveMode } from "@/lib/supabase/client";
import { getBranch, resetLocalData } from "@/lib/data/repo";
import { DisplaySettings } from "@/components/pos/display-settings";
import { getSyncState } from "@/lib/offline/sync";
import type { Branch, Employee, Order } from "@/lib/types";

// ข้อมูลบริษัทบนใบเสร็จทดสอบ (เหมือนหน้าขาย)
const COMPANY = { name_th: "บริษัท เอส เอช ดี เทคโนโลยี จำกัด", tax_id: "0000000000000", address: "กรุงเทพมหานคร", phone: "02-000-0000" };

type Section = "printer" | "display" | "appearance" | "data";
type Pick3 = (th: string, en: string, zh: string) => string;

/** ใบเสร็จตัวอย่าง (ใช้ทั้งภาพตัวอย่างและทดสอบพิมพ์ — ไม่ได้สร้างบิลจริง) */
function sampleReceipt(L: Pick3, width: number, branch: Branch | null, cashier: Employee | null) {
  const order = {
    order_no: "TEST-0001", created_at: new Date().toISOString(), customer_name: null, subtotal: 1490, discount_total: 100, grand_total: 1390, vat_amount: 90.93, change_amount: 10, is_offline_origin: false,
    items: [
      { name: L("สินค้าทดสอบ ภาษาไทย ๑๒๓", "Test product", "测试商品"), qty: 1, unit_price: 1290, line_total: 1290, discount_amount: 100, serials: ["SN-TEST-001"] },
      { name: "Test item 2", qty: 2, unit_price: 100, line_total: 200, discount_amount: 0, serials: [] },
    ],
    payments: [{ method: "cash", amount: 1400 }],
  } as unknown as Order;
  return buildReceipt({ order, branch: branch ?? undefined, cashier: cashier ?? undefined, company: COMPANY, width,
    copyLabel: L("ทดสอบการพิมพ์ — ไม่ใช่ใบเสร็จจริง", "TEST PRINT — not a real receipt", "打印测试 — 非正式小票"),
    docUrl: typeof window !== "undefined" ? window.location.origin : null });
}

export default function PosSettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const L: Pick3 = useCallback((th, en, zh) => (locale === "th" ? th : locale === "zh" ? zh : en), [locale]);
  const { mode, setMode } = useTheme();
  const toast = useToast();
  const session = useSession();
  const transport = session.printer.transport;
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [sunmi, setSunmi] = useState<ShellInfo | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [usbName, setUsbName] = useState<string | null>(null), [usbChecking, setUsbChecking] = useState(false);
  const [serialOk, setSerialOk] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lastTest, setLastTest] = useState<{ ok: boolean; at: Date; msg?: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [section, setSection] = useState<Section>("printer");

  useEffect(() => { if (session.branchId) void getBranch(session.branchId).then((b) => setBranch(b ?? null)).catch(() => undefined); }, [session.branchId]);
  useEffect(() => { setSunmi(shellInfo()); }, []);
  // เครื่องพิมพ์ USB ที่เคยอนุญาตแล้ว → ต่ออัตโนมัติ
  useEffect(() => {
    if (transport !== "usb") return;
    setUsbChecking(true);
    void reconnectUsbPrinter().then((ok) => setUsbName(ok ? usbPrinterName() : null)).finally(() => setUsbChecking(false));
  }, [transport]);
  useEffect(() => {
    if (transport !== "bridge") return;
    void bridgeStatus(session.printer).then((r) => { setBridgeOk(r.ok); setPrinters(r.printers ?? []); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, session.printer.bridgeUrl]);
  // ภาพตัวอย่างใบเสร็จ (วาดแบบเดียวกับที่ส่งไปเครื่องพิมพ์)
  useEffect(() => {
    let alive = true;
    void import("@/lib/printing/render-image").then(({ renderReceiptPng }) =>
      renderReceiptPng(sampleReceipt(L, session.printer.width, branch, session.employee), session.printer.width <= 32 ? 384 : 576))
      .then((png) => { if (alive) setPreview(png); }).catch(() => undefined);
    return () => { alive = false; };
  }, [L, session.printer.width, branch, session.employee]);

  async function connectUsb() {
    const r = await connectUsbPrinter();
    setUsbName(r.ok ? r.name ?? usbPrinterName() : null);
    toast.push(r.ok ? { tone: "ok", title: L("เชื่อมต่อเครื่องพิมพ์แล้ว", "Printer connected", "打印机已连接"), body: r.name }
      : { tone: "warn", title: L("เชื่อมต่อไม่สำเร็จ", "Connection failed", "连接失败"), body: /NotFound|No device selected/i.test(r.error ?? "") ? L("ยังไม่ได้เลือกเครื่องพิมพ์", "No printer selected", "未选择打印机") : /Access denied|SecurityError|claim/i.test(r.error ?? "") ? L("เครื่องพิมพ์ถูกโปรแกรมอื่นใช้อยู่ (เช่นไดรเวอร์บน Windows) — ใช้โหมด “ไดรเวอร์เครื่อง” แทน", "The printer is held by another driver (e.g. on Windows) — use “System driver” instead", "打印机被其他驱动占用（如 Windows）— 请改用“系统驱动”") : r.error });
  }

  async function testPrint() {
    // USB ยังไม่เชื่อม → ให้เลือกเครื่องก่อน (ต้องเรียกตอนกดปุ่มทันที)
    if (transport === "usb" && !usbPrinterName() && !(await reconnectUsbPrinter())) { await connectUsb(); if (!usbPrinterName()) return; }
    setTesting(true);
    try {
      const res = await printEscPos(session.printer, sampleReceipt(L, session.printer.width, branch, session.employee));
      setLastTest({ ok: res.ok, at: new Date(), msg: res.error ?? undefined });
      toast.push(res.ok ? { tone: "ok", title: L("ส่งงานพิมพ์แล้ว", "Sent to printer", "已发送打印"), body: L("ถ้ากระดาษไม่ออก ตรวจสายและไฟเครื่องพิมพ์", "If nothing prints, check the cable and power", "若未出纸，请检查连线与电源") } : { tone: "danger", title: t.pos.printFailed, body: res.error ?? undefined });
    } finally { setTesting(false); }
  }

  async function testDrawer() {
    const res = await openCashDrawer(session.printer);
    toast.push(res.ok ? { tone: "ok", title: t.settings.testDrawer } : { tone: "danger", title: t.pos.printFailed, body: res.error ?? undefined });
  }

  const sync = getSyncState();
  const hasDrawer = transport === "bridge" || transport === "webserial";

  // ช่องทางพิมพ์ (การ์ดเลือก)
  const methods = useMemo(() => [
    ...(sunmi ? [{ v: "sunmi" as PrintTransport, icon: <Smartphone size={18} />, title: L("เครื่องพิมพ์ในตัว Sunmi", "Sunmi built-in printer", "Sunmi 内置打印机"), desc: L("เปิดผ่านแอป SHD POS — พิมพ์อัตโนมัติ", "Running in the SHD POS app — prints automatically", "在 SHD POS 应用中 — 自动打印"), rec: true }] : []),
    { v: "usb" as PrintTransport, icon: <Usb size={18} />, title: L("USB ตรงจากเบราว์เซอร์", "USB from the browser", "浏览器直连 USB"), desc: L("ไม่ต้องลงโปรแกรม · พิมพ์ทันที · ไทยออกถูก", "No install · instant · Thai prints correctly", "无需安装 · 即时打印 · 泰文正确"), rec: !sunmi },
    { v: "browser" as PrintTransport, icon: <MonitorSmartphone size={18} />, title: L("ไดรเวอร์ในเครื่อง", "System driver", "系统驱动"), desc: L("ผ่านหน้าต่างพิมพ์ของคอม · ต้องลงไดรเวอร์", "Via the computer's print dialog · needs a driver", "通过电脑打印对话框 · 需驱动"), rec: false },
    { v: "bridge" as PrintTransport, icon: <Router size={18} />, title: "Print Bridge", desc: L("โปรแกรมตัวกลาง · LAN/USB + ลิ้นชัก", "Helper app · LAN/USB + cash drawer", "中转程序 · LAN/USB + 钱箱"), rec: false },
    { v: "webserial" as PrintTransport, icon: <Cable size={18} />, title: "Serial", desc: L("เครื่องพิมพ์สาย Serial/COM", "Serial/COM printers", "串口打印机"), rec: false },
  ], [L, sunmi]);

  // สถานะเครื่องพิมพ์ของช่องทางที่เลือก
  const printerState: { ok: boolean | null; label: string } =
    transport === "sunmi" || (sunmi && transport !== "browser") ? { ok: !!sunmi?.printer, label: sunmi?.printer ? L(`พร้อม · Sunmi ${sunmi.model}`, `Ready · Sunmi ${sunmi.model}`, `就绪 · Sunmi ${sunmi.model}`) : L("ยังเชื่อมเครื่องพิมพ์ในตัวไม่ได้", "Built-in printer not connected", "内置打印机未连接") }
    : transport === "usb" ? (usbChecking ? { ok: null, label: L("กำลังตรวจ…", "Checking…", "检查中…") } : usbName ? { ok: true, label: usbName } : { ok: false, label: L("ยังไม่ได้เชื่อมต่อ", "Not connected", "未连接") })
    : transport === "bridge" ? (bridgeOk === null ? { ok: null, label: L("กำลังตรวจ…", "Checking…", "检查中…") } : bridgeOk ? { ok: true, label: "Bridge OK" } : { ok: false, label: L("ติดต่อ Print Bridge ไม่ได้", "Print Bridge offline", "无法连接 Print Bridge") })
    : transport === "webserial" ? (serialOk ? { ok: true, label: L("เชื่อมต่อแล้ว", "Connected", "已连接") } : { ok: false, label: L("ยังไม่ได้เชื่อมต่อ", "Not connected", "未连接") })
    : transport === "browser" ? { ok: true, label: L("ใช้เครื่องพิมพ์หลักของคอม", "Uses the computer's default printer", "使用电脑默认打印机") }
    : { ok: false, label: L("ยังไม่ได้ตั้งค่า", "Not set up", "未设置") };

  const Dot = ({ ok }: { ok: boolean | null }) => ok === null ? <Loader2 size={14} className="animate-spin text-muted" /> : ok ? <CheckCircle2 size={15} className="text-ok" /> : <AlertCircle size={15} className="text-warn" />;

  const sections: { id: Section; icon: React.ReactNode; title: string; sub: string; ok: boolean | null }[] = [
    { id: "printer", icon: <Printer size={18} />, title: L("เครื่องพิมพ์ใบเสร็จ", "Receipt printer", "小票打印机"), sub: printerState.label, ok: printerState.ok },
    { id: "display", icon: <Monitor size={18} />, title: t.settings.customerDisplay, sub: sunmi ? (sunmi.secondScreen ? L("จอที่สอง Sunmi พร้อม", "Sunmi second screen ready", "Sunmi 副屏就绪") : L("ไม่พบจอที่สอง", "No second screen", "未检测到副屏")) : L("เปิดเป็นหน้าต่างที่สอง", "Opens as a second window", "以第二窗口打开"), ok: sunmi ? sunmi.secondScreen : null },
    { id: "appearance", icon: <Palette size={18} />, title: t.settings.appearance, sub: `${mode === "light" ? t.settings.light : mode === "dark" ? t.settings.dark : t.settings.system} · ${LOCALE_LABEL[locale]}`, ok: null },
    { id: "data", icon: <Database size={18} />, title: t.settings.dataMode, sub: sync.failed ? L(`ส่งไม่สำเร็จ ${sync.failed}`, `${sync.failed} failed`, `${sync.failed} 失败`) : sync.pending ? L(`รอซิงก์ ${sync.pending}`, `${sync.pending} pending`, `待同步 ${sync.pending}`) : sync.online ? L("ออนไลน์ · ซิงก์ครบ", "Online · all synced", "在线 · 已全部同步") : L("ออฟไลน์", "Offline", "离线"), ok: sync.online && !sync.failed && !sync.pending },
  ];
  const cur = sections.find((s) => s.id === section)!;
  const browserName = typeof navigator === "undefined" ? "—" : /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome\//.test(navigator.userAgent) ? "Chrome" : /Safari\//.test(navigator.userAgent) ? "Safari" : /Firefox\//.test(navigator.userAgent) ? "Firefox" : "—";

  return (
    <div className="p-4 sm:p-5 flex flex-col gap-4 lg:h-[calc(100vh-3.5rem-1px)] lg:overflow-hidden">
      {/* หัว */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 rounded-2xl bg-brand/12 text-brand grid place-items-center"><Settings2 size={22} /></span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">{t.settings.title}</h1>
            <p className="text-xs text-muted">{L("ตั้งค่าเฉพาะเครื่องนี้", "Settings for this device", "本机设置")}{branch ? <> · <span translate="no">{branch.name_th || branch.name}</span></> : null}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill icon={<Printer size={14} />} ok={printerState.ok} label={L("เครื่องพิมพ์", "Printer", "打印机")} value={printerState.ok ? L("พร้อม", "Ready", "就绪") : printerState.ok === null ? "…" : L("ยังไม่พร้อม", "Not ready", "未就绪")} />
          <StatusPill icon={sync.online ? <Wifi size={14} /> : <WifiOff size={14} />} ok={sync.online && !sync.failed} label={L("ข้อมูล", "Data", "数据")} value={sync.pending ? L(`รอซิงก์ ${sync.pending}`, `${sync.pending} pending`, `待同步 ${sync.pending}`) : sync.online ? L("ออนไลน์", "Online", "在线") : L("ออฟไลน์", "Offline", "离线")} />
        </div>
      </div>

      <div className="flex-1 grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4 min-h-0">
        {/* เมนูหมวด */}
        <nav className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-hidden lg:min-h-0" aria-label={t.settings.title}>
          {sections.map((s) => {
            const on = s.id === section;
            return (
              <button key={s.id} type="button" onClick={() => setSection(s.id)} aria-current={on ? "page" : undefined}
                className={`shrink-0 lg:w-full text-left rounded-2xl border p-3.5 flex items-center gap-3 transition-colors ${on ? "border-brand/40 bg-surface shadow-card ring-1 ring-brand/20" : "border-transparent bg-surface/60 hover:bg-surface"}`}>
                <span className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${on ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>{s.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold truncate">{s.title}</span>
                  <span className="block text-[11.5px] text-muted truncate" translate="no">{s.sub}</span>
                </span>
                {s.ok === null ? null : s.ok ? <CheckCircle2 size={16} className="text-ok shrink-0 hidden lg:block" /> : <AlertCircle size={16} className="text-warn shrink-0 hidden lg:block" />}
              </button>
            );
          })}
          {/* ข้อมูลเครื่องนี้ */}
          <div className="hidden lg:block mt-auto rounded-2xl border border-line/70 bg-surface/60 p-4 space-y-2 text-xs">
            <p className="text-[13px] font-semibold">{L("เครื่องนี้", "This device", "本机")}</p>
            <InfoRow k={L("สาขา", "Branch", "门店")} v={branch ? (branch.name_th || branch.name) : "—"} />
            <InfoRow k={L("ผู้ใช้", "User", "用户")} v={session.employee ? (session.employee.nickname || session.employee.first_name || "—") : "—"} />
            <InfoRow k={L("เบราว์เซอร์", "Browser", "浏览器")} v={browserName} />
            <InfoRow k="USB" v={webUsbSupported() ? L("รองรับ", "Supported", "支持") : L("ไม่รองรับ", "Not supported", "不支持")} />
            <InfoRow k={L("โหมด", "Mode", "模式")} v={sunmi ? `Sunmi ${sunmi.model}` : isLiveMode() ? L("ระบบจริง", "Live", "正式") : L("สาธิต", "Demo", "演示")} />
          </div>
        </nav>

        {/* เนื้อหาหมวด */}
        <Card className="min-h-0 lg:h-full flex flex-col overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line/70 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{cur.title}</h2>
              <p className="text-xs text-muted">
                {section === "printer" ? L("เลือกวิธีต่อ → เชื่อมต่อ → ทดสอบพิมพ์ · ใบเสร็จส่งเป็นรูป ภาษาไทยออกถูกทุกยี่ห้อ", "Choose method → connect → test print · receipts are sent as images so Thai prints correctly", "选择方式 → 连接 → 测试打印 · 小票以图片发送，泰文正确")
                  : section === "display" ? L("หน้าจอที่หันหาลูกค้า แสดงตะกร้า ยอด และ QR ชำระเงิน", "The customer-facing screen shows the cart, total and payment QR", "面向顾客的屏幕显示购物车、金额与付款二维码")
                  : section === "appearance" ? L("โหมดสีและภาษาของเครื่องนี้", "Color mode and language for this device", "本机的颜色模式与语言")
                  : L("บิลที่ขายขณะออฟไลน์จะเก็บในเครื่องแล้วส่งขึ้นเซิร์ฟเวอร์อัตโนมัติ", "Bills made offline are kept on this device and synced automatically", "离线开单保存在本机并自动同步")}
              </p>
            </div>
            {section === "data" ? <Badge tone={isLiveMode() ? "ok" : "warn"}>{isLiveMode() ? L("ระบบจริง", "Live", "正式") : L("สาธิต", "Demo", "演示")}</Badge> : null}
          </div>

          <div className="flex-1 min-h-0 overflow-auto lg:overflow-hidden">
            {section === "printer" ? (
              <div className="grid xl:grid-cols-[minmax(0,1fr)_400px] h-full min-h-0">
                <div className="p-5 space-y-4 min-w-0 min-h-0 lg:overflow-auto">
                  {/* 1) วิธีต่อ */}
                  <section>
                    <StepTitle n={1} text={L("วิธีต่อเครื่องพิมพ์", "How the printer connects", "打印机连接方式")} />
                    <div className="grid sm:grid-cols-2 2xl:grid-cols-4 gap-2.5">
                      {methods.map((m) => {
                        const on = transport === m.v;
                        return (
                          <button key={m.v} type="button" onClick={() => session.setPrinter({ transport: m.v })} aria-pressed={on}
                            className={`relative text-left rounded-2xl border p-3 flex flex-col gap-2 transition-colors ${on ? "border-brand bg-brand/[0.06] ring-1 ring-brand/30" : "border-line hover:bg-surface2"}`}>
                            {m.rec ? <span className="absolute top-2.5 right-2.5 text-[10px] px-1.5 py-0.5 rounded-full bg-ok/12 text-ok font-medium">{L("แนะนำ", "Recommended", "推荐")}</span> : null}
                            <span className={`h-9 w-9 rounded-xl grid place-items-center ${on ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>{m.icon}</span>
                            <span>
                              <span className="block text-[13px] font-semibold">{m.title}</span>
                              <span className="block text-[11px] text-muted leading-snug mt-0.5 line-clamp-2">{m.desc}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  {/* 2) เชื่อมต่อ */}
                  <section>
                    <StepTitle n={2} text={L("เชื่อมต่อ", "Connect", "连接")} />
                    <div className={`rounded-2xl border p-4 space-y-2.5 ${printerState.ok ? "border-ok/30 bg-ok/[0.04]" : printerState.ok === false ? "border-warn/30 bg-warn/[0.04]" : "border-line"}`}>
                      <div className="flex flex-wrap items-center gap-3 justify-between">
                        <span className="inline-flex items-center gap-3 min-w-0">
                          <span className={`h-11 w-11 rounded-xl grid place-items-center shrink-0 ${printerState.ok ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}><Printer size={20} /></span>
                          <span className="min-w-0">
                            <span className="block text-[15px] font-semibold truncate" translate="no">{printerState.label}</span>
                            <span className="inline-flex items-center gap-1 text-xs text-muted"><Dot ok={printerState.ok} />{printerState.ok ? L("พร้อมพิมพ์", "Ready to print", "可打印") : printerState.ok === null ? L("กำลังตรวจ", "Checking", "检查中") : L("ยังไม่พร้อม", "Not ready", "未就绪")}</span>
                          </span>
                        </span>
                        {transport === "usb" ? (
                          <Button variant={usbName ? "soft" : "primary"} disabled={!webUsbSupported()} onClick={() => void connectUsb()}><Usb size={15} />{usbName ? L("เปลี่ยนเครื่องพิมพ์", "Change printer", "更换打印机") : L("เชื่อมต่อ USB", "Connect USB", "连接 USB")}</Button>
                        ) : transport === "webserial" ? (
                          <Button variant="primary" disabled={!webSerialSupported()} onClick={async () => { const ok = await connectWebSerial(); setSerialOk(ok); toast.push(ok ? { tone: "ok", title: L("เชื่อมต่อแล้ว", "Connected", "已连接") } : { tone: "warn", title: L("เชื่อมต่อไม่สำเร็จ", "Connection failed", "连接失败") }); }}><Cable size={15} />{L("เชื่อมต่อ Serial", "Connect serial", "连接串口")}</Button>
                        ) : transport === "bridge" ? (
                          <Button variant="soft" onClick={() => { setBridgeOk(null); void bridgeStatus(session.printer).then((r) => { setBridgeOk(r.ok); setPrinters(r.printers ?? []); }); }}><RefreshCw size={15} />{L("ตรวจใหม่", "Re-check", "重新检测")}</Button>
                        ) : null}
                      </div>
                      {transport === "usb" ? (
                        <p className="text-xs text-muted leading-relaxed">
                          {webUsbSupported()
                            ? L("ต่อสาย USB แล้วกด “เชื่อมต่อ USB” เลือกเครื่องพิมพ์ครั้งเดียว — ครั้งต่อไประบบต่อให้อัตโนมัติ", "Plug in the USB cable, press “Connect USB” and pick the printer once — it reconnects automatically afterwards", "插上 USB 线，点“连接 USB”选择打印机一次 — 之后自动连接")
                            : L("เบราว์เซอร์นี้ใช้ USB ไม่ได้ — เปิดด้วย Chrome หรือ Edge บนคอม หรือเลือก “ไดรเวอร์ในเครื่อง”", "This browser can't use USB — open in Chrome or Edge on a computer, or choose “System driver”", "此浏览器无法使用 USB — 请用电脑版 Chrome/Edge，或选择“系统驱动”")}
                        </p>
                      ) : null}
                      {transport === "browser" ? (
                        <p className="text-xs text-muted leading-relaxed">{L("ลงไดรเวอร์ของเครื่องพิมพ์ในคอมแล้วตั้งเป็นเครื่องพิมพ์หลัก — จะมีหน้าต่างพิมพ์ให้กดทุกครั้ง · ตั้งกระดาษ 80 มม. และขอบ “ไม่มี”", "Install the printer driver and set it as default — a print dialog appears each time · paper 80mm, margins “None”", "安装打印机驱动并设为默认 — 每次弹出打印对话框 · 纸张 80 毫米、边距“无”")}</p>
                      ) : null}
                      {transport === "bridge" ? (
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Field label={t.settings.bridgeUrl} hint={L("รันโปรแกรมจากโฟลเดอร์ bridge/ บนเครื่องนี้", "Run the agent from the bridge/ folder on this machine", "在本机运行 bridge/ 中的程序")}>
                            <Input value={session.printer.bridgeUrl} onChange={(e) => session.setPrinter({ bridgeUrl: e.target.value })} />
                          </Field>
                          {printers.length ? (
                            <Field label={t.settings.printer}>
                              <Select value={session.printer.printerName ?? ""} onChange={(e) => session.setPrinter({ printerName: e.target.value })}>
                                <option value="">(default)</option>
                                {printers.map((p) => <option key={p}>{p}</option>)}
                              </Select>
                            </Field>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {/* 3) กระดาษ + ทดสอบ */}
                  <section>
                    <StepTitle n={3} text={L("กระดาษและทดสอบพิมพ์", "Paper & test print", "纸张与测试打印")} />
                    <div className="rounded-2xl border border-line p-4 space-y-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <Field label={L("ขนาดกระดาษ", "Paper width", "纸张宽度")}>
                          <Segmented value={String(session.printer.width)} onChange={(v) => session.setPrinter({ width: Number(v) })}
                            options={[{ value: "48", label: L("80 มม.", "80 mm", "80 毫米") }, { value: "32", label: L("58 มม.", "58 mm", "58 毫米") }]} />
                        </Field>
                        {hasDrawer ? (
                          <Field label={L("ขาลิ้นชัก", "Drawer pin", "钱箱引脚")}>
                            <Select value={session.printer.drawerPin} onChange={(e) => session.setPrinter({ drawerPin: Number(e.target.value) as 0 | 1 })}>
                              <option value={0}>{L("Pin 2 (ปกติ)", "Pin 2 (default)", "Pin 2（默认）")}</option>
                              <option value={1}>Pin 5</option>
                            </Select>
                          </Field>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary" className="flex-1 min-w-[240px] h-11 text-[14.5px]" loading={testing} onClick={() => void testPrint()}>
                          <Printer size={17} /> {L("ทดสอบพิมพ์ใบเสร็จ", "Print a test receipt", "打印测试小票")}
                        </Button>
                        {hasDrawer ? <Button variant="ghost" className="h-11" onClick={() => void testDrawer()}><Inbox size={16} /> {t.settings.testDrawer}</Button> : null}
                      </div>
                      {lastTest ? (
                        <p className={`text-xs flex items-center gap-1.5 ${lastTest.ok ? "text-ok" : "text-danger"}`}>
                          {lastTest.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                          {lastTest.ok ? L("ส่งงานพิมพ์สำเร็จ", "Sent successfully", "发送成功") : L("พิมพ์ไม่สำเร็จ", "Print failed", "打印失败")}
                          {" · "}{lastTest.at.toLocaleTimeString(locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          {lastTest.msg ? <span className="text-muted"> — {lastTest.msg}</span> : null}
                        </p>
                      ) : null}
                    </div>
                  </section>

                  {/* แก้ปัญหา */}
                  <details className="group rounded-2xl border border-line">
                    <summary className="cursor-pointer list-none px-5 py-3.5 text-[13px] font-medium flex items-center justify-between">
                      {L("พิมพ์ไม่ออก? วิธีแก้", "Nothing prints? Troubleshooting", "无法打印？排查方法")}
                      <ChevronDown size={15} className="text-muted transition-transform group-open:rotate-180" />
                    </summary>
                    <ul className="px-5 pb-4 space-y-1.5 text-xs text-muted list-disc pl-9 leading-relaxed">
                      <li>{L("เครื่องพิมพ์เปิดอยู่ ไฟเขียว มีกระดาษ และฝาปิดสนิท", "Printer is on (green light), has paper and the cover is closed", "打印机已开（绿灯）、有纸且盖已合上")}</li>
                      <li>{L("ใช้ Chrome หรือ Edge — Safari ใช้ USB ไม่ได้", "Use Chrome or Edge — Safari can't use USB", "请用 Chrome 或 Edge — Safari 不支持 USB")}</li>
                      <li>{L("ถอดสาย USB แล้วเสียบใหม่ จากนั้นกด “เปลี่ยนเครื่องพิมพ์” เลือกเครื่องอีกครั้ง", "Unplug and replug the USB cable, then press “Change printer” and pick it again", "拔插 USB 线后点“更换打印机”重新选择")}</li>
                      <li>{L("Windows: ถ้าเชื่อมต่อ USB ไม่ได้ ให้ลงไดรเวอร์เครื่องพิมพ์แล้วเลือก “ไดรเวอร์ในเครื่อง”", "Windows: if USB won't connect, install the printer driver and choose “System driver”", "Windows：若 USB 连不上，请安装驱动并选择“系统驱动”")}</li>
                      <li>{L("เว็บจริงกับ localhost ต้องกดเชื่อมต่อแยกกันอย่างละครั้ง", "The live site and localhost each need connecting once", "正式网站与 localhost 需分别连接一次")}</li>
                    </ul>
                  </details>
                </div>

                {/* ตัวอย่างใบเสร็จ — สูงเต็มพื้นที่ */}
                <aside className="border-t xl:border-t-0 xl:border-l border-line/70 bg-surface2/60 flex flex-col min-h-[420px] xl:min-h-0">
                  <div className="px-5 pt-4 pb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">{L("ตัวอย่างใบเสร็จ", "Receipt preview", "小票预览")}</h3>
                      <p className="text-[11px] text-muted">{L("หน้าตาที่จะพิมพ์จริง", "Exactly what will print", "实际打印效果")}</p>
                    </div>
                    <Badge tone="neutral">{session.printer.width <= 32 ? "58" : "80"} {L("มม.", "mm", "毫米")}</Badge>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto px-5 pb-5 [scrollbar-width:thin]">
                    {preview
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={`data:image/png;base64,${preview}`} alt={L("ตัวอย่างใบเสร็จ", "Receipt preview", "小票预览")} className={`mx-auto bg-white rounded-sm shadow-[0_8px_30px_-12px_rgba(0,0,0,.35)] ${session.printer.width <= 32 ? "w-[72%]" : "w-full"}`} />
                      : <div className="h-64 grid place-items-center text-muted"><Loader2 size={18} className="animate-spin" /></div>}
                  </div>
                </aside>
              </div>
            ) : null}

            {section === "display" ? <DisplaySettings L={L} branch={branch} sunmi={sunmi} /> : null}

            {section === "appearance" ? (
              <div className="p-6 space-y-8 max-w-4xl">
                <section>
                  <p className="text-[13px] font-semibold mb-3">{t.settings.theme}</p>
                  <div className="grid sm:grid-cols-3 gap-3">
                    {([["light", t.settings.light, "bg-white", "bg-slate-100"], ["dark", t.settings.dark, "bg-slate-900", "bg-slate-700"], ["system", t.settings.system, "bg-gradient-to-r from-white to-slate-900", "bg-slate-400"]] as const).map(([v, label, bg, bar]) => (
                      <button key={v} type="button" onClick={() => setMode(v as ThemeMode)} aria-pressed={mode === v}
                        className={`rounded-2xl border p-3 text-left transition-colors ${mode === v ? "border-brand ring-1 ring-brand/30 bg-brand/[0.05]" : "border-line hover:bg-surface2"}`}>
                        <span className={`block h-20 rounded-xl border border-line ${bg} p-2 space-y-1.5`}><span className={`block h-2 w-1/2 rounded ${bar}`} /><span className={`block h-2 w-3/4 rounded ${bar}`} /><span className={`block h-2 w-2/3 rounded ${bar}`} /></span>
                        <span className="mt-2 flex items-center justify-between text-[13px] font-medium">{label}{mode === v ? <CheckCircle2 size={15} className="text-brand" /> : null}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section>
                  <p className="text-[13px] font-semibold mb-3">{t.settings.language}</p>
                  <div className="grid sm:grid-cols-3 gap-3">
                    {LOCALES.map((l) => (
                      <button key={l} type="button" onClick={() => setLocale(l)} aria-pressed={locale === l}
                        className={`rounded-2xl border px-4 py-4 text-left flex items-center justify-between transition-colors ${locale === l ? "border-brand ring-1 ring-brand/30 bg-brand/[0.05]" : "border-line hover:bg-surface2"}`}>
                        <span><span className="block text-[15px] font-semibold" translate="no">{LOCALE_LABEL[l]}</span><span className="text-[11px] text-muted uppercase">{l}</span></span>
                        {locale === l ? <CheckCircle2 size={16} className="text-brand" /> : null}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}

            {section === "data" ? (
              <div className="p-6 space-y-6 max-w-4xl">
                <div className="grid sm:grid-cols-3 gap-3">
                  <BigStat label={t.offline.pending} value={sync.pending} tone={sync.pending ? "warn" : "ok"} />
                  <BigStat label={t.offline.failed} value={sync.failed} tone={sync.failed ? "danger" : "ok"} />
                  <BigStat label={t.common.status} value={sync.online ? t.offline.online : t.offline.offline} tone={sync.online ? "ok" : "warn"} />
                </div>
                <div className="rounded-2xl border border-line p-5 space-y-3">
                  <p className="text-sm font-semibold">{L("ล้างข้อมูลในเครื่อง", "Clear local data", "清除本地数据")}</p>
                  <p className="text-xs text-muted leading-relaxed">{L("ใช้เมื่อข้อมูลในเครื่องค้างหรือแสดงผลผิด — ระบบจะโหลดสินค้า ราคา และสต๊อกจากเซิร์ฟเวอร์ใหม่ทั้งหมด", "Use when local data is stale or wrong — products, prices and stock reload from the server", "本机数据异常时使用 — 将从服务器重新加载商品、价格与库存")}</p>
                  {confirmReset ? (
                    <div className="rounded-xl border border-danger/30 bg-danger/[0.05] p-3 space-y-2">
                      <p className="text-xs text-danger font-medium">
                        {sync.pending ? L(`มีบิลรอซิงก์ ${sync.pending} รายการ — ล้างแล้วบิลเหล่านี้จะหาย! รอซิงก์ให้เป็น 0 ก่อน`, `${sync.pending} bills are waiting to sync — they will be LOST! Wait until pending is 0`, `有 ${sync.pending} 张单据待同步 — 清除将丢失！请等待同步完成`) : L("ยืนยันล้างข้อมูลในเครื่องแล้วโหลดใหม่?", "Clear this device's data and reload?", "确认清除本机数据并重新加载？")}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>{L("ยกเลิก", "Cancel", "取消")}</Button>
                        <Button size="sm" variant="danger" disabled={sync.pending > 0} onClick={async () => { await resetLocalData(); toast.push({ tone: "ok", title: t.common.reset }); location.reload(); }}>{L("ยืนยันล้างข้อมูล", "Confirm clear", "确认清除")}</Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmReset(true)}><Database size={15} /> {L("ล้างข้อมูลในเครื่องแล้วโหลดใหม่", "Clear local data and reload", "清除本地数据并重新加载")}</Button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return <p className="flex justify-between gap-3"><span className="text-muted shrink-0 whitespace-nowrap">{k}</span><span className="font-medium truncate text-right min-w-0" translate="no">{v}</span></p>;
}

function StatusPill({ icon, ok, label, value }: { icon: React.ReactNode; ok: boolean | null; label: string; value: string }) {
  const tone = ok === null ? "border-line text-muted" : ok ? "border-ok/30 bg-ok/[0.06] text-ok" : "border-warn/30 bg-warn/[0.06] text-warn";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 h-9 text-xs ${tone}`}>
      {icon}<span className="text-muted">{label}</span><b className="font-semibold">{value}</b>
    </span>
  );
}

function StepTitle({ n, text }: { n: number; text: string }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
      <span className="h-5 w-5 rounded-full bg-brand/12 text-brand grid place-items-center text-[11px] tnum">{n}</span>{text}
    </p>
  );
}

function BigStat({ label, value, tone }: { label: string; value: string | number; tone: "ok" | "warn" | "danger" }) {
  const c = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-danger";
  return (
    <div className="rounded-2xl border border-line bg-surface2/60 p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tnum ${c}`}>{value}</p>
    </div>
  );
}
