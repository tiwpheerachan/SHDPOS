// ภาษีมูลค่าเพิ่มรายบรรทัด (UAT F027–F029) — สูตรเดียวกับ SQL pos_quote_finalize_vat (0076) ทุกสตางค์
//   • vat_mode ต่อสินค้า: inclusive (ราคารวม VAT) · exclusive (ราคาก่อน VAT บวกเพิ่ม) · exempt (ไม่มี VAT)
//   • ส่วนลดหัวบิล (ท้ายบิล/คูปอง/แต้ม) กระจายลงรายการตามสัดส่วน แบบเศษที่เหลือมากสุดได้ก่อน → รวมแล้วตรงพอดี ไม่มีเศษลอย
//   • VAT หัวบิล = ผลรวม VAT รายบรรทัด · ฐาน = ยอด − VAT · คิดเป็นจำนวนเต็มสตางค์ ปัดครึ่งขึ้น (ไม่ใช้ทศนิยมลอยตัว)
export type VatMode = "inclusive" | "exclusive" | "exempt";
export type TaxLineIn = { amount: number; mode?: VatMode | null; rate?: number | null };
export type TaxLineOut = { net: number; alloc: number; vat: number; base: number; total: number; mode: VatMode };
export type TaxResult = { lines: TaxLineOut[]; total: number; vat: number; base: number; exclusiveVat: number };

const toC = (n: number) => Math.round(n * 100);
const fromC = (c: number) => c / 100;
/** a×b/c ปัดครึ่งขึ้น ด้วยจำนวนเต็ม (ค่าบวก) */
const mulDivHalfUp = (a: number, b: number, c: number) => Math.floor((2 * a * b + c) / (2 * c));

/**
 * @param lines   ยอดรายการหลังส่วนลดรายบรรทัด (ก่อนส่วนลดหัวบิล) · ราคาตาม vat_mode ของสินค้า
 * @param header  ยอดหัวบิลก่อนบวก VAT แยก (= ผลรวมรายการ − ส่วนลดหัวบิล)
 */
export function computeVat(lines: TaxLineIn[], header: number): TaxResult {
  const Lc = lines.map((l) => Math.max(toC(l.amount), 0));
  const S = Lc.reduce((a, b) => a + b, 0);
  const Dc = Math.max(Math.min(S - toC(header), S), 0);
  // กระจายส่วนลดหัวบิล: ส่วนเต็มก่อน แล้วแจกเศษให้รายการที่เศษมากสุด (เท่ากัน → ลำดับก่อน)
  const alloc = Lc.map((c) => (S > 0 ? Math.floor((Dc * c) / S) : 0));
  let rem = Dc - alloc.reduce((a, b) => a + b, 0);
  if (rem > 0 && S > 0) {
    const order = Lc.map((c, i) => ({ i, frac: (Dc * c) % S })).sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const o of order) { if (rem <= 0) break; if (Lc[o.i] - alloc[o.i] > 0) { alloc[o.i]++; rem--; } }
  }
  const out = lines.map((l, i): TaxLineOut => {
    const mode: VatMode = l.mode === "exclusive" || l.mode === "exempt" ? l.mode : "inclusive";
    const bp = Math.round((l.rate ?? 7) * 100); // อัตราเป็น basis point (7% = 700)
    const net = Lc[i] - alloc[i];
    const vat = mode === "exempt" || bp <= 0 ? 0 : mode === "inclusive" ? mulDivHalfUp(net, bp, 10000 + bp) : mulDivHalfUp(net, bp, 10000);
    const total = mode === "exclusive" ? net + vat : net;
    return { net: fromC(net), alloc: fromC(alloc[i]), vat: fromC(vat), base: fromC(total - vat), total: fromC(total), mode };
  });
  const totalC = out.reduce((a, l) => a + toC(l.total), 0), vatC = out.reduce((a, l) => a + toC(l.vat), 0);
  const exC = out.reduce((a, l) => a + (l.mode === "exclusive" ? toC(l.vat) : 0), 0);
  return { lines: out, total: fromC(totalC), vat: fromC(vatC), base: fromC(totalC - vatC), exclusiveVat: fromC(exC) };
}
