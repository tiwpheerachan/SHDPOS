// =====================================================================
// จอลูกค้า (Customer Display)
// เปิดเป็นหน้าต่างที่สองแล้วลากไปจอที่ลูกค้าเห็น — ซิงก์ผ่าน BroadcastChannel
// ใช้ได้ทั้งบนคอมที่ต่อ 2 จอ และแท็บเล็ตที่ต่อจอเสริม
// =====================================================================

import type { CartLine } from "./types";
import { shellDisplay } from "./printing/shell";

const CHANNEL = "shdpos.customer-display";

export interface DisplayPayload {
  state: "idle" | "cart" | "payment" | "done";
  branchName?: string;
  brandName?: string;
  brandLogo?: string;
  /** แบนเนอร์หมุนวนตอนจอว่าง (รายแบรนด์) */
  banners?: { media_url: string; media_type: "image" | "video"; fit: "cover" | "contain"; pos_x: number; pos_y: number; duration_sec: number }[];
  lines: (Pick<CartLine, "lineId" | "name" | "qty" | "unit_price"> & { image_url?: string | null; is_gift?: boolean })[];
  subtotal: number;
  discount: number;          // ส่วนลดพนักงาน (บรรทัด+ท้ายบิล)
  coupon?: number;           // ส่วนลดคูปอง/แคมเปญ
  redeem?: number;           // ส่วนลดจากแต้ม
  vat?: number;              // VAT ที่รวมในยอด
  grandTotal: number;
  paid?: number;
  change?: number;
  orderNo?: string;
  /** ระหว่างชำระเงิน: วิธีจ่าย + QR ให้ลูกค้าสแกน */
  payMethod?: string;
  payMethodLabel?: string;
  payQr?: string | null;
  amountDue?: number;
  updatedAt: number;
}

export const EMPTY_DISPLAY: DisplayPayload = {
  state: "idle",
  lines: [],
  subtotal: 0,
  discount: 0,
  grandTotal: 0,
  updatedAt: 0,
};

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}

export function pushDisplay(payload: Omit<DisplayPayload, "updatedAt">): void {
  const c = getChannel();
  const full: DisplayPayload = { ...payload, updatedAt: Date.now() };
  c?.postMessage(full);
  shellDisplay(full); // แอปตัวหุ้ม Sunmi: ส่งไปจอลูกค้า (จอที่สอง)
  try {
    localStorage.setItem(CHANNEL, JSON.stringify(full));
  } catch {
    /* ignore */
  }
}

export function subscribeDisplay(cb: (p: DisplayPayload) => void): () => void {
  const c = getChannel();
  const onMsg = (e: MessageEvent<DisplayPayload>) => cb(e.data);
  c?.addEventListener("message", onMsg);
  // แอปตัวหุ้ม Sunmi เรียก window.__shdDisplay(payload) บนจอที่สอง
  const w = window as unknown as { __shdDisplay?: (p: DisplayPayload) => void };
  w.__shdDisplay = (p) => { try { cb(p); } catch { /* ignore */ } };

  // fallback สำหรับเบราว์เซอร์ที่ไม่มี BroadcastChannel
  const onStorage = (e: StorageEvent) => {
    if (e.key === CHANNEL && e.newValue) {
      try {
        cb(JSON.parse(e.newValue) as DisplayPayload);
      } catch {
        /* ignore */
      }
    }
  };
  window.addEventListener("storage", onStorage);

  try {
    const cached = localStorage.getItem(CHANNEL);
    if (cached) cb(JSON.parse(cached) as DisplayPayload);
  } catch {
    /* ignore */
  }

  return () => {
    c?.removeEventListener("message", onMsg);
    window.removeEventListener("storage", onStorage);
    if (w.__shdDisplay) delete w.__shdDisplay;
  };
}

export function openDisplayWindow(): void {
  if (typeof window === "undefined") return;
  window.open("/pos/display", "shdpos-customer-display", "width=1024,height=768");
}
