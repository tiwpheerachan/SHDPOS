// =====================================================================
// พิมพ์รายงานเป็น PDF — เปิดหน้าต่างพิมพ์ (ผู้ใช้เลือก "Save as PDF")
// ไม่พึ่ง library ภายนอก · รองรับภาษาไทย
// =====================================================================

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export function printReport(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  meta?: string
): void {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Noto Sans Thai","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:28px;color:#161616;margin:0}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #161616;padding-bottom:12px;margin-bottom:16px}
  h1{font-size:18px;margin:0;font-weight:700}
  .brand{font-size:11px;color:#777773;text-align:right}
  .meta{color:#777773;font-size:11px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e2e2dd;vertical-align:top}
  th{background:#f3f3f1;text-transform:uppercase;font-size:9px;letter-spacing:.06em;color:#777773}
  tbody tr:nth-child(even) td{background:#fafaf9}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  @media print{@page{margin:14mm}}
</style></head>
<body>
  <div class="head"><h1>${esc(title)}</h1><div class="brand">SHD POS<br/>Retail Command Center</div></div>
  <div class="meta">${esc(meta ?? "")}${meta ? " · " : ""}${esc(new Date().toLocaleString())} · ${rows.length} ${"records"}</div>
  <table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
  <script>window.onload=function(){setTimeout(function(){window.print()},350)}</script>
</body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
