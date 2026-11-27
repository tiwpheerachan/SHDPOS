// =====================================================================
// เครื่องพิมพ์ใบเสร็จต่อ USB ผ่านเบราว์เซอร์ (WebUSB — Chrome/Edge บนคอม)
//   ใช้กับเครื่องพิมพ์ใบเสร็จทั่วไปที่รับคำสั่ง ESC/POS (Gainscha, Xprinter, Epson TM ฯลฯ)
//   ไม่ต้องลงโปรแกรมเพิ่ม · กด "เชื่อมต่อ USB" ครั้งแรกครั้งเดียว เบราว์เซอร์จำสิทธิ์ไว้
//   Windows: ถ้าเชื่อมไม่ได้ (Access denied) ให้ใช้โหมด Browser (ไดรเวอร์เครื่องพิมพ์) แทน
// =====================================================================

/* ชนิดเฉพาะที่ใช้ (ไม่พึ่ง @types/w3c-web-usb) */
interface UsbEndpoint { endpointNumber: number; direction: "in" | "out"; type: string }
interface UsbAlternate { interfaceClass: number; endpoints: UsbEndpoint[] }
interface UsbInterface { interfaceNumber: number; alternates: UsbAlternate[]; claimed: boolean }
interface UsbConfiguration { configurationValue: number; interfaces: UsbInterface[] }
export interface UsbDeviceLike {
  productName?: string; manufacturerName?: string; vendorId: number; productId: number; opened: boolean;
  configuration: UsbConfiguration | null; configurations: UsbConfiguration[];
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(v: number): Promise<void>;
  claimInterface(n: number): Promise<void>; transferOut(ep: number, data: BufferSource): Promise<{ status: string }>;
}
interface UsbApi { requestDevice(o: { filters: object[] }): Promise<UsbDeviceLike>; getDevices(): Promise<UsbDeviceLike[]> }

const KEY = "shdpos.usbPrinter"; // vendorId:productId ที่เลือกไว้

function usb(): UsbApi | null {
  if (typeof navigator === "undefined") return null;
  return ((navigator as unknown as { usb?: UsbApi }).usb) ?? null;
}

export function webUsbSupported(): boolean {
  return usb() !== null;
}

let dev: UsbDeviceLike | null = null;
let ep: { iface: number; out: number } | null = null;

export function usbPrinterName(): string | null {
  if (dev) return [dev.manufacturerName, dev.productName].filter(Boolean).join(" ") || `USB ${dev.vendorId.toString(16)}:${dev.productId.toString(16)}`;
  return null;
}

/** หาช่องส่งข้อมูล: interface ชนิดเครื่องพิมพ์ (class 7) ก่อน ไม่มีก็ใช้ interface แรกที่มี bulk OUT */
function findOut(d: UsbDeviceLike): { iface: number; out: number; config: number } | null {
  for (const cfg of d.configurations) {
    const cands = [...cfg.interfaces].sort((a, b) => (b.alternates[0]?.interfaceClass === 7 ? 1 : 0) - (a.alternates[0]?.interfaceClass === 7 ? 1 : 0));
    for (const it of cands) {
      const e = it.alternates[0]?.endpoints.find((x) => x.direction === "out" && x.type === "bulk");
      if (e) return { iface: it.interfaceNumber, out: e.endpointNumber, config: cfg.configurationValue };
    }
  }
  return null;
}

async function openDevice(d: UsbDeviceLike): Promise<void> {
  const f = findOut(d);
  if (!f) throw Error("no_bulk_out");
  if (!d.opened) await d.open();
  if (!d.configuration || d.configuration.configurationValue !== f.config) await d.selectConfiguration(f.config);
  const it = d.configuration?.interfaces.find((x) => x.interfaceNumber === f.iface);
  if (!it?.claimed) await d.claimInterface(f.iface);
  dev = d; ep = { iface: f.iface, out: f.out };
  try { localStorage.setItem(KEY, `${d.vendorId}:${d.productId}`); } catch { /* ignore */ }
}

/** เลือกเครื่องพิมพ์ (ต้องเรียกจากการกดปุ่ม) */
export async function connectUsbPrinter(): Promise<{ ok: boolean; name?: string; error?: string }> {
  const u = usb();
  if (!u) return { ok: false, error: "unsupported" };
  try {
    const d = await u.requestDevice({ filters: [] });
    await openDevice(d);
    return { ok: true, name: usbPrinterName() ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** ต่อเครื่องเดิมอัตโนมัติ (เคยอนุญาตแล้ว) — ไม่ต้องกดปุ่ม */
export async function reconnectUsbPrinter(): Promise<boolean> {
  if (dev?.opened && ep) return true;
  const u = usb();
  if (!u) return false;
  try {
    const want = localStorage.getItem(KEY);
    const list = await u.getDevices();
    const d = list.find((x) => `${x.vendorId}:${x.productId}` === want) ?? (list.length === 1 ? list[0] : null);
    if (!d) return false;
    await openDevice(d);
    return true;
  } catch {
    return false;
  }
}

export async function writeUsb(bytes: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  if (!(await reconnectUsbPrinter()) || !dev || !ep) return { ok: false, error: "usb_not_connected" };
  try {
    const CHUNK = 16 * 1024;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const r = await dev.transferOut(ep.out, bytes.slice(i, i + CHUNK));
      if (r.status !== "ok") return { ok: false, error: `usb_${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    dev = null; ep = null; // สายหลุด/ปิดเครื่อง → ครั้งหน้าต่อใหม่
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
