"use client";

import { useEffect, useState } from "react";
import { shellInfo, type ShellInfo } from "@/lib/printing/shell";
import { Settings2, Printer, Inbox, Monitor, Database, Palette, Languages, Usb } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { Button, Card, CardHeader, Input, Field, Select, Segmented, Badge } from "@/components/ui";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dict";
import { bridgeStatus, connectWebSerial, openCashDrawer, printEscPos, webSerialSupported, type PrintTransport } from "@/lib/printing/bridge";
import { buildReceipt } from "@/lib/printing/receipt";
import { connectUsbPrinter, reconnectUsbPrinter, usbPrinterName, webUsbSupported } from "@/lib/printing/webusb";
import { getBranch } from "@/lib/data/repo";
import type { Branch, Order } from "@/lib/types";

// ข้อมูลบริษัทบนใบเสร็จทดสอบ (เหมือนหน้าขาย)
const COMPANY = { name_th: "บริษัท เอส เอช ดี เทคโนโลยี จำกัด", tax_id: "0000000000000", address: "กรุงเทพมหานคร", phone: "02-000-0000" };
import { openDisplayWindow } from "@/lib/customer-display";
import { isLiveMode } from "@/lib/supabase/client";
import { resetLocalData } from "@/lib/data/repo";
import { getSyncState } from "@/lib/offline/sync";

