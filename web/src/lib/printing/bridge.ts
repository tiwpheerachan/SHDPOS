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

export type PrintTransport = "bridge" | "webserial" | "browser" | "none";

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
    const ok = await writeSerial(builder.build());
    return ok ? { ok: true, transport: "webserial" } : { ok: false, transport: "webserial", error: "serial write failed" };
  }

  if (cfg.transport === "browser") {
    if (typeof window !== "undefined") window.print();
    return { ok: true, transport: "browser" };
  }

  return { ok: false, transport: "none", error: "no printer configured" };
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
