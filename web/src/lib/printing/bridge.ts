// =====================================================================
// ส่งงานพิมพ์ / เปิดลิ้นชัก
//
// ลำดับที่พยายาม:
//   1) Print Bridge — เอเจนต์เล็ก ๆ ที่ลงไว้บนเครื่อง POS (เสถียรที่สุด)
//      รองรับ USB / Network / Serial และเปิดลิ้นชักได้
//   2) WebSerial — เบราว์เซอร์คุยกับเครื่องพิมพ์ตรง ๆ (Chrome/Edge บน desktop)
//   3) window.print() — พิมพ์ผ่านไดรเวอร์ระบบเป็นทางสำรองสุดท้าย
//
// สำคัญ: การพิมพ์ต้องไม่ทำให้การขายล้มเหลว — บิลถูกบันทึกไปแล้วก่อนถึงตรงนี้
// =====================================================================

import { drawerKickBytes, EscPosBuilder } from "./escpos";
import { tr } from "../i18n/tr";
import { inShell, shellInfo, shellPrintImage } from "./shell";
import { writeUsb } from "./webusb";

export type PrintTransport = "bridge" | "usb" | "webserial" | "browser" | "sunmi" | "none";

export interface PrinterConfig {
  transport: PrintTransport;
  bridgeUrl: string;
  printerName?: string;
  width: number;
  drawerPin: 0 | 1;
}

export const DEFAULT_PRINTER: PrinterConfig = {
  transport: "bridge",
  bridgeUrl: "http://127.0.0.1:9110",
  width: 48,
  drawerPin: 0,
};

export interface PrintResult {
  ok: boolean;
  transport: PrintTransport;
  error?: string;
}

