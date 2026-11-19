// =====================================================================
// PromptPay QR payload (EMVCo) — สร้างสตริงมาตรฐานสำหรับสแกนจ่าย
//   * ใช้เป็นตัวอย่างจำลอง (เบอร์ร้านเป็น demo) — ไม่เชื่อมธนาคารจริง
// =====================================================================

function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  return `${id}${len}${value}`;
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF)
function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** เบอร์มือถือ/เลขอ้างอิง → รูปแบบ 13 หลัก (0066 + 9 หลักท้าย) */
function formatMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "").replace(/^0+/, "");
  return `0066${digits.slice(-9).padStart(9, "0")}`;
}

/**
 * สร้าง payload PromptPay (ระบุจำนวนเงิน) สำหรับเรนเดอร์เป็น QR
 * @param mobile เบอร์พร้อมเพย์ของร้าน (demo)
 * @param amount ยอดเงินบาท
 */
export function promptPayPayload(mobile: string, amount: number): string {
  const merchantAccount = tlv("00", "A000000677010111") + tlv("01", formatMobile(mobile));
  let payload =
    tlv("00", "01") +              // version
    tlv("01", "12") +              // 12 = dynamic (ระบุยอด ใช้ครั้งเดียว)
    tlv("29", merchantAccount) +   // merchant account (PromptPay)
    tlv("53", "764") +             // currency THB
    tlv("54", amount.toFixed(2)) + // amount
    tlv("58", "TH") +              // country
    "6304";                        // CRC tag + length (คำนวณต่อท้าย)
  return payload + crc16(payload);
}

/** เบอร์พร้อมเพย์ร้านตัวอย่าง (จำลอง) */
export const DEMO_PROMPTPAY_MOBILE = "0912345678";
