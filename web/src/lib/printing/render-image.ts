// =====================================================================
// วาดใบเสร็จเป็นรูป (PNG ขาว-ดำ) จากคำสั่งที่ EscPosBuilder บันทึกไว้
//   ใช้กับเครื่องพิมพ์ในตัวของ Sunmi ผ่านแอปตัวหุ้ม — ภาษาไทย/จีนออกถูกแน่นอน (ใช้ฟอนต์ของแอป)
//   80 มม. = กว้าง 576 จุด · 58 มม. = 384 จุด
// =====================================================================
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import type { EscPosBuilder, ReceiptOp } from "./escpos";

const SPLIT = /\s{2,}/; // ช่องว่างหลายตัว = แบ่งคอลัมน์ (ข้อความถูกจัดคอลัมน์ไว้สำหรับฟอนต์ความกว้างเท่ากัน)

function qrImage(data: string, px: number): Promise<HTMLImageElement> {
  let svg = renderToStaticMarkup(createElement(QRCodeSVG, { value: data, size: px, level: "M", marginSize: 0, bgColor: "#ffffff", fgColor: "#000000" }));
  // React ไม่ใส่ xmlns ให้ <svg> → โหลดเป็นรูปไม่ได้
  if (!/xmlns=/.test(svg)) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error("qr render failed"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** คืน PNG base64 (ไม่มี prefix data:) */
export async function renderReceiptPng(b: EscPosBuilder, widthPx: number): Promise<string> {
  return (await renderReceiptCanvas(b, widthPx)).toDataURL("image/png").split(",")[1];
}

/**
 * ใบเสร็จเป็นคำสั่งพิมพ์รูป ESC/POS (GS v 0) — ใช้กับเครื่องพิมพ์ใบเสร็จทั่วไป (Gainscha/Xprinter/Epson ฯลฯ)
 *   ภาษาไทยออกถูกแน่นอน ไม่ต้องพึ่งชุดตัวอักษรในเครื่องพิมพ์ · ตัดกระดาษท้ายใบ
 */
export async function renderReceiptRaster(b: EscPosBuilder, widthPx: number, opts: { cut?: boolean } = {}): Promise<Uint8Array> {
  const c = await renderReceiptCanvas(b, widthPx);
  const g = c.getContext("2d")!;
  const { data } = g.getImageData(0, 0, c.width, c.height);
  const bytesPerRow = Math.ceil(c.width / 8);
  const out: number[] = [0x1b, 0x40]; // ESC @
  const BAND = 128; // ส่งเป็นช่วง ๆ กันบัฟเฟอร์เครื่องพิมพ์เต็ม
  for (let y0 = 0; y0 < c.height; y0 += BAND) {
    const rows = Math.min(BAND, c.height - y0);
    out.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8);
    for (let y = y0; y < y0 + rows; y++) {
      for (let xb = 0; xb < bytesPerRow; xb++) {
        let v = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit;
          if (x >= c.width) continue;
          const i = (y * c.width + x) * 4;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (data[i + 3] > 0 && lum < 160) v |= 0x80 >> bit; // ดำ = จุดพิมพ์
        }
        out.push(v);
      }
    }
  }
  out.push(0x1b, 0x64, 0x04); // feed 4 บรรทัด
  if (opts.cut !== false) out.push(0x1d, 0x56, 0x42, 0x00); // ตัดกระดาษ
  return new Uint8Array(out);
}