async function postBridge(cfg: PrinterConfig, path: string, body: unknown, timeoutMs = 5000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${cfg.bridgeUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function bridgeStatus(cfg: PrinterConfig): Promise<{ ok: boolean; printers?: string[] }> {
  try {
    const res = await fetch(`${cfg.bridgeUrl}/status`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------
// WebSerial
// ---------------------------------------------------------------------
type SerialPortLike = {
  open: (o: { baudRate: number }) => Promise<void>;
  writable: { getWriter: () => { write: (d: Uint8Array) => Promise<void>; releaseLock: () => void } } | null;
};

let serialPort: SerialPortLike | null = null;

export function webSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

/** ต้องเรียกจาก user gesture (ปุ่มกด) เท่านั้น */
export async function connectWebSerial(): Promise<boolean> {
  if (!webSerialSupported()) return false;
  try {
    const nav = navigator as unknown as { serial: { requestPort: () => Promise<SerialPortLike> } };
    const port = await nav.serial.requestPort();
    await port.open({ baudRate: 9600 });
    serialPort = port;
    return true;
  } catch {
    return false;
  }
}

async function writeSerial(bytes: Uint8Array): Promise<boolean> {
  if (!serialPort?.writable) return false;
  const writer = serialPort.writable.getWriter();
  try {
    await writer.write(bytes);
    return true;
  } catch {
    return false;
  } finally {
    writer.releaseLock();
  }
}

// ---------------------------------------------------------------------
// API หลัก
// ---------------------------------------------------------------------
export async function printEscPos(cfg: PrinterConfig, builder: EscPosBuilder): Promise<PrintResult> {
  // เปิดในแอปตัวหุ้ม Sunmi → พิมพ์เครื่องพิมพ์ในตัวเสมอ (ยกเว้นตั้งเป็น Browser/ไม่พิมพ์ไว้เอง)
  if (cfg.transport === "sunmi" || (inShell() && cfg.transport !== "browser" && cfg.transport !== "none")) {
    if (!inShell()) return { ok: false, transport: "sunmi", error: "ต้องเปิดผ่านแอป SHD POS บนเครื่อง Sunmi" };
    try {
      const { renderReceiptPng } = await import("./render-image");
      const png = await renderReceiptPng(builder, shellInfo()?.paperWidthPx || 576);
      const r = await shellPrintImage(png);
      return r.ok ? { ok: true, transport: "sunmi" } : { ok: false, transport: "sunmi", error: r.error };
    } catch (e) {
      return { ok: false, transport: "sunmi", error: e instanceof Error ? e.message : "print failed" };
    }
  }
  // ความกว้างกระดาษเป็นจุด: 80 มม. = 576 · 58 มม. = 384
  const px = cfg.width <= 32 ? 384 : 576;

  // USB ตรงจากเบราว์เซอร์ — ส่งใบเสร็จเป็นรูป (ภาษาไทยออกถูกทุกยี่ห้อ)
  if (cfg.transport === "usb") {
    try {
      const { renderReceiptRaster } = await import("./render-image");
      const r = await writeUsb(await renderReceiptRaster(builder, px));
      return r.ok ? { ok: true, transport: "usb" } : { ok: false, transport: "usb", error: usbError(r.error) };
    } catch (e) {
      return { ok: false, transport: "usb", error: e instanceof Error ? e.message : "print failed" };
    }
  }

  // พิมพ์ผ่านไดรเวอร์เครื่องพิมพ์ของคอม (หน้าต่างพิมพ์) — พิมพ์เฉพาะรูปใบเสร็จ ไม่ใช่ทั้งหน้า
  if (cfg.transport === "browser") {
    try {
      const { renderReceiptPng } = await import("./render-image");
      await printImageViaBrowser(await renderReceiptPng(builder, px), cfg.width <= 32 ? 58 : 80);
      return { ok: true, transport: "browser" };
    } catch (e) {
      return { ok: false, transport: "browser", error: e instanceof Error ? e.message : "print failed" };
    }
  }

  const payloadB64 = builder.toBase64();

  if (cfg.transport === "bridge") {
    try {
      const res = await postBridge(cfg, "/print", {
        printer: cfg.printerName,
        data: payloadB64,
        encoding: "base64",
      });
      if (res.ok) return { ok: true, transport: "bridge" };
      return { ok: false, transport: "bridge", error: `bridge ${res.status}` };
    } catch (e) {
      return { ok: false, transport: "bridge", error: e instanceof Error ? e.message : "bridge unreachable" };
    }
  }

  if (cfg.transport === "webserial") {
    const { renderReceiptRaster } = await import("./render-image");
    const ok = await writeSerial(await renderReceiptRaster(builder, px));
    return ok ? { ok: true, transport: "webserial" } : { ok: false, transport: "webserial", error: "serial write failed" };
  }

  return { ok: false, transport: "none", error: "no printer configured" };
}

function usbError(code?: string): string | undefined {
  if (code === "usb_not_connected") return tr("ยังไม่ได้เชื่อมต่อเครื่องพิมพ์ USB — ไปที่ ตั้งค่า → เครื่องพิมพ์ → เชื่อมต่อ USB", "USB printer not connected — go to Settings → Printer → Connect USB", "未连接 USB 打印机 — 前往 设置 → 打印机 → 连接 USB");
  return code;
}

/** พิมพ์รูปใบเสร็จผ่านหน้าต่างพิมพ์ของระบบ (iframe แยก — ไม่พิมพ์หน้าเว็บทั้งหน้า) */
function printImageViaBrowser(pngB64: string, mm: 58 | 80): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return reject(Error("no document"));
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(f);
    const d = f.contentDocument!;
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${mm}mm auto;margin:0}html,body{margin:0;padding:0}img{width:${mm - 6}mm;display:block;margin:0 auto}</style></head><body><img src="data:image/png;base64,${pngB64}"></body></html>`);
    d.close();
    const img = d.querySelector("img")!;
    const go = () => {
      try { f.contentWindow!.focus(); f.contentWindow!.print(); resolve(); } catch (e) { reject(e); }
      setTimeout(() => f.remove(), 60_000);
    };
    if (img.complete) go(); else { img.onload = go; img.onerror = () => { f.remove(); reject(Error("image load failed")); }; }
  });
}

export async function openCashDrawer(cfg: PrinterConfig): Promise<PrintResult> {
  const bytes = drawerKickBytes(cfg.drawerPin);

  if (cfg.transport === "bridge") {
    try {
      const res = await postBridge(cfg, "/drawer", { printer: cfg.printerName, pin: cfg.drawerPin });
      if (res.ok) return { ok: true, transport: "bridge" };
      return { ok: false, transport: "bridge", error: `bridge ${res.status}` };
    } catch (e) {
      return { ok: false, transport: "bridge", error: e instanceof Error ? e.message : "bridge unreachable" };
    }
  }

  if (cfg.transport === "webserial") {
    const ok = await writeSerial(bytes);
    return ok ? { ok: true, transport: "webserial" } : { ok: false, transport: "webserial", error: "serial write failed" };
  }

  return { ok: false, transport: cfg.transport, error: "drawer needs bridge or serial" };
}
