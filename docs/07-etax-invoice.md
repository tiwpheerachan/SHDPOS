# 07 — ใบกำกับภาษีและ e-Tax Invoice

> ข้อมูลกฎหมายภาษีในเอกสารนี้อ้างอิง ณ กันยายน 2569 (2026)
> ก่อนขึ้นใช้งานจริงควรให้ฝ่ายบัญชี/ผู้สอบบัญชีตรวจทานอีกครั้ง
> ระบบนี้ไม่ใช่คำแนะนำทางภาษี

## 1. อัตรา VAT

VAT ปัจจุบันคือ **7%** โดย ครม. มีมติขยายเวลาการลดอัตราออกไปอีก 1 ปี
ถึง **30 กันยายน 2570** (อัตราตามประมวลรัษฎากรจริงคือ 10%)

ระบบเก็บอัตราไว้ใน `settings.tax.vat` และ `products.vat_rate` จึงเปลี่ยนได้โดยไม่ต้องแก้โค้ด
หากอนาคตกลับไป 10% ให้แก้ค่าใน settings และ `VAT_RATE` ใน `web/src/lib/money.ts`

## 2. ราคาแบบรวมภาษี (VAT inclusive)

ราคาป้ายในร้านค้าปลีกไทยรวม VAT แล้ว ระบบจึงคิดแบบ inclusive เป็นค่าเริ่มต้น

```
ยอดสุทธิ (รวม VAT)   = 4,990.00
มูลค่าก่อน VAT        = 4,990.00 × 100 / 107 = 4,663.55
ภาษีมูลค่าเพิ่ม 7%     = 4,990.00 − 4,663.55  =   326.45
```

การคำนวณอยู่ที่เดียวใน `web/src/lib/money.ts → computeTotals()` และปัดทศนิยม 2 ตำแหน่ง
แบบ half-up ทุกขั้นตอน (ใช้ `round2()` กันปัญหา floating point)

## 3. ประเภทเอกสาร (`tax_documents.doc_type`)

| ชนิด | เมื่อไร | ต้องมีอะไร |
|---|---|---|
| `abb_tax_invoice` ใบกำกับภาษีอย่างย่อ | ทุกบิลขายหน้าร้าน | ชื่อผู้ขาย, เลขผู้เสียภาษี, สาขาที่, เลขที่/วันที่, รายการ, ยอดรวมที่มีข้อความว่ารวม VAT แล้ว |
| `full_tax_invoice` ใบกำกับภาษีเต็มรูป | ลูกค้าขอ (มีเลขผู้เสียภาษี) | เพิ่มชื่อ–ที่อยู่ผู้ซื้อ, เลขประจำตัวผู้เสียภาษีผู้ซื้อ, สาขาผู้ซื้อ, แยกมูลค่าสินค้ากับ VAT |
| `credit_note` ใบลดหนี้ | คืนสินค้า/ลดราคาหลังออกใบกำกับ | อ้างเลขที่ใบกำกับเดิม + เหตุผล |
| `debit_note` ใบเพิ่มหนี้ | เก็บเงินเพิ่มภายหลัง | อ้างเลขที่ใบกำกับเดิม |
| `receipt` ใบเสร็จรับเงิน | กรณีที่ต้องแยกจากใบกำกับ | — |

### ข้อควรรู้ที่มักพลาด
- **รหัสสาขา** ต้องพิมพ์บนใบกำกับ (`branches.tax_branch_no`, สำนักงานใหญ่ = `00000`)
- **เลขที่เอกสารห้ามซ้ำและห้ามข้าม** ภายในปีภาษี — ระบบใช้ `document_sequences` แบบ atomic
- ออกใบกำกับเต็มรูปแทนใบย่อที่ออกไปแล้ว ต้อง**เรียกใบย่อคืน**หรืออ้างอิงให้ชัด
  (`tax_documents.replaces_doc_no`)
- ใบลดหนี้ต้องออกใน**เดือนภาษีที่เกิดเหตุการณ์**

## 4. e-Tax Invoice — สถานะปัจจุบัน

การทำ e-invoicing ในไทยยัง **สมัครใจ** ยังไม่มีข้อบังคับ B2B สำหรับปี 2026–2027
มีสองเส้นทาง:

