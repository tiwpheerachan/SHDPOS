// =====================================================================
// แอปตัวหุ้ม (Android WebView) สำหรับเครื่อง Sunmi — ดู android-shell/
//   แอปใส่ window.SHDShell ให้หน้าเว็บ: พิมพ์ด้วยเครื่องพิมพ์ในตัว + ส่งข้อมูลไปจอลูกค้า (จอที่สอง)
//   เปิดในเบราว์เซอร์ปกติ = ไม่มี SHDShell → ระบบทำงานแบบเดิมทุกอย่าง
// =====================================================================

import { tr } from "@/lib/i18n/tr";

export interface ShellInfo {
  shell: "sunmi";
  version: string;
  printer: boolean;          // เชื่อมเครื่องพิมพ์ในตัวได้
  paperWidthPx: number;      // 576 (80มม.) / 384 (58มม.)
  secondScreen: boolean;     // มีจอลูกค้า
  model: string;
}

interface ShellApi {
  info(): string;
  printImage(base64Png: string): string; // คืน JSON {ok, error?} (บล็อกจนพิมพ์เสร็จ)
  printImageAsync?(base64Png: string, id: string): void; // ไม่บล็อก — แอปเรียก window.__shdPrintDone(id, json) เมื่อเสร็จ
  printRaw(base64: string): string;
  display(json: string): void;
}

function api(): ShellApi | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { SHDShell?: ShellApi }).SHDShell) ?? null;
}

export function inShell(): boolean {
  return api() !== null;
}

export function shellInfo(): ShellInfo | null {
  const a = api();
  if (!a) return null;
  try { return JSON.parse(a.info()) as ShellInfo; } catch { return null; }
}

/** รหัสข้อผิดพลาดจากแอป → ข้อความ 3 ภาษา */
function errorText(code?: string): string | undefined {
  if (!code) return code;
  const m: Record<string, [string, string, string]> = {
    printer_not_connected: ["ยังเชื่อมเครื่องพิมพ์ในตัวไม่ได้ — ปิดแล้วเปิดแอปใหม่", "Built-in printer not connected — restart the app", "内置打印机未连接 — 请重启应用"],
    printer_not_found: ["ไม่พบเครื่องพิมพ์ในตัว", "Built-in printer not found", "未找到内置打印机"],
    printer_preparing: ["เครื่องพิมพ์กำลังเตรียมพร้อม — ลองใหม่อีกครั้ง", "Printer is warming up — try again", "打印机准备中 — 请重试"],
    printer_comm_error: ["สื่อสารกับเครื่องพิมพ์ไม่ได้", "Printer communication error", "打印机通信错误"],
    paper_out: ["กระดาษหมด — ใส่กระดาษแล้วพิมพ์ซ้ำ", "Out of paper — load paper and reprint", "缺纸 — 请装纸后重打"],
    printer_overheat: ["เครื่องพิมพ์ร้อนเกิน — รอสักครู่", "Printer overheated — wait a moment", "打印机过热 — 请稍候"],
    cover_open: ["ฝาเครื่องพิมพ์เปิดอยู่ — ปิดฝาแล้วพิมพ์ซ้ำ", "Printer cover open — close it and reprint", "打印机盖未关 — 关好后重打"],
    cutter_error: ["มีดตัดกระดาษติด", "Paper cutter error", "切刀故障"],
    print_timeout: ["เครื่องพิมพ์ไม่ตอบสนอง", "Printer did not respond", "打印机无响应"],
    untrusted_page: ["หน้านี้สั่งพิมพ์ไม่ได้", "This page can't print", "此页面无法打印"],
    bad_image: ["ข้อมูลใบเสร็จเสีย", "Invalid receipt image", "小票图片无效"],
  };
  const k = code.split(":")[0];
  return m[k] ? tr(...m[k]) : code;
}

function result(s: string): { ok: boolean; error?: string } {
  try { const r = JSON.parse(s) as { ok: boolean; error?: string }; return { ...r, error: errorText(r.error) }; } catch { return { ok: false, error: s || "shell error" }; }
}

/** พิมพ์รูปใบเสร็จ — ใช้แบบไม่บล็อกหน้าจอเมื่อแอปรองรับ (หน้าเว็บไม่ค้างระหว่างพิมพ์) */
export function shellPrintImage(base64Png: string): Promise<{ ok: boolean; error?: string }> {
  const a = api();
  if (!a) return Promise.resolve({ ok: false, error: "not in shell" });
  if (!a.printImageAsync) return Promise.resolve(result(a.printImage(base64Png)));
  const w = window as unknown as { __shdPrintDone?: (id: string, json: string) => void; __shdPrintWait?: Map<string, (j: string) => void> };
  const wait = (w.__shdPrintWait ??= new Map<string, (j: string) => void>());
  w.__shdPrintDone = (id, json) => { const f = wait.get(id); wait.delete(id); f?.(json); };
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { wait.delete(id); resolve({ ok: false, error: errorText("print_timeout") }); }, 25_000);
    wait.set(id, (json: string) => { clearTimeout(timer); resolve(result(json)); });
    try { a.printImageAsync!(base64Png, id); } catch (e) { clearTimeout(timer); wait.delete(id); resolve({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  });
}

export function shellPrintRaw(base64: string): { ok: boolean; error?: string } {
  const a = api();
  if (!a) return { ok: false, error: "not in shell" };
  return result(a.printRaw(base64));
}

/** ส่งข้อมูลจอลูกค้าให้แอป → แอปส่งต่อไปหน้า /pos/display บนจอที่สอง (เรียก window.__shdDisplay) */
export function shellDisplay(payload: unknown): void {
  const a = api();
  if (!a) return;
  try { a.display(JSON.stringify(payload)); } catch { /* จอลูกค้าล้มต้องไม่กระทบการขาย */ }
}
