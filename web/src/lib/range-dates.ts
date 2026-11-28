// ช่วงวันที่ตามชื่อช่วง (เวลาไทย) ฝั่งเซิร์ฟเวอร์ — ตรงกับปุ่ม วันนี้/7D/30D/MTD/YTD/ทั้งหมด ในหน้ายอดขาย
/** ช่วงวันที่ตามชื่อช่วง (เวลาไทย) — ตรงกับปุ่มในหน้ายอดขาย */
export function rangeDates(range: string | undefined, from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 3600_000); // นาฬิกาไทยในรูป UTC
  const startOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - 7 * 3600_000);
  const y = bkk.getUTCFullYear(), m = bkk.getUTCMonth(), d = bkk.getUTCDate();
  switch (range) {
    case "today": return { from: startOf(y, m, d), to: now };
    case "yesterday": return { from: startOf(y, m, d - 1), to: new Date(+startOf(y, m, d) - 1) };
    case "7d": return { from: startOf(y, m, d - 7), to: now };
    case "30d": return { from: startOf(y, m, d - 30), to: now };
    case "mtd": return { from: startOf(y, m, 1), to: now };
    case "ytd": return { from: startOf(y, 0, 1), to: now };
    case "all": return { from: startOf(2024, 0, 1), to: now };
    default: {
      const f = new Date(from ?? ""), t = new Date(to ?? "");
      return Number.isNaN(+f) || Number.isNaN(+t) ? { from: startOf(y, m, d - 30), to: now } : { from: f, to: t };
    }
  }
}
