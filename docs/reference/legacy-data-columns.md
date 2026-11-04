# อ้างอิง — คอลัมน์จากไฟล์ยอดขายเดิม → ตารางใหม่

ไฟล์ต้นทาง: `2024-offline 线下销售-多维表格_สาขา门店.xlsx`
**98,445 บรรทัด · 57 คอลัมน์ · 4 แบรนด์ · 29 สาขา · 293 พนักงานขาย · 1,250 SKU**

เอกสารนี้คือสะพานระหว่างวิธีเก็บข้อมูลแบบเดิมกับ schema ใหม่ ใช้ตอน migrate ข้อมูลย้อนหลัง

## ตาราง mapping

| # | คอลัมน์เดิม | ตาราง.ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|---|
| 1 | หมายเลขคำสั่งซื้อ 订单号 | `orders.reference_no` | เลขจากระบบเดิม/มาร์เก็ตเพลส |
| 2 | 流水明细 | — | ข้อความประกอบ ไม่ต้อง migrate |
| 3 | ค่าธรรมเนียมธนาคาร 扣除手续费金额 | `order_payments.fee_amount` | |
| 4 | 品牌 | `brands.code` ผ่าน `branches.brand_id` | 70mai / Anker / dreame / ddpai |
| 5 | สาขา 门店 | `branches.name` | 29 ค่า ดูตารางสาขาด้านล่าง |
| 6 | เดือน 月份 | อนุมานจาก `orders.created_at` | ไม่เก็บซ้ำ |
| 7 | ปี 年份 | อนุมานจาก `orders.created_at` | |
| 8 | วันที่ 销售时间 | `orders.created_at` | |
| 9 | 菜菜核对流水 | — | ฟิลด์ตรวจสอบภายในของทีมจีน |
| 10 | 菜菜无法核对 | — | เหมือนข้างบน |
| 11 | **พนักงานขาย 销售员** | `order_items.salesperson_id` → `employees.nickname` | 293 ค่า ตัวพิมพ์/ภาษาไม่สม่ำเสมอ ต้อง normalize |
| 12 | POS ธนาคาร 刷卡机银行 | `order_payments.acquirer_bank` | |
| 13 | ชื่อลูกค้า 姓名 | `orders.customer_name` / `customers.name` | |
| 14 | เลข invoice 发票号码 | `tax_documents.doc_no` | รูปแบบ `IV6705210003` |
| 15 | เบอร์โทร 电话 | `orders.customer_phone` / `customers.phone` | ใช้เป็นคีย์รวมลูกค้า |
| 16 | **SKU** | `order_items.sku` → `products.sku` | 1,250 ค่า รวมทั้งสินค้าและบริการ |
| 17 | **ประเภทของ 销售类型** | `order_items.kind` | ดูตารางแปลงด้านล่าง |
| 18 | จำนวน 数量 | `order_items.qty` | |
| 19 | ราคาขาย IV 含税单价 | `order_items.unit_price` | รวม VAT แล้ว |
| 20 | ส่วนลด 折扣 | `order_items.discount_amount` | |
| 21 | หักส่วนลด 折扣后单价 | คำนวณได้ | ไม่เก็บซ้ำ |
| 22 | ยอดขายรวม 销售金额 | `order_items.line_total` | |
| 23 | **ชำระ 付款方式** | `order_payments.method` | ดูตารางแปลงด้านล่าง |
| 24 | **ช่องทาง 订单来源** | `orders.channel` | ดูตารางแปลงด้านล่าง |
| 25 | หลักฐานการโอนเงิน | Supabase Storage + `order_payments.reference_no` | ชื่อไฟล์รูป |
| 26 | จำนวนเงินยอดเต็มที่ได้รับ 刷卡总金额 | `order_payments.amount` | |
| 27 | **SN NO.** | `order_item_serials.serial_no` → `serials` | หัวใจของงานหลังการขาย |
| 28 | รายละเอียดออกใบกำกับภาษี | `tax_documents` | |
| 29 | อีเมลลูกค้า | `customers.email` / `tax_documents.buyer_email` | ใช้กับ e-Tax by Email |
| 30 | รายละเอียดออกใบกำกับภาษี | `tax_documents.buyer_*` | คอลัมน์ซ้ำในไฟล์เดิม |
| 31 | รายการผ่อน | `order_payments.installment_months` | |
| 32 | ช่องทาง 订单来源1 | `orders.channel` | คอลัมน์ซ้ำ |
| 33 | ธนาคาร | `order_payments.acquirer_bank` | `(กสิกร)`, `(SCB)`, `(กรุงไทย)`, … |
| 34 | ได้รับเงินแล้ว 回款确定 | `order_payments.received_at` | งานกระทบยอดของฝ่ายการเงิน |
| 35 | หมายเลขวีซ่า MID 详细 | `order_payments.mid` + `approval_code` | เช่น `VISA 65804728000642` |
| 36 | บิลใบกำกับสินค้า IN.Voice | `tax_documents.etax_pdf_url` | ชื่อไฟล์ PDF |
| 37 | ใบเสร็จรับเงิน | `tax_documents` (`doc_type = receipt`) | |
| 38 | 深圳财务确定 | — | ขั้นตอนตรวจสอบของสำนักงานจีน |
| 39 | ค่าใช้จ่าย 成本单价 | `order_items.unit_cost` | |
| 40 | ต้นทุนทั้งหมด 成本金额 | `order_items.cost_total` | |
| 41 | 核实单价 | — | ฟิลด์ตรวจสอบ |
| 42 | **กำไรสินค้าโภคภัณฑ์ 毛利** | `order_items.gross_profit` | |
| 43 | 门店账号 | `branches.erp_store_code` | เช่น `[Brand Shop] 70mai - Ramindra` |
| 44 | อัตราส่วนต้นทุน 成本占比 | คำนวณได้ | ไม่เก็บซ้ำ |
| 45 | 文本 11 | — | |
| 46 | 门店品牌 | `branches.brand_id` | |
| 47 | เวลาเก็บเงินของธนาคาร 银行到账时间 | `order_payments.received_at` | |
| 48 | ธนาคารผู้รับ 收款银行 | `order_payments.acquirer_bank` | |
| 49 | จำนวนเงินรายได้ธนาคาร 银行收款金额 | `order_payments.amount` | |
| 50 | ยอดเงินค้างชำระ 未回款金额 | คำนวณจาก `orders.grand_total − paid_total` | |
| 51 | แหล่งลูกค้า 客户来源 | `customers.source` | |
| 52 | ชำระหลายบิล 多订单回款 | จัดการด้วย `order_payments` หลายแถว | |
| 53 | 菜菜核对银行流水 | — | ฟิลด์ตรวจสอบ |
| 54 | IVT | — | |
| 55 | 文本 13 | — | |
| 56 | 对应公司 | `settings.company.profile` | นิติบุคคลที่ออกบิล |
| 57 | 月份♻️ | อนุมานจากวันที่ | |

