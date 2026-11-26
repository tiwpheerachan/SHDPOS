// ตัวอ่านไฟล์ MID/TID ของธนาคาร + สูตรค่าธรรมเนียม — ข้อมูลสังเคราะห์ (ไม่ใช่เลขจริง) เลียนรูปแบบไฟล์จริง
import assert from "node:assert/strict";
import { parseEdcWorkbook, cleanNo, guessBranch } from "../src/lib/edc-import";
import { computeFee, serviceForMethod, maskNo } from "../src/lib/server/edc";

let n = 0;
// เลขแบบ E-notation ของ Excel → ข้อความตัวเลข · เกิน 15 หลักเตือน
const warns: string[] = [];
assert.equal(cleanNo("6.5804728E7"), "65804728");
assert.equal(cleanNo("4.01016000001234E14"), "401016000001234");
assert.equal(cleanNo("1.23456789012345678E17", (m) => warns.push(m)), "123456789012345680"); assert.equal(warns.length, 1);
assert.equal(cleanNo("ไม่มียอด"), null); assert.equal(cleanNo("ab"), null); n++;

const kbank = { name: "KBANK", grid: [
  ["", "", "TID", "NEW TID", "NEW TID", "MID", "MID UNIONPAY", "MID QR CREDIT", "MID TH QR KBANK", "MID TID ALIPAY/ALIPAY +", "MID/TID WECHAT", "TID UNIONPAY", "TID \n0% 3month", "TID \n0% 6month"],
  ["Shop Alpha", "", "11110001", "", "", "1.11111111111111E14"],
  ["", "0812345678", "11110002", "", "", "", "", "", "", "TID11110003\n222222222222222", "", "", "", "3.33333333333333E14"], // แถวต่อเนื่อง: ซิม + Alipay(TID/MID ในเซลล์เดียว) + ผ่อน 6 (เลขยาว = MID)
  ["Shop Beta", "ไม่มียอดชำระ", "22220001", "22220009", "", "4.44444444444444E14"],                                       // เปลี่ยนเครื่อง + หมายเหตุ
  ["Shop Gamma", "", "33330001/33330002", "", "", "5.55555555555555E14", "", "", "", "", "", "", "33330003"],          // 2 TID ในช่องเดียว + ผ่อน 3 มีแต่ TID → ใช้ MID บัตร
] };
const uob = { name: "UOB", grid: [
  ["", "", "TID", "MID", "TID  / 0% 4month", "MID / 0% 4month"],
  ["Shop Delta", "", "44440001", "666666666666", "44440002", "777777777777777"],
] };
const cardx = { name: "card x  scb", grid: [
  ["RECORD", "MER_NO", "MID", "TID", "TAX_ID", "COMPANY", "EN_NAME_ON_B2K"],
  ["1.0", "9.99999990001E11", "8.88888888888E11", "5.555E7", "0000000000000", "TEST CO", "SHOP EPSILON"],
] };
const junk = { name: "Summary", grid: [["a", "b"], ["1", "2"]] };
const r = parseEdcWorkbook([kbank, uob, cardx, junk]);
const by = (acq: string, tid: string) => r.rows.find((x) => x.acquirer === acq && x.tid === tid)!;
assert.equal(r.sheets.find((s) => s.name === "Summary")!.skipped, "ไม่รู้ว่าเป็นธนาคารไหน"); n++;
const a2 = by("KBANK", "11110002");
assert.equal(a2.label, "Shop Alpha", "แถวต่อเนื่องใช้ชื่อแถวบน"); assert.equal(a2.sim_no, "0812345678", "ซิมจากช่องไม่มีหัว");
const ali = a2.mids.find((m) => m.service === "alipay")!; assert.equal(ali.mid, "222222222222222"); assert.equal(ali.tid, "11110003", "TID/MID ในเซลล์เดียวแยกถูก");
const inst6 = a2.mids.find((m) => m.service === "installment" && m.installment_months === 6)!; assert.equal(inst6.mid, "333333333333333", "เลขยาวในคอลัมน์ TID ผ่อน = MID"); n++;
assert.equal(by("KBANK", "22220001").status, "retired"); assert.equal(by("KBANK", "22220001").replaced_by_tid, "22220009");
assert.equal(by("KBANK", "22220009").status, "no_txn", "เครื่องใหม่สถานะตามหมายเหตุ"); n++;
assert.ok(by("KBANK", "33330001") && by("KBANK", "33330002"), "2 TID ในช่องเดียว = 2 เครื่อง");
const g3 = by("KBANK", "33330001").mids.find((m) => m.service === "installment")!; assert.equal(g3.installment_months, 3); assert.equal(g3.mid, "555555555555555", "ผ่อนไม่มี MID → MID บัตร"); assert.equal(g3.tid, "33330003"); n++;
const d = by("UOB", "44440001"); const d4 = d.mids.find((m) => m.installment_months === 4)!; assert.equal(d4.mid, "777777777777777"); assert.equal(d4.tid, "44440002", "UOB ผ่อนแยก TID+MID"); n++;
const e = by("CARDX", "55550000"); assert.equal(e.label, "SHOP EPSILON"); assert.equal(e.mids[0].merchant_no, "999999990001"); assert.equal(e.mids[0].mid, "888888888888"); n++;
// เดาสาขา
const branches = [{ id: "b1", name: "Anker Central World", name_th: "แองเคอร์ เซ็นทรัลเวิลด์", code: "ANK-CW" }, { id: "b2", name: "Dreame Seacon Srinakarin", name_th: null, code: "DRM-SC" }];
assert.equal(guessBranch("anker Central World", branches), "b1"); assert.equal(guessBranch("Dreame Seacon Srinakarin", branches), "b2"); assert.equal(guessBranch("Unknown Place", branches), null); n++;
// ค่าธรรมเนียม + บริการตามวิธีชำระ + มาสก์
assert.equal(computeFee(10000, { rate_pct: 1.6, fixed_fee: 0, vat_on_fee: true }), 171.2);
assert.equal(computeFee(1000, { rate_pct: 3, fixed_fee: 5, vat_on_fee: false }), 35);
assert.equal(computeFee(1000, null), 0); assert.equal(computeFee(0, { rate_pct: 2, fixed_fee: 5, vat_on_fee: true }), 0);
assert.deepEqual(serviceForMethod("installment", 6), { service: "installment", months: 6 }); assert.deepEqual(serviceForMethod("edc"), { service: "card", months: 0 }); assert.equal(serviceForMethod("bank_transfer"), null); assert.deepEqual(serviceForMethod("credit_card"), { service: "card", months: 0 }); assert.deepEqual(serviceForMethod("debit_card"), { service: "debit", months: 0 });
assert.equal(maskNo("401016000001234"), "••••••1234"); assert.equal(maskNo(null), null); n++;
console.log(`PASS: ${n} EDC import/fee checks (E-notation, continuation rows, SIM, TID/MID same cell, long no in plan-TID col = MID, NEW TID retire, 2 TIDs/cell, plan MID fallback, UOB plan TID+MID, CardX merchant no, branch guess, MDR fee w/ VAT, masking)`);
