// แม็พ error code (§9) → ข้อความ th/en/zh — ใช้ร่วมทั้ง local engine และ REST
type Locale = "th" | "en" | "zh";

const MSG: Record<string, { th: string; en: string; zh: string }> = {
  serial_unknown: { th: "ไม่รู้จัก Serial นี้", en: "Unknown serial", zh: "未知序列号" },
  serial_wrong_warehouse: { th: "Serial อยู่คนละคลัง", en: "Serial in wrong warehouse", zh: "序列号属其他仓" },
  serial_wrong_sku: { th: "Serial ไม่ตรงรุ่น/SKU", en: "Serial on wrong SKU", zh: "序列号与SKU不符" },
  serial_duplicate: { th: "สแกน Serial นี้ซ้ำ", en: "Duplicate serial", zh: "序列号重复" },
  serial_not_shipped: { th: "Serial นี้ไม่ได้ถูกส่งมา", en: "Serial was not shipped", zh: "该序列号未发出" },
  sku_not_on_order: { th: "SKU นี้ไม่อยู่ในใบโอน", en: "SKU not on this transfer", zh: "SKU不在单据内" },
  qty_mismatch: { th: "จำนวนไม่ตรงกับที่ส่ง", en: "Quantity mismatch", zh: "数量不符" },
  transfer_version_conflict: { th: "มีคนอัปเดตเอกสารนี้แล้ว — โหลดใหม่", en: "Updated by someone else — reload", zh: "已被他人更新，请重载" },
  transfer_concurrency: { th: "ชนกันชั่วคราว — กำลังลองใหม่", en: "Concurrency — retrying", zh: "并发冲突，重试中" },
  transfer_wrong_status: { th: "สถานะเอกสารไม่ถูกต้องสำหรับขั้นนี้", en: "Wrong status for this step", zh: "单据状态不符" },
  step_not_allowed: { th: "ทำขั้นนี้ไม่ได้ในสถานะปัจจุบัน", en: "Step not allowed now", zh: "当前步骤不允许" },
  transfer_multi_line_unsupported: { th: "ยังไม่รองรับหลายบรรทัดในเอกสารนี้", en: "Multi-line not supported", zh: "暂不支持多行" },
  jst_sync_failed: { th: "ซิงค์กับ JST ไม่สำเร็จ", en: "JST sync failed", zh: "JST同步失败" },
  serial_count_mismatch: { th: "จำนวน Serial ไม่เท่ากับจำนวนที่สั่ง", en: "Serial count ≠ qty", zh: "序列号数量≠数量" },
  not_serialized: { th: "สินค้านี้ยังไม่จัดประเภท Serial — ส่งไม่ได้", en: "Item unclassified — cannot ship", zh: "未分类序列 — 不可发货" },
};

/** แปลง error code → ข้อความตามภาษา (params ใส่ต่อท้ายถ้ามี) */
export function owErrorMessage(code: string, l: Locale, params?: Record<string, unknown>): string {
  const m = MSG[code];
  const base = m ? (l === "th" ? m.th : l === "zh" ? m.zh : m.en) : code;
  const sn = params?.serialNo ?? params?.sku;
  return sn ? `${base} (${sn})` : base;
}