**สรุป**: 57 คอลัมน์ → เก็บจริง 34 คอลัมน์, คำนวณได้ 6, เป็นฟิลด์ตรวจสอบภายใน 17

## ตารางแปลงค่า

### ประเภทของ → `order_items.kind`

| ค่าเดิม | จำนวนบรรทัด | ค่าใหม่ | ตัดสต๊อก? |
|---|---:|---|:---:|
| ขายสินค้า 商品销售 | 72,413 | `goods` | ✅ |
| บริการติดตั้ง 安装服务 | 21,068 | `service` | ❌ |
| รับสินค้าหน้าร้าน 自提 | 2,292 | `goods` + `channel = online_*` | ✅ |
| ค่าเดินทาง 上门安装服务费 | 161 | `fee` | ❌ |
| เครมสินค้า 售后 | 93 | `claim` | ตาม `returns` |
| B2B | 11 | `b2b` | ✅ |

### ชำระ → `order_payments.method`

| ค่าเดิม | จำนวน | ค่าใหม่ |
|---|---:|---|
| บัตรเครดิต POS | 44,369 | `credit_card` |
| QR 扫码 | 40,014 | `qr_promptpay` |
| online การชำระเงิน 线上支付 | 9,148 | `online_marketplace` |
| โอนเงินเข้าบัญชี 转账入账户 | 2,398 | `bank_transfer` |
| เงินสด 现金 | 14 | `cash` |
| motorshow 展会 | 2 | `other` |

> น่าสังเกต: เงินสดมีแค่ **14 บิลจาก 98,445** — หน้าร้าน SHD แทบเป็น cashless แล้ว
> แต่ลิ้นชักยังจำเป็นสำหรับเก็บสลิป เงินทอนเล็กน้อย และการกระทบยอด

### ช่องทาง → `orders.channel`

| ค่าเดิม | จำนวน | ค่าใหม่ |
|---|---:|---|
| offline | 88,297 | `offline` |
| online-shopee | 7,139 | `online_shopee` |
| online-LZD | 254 | `online_lazada` |
| online-website | 185 | `online_website` |
| motorshow 展会 | 7 | `event` |
| Online-Noc | 3 | `other` |
| online-TikTok | 2 | `online_tiktok` |

## 29 สาขา (เรียงตามจำนวนบรรทัดปี 2024)

