// =====================================================================
// พิมพ์ใบโอนย้ายสินค้า (CO / Inter-branch Stock Transfer) — เอกสารทางการ A4
//   ไม่พึ่ง library ภายนอก · รองรับไทย · หัวจดหมาย + โลโก้ + ตราประทับ + ลายเซ็น 4 ฝ่าย
//   โลโก้/ตราประทับ: ส่ง logoUrl / stampUrl (data URL หรือ path) ได้ ถ้าไม่ส่งจะโชว์กรอบว่างรอแปะ
// =====================================================================
import type { Transfer } from "@/lib/types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

export interface CoCompany {
  name: string; nameEn?: string; address?: string; taxId?: string; tel?: string;
}
export interface CoDocMeta {
  fromName: string; toName: string; statusLabel: string;
  locale: "th" | "en" | "zh"; carrierName?: string | null;
  /** ชื่อผู้เกี่ยวข้อง (เติมในช่องลายเซ็น) */
  requesterName?: string | null; approverName?: string | null;
  /** โลโก้ + ตราประทับ (data URL หรือ URL) — ไม่ส่ง = โชว์กรอบว่าง */
  logoUrl?: string | null; stampUrl?: string | null;
  company?: Partial<CoCompany>;
  note?: string | null;
}

const DEFAULT_COMPANY: CoCompany = {
  name: "บริษัท เอส เอช ดี เทคโนโลยี จำกัด",
  nameEn: "SHD Technology Co., Ltd.",
  address: "— ที่อยู่สำนักงานใหญ่ —",
  taxId: "เลขประจำตัวผู้เสียภาษี —",
  tel: "โทร. —",
};

