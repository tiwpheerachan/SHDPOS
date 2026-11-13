// =====================================================================
// พิมพ์ใบโอนย้ายสินค้า (CO / Transfer Order) — เปิดหน้าต่างพิมพ์ (เลือก Save as PDF ได้)
//   ไม่พึ่ง library ภายนอก · รองรับไทย · มีช่องเซ็น ผู้ส่ง/ผู้รับ/ผู้อนุมัติ + Serial
// =====================================================================
import type { Transfer } from "@/lib/types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export interface CoDocMeta {
  fromName: string; toName: string; statusLabel: string;
  locale: "th" | "en" | "zh"; carrierName?: string | null;
}

export function printTransferCO(tr: Transfer, meta: CoDocMeta): void {
  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) return;
  const L = (th: string, en: string) => (meta.locale === "th" ? th : en);
  const dt = (s?: string | null) => (s ? new Date(s).toLocaleString(meta.locale === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

  const rows = tr.items.map((it, i) => {
    const sns = (it.shippedSerials?.length ? it.shippedSerials : it.receivedSerials ?? []).map((s) => s.serialNo);
    return `<tr>
      <td class="num">${i + 1}</td>
      <td><div class="pname">${esc(it.name)}</div><div class="sku">${esc(it.sku)}${it.isSerialized ? ' · <span class="sn-tag">SN</span>' : ""}</div>${sns.length ? `<div class="sns">${sns.map((s) => esc(s)).join(" · ")}</div>` : ""}</td>
      <td class="num">${it.qty_requested}</td>
      <td class="num">${it.qty_shipped || "—"}</td>
      <td class="num">${it.qty_received || "—"}</td>
    </tr>`;
  }).join("");

  const sign = (role: string, name: string) => `<div class="sign"><div class="sline"></div><div class="srole">${esc(role)}</div><div class="sname">${esc(name)}</div></div>`;

  const html = `<!doctype html><html lang="${meta.locale}"><head><meta charset="utf-8"><title>CO ${esc(tr.transfer_no)}</title>
<style>
  *{box-sizing:border-box} body{font-family:"Noto Sans Thai","Inter",-apple-system,"Segoe UI",sans-serif;padding:26px;color:#161616;margin:0;font-size:12px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #161616;padding-bottom:12px;margin-bottom:6px}
  .head h1{font-size:18px;margin:0 0 2px;font-weight:800;letter-spacing:.3px}
  .head .sub{font-size:11px;color:#777}
  .brand{text-align:right;font-size:11px;color:#777}
  .brand b{color:#161616;font-size:13px}
  .badge{display:inline-block;border:1px solid #7950D8;color:#7950D8;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:600;margin-top:6px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:14px 0}
  .f{font-size:11px} .f .k{color:#888} .f .v{font-weight:600}
  .route{display:flex;align-items:center;gap:10px;margin:12px 0;padding:10px 14px;background:#f6f5fb;border:1px solid #e7e4f3;border-radius:10px}
  .route .b{font-weight:700;font-size:13px} .route .arr{color:#7950D8;font-weight:700}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #e2e2dd;vertical-align:top}
  th{background:#f3f3f1;text-transform:uppercase;font-size:9px;letter-spacing:.06em;color:#777}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .pname{font-weight:600} .sku{font-size:10px;color:#888;font-family:ui-monospace,monospace}
  .sns{font-size:9.5px;color:#7950D8;margin-top:3px;font-family:ui-monospace,monospace;line-height:1.5}
  .sn-tag{color:#7950D8;font-weight:700}
  .totes{margin-top:8px;text-align:right;font-size:11px;color:#555}
  .signs{display:flex;gap:28px;margin-top:40px}
  .sign{flex:1;text-align:center} .sline{border-top:1px dotted #999;margin-bottom:6px;height:1px} .srole{font-size:11px;color:#555} .sname{font-size:10px;color:#999;margin-top:2px}
  .foot{margin-top:24px;font-size:9.5px;color:#aaa;text-align:center}
  @media print{@page{margin:12mm} body{padding:0}}
</style></head>
<body>
  <div class="head">
    <div><h1>${L("ใบโอนย้ายสินค้า", "Transfer Order")}</h1><div class="sub">Transfer Order (CO) · ${esc(tr.transfer_no)}</div><span class="badge">${esc(meta.statusLabel)}</span></div>
    <div class="brand"><b>SHD POS</b><br/>Stock Transfer Document<br/>${esc(dt(new Date().toISOString()))}</div>
  </div>
  <div class="route"><span class="b">${esc(meta.fromName)}</span><span class="arr">→</span><span class="b">${esc(meta.toName)}</span></div>
  <div class="grid">
    <div class="f"><span class="k">${L("เลขที่เอกสาร", "Document No.")}:</span> <span class="v">${esc(tr.transfer_no)}</span></div>
    <div class="f"><span class="k">${L("วันที่สร้าง", "Created")}:</span> <span class="v">${esc(dt(tr.created_at))}</span></div>
    <div class="f"><span class="k">JST:</span> <span class="v">${esc(tr.jst_allocation_no ?? "—")}</span></div>
    <div class="f"><span class="k">${L("ขนส่ง", "Carrier")}:</span> <span class="v">${esc(meta.carrierName ?? "—")}${tr.tracking ? " · " + esc(tr.tracking) : ""}</span></div>
    ${tr.reference_no ? `<div class="f"><span class="k">Ref:</span> <span class="v">${esc(tr.reference_no)}</span></div>` : ""}
  </div>
  <table>
    <thead><tr><th class="num">#</th><th>${L("สินค้า / Serial", "Item / Serial")}</th><th class="num">${L("ขอ", "Req")}</th><th class="num">${L("ส่ง", "Ship")}</th><th class="num">${L("รับ", "Recv")}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totes">${L("รวม", "Total")} ${tr.items.length} ${L("รายการ", "items")} · ${L("จำนวนรวม", "qty")} ${tr.items.reduce((s, i) => s + i.qty_requested, 0)}</div>
  <div class="signs">
    ${sign(L("ผู้ส่ง (ต้นทาง)", "Sender"), meta.fromName)}
    ${sign(L("ผู้รับ (ปลายทาง)", "Receiver"), meta.toName)}
    ${sign(L("ผู้อนุมัติ", "Approved by"), "")}
  </div>
  <div class="foot">SHD POS · ${esc(tr.transfer_no)} · ${L("เอกสารสร้างจากระบบ", "System-generated document")}</div>
  <script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>
</body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
