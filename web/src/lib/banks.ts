// =====================================================================
// ทะเบียนธนาคารไทย — สี brand + ชื่อย่อ สำหรับทำตรา monogram บนหน้าชำระเงิน
// * เป็นตราแบบเรียบ (อักษรย่อ + สีประจำธนาคาร) ออกแบบเองไม่ใช่โลโก้จริง
// * key = รหัสสั้นคงที่ · match จากชื่อไทย/อังกฤษได้ด้วย bankByName()
// =====================================================================

export interface BankInfo {
  code: string;        // รหัสสั้น เช่น KBANK
  th: string;          // ชื่อไทยเต็ม
  en: string;          // ชื่ออังกฤษย่อ (fallback บนตรา)
  color: string;       // สีพื้นตรา (brand) — ใช้ตอน fallback / ไทล์สี
  ink?: string;        // สีตัวอักษรตอน fallback (ค่าเริ่ม = ขาว)
  logo?: string;       // โลโก้ขาว (omise) วางบนไทล์สีประจำธนาคาร
  logoColor?: string;  // โลโก้เต็มสี วางบนไทล์ขาว (เหมือนไอคอนแอป)
}

// โลโก้เต็มสีวงกลม (ชุด thai-bank-logos ของผู้ใช้) วางใน /public/banks/color
// สี color ใช้เฉพาะตอน fallback เท่านั้น เพราะทุกธนาคารมี logoColor แล้ว
export const BANKS: BankInfo[] = [
  { code: "KBANK", th: "กสิกรไทย", en: "KBANK", color: "#0a8a3c", logoColor: "/banks/color/kbank.png" },
  { code: "SCB", th: "ไทยพาณิชย์", en: "SCB", color: "#4e2e7f", logoColor: "/banks/color/scb.png" },
  { code: "BBL", th: "กรุงเทพ", en: "BBL", color: "#1e4598", logoColor: "/banks/color/bbl.png" },
  { code: "KTB", th: "กรุงไทย", en: "KTB", color: "#01a6e5", logoColor: "/banks/color/ktb.png" },
  { code: "BAY", th: "กรุงศรีอยุธยา", en: "BAY", color: "#6c5731", ink: "#ffd24a", logoColor: "/banks/color/bay.png" },
  { code: "TTB", th: "ทีเอ็มบีธนชาต", en: "ttb", color: "#114ea6", logoColor: "/banks/color/ttb.png" },
  { code: "UOB", th: "ยูโอบี", en: "UOB", color: "#1b2a5e", logoColor: "/banks/color/uob.png" },
  { code: "GSB", th: "ออมสิน", en: "GSB", color: "#eb198d", logoColor: "/banks/color/gsb.png" },
  { code: "KKP", th: "เกียรตินาคินภัทร", en: "KKP", color: "#0b4d8c", logoColor: "/banks/color/kkp.png" },
  { code: "CIMB", th: "ซีไอเอ็มบี", en: "CIMB", color: "#b11116", logoColor: "/banks/color/cimb.png" },
  { code: "LH", th: "แลนด์ แอนด์ เฮ้าส์", en: "LH", color: "#e39b00", logoColor: "/banks/color/lh.png" },
  { code: "BAAC", th: "ธ.ก.ส.", en: "BAAC", color: "#1f7a43", logoColor: "/banks/color/baac.png" },
  { code: "GHB", th: "อาคารสงเคราะห์", en: "GHB", color: "#f36f21", logoColor: "/banks/color/ghb.png" },
  { code: "TISCO", th: "ทิสโก้", en: "TISCO", color: "#0a4aa0", logoColor: "/banks/color/tisco.png" },
  { code: "TCRB", th: "ไทยเครดิต", en: "TCRB", color: "#1b3f8b", logoColor: "/banks/color/tcrb.png" },
  { code: "IBANK", th: "อิสลามแห่งประเทศไทย", en: "IBANK", color: "#0b5a37", logoColor: "/banks/color/ibank.png" },
  { code: "ICBC", th: "ไอซีบีซี", en: "ICBC", color: "#c8102e", logoColor: "/banks/color/icbc.png" },
  { code: "CITI", th: "ซิตี้แบงก์", en: "CITI", color: "#004685", logoColor: "/banks/color/citi.png" },
  { code: "HSBC", th: "เอชเอสบีซี", en: "HSBC", color: "#db0011", logoColor: "/banks/color/hsbc.png" },
  { code: "PROMPTPAY", th: "พร้อมเพย์", en: "PP", color: "#113b5e", logoColor: "/banks/color/promptpay.png" },
  { code: "TRUEMONEY", th: "ทรูมันนี่", en: "TMN", color: "#ec1c24", logoColor: "/banks/color/truemoney.png" },
];

// ตรา fallback (ไม่โชว์ในตัวเลือก) ใช้เมื่อ match ชื่อธนาคารไม่เจอ
export const OTHER_BANK: BankInfo = { code: "OTHER", th: "อื่น ๆ", en: "BANK", color: "#64748b" };

export const BANK_BY_CODE: Record<string, BankInfo> = Object.fromEntries(
  BANKS.map((b) => [b.code, b])
);

/** หา BankInfo จากชื่อ (ไทย/อังกฤษ/รหัส) ที่เก็บไว้ใน acquirer_bank */
export function bankByName(name?: string | null): BankInfo {
  if (!name) return OTHER_BANK;
  const key = name.trim().toLowerCase();
  const found = BANKS.find(
    (b) =>
      b.code.toLowerCase() === key ||
      b.th === name.trim() ||
      b.en.toLowerCase() === key ||
      name.includes(b.th)
  );
  return found ?? OTHER_BANK;
}
