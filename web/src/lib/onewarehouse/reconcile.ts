// กระทบ Serial ตอนรับเข้า — เทียบที่ "ส่งมา" กับที่ "สแกนรับ"
export interface SerialReconcile {
  matched: string[];   // ตรง
  extra: string[];     // สแกนได้แต่ไม่ได้ถูกส่งมา (serial_not_shipped)
  missing: string[];   // ส่งมาแต่ยังไม่ได้สแกน (ขาด)
  duplicates: string[]; // สแกนซ้ำ
  ok: boolean;         // ครบและไม่มีปัญหา
}
export function reconcileSerials(shipped: string[], scanned: string[]): SerialReconcile {
  const shipSet = new Set(shipped);
  const scanSet = new Set(scanned);
  const matched = [...scanSet].filter((s) => shipSet.has(s));
  const extra = [...scanSet].filter((s) => !shipSet.has(s));
  const missing = shipped.filter((s) => !scanSet.has(s));
  const duplicates = scanned.filter((s, i) => scanned.indexOf(s) !== i);
  return { matched, extra, missing, duplicates, ok: missing.length === 0 && extra.length === 0 && duplicates.length === 0 };
}