async function renderReceiptCanvas(b: EscPosBuilder, widthPx: number): Promise<HTMLCanvasElement> {
  const cols = b.width;
  const family = (typeof document !== "undefined" && getComputedStyle(document.body).fontFamily) || "sans-serif";
  const base = Math.round((widthPx / cols) * 1.9); // 80มม./48คอลัมน์ ≈ 23px
  const lh = (dbl: boolean) => Math.round((dbl ? base * 1.6 : base) * 1.35);
  const font = (bold: boolean, dbl: boolean, px?: number) => `${bold ? "700" : "400"} ${px ?? (dbl ? Math.round(base * 1.6) : base)}px ${family}`;
  const pad = 4;

  // รูป QR ล่วงหน้า + คำนวณความสูง
  const qrs = new Map<ReceiptOp, HTMLImageElement | null>();
  let h = pad * 2;
  for (const op of b.ops) {
    if (op.t === "line" || op.t === "row") h += lh(op.double);
    else if (op.t === "divider") h += Math.round(base * 0.9);
    else if (op.t === "feed") h += Math.round(base * 0.6) * Math.min(op.n, 4);
    else if (op.t === "qr") {
      // QR ล้ม = ข้าม QR แต่ยังพิมพ์ใบเสร็จได้ (ห้ามทำให้การพิมพ์ทั้งใบล้ม)
      const px = Math.min(widthPx - 40, op.size * 48);
      const img = await qrImage(op.data, px).catch(() => null);
      qrs.set(op, img); h += img ? px + base : 0;
    }
  }

  const c = document.createElement("canvas");
  c.width = widthPx; c.height = Math.max(h, 40);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000"; g.strokeStyle = "#000"; g.textBaseline = "middle";

  /** เขียนข้อความ — ยาวเกินพื้นที่ = ย่อฟอนต์ลงให้พอดี (ไม่ตัดคำ) */
  const draw = (s: string, x: number, y: number, align: CanvasTextAlign, bold: boolean, dbl: boolean, maxW: number) => {
    let px = dbl ? Math.round(base * 1.6) : base;
    g.font = font(bold, dbl, px);
    while (px > 10 && g.measureText(s).width > maxW) { px -= 1; g.font = font(bold, dbl, px); }
    g.textAlign = align;
    g.fillText(s, x, y);
  };

  let y = pad;
  for (const op of b.ops) {
    if (op.t === "line") {
      const mid = y + lh(op.double) / 2;
      const s = op.s.replace(/\s+$/, "");
      const segs = op.align === "left" ? s.split(SPLIT) : [s.trim()];
      if (segs.length <= 1) {
        const x = op.align === "center" ? widthPx / 2 : op.align === "right" ? widthPx - pad : pad;
        draw(s.trim(), x, mid, op.align, op.bold, op.double, widthPx - pad * 2);
      } else {
        // คอลัมน์: วางตามตำแหน่งตัวอักษรเดิม · ช่องสุดท้ายชิดขวาถ้าเดิมชิดขอบขวา
        let idx = 0;
        segs.forEach((seg, i) => {
          const at = s.indexOf(seg, idx); idx = at + seg.length;
          const last = i === segs.length - 1;
          if (last && idx >= cols - 2) draw(seg, widthPx - pad, mid, "right", op.bold, op.double, widthPx * 0.45);
          else draw(seg, pad + (at / cols) * (widthPx - pad * 2), mid, "left", op.bold, op.double, widthPx * (last ? 0.6 : 0.55));
        });
      }
      y += lh(op.double);
    } else if (op.t === "row") {
      const mid = y + lh(op.double) / 2;
      g.font = font(op.bold, op.double);
      const rw = g.measureText(op.r).width;
      draw(op.r, widthPx - pad, mid, "right", op.bold, op.double, widthPx * 0.5);
      draw(op.l, pad, mid, "left", op.bold, op.double, Math.max(40, widthPx - pad * 3 - rw));
      y += lh(op.double);
    } else if (op.t === "divider") {
      const yy = y + Math.round(base * 0.45);
      g.lineWidth = op.ch === "=" ? 3 : 2;
      g.setLineDash(op.ch === "-" ? [8, 6] : []);
      g.beginPath(); g.moveTo(pad, yy); g.lineTo(widthPx - pad, yy); g.stroke();
      g.setLineDash([]);
      y += Math.round(base * 0.9);
    } else if (op.t === "feed") {
      y += Math.round(base * 0.6) * Math.min(op.n, 4);
    } else if (op.t === "qr") {
      const img = qrs.get(op);
      if (!img) continue;
      g.drawImage(img, (widthPx - img.width) / 2, y + base / 2, img.width, img.height);
      y += img.height + base;
    }
  }
  return c;
}
