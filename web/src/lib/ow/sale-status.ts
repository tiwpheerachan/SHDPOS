// สถานะบิลขายจาก OneWarehouse — จุดเดียวที่ตัดสินว่า "JST รับบิลแล้ว" (ใช้ทั้งเซิร์ฟเวอร์และหน้าจอ)
//   OW (24 พ.ย.): สำเร็จ = "jst_confirmed" (สเปก OpenAPI) · ทีม OW แจ้งว่าสำเร็จอาจเป็น "shipped" → รองรับทั้งคู่
//   "failed" = JST ปฏิเสธ: ไม่มีการตัดสต๊อก/ไม่มีบิลใน JST → ห้ามถือว่าขายสำเร็จ แก้แล้วส่งใหม่ด้วย PATCH
export const OW_SALE_DONE = new Set(["jst_confirmed", "shipped"]);
export const isOwSaleDone = (s?: string | null) => !!s && OW_SALE_DONE.has(s);
export const isOwSaleFailed = (s?: string | null) => s === "failed";
