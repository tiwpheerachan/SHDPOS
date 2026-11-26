// ตัวช่วยแปล 3 ภาษาแบบเรียกตรง (ใช้ได้ทั้งในคอมโพเนนต์และนอก React เช่น lib/*, toast, export)
//   tr("ไทย", "English", "中文") → ข้อความตามภาษาปัจจุบันของเครื่อง
//   ภาษาปัจจุบันซิงก์จาก I18nProvider (setCurrentLocale) · ฝั่งเซิร์ฟเวอร์ = ไทยเสมอ
import type { Locale } from "./dict";

let current: Locale = "th";
export function setCurrentLocale(l: Locale) { current = l; }
export function currentLocale(): Locale { return current; }

export function tr(th: string, en: string, zh: string): string {
  return current === "en" ? en : current === "zh" ? zh : th;
}
