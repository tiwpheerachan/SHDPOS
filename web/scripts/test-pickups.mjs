// จ่ายเต็มแล้วมารับของทีหลัง (0077) — UAT T021 ส่งมอบบางส่วน · คืนเงินก่อนมารับ · SN ต้องตรงบิล
export async function testPickups(db, ids) {
  const eq = (a, b, m) => { if (a !== b) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); };
  async function rejects(p, msg) { try { await p; } catch (e) { if (e.message.includes(msg)) return; throw Error(`${msg}: ได้ error อื่น → ${e.message}`); } throw Error('ต้องปฏิเสธ: ' + msg); }
  const U = (n) => `00000000-0000-4000-8000-${String(9700 + n).padStart(12, '0')}`;
  const BR = U(1), P = U(2), S = U(3), APR = U(4);
  await db.query("insert into branches(id,code,name,name_th) values($1,'PK1','PK1','PK1')", [BR]);
  await db.query("insert into employees(id,employee_code,first_name,role,home_branch_id) values($1,'PKAPR','Apr','manager',$2)", [APR, BR]);
  await db.query('insert into employee_branches(employee_id,branch_id) values($1,$2) on conflict do nothing', [ids.actor, BR]);
  await db.query("insert into products(id,sku,name_th,price,cost) values($1,'PK-A','A',100,50)", [P]);
  await db.query("insert into products(id,sku,name_th,price,cost,track_serial) values($1,'PK-S','S',1000,500,true)", [S]);
  const order = async (n, lines) => {
    const id = U(100 + n), total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    await db.query(`insert into orders(id,client_uuid,order_no,branch_id,cashier_id,status,channel,subtotal,grand_total,vat_amount,customer_name,customer_phone) values($1,$1,$2,$3,$4,'completed','offline',$5,$5,0,'คุณลูกค้า','081-234-5678')`, [id, `PKB-${n}`, BR, ids.actor, total]);
    for (const [k, l] of lines.entries()) {
      const iid = U(200 + n * 10 + k);
      await db.query(`insert into order_items(id,order_id,product_id,sku,name,qty,unit_price,line_total,sort_order) values($1,$2,$3,$4,$4,$5,$6,$7,$8)`, [iid, id, l.p, l.sku, l.qty, l.price, l.qty * l.price, k]);
      for (const sn of l.sns ?? []) { const sid = (await db.query("insert into serials(product_id,serial_no,branch_id,status) values($1,$2,$3,'sold') returning id", [l.p, sn, BR])).rows[0].id; await db.query('insert into order_item_serials(order_item_id,serial_id,serial_no) values($1,$2,$3)', [iid, sid, sn]); }
    }
    await db.query(`insert into order_payments(order_id,method,amount) values($1,'bank_transfer',$2)`, [id, total]);
    return id;
  };
  const create = (o, due = null) => db.query('select pos_pickup_create($1,$2,$3,$4,$5) r', [ids.actor, o, due, JSON.stringify({}), 'ลูกค้าโอนแล้ว มารับเสาร์']).then((x) => x.rows[0].r);
  const hand = (o, lines, receiver = 'คุณลูกค้า', ver = null) => db.query('select pos_pickup_handover($1,$2,$3,$4,$5,$6) r', [ids.actor, o, ver, JSON.stringify(lines), receiver, null]).then((x) => x.rows[0].r);
  const pk = async (o) => (await db.query('select * from pos_order_pickups where order_id=$1', [o])).rows[0];
  const itemOf = async (o, k = 0) => (await db.query('select id from order_items where order_id=$1 order by sort_order', [o])).rows[k].id;
  let n = 0;

  // T021 ส่งมอบบางส่วน: ขาย 10 ชิ้น ส่ง 4 แล้ว 6 → ครบ ค้าง 0 · ไม่แตะสต๊อกตอนส่งมอบ (ตัดไปแล้วตอนขาย)
  const o1 = await order(1, [{ p: P, sku: 'PK-A', qty: 10, price: 100 }]);
  eq((await create(o1)).status, 'pending', 'สร้างรายการรอรับ');
  eq((await create(o1)).replay, true, 'สร้างซ้ำได้รายการเดิม'); n++;
  const mv0 = Number((await db.query('select count(*) c from stock_movements where branch_id=$1', [BR])).rows[0].c);
  const it1 = await itemOf(o1);
  await rejects(hand(o1, [{ order_item_id: it1, qty: 4 }], ''), 'pickup_receiver_required');
  await rejects(hand(o1, [{ order_item_id: it1, qty: 11 }]), 'pickup_qty_exceeds'); n++;
  eq((await hand(o1, [{ order_item_id: it1, qty: 4 }])).status, 'partial', 'ส่ง 4 = บางส่วน');
  await rejects(hand(o1, [{ order_item_id: it1, qty: 7 }]), 'pickup_qty_exceeds');
  eq((await hand(o1, [{ order_item_id: it1, qty: 6 }])).status, 'completed', 'ส่งอีก 6 = ครบ');
  eq((await pk(o1)).items[0].picked_qty, 10, 'ส่งรวม 10');
  eq(Number((await db.query('select count(*) c from stock_movements where branch_id=$1', [BR])).rows[0].c), mv0, 'ส่งมอบไม่ตัดสต๊อกซ้ำ'); n++;
  await rejects(hand(o1, [{ order_item_id: it1, qty: 1 }]), 'pickup_not_open'); n++;

  // SN: ต้องสแกนให้ตรงบิล · ห้ามส่ง SN เดิมซ้ำ · version กันสองเครื่องส่งพร้อมกัน
  const o2 = await order(2, [{ p: S, sku: 'PK-S', qty: 2, price: 1000, sns: ['SN-A', 'SN-B'] }]);
  await create(o2);
  const it2 = await itemOf(o2);
  await rejects(hand(o2, [{ order_item_id: it2, qty: 1 }]), 'pickup_serials_required');
  await rejects(hand(o2, [{ order_item_id: it2, qty: 1, serials: ['SN-X'] }]), 'pickup_serial_not_in_bill'); n++;
  await hand(o2, [{ order_item_id: it2, qty: 1, serials: ['sn-a'] }]);
  await rejects(hand(o2, [{ order_item_id: it2, qty: 1, serials: ['SN-A'] }]), 'pickup_serial_already_handed');
  await rejects(hand(o2, [{ order_item_id: it2, qty: 1, serials: ['SN-B'] }], 'คุณลูกค้า', 1), 'pickup_version_conflict'); n++;

  // คืนเงินก่อนมารับ (เหมือน T022 ยกเลิกแล้วคืนเงิน): รับคืน SN-B ที่ยังไม่ส่งมอบ → ออกจากรายการรอรับ
  await db.query("update order_items set returned_qty=0 where order_id=$1", [o2]);
  const r = (await db.query('select pos_return_request($1,$2) r', [ids.actor, JSON.stringify({ client_uuid: U(301), order_client_uuid: o2, kind: 'return', type: 'refund', refund_method: 'bank_transfer', items: [{ order_item_id: it2, qty: 1, condition: 'sellable', serials: ['SN-B'] }] })])).rows[0].r;
  await db.query('select pos_return_decide($1,$2,true,$3)', [r.return_id, APR, 'ok']);
  const p2 = await pk(o2);
  eq(p2.status, 'completed', 'ส่งไป 1 + คืนเงิน 1 = ปิด'); eq(p2.items[0].returned_qty, 1, 'ยอดคืนก่อนรับ'); eq(p2.items[0].serials.join(), 'SN-A', 'SN ที่คืนออกจากรายการ'); n++;
  // คืนทั้งหมดก่อนมารับเลย → ยกเลิกการรอรับ
  const o3 = await order(3, [{ p: P, sku: 'PK-A', qty: 2, price: 100 }]);
  await create(o3);
  const r3 = (await db.query('select pos_return_request($1,$2) r', [ids.actor, JSON.stringify({ client_uuid: U(302), order_client_uuid: o3, kind: 'return', type: 'refund', refund_method: 'bank_transfer', items: [{ order_item_id: await itemOf(o3), qty: 2, condition: 'sellable' }] })])).rows[0].r;
  await db.query('select pos_return_decide($1,$2,true,$3)', [r3.return_id, APR, 'ok']);
  eq((await pk(o3)).status, 'cancelled', 'คืนครบก่อนรับ = ยกเลิกรอรับ'); n++;
  eq(Number((await db.query("select count(*) c from pos_pickup_events where order_id=$1", [o2])).rows[0].c), 3, 'ประวัติ สร้าง/ส่งมอบ/คืน'); n++;
  await rejects(create(U(999)), 'pickup_order_not_found');
  await db.exec('set role anon'); await rejects(create(o3), 'permission denied'); await db.exec('reset role'); n++;
  console.log(`PASS: ${n} pickup regressions (pay-in-full pickup later: T021 4+6 partial delivery, no double stock cut, SN must match bill, no double handover, version guard, refund before pickup reduces/cancels)`);
}