| สาขา | บรรทัด | แบรนด์ | รหัสใหม่ |
|---|---:|---|---|
| 70mai ramintra | 23,024 | 70mai | `70MAI-RAMINTRA` |
| 70mai kanjana | 18,213 | 70mai | `70MAI-KANJANA` |
| Anker Central World | 10,654 | Anker | `ANKER-CTW` |
| Dreame Central Westgate | 8,399 | Dreame | `DREAME-WESTGATE` |
| 70Mai Chonburi | 5,894 | 70mai | `70MAI-CHONBURI` |
| 70mai Tha Phra | 5,743 | 70mai | `70MAI-THAPHRA` |
| Anker Central Rama9 | 3,971 | Anker | `ANKER-RAMA9` |
| Dreame Seacon Srinakarin | 3,747 | Dreame | `DREAME-SEACON` |
| Anker Central Park | 3,401 | Anker | `ANKER-CTPARK` |
| Dreame central rama2 | 2,895 | Dreame | `DREAME-RAMA2` |
| Anker Fashion Island | 1,718 | Anker | `ANKER-FASHION` |
| Dreame mega bangna | 1,688 | Dreame | `DREAME-MEGA` |
| DDPAI SUSCO Pinklao | 1,423 | DDPAI | `DDPAI-PINKLAO` |
| Anker Central Pinklao | 1,323 | Anker | `ANKER-PINKLAO` |
| Anker The mall bangkapi | 1,188 | Anker | `ANKER-BANGKAPI` |
| Anker The mall ngarmvongvan | 1,155 | Anker | `ANKER-NGAMWONG` |
| Anker North Ville | 384 | Anker | `ANKER-NORTHVILLE` |
| Dreame The mall ngarmvongvan | 346 | Dreame | `DREAME-NGAMWONG` |
| Vending-Anker Mega bangna | 259 | Anker | `ANKER-VD-BANGNA` |
| Dreame Central Pinklao | 230 | Dreame | `DREAME-PINKLAO` |
| Dreame East Ville | 212 | Dreame | `DREAME-EASTVILLE` |
| Anker Central Khon Kaen | 199 | Anker | `ANKER-KHONKAEN` |
| Vending-BTS Siam ANKER | 196 | Anker | `ANKER-VD-SIAM` |
| 70Mai Rangsit | 174 | 70mai | `70MAI-RANGSIT` |
| Dreame North ville | 101 | Dreame | `DREAME-NORTHVILLE` |
| Dreame Central Bangna | 47 | Dreame | `DREAME-BANGNA` |
| 70Mai Ratchaphruek | 11 | 70mai | `70MAI-RATCHA` |
| Dreame Happitat | 8 | Dreame | `DREAME-HAPPITAT` |
| Anker Maga banga | 1 | Anker | ข้อมูลผิด — รวมเข้า `ANKER-VD-BANGNA` |

## ข้อสังเกตจากข้อมูลจริงที่ส่งผลต่อการออกแบบ

1. **ชื่อสาขาสะกดไม่นิ่ง** (`Anker Maga banga`, `ramintra` vs `Ramindra`)
   → ต้องมี `branches.code` เป็นคีย์จริง ไม่ใช้ชื่อ

2. **ชื่อพนักงานมีทั้งไทย/อังกฤษ/ตัวพิมพ์ต่างกัน** (`Tanakorn` กับ `tanakorn`, `Thada` กับ `thada`)
   → ต้องมี `employees.employee_code` เป็นคีย์ และ `nickname` แยกไว้สำหรับรายงาน

3. **บริการติดตั้งคิดเป็น 21% ของบรรทัดทั้งหมด**
   → `products.kind = 'service'` และ `is_stocked = false` เป็นเรื่องจำเป็น ไม่ใช่ของเสริม

4. **หนึ่งบิลมีหลายเลขใบกำกับ** (สินค้ากับค่าติดตั้งแยกใบ)
   → `tax_documents` ต้องแยกจาก `orders` แบบ 1-to-many

5. **มีบิลราคา 0 จากงานมอเตอร์โชว์** (ของแถม/ตัวอย่าง)
   → ต้องรองรับบรรทัดราคา 0 ที่ยังมีต้นทุน (กำไรติดลบ) โดยไม่ error

6. **Serial number บางรายการมีหลายตัวในช่องเดียว** (คั่นด้วย `++`)
   → ต้อง normalize เป็นหลายแถวใน `order_item_serials`

7. **ต้นทุนถูกบันทึกรายบรรทัด** ไม่ใช่ดึงจาก master
   → ยืนยันว่าการ snapshot `unit_cost` ตอนขายเป็นวิธีที่ถูกต้อง
