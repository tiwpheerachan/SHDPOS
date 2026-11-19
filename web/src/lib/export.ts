// =====================================================================
// ส่งออกข้อมูล — CSV (exportCsv) และ Excel .xls (downloadExcel)
//   เปิดใน Excel/Sheets ได้ รองรับภาษาไทย (BOM) · ไม่ต้องลง library
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

// ── Excel (.xls) แบบจัดรูปแบบ (HTML-table blob) — ใช้ร่วมได้ทุกหน้า ──
export interface ExcelCol<T> { key: string; label: string; map?: (row: T) => string | number }

const escHtml = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function downloadExcel<T>(filename: string, columns: ExcelCol<T>[], rows: T[], title?: string): void {
  const cell = (r: T, c: ExcelCol<T>) => c.map ? c.map(r) : (r as Record<string, unknown>)[c.key];
  const head = `<tr>${columns.map((c) => `<th style="background:#132436;color:#fff;padding:6px 10px;text-align:left">${escHtml(c.label)}</th>`).join("")}</tr>`;
  const body = rows.map((r, i) => `<tr style="background:${i % 2 ? "#f7f8fa" : "#fff"}">${columns.map((c) => `<td style="padding:5px 10px;border:1px solid #e5e7eb">${escHtml(cell(r, c))}</td>`).join("")}</tr>`).join("");
  const cap = title ? `<caption style="text-align:left;font-size:15px;font-weight:700;padding:8px 0">${escHtml(title)}</caption>` : "";
  const html = `<html><head><meta charset="utf-8"></head><body><table border="1" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px">${cap}${head}${body}</table></body></html>`;
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