export function printTransferCO(tr: Transfer, meta: CoDocMeta): void {
  const win = window.open("", "_blank", "width=860,height=960");
  if (!win) return;
  const th = meta.locale === "th";
  const L = (t: string, e: string) => (th ? t : e);
  const dt = (s?: string | null) => (s ? new Date(s).toLocaleString(th ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
  const dOnly = (s?: string | null) => (s ? new Date(s).toLocaleDateString(th ? "th-TH" : "en-GB", { dateStyle: "long" }) : "—");
  const co = { ...DEFAULT_COMPANY, ...(meta.company ?? {}) };

  const rows = tr.items.map((it, i) => {
    const sns = (it.shippedSerials?.length ? it.shippedSerials : it.receivedSerials ?? []).map((s) => s.serialNo);
    return `<tr>
      <td class="num">${i + 1}</td>
      <td><div class="pname">${esc(it.name)}</div><div class="sku">${esc(it.sku)}${it.isSerialized ? ' · <span class="sn-tag">SN</span>' : ""}</div>${sns.length ? `<div class="sns">${sns.map((s) => `<span>${esc(s)}</span>`).join("")}</div>` : ""}</td>
      <td class="num">${it.qty_requested}</td>
      <td class="num">${it.qty_shipped || "–"}</td>
      <td class="num">${it.qty_received || "–"}</td>
    </tr>`;
  }).join("");

  const totalQty = tr.items.reduce((s, i) => s + i.qty_requested, 0);
  const logoBox = meta.logoUrl
    ? `<img class="logo-img" src="${esc(meta.logoUrl)}" alt="logo"/>`
    : `<div class="logo-ph">${L("โลโก้บริษัท", "COMPANY LOGO")}</div>`;
  const stampBox = meta.stampUrl
    ? `<img class="stamp-img" src="${esc(meta.stampUrl)}" alt="stamp"/>`
    : `<div class="stamp-ph"><span>${L("ประทับตรา", "OFFICIAL")}</span><span>${L("บริษัท", "SEAL")}</span></div>`;

  const sign = (role: string, name?: string | null) => `<div class="sign">
    <div class="sline"></div>
    <div class="srole">${esc(role)}</div>
    <div class="sname">${name ? esc(name) : "( ………………………………… )"}</div>
    <div class="sdate">${L("วันที่", "Date")} …… / …… / ……</div>
  </div>`;

  const html = `<!doctype html><html lang="${meta.locale}"><head><meta charset="utf-8"><title>${L("ใบโอนย้ายสินค้า", "Transfer Order")} ${esc(tr.transfer_no)}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0}
  body{font-family:"Noto Sans Thai","Sarabun","Inter",-apple-system,"Segoe UI",sans-serif;color:#1b1b1f;font-size:12px;line-height:1.5;background:#fff}
  .sheet{max-width:760px;margin:0 auto;padding:30px 36px 40px;position:relative}
  .wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:0}
  .wm span{font-size:120px;font-weight:800;letter-spacing:8px;color:#E05A29;opacity:.045;transform:rotate(-22deg);white-space:nowrap}
  .doc{position:relative;z-index:1}
  /* หัวจดหมาย */
  .lh{display:flex;align-items:center;gap:18px;padding-bottom:16px;border-bottom:2.5px solid #1b1b1f}
  .logo-ph{width:84px;height:84px;border:1.5px dashed #b9b4cf;border-radius:12px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:8.5px;letter-spacing:.08em;color:#a59fc0;font-weight:600;flex:0 0 auto;background:#faf9fe}
  .logo-img{width:84px;height:84px;object-fit:contain;flex:0 0 auto}
  .co{flex:1;min-width:0}
  .co .nm{font-family:"Noto Serif Thai",Georgia,"Times New Roman",serif;font-size:19px;font-weight:700;letter-spacing:.2px;line-height:1.25}
  .co .nm-en{font-size:11px;color:#6b6b74;margin-top:1px;letter-spacing:.3px}
  .co .meta{font-size:10px;color:#86868f;margin-top:5px;line-height:1.6}
  /* แถบชื่อเอกสาร */
  .title{display:flex;justify-content:space-between;align-items:flex-end;margin:18px 0 4px}
  .title h1{font-family:"Noto Serif Thai",Georgia,serif;font-size:21px;margin:0;font-weight:700;letter-spacing:.4px}
  .title .sub{font-size:10.5px;color:#86868f;letter-spacing:.14em;text-transform:uppercase;margin-top:2px}
  .title .st{text-align:right}
  .badge{display:inline-block;border:1.4px solid #E05A29;color:#E05A29;border-radius:999px;padding:3px 13px;font-size:10.5px;font-weight:700;letter-spacing:.03em}
  .docno{font-size:11px;color:#6b6b74;margin-top:5px}
  .docno b{color:#1b1b1f;font-family:ui-monospace,monospace;letter-spacing:.02em}
  /* กล่องเส้นทาง */
  .route{display:flex;align-items:center;gap:14px;margin:16px 0 14px;padding:13px 18px;background:linear-gradient(90deg,#f7f5fd,#fcfbff);border:1px solid #e7e3f5;border-radius:12px}
  .route .side{flex:1;min-width:0}
  .route .lab{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#9a94b4;font-weight:600}
  .route .b{font-weight:700;font-size:14px;margin-top:1px}
  .route .arr{color:#E05A29;font-size:22px;font-weight:300;flex:0 0 auto}
  /* เมตา */
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:7px 28px;margin:4px 2px 16px}
  .f{font-size:11px;display:flex;gap:6px;border-bottom:1px dotted #e4e2ea;padding-bottom:5px}
  .f .k{color:#8a8a93;flex:0 0 auto} .f .v{font-weight:600;color:#1b1b1f}
  /* ตาราง */
  table{width:100%;border-collapse:collapse;margin-top:2px}
  thead th{background:#1b1b1f;color:#fff;text-align:left;padding:8px 11px;font-size:9px;letter-spacing:.07em;text-transform:uppercase;font-weight:600}
  thead th:first-child{border-radius:7px 0 0 7px} thead th:last-child{border-radius:0 7px 7px 0}
  tbody td{padding:9px 11px;border-bottom:1px solid #ececef;vertical-align:top}
  tbody tr:nth-child(even){background:#faf9fc}
  .num{text-align:right;font-variant-numeric:tabular-nums;width:52px}
  thead th.num{text-align:right}
  .pname{font-weight:600;font-size:12px} .sku{font-size:10px;color:#9a9aa2;font-family:ui-monospace,monospace;margin-top:1px}
  .sn-tag{color:#E05A29;font-weight:700}
  .sns{margin-top:5px;display:flex;flex-wrap:wrap;gap:4px}
  .sns span{font-size:9px;color:#5b4b9e;font-family:ui-monospace,monospace;background:#f1eefb;border:1px solid #e3def5;border-radius:5px;padding:1px 6px}
  /* รวม */
  .totes{display:flex;justify-content:flex-end;gap:26px;margin-top:12px;padding:10px 12px;background:#faf9fc;border-radius:8px;font-size:11px}
  .totes .t .k{color:#8a8a93;font-size:9.5px;letter-spacing:.04em} .totes .t .v{font-weight:700;font-size:15px}
  .note{margin-top:12px;font-size:11px;padding:10px 13px;border-left:3px solid #E05A29;background:#faf9fe;border-radius:0 8px 8px 0}
  .note .k{color:#8a8a93;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase}
  /* ลายเซ็น + ตรา */
  .auth{display:flex;gap:18px;margin-top:38px;align-items:flex-end}
  .signs{flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
  .sign{text-align:center} .sline{border-top:1.2px solid #1b1b1f;margin:0 6px 7px} .srole{font-size:10.5px;font-weight:600;color:#3a3a40} .sname{font-size:10px;color:#9a9aa2;margin-top:3px} .sdate{font-size:9px;color:#b4b4bb;margin-top:3px}
  .stamp{flex:0 0 130px;display:flex;align-items:center;justify-content:center}
  .stamp-ph{width:118px;height:118px;border:1.5px dashed #c9b7e0;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:#b6a6cf;font-size:10px;font-weight:600;letter-spacing:.1em;text-align:center}
  .stamp-img{width:122px;height:122px;object-fit:contain}
  .foot{margin-top:28px;padding-top:12px;border-top:1px solid #ececef;display:flex;justify-content:space-between;font-size:9px;color:#b0b0b7}
  @media print{@page{size:A4;margin:12mm} .sheet{padding:0;max-width:none} body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body>
  <div class="sheet">
    <div class="wm"><span>${esc(co.nameEn || "SHD")}</span></div>
    <div class="doc">
      <!-- หัวจดหมาย -->
      <div class="lh">
        ${logoBox}
        <div class="co">
          <div class="nm">${esc(co.name)}</div>
          ${co.nameEn ? `<div class="nm-en">${esc(co.nameEn)}</div>` : ""}
          <div class="meta">${esc(co.address)}${co.taxId ? ` &nbsp;·&nbsp; ${esc(co.taxId)}` : ""}${co.tel ? ` &nbsp;·&nbsp; ${esc(co.tel)}` : ""}</div>
        </div>
      </div>
      <!-- ชื่อเอกสาร -->
      <div class="title">
        <div>
          <h1>${L("ใบโอนย้ายสินค้าระหว่างสาขา", "Inter-branch Stock Transfer")}</h1>
          <div class="sub">Stock Transfer Order (CO)</div>
        </div>
        <div class="st">
          <span class="badge">${esc(meta.statusLabel)}</span>
          <div class="docno">${L("เลขที่", "No.")} <b>${esc(tr.transfer_no)}</b></div>
          <div class="docno">${L("วันที่", "Date")} ${esc(dOnly(tr.created_at))}</div>
        </div>
      </div>
      <!-- เส้นทาง -->
      <div class="route">
        <div class="side"><div class="lab">${L("ต้นทาง", "From")}</div><div class="b">${esc(meta.fromName)}</div></div>
        <div class="arr">➝</div>
        <div class="side" style="text-align:right"><div class="lab">${L("ปลายทาง", "To")}</div><div class="b">${esc(meta.toName)}</div></div>
      </div>
      <!-- เมตา -->
      <div class="grid">
        <div class="f"><span class="k">${L("เลขที่เอกสาร", "Document No.")}</span> <span class="v">${esc(tr.transfer_no)}</span></div>
        <div class="f"><span class="k">${L("วันที่-เวลาสร้าง", "Created")}</span> <span class="v">${esc(dt(tr.created_at))}</span></div>
        <div class="f"><span class="k">${L("ขนส่ง", "Carrier")}</span> <span class="v">${esc(meta.carrierName ?? "—")}${tr.tracking ? " · " + esc(tr.tracking) : ""}</span></div>
        <div class="f"><span class="k">JST Allocation</span> <span class="v">${esc(tr.jst_allocation_no ?? "—")}</span></div>
        ${tr.reference_no ? `<div class="f"><span class="k">${L("อ้างอิง", "Reference")}</span> <span class="v">${esc(tr.reference_no)}</span></div>` : ""}
        <div class="f"><span class="k">${L("สถานะ", "Status")}</span> <span class="v">${esc(meta.statusLabel)}</span></div>
      </div>
      <!-- รายการ -->
      <table>
        <thead><tr><th class="num">#</th><th>${L("รายการสินค้า / Serial No.", "Item / Serial No.")}</th><th class="num">${L("ขอ", "Req")}</th><th class="num">${L("ส่ง", "Ship")}</th><th class="num">${L("รับ", "Recv")}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totes">
        <div class="t"><div class="k">${L("จำนวนรายการ", "Line items")}</div><div class="v">${tr.items.length}</div></div>
        <div class="t"><div class="k">${L("จำนวนรวม (ชิ้น)", "Total qty")}</div><div class="v">${totalQty}</div></div>
      </div>
      ${meta.note ? `<div class="note"><span class="k">${L("หมายเหตุ / เหตุผล", "Note / Reason")}</span><br/>${esc(meta.note)}</div>` : ""}
      <!-- ลายเซ็น + ตราประทับ -->
      <div class="auth">
        <div class="signs">
          ${sign(L("ผู้จัดทำ / ผู้ขอโอน", "Prepared / Requested"), meta.requesterName)}
          ${sign(L("ผู้อนุมัติ", "Approved by"), meta.approverName)}
          ${sign(L("ผู้ส่งมอบ (ต้นทาง)", "Delivered by"), null)}
          ${sign(L("ผู้รับมอบ (ปลายทาง)", "Received by"), null)}
        </div>
        <div class="stamp">${stampBox}</div>
      </div>
      <div class="foot">
        <span>${L("เอกสารนี้ออกโดยระบบ SHD POS", "System-generated by SHD POS")} · ${esc(tr.transfer_no)}</span>
        <span>${L("พิมพ์เมื่อ", "Printed")} ${esc(dt(new Date().toISOString()))}</span>
      </div>
    </div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print()},450)}</script>
</body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