export default function PosSettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const { mode, setMode } = useTheme();
  const toast = useToast();
  const session = useSession();
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [sunmi, setSunmi] = useState<ShellInfo | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  useEffect(() => { if (session.branchId) void getBranch(session.branchId).then((b) => setBranch(b ?? null)).catch(() => undefined); }, [session.branchId]);
  useEffect(() => { setSunmi(shellInfo()); }, []);
  // เครื่องพิมพ์ USB ที่เคยอนุญาตแล้ว → ต่ออัตโนมัติ
  const [usbName, setUsbName] = useState<string | null>(null), [testing, setTesting] = useState(false);
  useEffect(() => { if (session.printer.transport === "usb") void reconnectUsbPrinter().then((ok) => setUsbName(ok ? usbPrinterName() : null)); }, [session.printer.transport]);
  async function connectUsb() {
    const r = await connectUsbPrinter();
    setUsbName(r.ok ? r.name ?? usbPrinterName() : null);
    toast.push(r.ok ? { tone: "ok", title: L("เชื่อมต่อเครื่องพิมพ์แล้ว", "Printer connected", "打印机已连接"), body: r.name }
      : { tone: "warn", title: L("เชื่อมต่อไม่สำเร็จ", "Connection failed", "连接失败"), body: /NotFound|No device selected/i.test(r.error ?? "") ? L("ยังไม่ได้เลือกเครื่องพิมพ์", "No printer selected", "未选择打印机") : /Access denied|SecurityError|claim/i.test(r.error ?? "") ? L("เครื่องพิมพ์ถูกโปรแกรมอื่นใช้อยู่ (เช่นไดรเวอร์บน Windows) — ใช้โหมด Browser แทน", "The printer is held by another driver (e.g. on Windows) — use Browser mode instead", "打印机被其他驱动占用（如 Windows）— 请改用浏览器模式") : r.error });
  }

  useEffect(() => {
    void bridgeStatus(session.printer).then((r) => {
      setBridgeOk(r.ok);
      setPrinters(r.printers ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.printer.bridgeUrl]);

  /** พิมพ์ใบเสร็จตัวอย่างหน้าตาเหมือนของจริง (ไทย/ยอด/VAT/QR) — ไม่ได้สร้างบิลจริง */
  async function testPrint() {
    // USB ยังไม่เชื่อม → ให้เลือกเครื่องก่อน (ต้องเรียกตอนกดปุ่มทันที)
    if (session.printer.transport === "usb" && !usbPrinterName() && !(await reconnectUsbPrinter())) { await connectUsb(); if (!usbPrinterName()) return; }
    setTesting(true);
    try {
      const now = new Date().toISOString();
      const order = { order_no: "TEST-0001", created_at: now, customer_name: null, subtotal: 1490, discount_total: 100, grand_total: 1390, vat_amount: 90.93, change_amount: 10, is_offline_origin: false,
        items: [{ name: L("สินค้าทดสอบ ภาษาไทย ๑๒๓", "Test product", "测试商品"), qty: 1, unit_price: 1290, line_total: 1290, discount_amount: 100, serials: ["SN-TEST-001"] }, { name: "Test item 2", qty: 2, unit_price: 100, line_total: 200, discount_amount: 0, serials: [] }],
        payments: [{ method: "cash", amount: 1400 }] } as unknown as Order;
      const b = buildReceipt({ order, branch: branch ?? undefined, cashier: session.employee ?? undefined, company: COMPANY, width: session.printer.width,
        copyLabel: L("ทดสอบการพิมพ์ — ไม่ใช่ใบเสร็จจริง", "TEST PRINT — not a real receipt", "打印测试 — 非正式小票"), docUrl: typeof window !== "undefined" ? window.location.origin : null });
      const res = await printEscPos(session.printer, b);
      toast.push(res.ok ? { tone: "ok", title: L("ส่งงานพิมพ์แล้ว", "Sent to printer", "已发送打印"), body: L("ถ้ากระดาษไม่ออก ตรวจสายและไฟเครื่องพิมพ์", "If nothing prints, check the cable and power", "若未出纸，请检查连线与电源") } : { tone: "danger", title: t.pos.printFailed, body: res.error ?? undefined });
    } finally { setTesting(false); }
  }

  async function testDrawer() {
    const res = await openCashDrawer(session.printer);
    toast.push(res.ok ? { tone: "ok", title: t.settings.testDrawer } : { tone: "danger", title: t.pos.printFailed, body: res.error ?? undefined });
  }

  const sync = getSyncState();

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-lg font-semibold flex items-center gap-2">
        <Settings2 size={18} className="text-brand" /> {t.settings.title}
      </h1>

      {/* การแสดงผล */}
      <Card>
        <CardHeader title={t.settings.appearance} subtitle={L("ค่าเริ่มต้นของระบบคือโหมดสว่าง", "System default is light mode", "系统默认为浅色模式")} />
        <div className="p-5 space-y-4">
          <Field label={t.settings.theme}>
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as ThemeMode)}
              options={[
                { value: "light" as ThemeMode, label: <span className="flex items-center gap-1.5"><Palette size={13} /> {t.settings.light}</span> },
                { value: "dark" as ThemeMode, label: t.settings.dark },
                { value: "system" as ThemeMode, label: t.settings.system },
              ]}
            />
          </Field>
          <Field label={t.settings.language}>
            <Segmented
              value={locale}
              onChange={setLocale}
              options={LOCALES.map((l) => ({ value: l, label: <span className="flex items-center gap-1.5"><Languages size={13} /> {LOCALE_LABEL[l]}</span> }))}
            />
          </Field>
        </div>
      </Card>

      {/* เครื่องพิมพ์ + ลิ้นชัก */}
      <Card>
        <CardHeader
          title={`${t.settings.printer} · ${t.settings.drawer}`}
          subtitle={L("ใช้ Print Bridge เพื่อความเสถียรสูงสุด (รองรับ USB / LAN / Serial + เปิดลิ้นชัก)", "Use Print Bridge for maximum reliability (supports USB / LAN / Serial + drawer)", "使用 Print Bridge 以获得最佳稳定性（支持 USB / LAN / Serial + 开钱箱）")}
          right={
            bridgeOk === null ? null : bridgeOk ? <Badge tone="ok">Bridge OK</Badge> : <Badge tone="warn">Bridge offline</Badge>
          }
        />
        <div className="p-5 space-y-4">
          <Field label={L("ช่องทางการพิมพ์", "Print method", "打印方式")}>
            <Segmented
              value={session.printer.transport}
              onChange={(v) => session.setPrinter({ transport: v as PrintTransport })}
              options={[
                ...(sunmi ? [{ value: "sunmi" as PrintTransport, label: "Sunmi" }] : []),
                { value: "usb" as PrintTransport, label: L("USB (แนะนำ)", "USB (recommended)", "USB（推荐）") },
                { value: "browser" as PrintTransport, label: L("ไดรเวอร์เครื่อง", "System driver", "系统驱动") },
                { value: "bridge" as PrintTransport, label: "Print Bridge" },
                { value: "webserial" as PrintTransport, label: "Serial" },
              ]}
            />
          </Field>
          {sunmi ? (
            <p className="text-xs rounded-xl border border-ok/30 bg-ok/5 px-3 py-2">
              {L(`เปิดผ่านแอป SHD POS บน Sunmi ${sunmi.model} — ใบเสร็จพิมพ์ด้วยเครื่องพิมพ์ในตัวอัตโนมัติ (${sunmi.paperWidthPx >= 576 ? "80" : "58"} มม.)`, `Running in the SHD POS app on Sunmi ${sunmi.model} — receipts print on the built-in printer (${sunmi.paperWidthPx >= 576 ? "80" : "58"} mm)`, `正在 Sunmi ${sunmi.model} 的 SHD POS 应用中运行 — 小票自动用内置打印机打印（${sunmi.paperWidthPx >= 576 ? "80" : "58"} 毫米）`)}
              {" · "}{sunmi.printer ? L("เครื่องพิมพ์พร้อม", "Printer ready", "打印机就绪") : L("ยังเชื่อมเครื่องพิมพ์ไม่ได้", "Printer not connected", "打印机未连接")}
              {" · "}{sunmi.secondScreen ? L("มีจอลูกค้า", "Customer display found", "已检测到客显屏") : L("ไม่พบจอลูกค้า", "No customer display", "未检测到客显屏")}
            </p>
          ) : null}

          {session.printer.transport === "usb" ? (
            <div className="rounded-xl border border-line bg-surface2 px-4 py-3 space-y-2">
              <p className="text-xs text-muted">
                {webUsbSupported()
                  ? L("ต่อเครื่องพิมพ์ใบเสร็จ (Gainscha, Xprinter, Epson ฯลฯ) ด้วยสาย USB แล้วกด “เชื่อมต่อ USB” เลือกเครื่องครั้งเดียว — ครั้งต่อไปต่ออัตโนมัติ · พิมพ์ทันทีไม่มีหน้าต่างให้กด · ภาษาไทยออกถูก (ส่งเป็นรูป)", "Plug the receipt printer (Gainscha, Xprinter, Epson…) in via USB and press “Connect USB” once — it reconnects automatically · prints instantly with no dialog · Thai prints correctly (sent as an image)", "用 USB 连接小票打印机（Gainscha、Xprinter、Epson 等），点一次“连接 USB”选择设备 — 之后自动连接 · 无弹窗直接打印 · 泰文正确（以图片发送）")
                  : L("เบราว์เซอร์นี้ไม่รองรับ USB — ใช้ Chrome หรือ Edge บนคอม หรือเลือก “ไดรเวอร์เครื่อง”", "This browser doesn't support USB — use Chrome or Edge on a computer, or choose “System driver”", "此浏览器不支持 USB — 请使用电脑版 Chrome/Edge，或选择“系统驱动”")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="soft" disabled={!webUsbSupported()} onClick={() => void connectUsb()}><Usb size={15} /> {usbName ? L("เปลี่ยนเครื่องพิมพ์", "Change printer", "更换打印机") : L("เชื่อมต่อ USB", "Connect USB", "连接 USB")}</Button>
                {usbName ? <Badge tone="ok"><span translate="no">{usbName}</span></Badge> : <span className="text-xs text-muted">{L("ยังไม่ได้เชื่อมต่อ", "Not connected", "未连接")}</span>}
              </div>
            </div>
          ) : null}

          {session.printer.transport === "browser" ? (
            <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-xs text-muted">
              {L("พิมพ์ผ่านไดรเวอร์ที่ลงไว้ในคอม (ลงไดรเวอร์ของเครื่องพิมพ์ก่อน แล้วตั้งเป็นเครื่องพิมพ์หลัก) — จะมีหน้าต่างพิมพ์ให้กดยืนยันทุกครั้ง · ตั้งขนาดกระดาษ 80 มม. และขอบ “ไม่มี”", "Prints through the computer's installed driver (install the printer driver and set it as default) — a print dialog appears each time · set paper to 80mm and margins to “None”", "通过电脑已安装的驱动打印（先安装打印机驱动并设为默认）— 每次会弹出打印对话框 · 纸张设为 80 毫米、边距“无”")}
            </p>
          ) : null}

          {session.printer.transport === "bridge" ? (
            <>
              <Field label={t.settings.bridgeUrl} hint={L("รันเอเจนต์จากโฟลเดอร์ bridge/ บนเครื่อง POS", "Run the agent from the bridge/ folder on the POS machine", "在 POS 机上从 bridge/ 文件夹运行代理")}>
                <Input value={session.printer.bridgeUrl} onChange={(e) => session.setPrinter({ bridgeUrl: e.target.value })} />
              </Field>
              {printers.length ? (
                <Field label={t.settings.printer}>
                  <Select value={session.printer.printerName ?? ""} onChange={(e) => session.setPrinter({ printerName: e.target.value })}>
                    <option value="">(default)</option>
                    {printers.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </>
          ) : null}

          {session.printer.transport === "webserial" ? (
            <div className="rounded-xl border border-line bg-surface2 px-4 py-3">
              <p className="text-xs text-muted mb-2">
                {webSerialSupported() ? L("เชื่อมต่อเครื่องพิมพ์ผ่าน USB/Serial โดยตรงจากเบราว์เซอร์ (Chrome/Edge บนคอม)", "Connect the printer via USB/Serial directly from the browser (Chrome/Edge on desktop)", "直接通过浏览器用 USB/Serial 连接打印机（桌面版 Chrome/Edge）") : L("เบราว์เซอร์นี้ไม่รองรับ WebSerial", "This browser does not support WebSerial", "此浏览器不支持 WebSerial")}
              </p>
              <Button
                variant="soft"
                disabled={!webSerialSupported()}
                onClick={async () => {
                  const ok = await connectWebSerial();
                  toast.push(ok ? { tone: "ok", title: L("เชื่อมต่อแล้ว", "Connected", "已连接") } : { tone: "warn", title: L("เชื่อมต่อไม่สำเร็จ", "Connection failed", "连接失败") });
                }}
              >
                <Usb size={15} /> {L("เชื่อมต่อเครื่องพิมพ์", "Connect printer", "连接打印机")}
              </Button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label={L("ความกว้างสลิป", "Receipt width", "小票宽度")}>
              <Select value={session.printer.width} onChange={(e) => session.setPrinter({ width: Number(e.target.value) })}>
                <option value={48}>{L("80 มม. (48 คอลัมน์)", "80mm (48 columns)", "80 毫米（48 列）")}</option>
                <option value={32}>{L("58 มม. (32 คอลัมน์)", "58mm (32 columns)", "58 毫米（32 列）")}</option>
              </Select>
            </Field>
            {session.printer.transport === "bridge" || session.printer.transport === "webserial" ? <Field label={L("ขา drawer kick", "Drawer kick pin", "钱箱触发引脚")}>
              <Select value={session.printer.drawerPin} onChange={(e) => session.setPrinter({ drawerPin: Number(e.target.value) as 0 | 1 })}>
                <option value={0}>{L("Pin 2 (ปกติ)", "Pin 2 (default)", "Pin 2（默认）")}</option>
                <option value={1}>Pin 5</option>
              </Select>
            </Field> : null}
          </div>

          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" loading={testing} onClick={() => void testPrint()}>
              <Printer size={15} /> {L("ทดสอบพิมพ์ใบเสร็จ", "Print a test receipt", "打印测试小票")}
            </Button>
            {session.printer.transport === "bridge" || session.printer.transport === "webserial" ? <Button variant="ghost" className="flex-1" onClick={() => void testDrawer()}>
              <Inbox size={15} /> {t.settings.testDrawer}
            </Button> : null}
          </div>
        </div>
      </Card>

      {/* จอลูกค้า */}
      <Card>
        <CardHeader title={t.settings.customerDisplay} subtitle={L("เปิดหน้าต่างที่สองแล้วลากไปจอที่ลูกค้าเห็น", "Open a second window and drag it to the customer-facing screen", "打开第二个窗口并拖到客显屏")} />
        <div className="p-5">
          <Button variant="soft" onClick={openDisplayWindow}>
            <Monitor size={15} /> {t.settings.openDisplay}
          </Button>
        </div>
      </Card>

      {/* ข้อมูล */}
      <Card>
        <CardHeader
          title={t.settings.dataMode}
          subtitle={isLiveMode() ? t.settings.liveMode : t.settings.demoMode}
          right={<Badge tone={isLiveMode() ? "ok" : "warn"}>{isLiveMode() ? "Supabase" : "Demo"}</Badge>}
        />
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-surface2 border border-line py-2.5">
              <p className="text-[11px] text-muted">{t.offline.pending}</p>
              <p className="text-lg font-semibold tnum">{sync.pending}</p>
            </div>
            <div className="rounded-xl bg-surface2 border border-line py-2.5">
              <p className="text-[11px] text-muted">{t.offline.failed}</p>
              <p className="text-lg font-semibold tnum text-danger">{sync.failed}</p>
            </div>
            <div className="rounded-xl bg-surface2 border border-line py-2.5">
              <p className="text-[11px] text-muted">{t.common.status}</p>
              <p className="text-lg font-semibold">{sync.online ? t.offline.online : t.offline.offline}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={async () => {
              await resetLocalData();
              toast.push({ tone: "ok", title: t.common.reset });
              location.reload();
            }}
          >
            <Database size={15} /> {L("ล้างข้อมูลในเครื่องแล้วโหลดใหม่", "Clear local data and reload", "清除本地数据并重新加载")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
