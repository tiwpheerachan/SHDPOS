# SHD POS — Print Bridge

เอเจนต์ Node เล็ก ๆ ที่รันบนเครื่อง POS แต่ละเครื่อง ทำหน้าที่ส่ง ESC/POS
ไปเครื่องพิมพ์สลิปและเปิดลิ้นชักเงินสด

ผูกกับ `127.0.0.1` เท่านั้น — เครื่องอื่นในเน็ตเวิร์กสั่งพิมพ์ไม่ได้
ใช้ Node standard library ล้วน ไม่ต้องติดตั้ง dependency ใด ๆ

## รัน

```bash
node src/server.js                                      # โหมดทดสอบ (เขียนเป็นไฟล์)
PRINTER_TYPE=network PRINTER_HOST=192.168.1.50 node src/server.js
PRINTER_TYPE=usb PRINTER_DEVICE=/dev/usb/lp0 node src/server.js
```

## ตัวแปรสภาพแวดล้อม

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `PORT` | `9110` | พอร์ตที่ฟัง |
| `PRINTER_TYPE` | `file` | `network` / `usb` / `file` |
| `PRINTER_HOST` | `127.0.0.1` | IP เครื่องพิมพ์ (network) |
| `PRINTER_PORT` | `9100` | พอร์ต RAW ของเครื่องพิมพ์ |
| `PRINTER_DEVICE` | — | `/dev/usb/lp0` หรือ `\\.\XPRINTER` |
| `ALLOW_ORIGin` | `*` | โดเมนที่เรียกได้ คั่นด้วยจุลภาค |
| `SPOOL_DIR` | temp | ที่เก็บไฟล์ในโหมด `file` |

## API

```
GET  /status   → { ok, platform, printerType, printers: [...] }
POST /print    ← { data: "<base64 ESC/POS>", encoding: "base64" }
POST /drawer   ← { pin: 0 | 1 }
```

## ตั้งให้รันตอนเปิดเครื่อง

**Windows** (ใช้ [nssm](https://nssm.cc/))
```
nssm install SHDPosBridge "C:\Program Files\nodejs\node.exe" "C:\shd-pos\bridge\src\server.js"
nssm set SHDPosBridge AppEnvironmentExtra PRINTER_TYPE=network PRINTER_HOST=192.168.1.50
nssm start SHDPosBridge
```

**Linux** (`/etc/systemd/system/shd-pos-bridge.service`)
```ini
[Unit]
Description=SHD POS Print Bridge
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/shd-pos/bridge/src/server.js
Environment=PRINTER_TYPE=network
Environment=PRINTER_HOST=192.168.1.50
Restart=always
User=pos

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now shd-pos-bridge
```

**macOS** — สร้าง `~/Library/LaunchAgents/co.th.shd.pos.bridge.plist` แล้ว `launchctl load`

## ทดสอบ

```bash
curl http://127.0.0.1:9110/status
curl -X POST http://127.0.0.1:9110/drawer -H 'Content-Type: application/json' -d '{"pin":0}'
```

หรือกดปุ่ม "ทดสอบพิมพ์" / "ทดสอบเปิดลิ้นชัก" ในหน้า `/pos/settings` ของแอป
