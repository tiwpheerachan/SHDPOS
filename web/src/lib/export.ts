// =====================================================================
// ส่งออกข้อมูลเป็น CSV (เปิดใน Excel ได้ รองรับภาษาไทยด้วย BOM)
// =====================================================================

export function exportCsv(filename: string, rows: Record<string, unknown>[], headers?: string[]): void {
  if (!rows.length) return;
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function stampFilename(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}`;
}
