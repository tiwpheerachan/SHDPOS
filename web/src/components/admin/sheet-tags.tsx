"use client";
// ป้ายสีแบบ Lark ที่ใช้ร่วมกันในตารางยอดขาย / ตัวกรองคอลัมน์ / ฟิลด์เพิ่มเอง — พื้นพาสเทล ตัวหนังสือสีเข้มอ่านง่าย
export const TAG_BG = [
  { bg: "#DCE7FF", dot: "#3370FF", name: { th: "ฟ้า", en: "Blue", zh: "蓝" } },
  { bg: "#D3F3E2", dot: "#2EA121", name: { th: "เขียว", en: "Green", zh: "绿" } },
  { bg: "#FEEBC8", dot: "#F5A623", name: { th: "ส้ม", en: "Orange", zh: "橙" } },
  { bg: "#FDDDDB", dot: "#F54A45", name: { th: "แดง", en: "Red", zh: "红" } },
  { bg: "#E8DFFF", dot: "#7F3BF5", name: { th: "ม่วง", en: "Purple", zh: "紫" } },
  { bg: "#CFF2F4", dot: "#14C0C6", name: { th: "ฟ้าอมเขียว", en: "Teal", zh: "青" } },
  { bg: "#FDDDF0", dot: "#E43B95", name: { th: "ชมพู", en: "Pink", zh: "粉" } },
  { bg: "#EDF2C9", dot: "#8FAC02", name: { th: "เขียวมะนาว", en: "Lime", zh: "黄绿" } },
  { bg: "#E4E6EA", dot: "#8F959E", name: { th: "เทา", en: "Gray", zh: "灰" } },
] as const;
export const tagHash = (v: string) => [...v].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** ป้ายค่า — tone = สีที่กำหนดเอง (ฟิลด์ตัวเลือก) ไม่ระบุ = เลือกจากค่าให้คงที่ */
export function TagChip({ value, tone, className = "" }: { value: string; tone?: number; className?: string }) {
  const t = TAG_BG[(tone ?? tagHash(value)) % TAG_BG.length];
  return (
    <span className={`inline-flex items-center max-w-full h-[22px] px-2 rounded-md text-[11.5px] font-medium text-[#1F2329] dark:text-[#1F2329] truncate align-middle ${className}`} style={{ background: t.bg }} title={value}>
      {value}
    </span>
  );
}

const PERSON_TONES = ["#3370FF", "#7F3BF5", "#E43B95", "#2EA121", "#F5A623", "#14C0C6", "#5B65F5", "#D9795F"];
/** คน — วงกลมตัวย่อ + ชื่อ (แบบช่องคนใน Lark) */
export function PersonChip({ name, photo }: { name: string; photo?: string | null }) {
  const w = name.replace(/[-–—(].*$/, "").trim().split(/\s+/).filter(Boolean);
  const ini = ((w[0]?.[0] ?? "?") + (w[1]?.[0] ?? "")).toUpperCase();
  return (
    <span className="inline-flex items-center gap-1.5 max-w-full h-[22px] pl-0.5 pr-2 rounded-full bg-[#EFF0F1] text-[#1F2329] text-[11.5px] align-middle" title={name}>
      {photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photo} alt="" referrerPolicy="no-referrer" loading="lazy" className="w-[18px] h-[18px] rounded-full object-cover shrink-0 bg-[#E4E6EA]" />
        : <span className="w-[18px] h-[18px] rounded-full grid place-items-center text-[9px] font-semibold text-white shrink-0" style={{ background: PERSON_TONES[tagHash(name) % PERSON_TONES.length] }}>{ini}</span>}
      <span className="truncate">{name}</span>
    </span>
  );
}