| เส้นทาง | เหมาะกับ | กลไก |
|---|---|---|
| **e-Tax Invoice by Email** | รายได้ต่อปีไม่เกิน 30 ล้านบาท | ส่งไฟล์ทางอีเมล ผ่านระบบประทับรับรองเวลาของ ETDA |
| **e-Tax Invoice & e-Receipt** | ทุกขนาดธุรกิจ | XML ตามมาตรฐาน ETDA + ลายเซ็นดิจิทัล (CA) + นำส่งกรมสรรพากรภายในวันที่ 15 ของเดือนถัดไป |

SHD มีรายได้เกิน 30 ล้าน จึงต้องใช้เส้นทาง **e-Tax Invoice & e-Receipt**

**สิทธิประโยชน์ทางภาษี** (ขยายถึงสิ้นปี 2570): หักรายจ่ายได้ 200% สำหรับการลงทุนระบบ
e-invoicing ที่เข้าเงื่อนไข และอัตรา e-Withholding tax ลดเหลือ 1%

## 5. การออกแบบในระบบ

`tax_documents.etax_status` เดินตาม flow:

```
not_required → draft → queued → signed → submitted → delivered
                            ↘ failed (มี etax_error + retry ได้)
                            ↘ cancelled
```

- บิลขายปกติ: `abb_tax_invoice` สถานะ `not_required` (ใบย่อไม่ต้องส่ง XML)
- ลูกค้าขอใบเต็มรูป: สร้าง `full_tax_invoice` สถานะ `draft` → เข้าคิว `queued`
- ตัวเชื่อมกับผู้ให้บริการ (INET, Frank, Ksher, หรือ RD โดยตรง) ทำเป็น **Edge Function**
  ไม่ใช่ที่เครื่อง POS เพราะ:
  1. ใบรับรองดิจิทัล (CA) ห้ามอยู่บนเครื่องหน้าร้าน
  2. การส่งต้องทำได้แม้เครื่อง POS ปิดไปแล้ว
  3. retry ต้องอยู่ฝั่ง server

```
POS ออกบิล → tax_documents (queued)
                   ↓ pg_cron ทุก 5 นาที
        Edge Function: สร้าง XML → ลงลายเซ็น → ส่งผู้ให้บริการ
                   ↓
        อัปเดต etax_status + etax_ref + etax_pdf_url
                   ↓
        ส่งอีเมล/ลิงก์ให้ลูกค้า
```

## 6. การเก็บเอกสาร

- เก็บ XML + PDF ที่ Supabase Storage (`etax_xml_url`, `etax_pdf_url`)
- **เก็บอย่างน้อย 5 ปี** ตามประมวลรัษฎากร
- บิลที่ยกเลิกห้ามลบ — เปลี่ยนสถานะเป็น `voided` และเก็บเหตุผลไว้

## 7. รายงานที่ฝ่ายบัญชีต้องใช้

| รายงาน | ที่มา |
|---|---|
| รายงานภาษีขาย (Output VAT) | `tax_documents` + `orders` แยกตามสาขาและเดือน |
| ยอดขายรายสาขาสำหรับ ภ.พ.30 | view `v_daily_sales` |
| รายการใบลดหนี้ | `tax_documents` where `doc_type = 'credit_note'` |
| กระทบยอดเงินสด | `shifts` (expected vs counted) + `cash_movements` |
| กระทบยอดบัตร/QR | `order_payments` แยก `acquirer_bank` + `fee_amount` |

ข้อมูลเดิมของ SHD มีคอลัมน์ `เวลาเก็บเงินของธนาคาร银行到账时间`, `ธนาคารผู้รับ收款银行`,
`ยอดเงินค้างชำระ未回款金额` → รองรับไว้แล้วใน `order_payments` (`received_at`, `acquirer_bank`, `fee_amount`)
สำหรับงานกระทบยอดกับ statement ธนาคาร

---

**แหล่งอ้างอิง**

- [ครม. ขยายเวลา VAT 7% อีก 1 ปี ถึง 30 ก.ย. 2570 — The Standard](https://thestandard.co/vat-7-percent-extension/)
- [ครม. ไฟเขียวขยายเวลา VAT 7% — กรุงเทพธุรกิจ](https://www.bangkokbiznews.com/economics/1244925)
- [Thailand's E-Invoicing Remains Voluntary: Key 2026/2027 Updates and Tax Incentives — Fiscal Solutions](https://www.fiscal-requirements.com/news/5729)
- [A complete guide to Value Added Tax (VAT) in Thailand — Forvis Mazars](https://www.forvismazars.com/th/en/insights/doing-business-in-thailand/tax/value-added-tax-vat-in-thailand)
