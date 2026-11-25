// รูปแบบเอกสารกลาง (ใช้ทั้งฝั่งเซิร์ฟเวอร์สร้าง และหน้า /doc/[token] แสดงผล/พิมพ์/PDF)
export type DocParty = { label: string; name: string; tax_id?: string | null; branch_label?: string | null; address?: string | null; phone?: string | null };
export type DocTable = { columns: { label: string; align?: "left" | "right" | "center"; width?: string }[]; rows: { cells: string[]; sub?: string | null; muted?: boolean }[] };
export type DocPayload = {
  kind: "receipt" | "tax_invoice" | "return" | "warranty" | "trace" | "transfer_out" | "transfer_in" | "transfer_diff";
  title: string; title_en: string; subtitle?: string | null;
  doc_no: string; date: string;
  watermark?: string | null;
  seller: { name: string; name_en?: string | null; tax_id?: string | null; branch_label?: string | null; address?: string | null; phone?: string | null };
  party?: DocParty | null;
  refs: { label: string; value: string }[];
  table?: DocTable | null;
  totals?: { label: string; value: string; strong?: boolean }[];
  payments?: { label: string; value: string }[];
  sections?: { title: string; tone?: "ok" | "warn" | "error" | "info" | "none"; lines: { label: string; value: string }[] }[];
  notes?: string[];
  signatures?: string[];
  internal?: boolean;
  issued_by?: string | null;
};
export type OrderDocItem = {
  kind: DocPayload["kind"]; key: string; title: string; doc_no: string | null; stage: string;
  available: boolean; reason?: string | null; url?: string | null; internal?: boolean; status?: string | null; at?: string | null;
};
