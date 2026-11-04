"use client";

import { useEffect, useState } from "react";
import { Settings2, Printer, Inbox, Monitor, Database, Palette, Languages, Usb } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { Button, Card, CardHeader, Input, Field, Select, Segmented, Badge } from "@/components/ui";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dict";
import { bridgeStatus, connectWebSerial, openCashDrawer, printEscPos, webSerialSupported, type PrintTransport } from "@/lib/printing/bridge";
import { EscPosBuilder } from "@/lib/printing/escpos";
import { openDisplayWindow } from "@/lib/customer-display";
import { isLiveMode } from "@/lib/supabase/client";
import { resetLocalData } from "@/lib/data/repo";
import { getSyncState } from "@/lib/offline/sync";

export default function PosSettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const toast = useToast();
  const session = useSession();
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);

  useEffect(() => {
    void bridgeStatus(session.printer).then((r) => {
      setBridgeOk(r.ok);
      setPrinters(r.printers ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.printer.bridgeUrl]);

  async function testPrint() {
    const b = new EscPosBuilder(session.printer.width);
    b.align("center").bold(true).double(true).line("SHD POS").double(false).bold(false);
    b.line("ทดสอบการพิมพ์ / Test Print / 打印测试");
    b.divider();
    b.align("left").row("สินค้าทดสอบ", "1,234.00");
    b.row("ภาษีมูลค่าเพิ่ม 7%", "80.73");
    b.divider("=");
    b.align("center").line(new Date().toLocaleString("th-TH")).feed(3).cut();
    const res = await printEscPos(session.printer, b);
    toast.push(res.ok ? { tone: "ok", title: t.settings.testPrint } : { tone: "danger", title: t.pos.printFailed, body: res.error ?? undefined });
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
        <CardHeader title={t.settings.appearance} subtitle="ค่าเริ่มต้นของระบบคือโหมดสว่าง" />
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
          subtitle="ใช้ Print Bridge เพื่อความเสถียรสูงสุด (รองรับ USB / LAN / Serial + เปิดลิ้นชัก)"
          right={
            bridgeOk === null ? null : bridgeOk ? <Badge tone="ok">Bridge OK</Badge> : <Badge tone="warn">Bridge offline</Badge>
          }
        />
        <div className="p-5 space-y-4">
          <Field label="ช่องทางการพิมพ์">
            <Segmented
              value={session.printer.transport}
              onChange={(v) => session.setPrinter({ transport: v as PrintTransport })}
              options={[
                { value: "bridge" as PrintTransport, label: "Print Bridge" },
                { value: "webserial" as PrintTransport, label: "WebSerial" },
                { value: "browser" as PrintTransport, label: "Browser" },
              ]}
            />
          </Field>

          {session.printer.transport === "bridge" ? (
            <>
              <Field label={t.settings.bridgeUrl} hint="รันเอเจนต์จากโฟลเดอร์ bridge/ บนเครื่อง POS">
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
                {webSerialSupported() ? "เชื่อมต่อเครื่องพิมพ์ผ่าน USB/Serial โดยตรงจากเบราว์เซอร์ (Chrome/Edge บนคอม)" : "เบราว์เซอร์นี้ไม่รองรับ WebSerial"}
              </p>
              <Button
                variant="soft"
                disabled={!webSerialSupported()}
                onClick={async () => {
                  const ok = await connectWebSerial();
                  toast.push(ok ? { tone: "ok", title: "เชื่อมต่อแล้ว" } : { tone: "warn", title: "เชื่อมต่อไม่สำเร็จ" });
                }}
              >
                <Usb size={15} /> เชื่อมต่อเครื่องพิมพ์
              </Button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="ความกว้างสลิป">
              <Select value={session.printer.width} onChange={(e) => session.setPrinter({ width: Number(e.target.value) })}>
                <option value={48}>80 มม. (48 คอลัมน์)</option>
                <option value={32}>58 มม. (32 คอลัมน์)</option>
              </Select>
            </Field>
            <Field label="ขา drawer kick">
              <Select value={session.printer.drawerPin} onChange={(e) => session.setPrinter({ drawerPin: Number(e.target.value) as 0 | 1 })}>
                <option value={0}>Pin 2 (ปกติ)</option>
                <option value={1}>Pin 5</option>
              </Select>
            </Field>
          </div>

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => void testPrint()}>
              <Printer size={15} /> {t.settings.testPrint}
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => void testDrawer()}>
              <Inbox size={15} /> {t.settings.testDrawer}
            </Button>
          </div>
        </div>
      </Card>

      {/* จอลูกค้า */}
      <Card>
        <CardHeader title={t.settings.customerDisplay} subtitle="เปิดหน้าต่างที่สองแล้วลากไปจอที่ลูกค้าเห็น" />
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
            <Database size={15} /> ล้างข้อมูลในเครื่องแล้วโหลดใหม่
          </Button>
        </div>
      </Card>
    </div>
  );
}
