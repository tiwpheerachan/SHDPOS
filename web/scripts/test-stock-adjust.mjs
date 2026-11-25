// ใบขอปรับสต๊อก + อนุมัติ (0078) — UAT T051: stock 10 ต้นทุน 50 เสียลด 2 → 8 มูลค่าลด 100 มีผู้อนุมัติ+เอกสาร · T052 กันติดลบ
export async function testStockAdjust(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw Error(`${msg}: ได้ error อื่น → ${e.message}`); } throw Error('ต้องปฏิเสธ: ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(9800 + n).padStart(12, '0')}`;
  const BR = U(1), P = U(2), S = U(3), APR = U(4), OW = U(5);
  await db.query("insert into branches(id,code,name,name_th) values($1,'AJ1','AJ1','AJ1'),($2,'AJOW','AJOW','AJOW')", [BR, OW]);
  await db.query("insert into employees(id,employee_code,first_name,role,home_branch_id) values($1,'AJAPR','Apr','manager',$2)", [APR, BR]);
  await db.query('insert into employee_branches(employee_id,branch_id) values($1,$2),($1,$3) on conflict do nothing', [ids.actor, BR, OW]);
  await db.query("insert into products(id,sku,name_th,price,cost) values($1,'AJ-A','A',100,50)", [P]);
  await db.query("insert into products(id,sku,name_th,price,cost,track_serial) values($1,'AJ-S','S',1000,700,true)", [S]);
  await db.query('insert into stock_levels(branch_id,product_id,qty_on_hand) values($1,$2,10),($1,$3,2)', [BR, P, S]);
  for (const sn of ['AJ-SN1', 'AJ-SN2']) await db.query("insert into serials(product_id,serial_no,branch_id,status) values($1,$2,$3,'in_stock')", [S, sn, BR]);
  const qty = async (p) => Number((await db.query('select qty_on_hand q from stock_levels where branch_id=$1 and product_id=$2', [BR, p])).rows[0].q);
  const req = (payload, actor = ids.actor) => db.query('select pos_adjust_request($1,$2) r', [actor, JSON.stringify({ branch_id: BR, ...payload })]).then((x) => x.rows[0].r);
  const decide = (id, ok, note = null, actor = APR) => db.query('select pos_adjust_decide($1,$2,$3,$4) r', [actor, id, ok, note]).then((x) => x.rows[0].r);
  let n = 0;
  // T051
  const a1 = await req({ client_uuid: U(10), reason_code: 'damage', note: 'ตกแตก', lines: [{ product_id: P, delta: -2 }] });
  eq(a1.status, 'pending', 'ขอปรับ = รออนุมัติ'); eq(Number(a1.total_value), -100, 'มูลค่าลด 100'); eq(await qty(P), 10, 'ยังไม่แตะสต๊อกก่อนอนุมัติ'); n++;
  eq((await req({ client_uuid: U(10), reason_code: 'damage', lines: [{ product_id: P, delta: -2 }] })).replay, true, 'ส่งซ้ำ = ใบเดิม'); n++;
  await rejects(decide(a1.id, true, null, ids.actor), 'adjust_self_approval'); n++;
  await decide(a1.id, true);
  eq(await qty(P), 8, 'T051 stock 8');
  const mv = (await db.query("select type, qty_delta, unit_cost, ref_no from stock_movements where ref_id=$1", [a1.id])).rows;
  eq(mv.length, 1, 'ledger 1 แถว'); eq(mv[0].type, 'damage', 'ประเภทของเสีย'); eq(Number(mv[0].unit_cost), 50, 'ต้นทุน'); eq(mv[0].ref_no, a1.adj_no, 'อ้างเลขเอกสาร'); n++;
  eq((await decide(a1.id, true)).replay, true, 'อนุมัติซ้ำไม่ปรับซ้ำ'); eq(await qty(P), 8, 'ไม่ปรับซ้ำ'); n++;
  // T052 กันติดลบ ทั้งตอนขอและตอนอนุมัติ
  await rejects(req({ reason_code: 'lost', lines: [{ product_id: P, delta: -9 }] }), 'adjust_negative'); n++;
  const a2 = await req({ reason_code: 'lost', lines: [{ product_id: P, delta: -8 }] });
  await db.query("select apply_stock_movement($1,$2,'sale',-1)", [BR, P]); // ขายไป 1 ระหว่างรออนุมัติ
  await rejects(decide(a2.id, true), 'adjust_negative'); eq(await qty(P), 7, 'อนุมัติไม่ผ่าน ไม่ตัด'); n++;
  await rejects(decide(a2.id, false, ''), 'adjust_reject_reason_required');
  eq((await decide(a2.id, false, 'ยอดไม่ถูก นับใหม่')).status, 'rejected', 'ปฏิเสธพร้อมเหตุผล'); n++;
  // เหตุผล/ทิศทาง
  await rejects(req({ reason_code: 'damage', lines: [{ product_id: P, delta: 2 }] }), 'adjust_direction');
  await rejects(req({ reason_code: 'correction', lines: [{ product_id: P, delta: 1 }] }), 'adjust_note_required');
  await rejects(req({ reason_code: 'xxx', lines: [{ product_id: P, delta: -1 }] }), 'adjust_reason_invalid'); n++;
  const a3 = await req({ reason_code: 'found', lines: [{ product_id: P, delta: 3 }] }); await decide(a3.id, true); eq(await qty(P), 10, 'พบเพิ่ม +3'); n++;
  // SN: ลดต้องระบุ SN ในสต๊อก · เสีย → defective · เพิ่ม SN ใช้รับเข้า
  await rejects(req({ reason_code: 'damage', lines: [{ product_id: S, delta: -1 }] }), 'adjust_serials_required');
  await rejects(req({ reason_code: 'damage', lines: [{ product_id: S, delta: -1, serials: ['NOPE'] }] }), 'adjust_serial_not_in_stock');
  await rejects(req({ reason_code: 'found', lines: [{ product_id: S, delta: 1 }] }), 'adjust_serial_increase_use_receive');
  const a4 = await req({ reason_code: 'damage', note: 'จอแตก', lines: [{ product_id: S, delta: -1, serials: ['aj-sn1'] }] }); await decide(a4.id, true);
  eq(await qty(S), 1, 'SN ลด 1'); eq((await db.query("select status from serials where serial_no='AJ-SN1'")).rows[0].status, 'defective', 'SN = defective'); n++;
  // ยกเลิกได้เฉพาะผู้ขอ · สาขาคลังกลางปรับไม่ได้ · anon ปิด
  const a5 = await req({ reason_code: 'expired', lines: [{ product_id: P, delta: -1 }] });
  await rejects(db.query('select pos_adjust_cancel($1,$2)', [APR, a5.id]), 'adjust_cancel_owner_only');
  await db.query('select pos_adjust_cancel($1,$2)', [ids.actor, a5.id]); await rejects(decide(a5.id, true), 'adjust_wrong_status'); n++;
  await db.query("insert into pos_warehouse_links(source,warehouse_id,branch_id,updated_by) values('test','WH-AJOW',$1,$2)", [OW, ids.actor]);
  await rejects(db.query('select pos_adjust_request($1,$2)', [ids.actor, JSON.stringify({ branch_id: OW, reason_code: 'damage', lines: [{ product_id: P, delta: -1 }] })]), 'adjust_ow_branch');
  await db.exec('set role anon'); await rejects(req({ reason_code: 'damage', lines: [{ product_id: P, delta: -1 }] }), 'permission denied'); await db.exec('reset role'); n++;
  console.log(`PASS: ${n} stock-adjust regressions (UAT T051 damage −2 → 8, value −100, approver≠requester, ledger+doc no, idempotent, T052 no negative at request/approve, reasons/direction, SN defective, cancel owner-only, OW blocked)`);
}
