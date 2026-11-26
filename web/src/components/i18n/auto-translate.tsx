"use client";
// ติดตั้งตัวแปลในเครื่อง (ทั้งแอป) + สวิตช์เปิด/ปิด สำหรับเมนูภาษา
import { useEffect, useRef, useState } from "react";
import { LOCALES, LOCALE_LABEL } from "@/lib/i18n/dict";
import { Languages, Loader2, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { initAutoTranslate, setAutoTranslate, syncAutoTranslate, useAutoTranslate } from "@/lib/i18n/auto-translate";

/** วางครั้งเดียวใต้ I18nProvider */
export function AutoTranslateMount() {
  const { locale } = useI18n();
  const { enabled } = useAutoTranslate();
  useEffect(() => { initAutoTranslate(); }, []);
  useEffect(() => { void syncAutoTranslate(locale); }, [locale, enabled]);
  return null;
}

/** สวิตช์ "แปลส่วนที่เหลือในเครื่อง" — ใส่ในเมนูภาษา/หน้าตั้งค่า */
export function AutoTranslateToggle({ compact }: { compact?: boolean }) {
  const { locale, L } = useI18n();
  const s = useAutoTranslate();
  const unsupported = s.status === "unsupported" || s.status === "unavailable";
  const hint =
    s.status === "unsupported" ? L("เบราว์เซอร์นี้ไม่มีตัวแปลในเครื่อง — ใช้ Google Chrome 138 ขึ้นไปบนคอมพิวเตอร์", "This browser has no on-device translator — use Google Chrome 138+ on desktop", "此浏览器不支持本地翻译 — 请使用电脑版 Chrome 138+")
    : s.status === "unavailable" ? L("เครื่องนี้ยังไม่รองรับคู่ภาษา ไทย → ภาษาที่เลือก", "This device doesn't support Thai → selected language yet", "本设备暂不支持 泰语→所选语言")
    : s.status === "downloading" ? L(`กำลังดาวน์โหลดโมเดลแปลภาษา ${s.progress}% (ครั้งแรกครั้งเดียว)`, `Downloading language model ${s.progress}% (first time only)`, `正在下载翻译模型 ${s.progress}%（仅首次）`)
    : s.status === "downloadable" ? L("กดเปิดเพื่อดาวน์โหลดโมเดลแปลภาษา (ครั้งแรกครั้งเดียว)", "Turn on to download the language model (first time only)", "开启以下载翻译模型（仅首次）")
    : s.status === "error" ? L("เปิดตัวแปลไม่สำเร็จ", "Couldn't start the translator", "无法启动翻译") + (s.message ? ` · ${s.message}` : "")
    : locale === "th" ? L("ทำงานเมื่อเลือกภาษาอังกฤษหรือจีน", "Works when English or Chinese is selected", "选择英文或中文时生效")
    : s.enabled && s.status === "ready" ? L(`แปลแล้ว ${s.translated} ข้อความ · ทำงานในเครื่อง ไม่ส่งข้อมูลออก`, `${s.translated} texts translated · on-device, nothing leaves this device`, `已翻译 ${s.translated} 条 · 本地运行，不上传数据`)
    : L("แปลข้อความที่ยังเป็นภาษาไทยด้วยโมเดลในเครื่อง — ชื่อสินค้า SKU SN เลขเอกสาร คงเดิม", "Translate remaining Thai text with an on-device model — product names, SKU, SN and document numbers stay as-is", "用本地模型翻译剩余泰文 — 商品名、SKU、SN、单号保持不变");
  return (
    <div className={compact ? "px-2 py-1.5" : "rounded-xl border border-line p-3"} translate="no">
      <label className={`flex items-center gap-2.5 ${unsupported ? "opacity-60" : "cursor-pointer"}`}>
        <span className="h-7 w-7 rounded-lg bg-brand/10 text-brand grid place-items-center shrink-0">{s.status === "downloading" ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium">{L("แปลส่วนที่เหลือในเครื่อง", "Auto-translate the rest (on-device)", "本地自动翻译剩余内容")}</span>
          <span className="block text-[11px] text-muted leading-snug">{hint}</span>
        </span>
        <input type="checkbox" className="sr-only peer" disabled={unsupported} checked={s.enabled} onChange={(e) => void setAutoTranslate(e.target.checked, locale)} />
        <span className="relative h-5 w-9 rounded-full bg-surface2 border border-line peer-checked:bg-brand transition shrink-0 after:absolute after:top-0.5 after:left-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4">
          {s.enabled && s.status === "ready" ? <Check size={10} className="absolute right-1 top-1 text-white" /> : null}
        </span>
      </label>
    </div>
  );
}

/** ปุ่มเมนูภาษา: เลือก ไทย/English/中文 + สวิตช์แปลส่วนที่เหลือในเครื่อง (ใช้ทั้งหน้าร้านและหลังบ้าน) */
export function LanguageMenu({ showLabel, className }: { showLabel?: boolean; className?: string }) {
  const { locale, setLocale, L } = useI18n();
  const s = useAutoTranslate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className={`relative ${className ?? ""}`} translate="no">
      <button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} title={L("ภาษา", "Language", "语言")}
        className="px-2 h-9 rounded-xl hover:bg-surface2 text-muted text-xs inline-flex items-center gap-1.5">
        <Languages size={15} />{showLabel ? LOCALE_LABEL[locale] : null}
        {s.enabled && locale !== "th" && s.status === "ready" ? <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden /> : null}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 mt-1 w-72 bg-surface border border-line rounded-xl shadow-pop p-1.5 z-50">
          <div className="grid grid-cols-3 gap-1 mb-1.5">
            {LOCALES.map((l) => (
              <button key={l} role="menuitemradio" aria-checked={locale === l} onClick={() => setLocale(l)}
                className={`h-9 rounded-lg text-xs font-medium ${locale === l ? "bg-brand text-brandInk" : "hover:bg-surface2"}`}>{LOCALE_LABEL[l]}</button>
            ))}
          </div>
          <AutoTranslateToggle compact />
        </div>
      ) : null}
    </div>
  );
}
