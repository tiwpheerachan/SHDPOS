// =====================================================================
// ESC/POS builder — สร้างไบต์สำหรับเครื่องพิมพ์สลิปความร้อน 58/80 มม.
// และคำสั่งเปิดลิ้นชักเงินสด (drawer kick)
//
// เครื่องพิมพ์ 80mm = 48 คอลัมน์ (font A), 58mm = 32 คอลัมน์
// =====================================================================

const ESC = 0x1b;
const GS = 0x1d;

export class EscPosBuilder {
  private parts: number[] = [];
  constructor(public readonly width = 48) {
    this.raw(ESC, 0x40); // initialize
    this.raw(ESC, 0x74, 0x3d); // codepage TIS-620 (ไทย) — ปรับตามรุ่นเครื่องพิมพ์
  }

  raw(...bytes: number[]): this {
    this.parts.push(...bytes);
    return this;
  }

  /** ข้อความ — เข้ารหัสเป็น TIS-620 ให้ภาษาไทยออกถูก */
  text(s: string): this {
    for (const ch of s) {
      const code = ch.codePointAt(0)!;
      if (code < 0x80) {
        this.parts.push(code);
      } else if (code >= 0x0e01 && code <= 0x0e5b) {
        this.parts.push(code - 0x0e00 + 0xa0); // TIS-620
      } else {
        this.parts.push(0x3f); // '?' สำหรับอักษรที่เครื่องพิมพ์ไม่รองรับ (เช่น จีน)
      }
    }
    return this;
  }

  line(s = ""): this {
    return this.text(s).raw(0x0a);
  }

  align(a: "left" | "center" | "right"): this {
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  double(on: boolean): this {
    return this.raw(GS, 0x21, on ? 0x11 : 0x00);
  }

  /** ซ้าย-ขวาในบรรทัดเดียว (ใช้กับยอดเงิน) */
  row(left: string, right: string): this {
    const pad = Math.max(1, this.width - visualLength(left) - visualLength(right));
    return this.line(left + " ".repeat(pad) + right);
  }

  divider(ch = "-"): this {
    return this.line(ch.repeat(this.width));
  }

  feed(n = 4): this {
    return this.raw(ESC, 0x64, n);
  }

  cut(): this {
    return this.raw(GS, 0x56, 0x42, 0x00);
  }

  /** เปิดลิ้นชัก: ESC p m t1 t2 */
  kickDrawer(pin: 0 | 1 = 0, on = 50, off = 200): this {
    return this.raw(ESC, 0x70, pin, on, off);
  }

  qr(data: string, size = 6): this {
    const bytes = Array.from(new TextEncoder().encode(data));
    const len = bytes.length + 3;
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30);
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...bytes);
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.parts);
  }

  toBase64(): string {
    const bytes = this.build();
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  }
}

/** ตัวอักษรไทยบางตัว (สระบน/ล่าง) ไม่กินความกว้าง */
const ZERO_WIDTH = /[ัิ-ฺ็-๎]/;

export function visualLength(s: string): number {
  let n = 0;
  for (const ch of s) if (!ZERO_WIDTH.test(ch)) n++;
  return n;
}

/** ตัดข้อความยาวให้พอดีความกว้างสลิป */
export function fit(s: string, width: number): string {
  if (visualLength(s) <= width) return s;
  let out = "";
  let n = 0;
  for (const ch of s) {
    if (!ZERO_WIDTH.test(ch)) {
      if (n >= width - 1) break;
      n++;
    }
    out += ch;
  }
  return out + "…";
}

export function drawerKickBytes(pin: 0 | 1 = 0): Uint8Array {
  return new Uint8Array([ESC, 0x70, pin, 50, 200]);
}
