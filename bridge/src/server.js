/* =====================================================================
 * SHD POS — Print Bridge
 *
 * เอเจนต์เล็ก ๆ ที่รันบนเครื่อง POS (Windows / macOS / Linux)
 * ทำหน้าที่เดียว: รับไบต์ ESC/POS จากเว็บ แล้วส่งให้เครื่องพิมพ์/ลิ้นชัก
 *
 * ทำไมต้องมี:
 *   - เบราว์เซอร์คุยกับเครื่องพิมพ์ USB/LAN ตรง ๆ ไม่ได้ (WebSerial มีข้อจำกัด)
 *   - ต้องเปิดลิ้นชักเงินสดผ่านพอร์ต RJ11 ที่ต่อหลังเครื่องพิมพ์
 *   - แยกความล้มเหลวของเครื่องพิมพ์ออกจากการขาย (POS ห้ามค้างเพราะ printer)
 *
 * ใช้ Node standard library ล้วน ไม่ต้องลง dependency ก็ทำงานได้
 *
 * รัน:  node src/server.js
 * ตั้งค่า (env):
 *   PORT=9110
 *   PRINTER_TYPE=network|usb|file      (ค่าเริ่มต้น: file → เขียนเป็นไฟล์ให้ดูตอนทดสอบ)
 *   PRINTER_HOST=192.168.1.50          (network)
 *   PRINTER_PORT=9100                  (network)
 *   PRINTER_DEVICE=/dev/usb/lp0        (usb/linux) หรือ \\.\XPRINTER (windows share)
 *   ALLOW_ORIGIN=http://localhost:3000,https://pos.shd-technology.co.th
 * ===================================================================== */

import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";

const PORT = Number(process.env.PORT || 9110);
const PRINTER_TYPE = process.env.PRINTER_TYPE || "file";
const PRINTER_HOST = process.env.PRINTER_HOST || "127.0.0.1";
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const PRINTER_DEVICE = process.env.PRINTER_DEVICE || "";
const ALLOW_ORIGIN = (process.env.ALLOW_ORIGIN || "*").split(",");
const SPOOL_DIR = process.env.SPOOL_DIR || path.join(os.tmpdir(), "shd-pos-spool");

const ESC = 0x1b;

// ---------------------------------------------------------------------
// คิวงานพิมพ์ — กันงานชนกันเมื่อมีหลายบิลพร้อมกัน
// ---------------------------------------------------------------------
const queue = [];
let working = false;

function enqueue(job) {
  return new Promise((resolve, reject) => {
    queue.push({ job, resolve, reject });
    drain();
  });
}

async function drain() {
  if (working) return;
  working = true;
  while (queue.length) {
    const { job, resolve, reject } = queue.shift();
    try {
      resolve(await job());
    } catch (e) {
      reject(e);
    }
  }
  working = false;
}

// ---------------------------------------------------------------------
// ช่องทางส่งข้อมูลไปเครื่องพิมพ์
// ---------------------------------------------------------------------
function sendNetwork(buf) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: PRINTER_HOST, port: PRINTER_PORT }, () => {
      socket.write(buf, () => socket.end());
    });
    socket.setTimeout(8000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("printer timeout"));
    });
    socket.on("error", reject);
    socket.on("close", () => resolve({ transport: "network", host: PRINTER_HOST }));
  });
}

function sendDevice(buf) {
  return new Promise((resolve, reject) => {
    if (!PRINTER_DEVICE) return reject(new Error("PRINTER_DEVICE not set"));
    fs.writeFile(PRINTER_DEVICE, buf, (err) => {
      if (err) reject(err);
      else resolve({ transport: "usb", device: PRINTER_DEVICE });
    });
  });
}

function sendFile(buf) {
  fs.mkdirSync(SPOOL_DIR, { recursive: true });
  const file = path.join(SPOOL_DIR, `receipt-${Date.now()}.bin`);
  fs.writeFileSync(file, buf);
  return Promise.resolve({ transport: "file", file });
}

function send(buf) {
  if (PRINTER_TYPE === "network") return sendNetwork(buf);
  if (PRINTER_TYPE === "usb") return sendDevice(buf);
  return sendFile(buf);
}

// ---------------------------------------------------------------------
// รายชื่อเครื่องพิมพ์ในระบบ (ไว้ให้หน้าตั้งค่าเลือก)
// ---------------------------------------------------------------------
function listPrinters() {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("wmic", ["printer", "get", "name"], (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split(/\r?\n/).slice(1).map((s) => s.trim()).filter(Boolean));
      });
    } else {
      execFile("lpstat", ["-a"], (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split(/\r?\n/).map((l) => l.split(" ")[0]).filter(Boolean));
      });
    }
  });
}

// ---------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------
function cors(req, res) {
  const origin = req.headers.origin;
  const allowed = ALLOW_ORIGIN.includes("*") || (origin && ALLOW_ORIGIN.includes(origin));
  res.setHeader("Access-Control-Allow-Origin", allowed ? origin || "*" : "null");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // สถานะ + รายชื่อเครื่องพิมพ์
  if (req.method === "GET" && url.pathname === "/status") {
    const printers = await listPrinters();
    return json(res, 200, {
      ok: true,
      version: "0.1.0",
      platform: process.platform,
      printerType: PRINTER_TYPE,
      spoolDir: PRINTER_TYPE === "file" ? SPOOL_DIR : undefined,
      printers,
    });
  }

  // พิมพ์สลิป — body: { data: base64, encoding: "base64" }
  if (req.method === "POST" && url.pathname === "/print") {
    try {
      const body = await readBody(req);
      if (!body.data) return json(res, 400, { ok: false, error: "missing data" });
      const buf = Buffer.from(body.data, body.encoding === "hex" ? "hex" : "base64");
      const result = await enqueue(() => send(buf));
      return json(res, 200, { ok: true, bytes: buf.length, ...result });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  // เปิดลิ้นชัก — body: { pin: 0|1 }
  if (req.method === "POST" && url.pathname === "/drawer") {
    try {
      const body = await readBody(req);
      const pin = body.pin === 1 ? 1 : 0;
      const buf = Buffer.from([ESC, 0x70, pin, 50, 200]);
      const result = await enqueue(() => send(buf));
      return json(res, 200, { ok: true, pin, ...result });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  json(res, 404, { ok: false, error: "not found" });
});

// ผูกกับ 127.0.0.1 เท่านั้น — เครื่องอื่นในเน็ตเวิร์กสั่งพิมพ์ไม่ได้
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[shd-pos-bridge] listening on http://127.0.0.1:${PORT}`);
  console.log(`[shd-pos-bridge] printer type: ${PRINTER_TYPE}`);
  if (PRINTER_TYPE === "file") console.log(`[shd-pos-bridge] spool dir: ${SPOOL_DIR}`);
});
