export async function testDeferredSales(db,ids){
 const assert=(v,m)=>{if(!v)throw Error(m)};
 async function rejects(sql,args,msg){try{await db.query(sql,args)}catch(e){if(e.message.includes(msg))return;throw e}throw Error('Expected '+msg)}
 const product='00000000-0000-4000-8000-000000003001',sale='00000000-0000-4000-8000-000000003002',other='00000000-0000-4000-8000-000000003003';
 await db.query("insert into products(id,sku,name_th,price,cost,track_serial,is_active)values($1,'DEF','Deferred SN',107,50,true,false)",[product]);
 await db.query('insert into stock_levels(branch_id,product_id,qty_on_hand)values($1,$2,4)',[ids.branch,product]);
 await db.query("insert into serials(product_id,serial_no,branch_id,status)values($1,'DEF-1',$2,'in_stock'),($1,'DEF-2',$2,'in_stock')",[product,ids.branch]);
 const draft={branch_id:ids.branch,cashier_id:ids.actor,channel:'offline',subtotal:214,discount_total:0,grand_total:214,items:[{product_id:product,sku:'DEF',name:'Deferred SN',kind:'goods',qty:2,unit_price:107,discount_amount:0,discount_percent:0,serials:['DEF-1']}]};
 const create='select pos_create_deferred_sale($1,$2,$3,$4,$5,$6,$7,$8) result',when='2026-11-20T03:00:00Z';
 let d=(await db.query(create,[sale,ids.actor,ids.branch,draft,when,true,'Missing SN',[{code:'sn_missing',product_id:product}]])).rows[0].result;
 await db.query(create,[sale,ids.actor,ids.branch,draft,when,true,'Missing SN',[]]);
 let stock=(await db.query('select * from stock_levels where branch_id=$1 and product_id=$2',[ids.branch,product])).rows[0];assert(Number(stock.qty_on_hand)===4&&Number(stock.qty_reserved_order)===2,'Pending must reserve once without posting stock');
 await rejects(create,[sale,ids.actor,ids.branch,{...draft,grand_total:1},when,true,'Missing SN',[]],'deferred_conflict');
 await db.query('update products set is_active=true where id=$1',[product]);
 const ordinary={client_uuid:other,branch_id:ids.branch,channel:'offline',items:[{...draft.items[0],qty:1,serials:['DEF-1']}],subtotal:107,discount_total:0,grand_total:107,vat_amount:7};
 await rejects('select pos_reserve_checkout($1,$2,$3,$4)',[other,ids.actor,ids.branch,ordinary],'serial_reserved_by_deferred_sale');
 const payment={method:'credit_card',amount:214,reference_no:'DEFERRED-REF'};
 d=(await db.query('select pos_record_deferred_payment($1,$2,$3,$4) result',[sale,ids.actor,d.version,payment])).rows[0].result;
 const v=d.version;const retry=(await db.query('select pos_record_deferred_payment($1,$2,$3,$4) result',[sale,ids.actor,1,payment])).rows[0].result;assert(retry.version===v&&retry.payments.length===1,'Payment retry duplicated funds');
 await rejects('select pos_record_deferred_payment($1,$2,$3,$4)',[sale,ids.actor,v,{...payment,reference_no:'EXTRA',amount:1}],'payment_total_mismatch');
 await rejects('select pos_cancel_deferred_sale($1,$2,$3,$4)',[sale,ids.actor,v,'Cancel test'],'paid_deferred_requires_refund');
 const quote={...draft,client_uuid:sale,vat_amount:14,items:[{...draft.items[0],unit_cost:50,cost_total:100,line_total:214,gross_profit:100,serials:['DEF-1','MISSING']} ]};
 const post='select pos_post_deferred_sale($1,$2,$3,$4,true) result';
 await rejects(post,[sale,ids.actor,v,quote],'serial_not_available');
 assert(Number((await db.query('select qty_reserved_order from stock_levels where branch_id=$1 and product_id=$2',[ids.branch,product])).rows[0].qty_reserved_order)===2,'Failed post released reservation');
 assert(Number((await db.query('select count(*) from pos_deferred_serial_claims where sale_id=$1',[sale])).rows[0].count)===1,'Failed post lost SN claim');
 d=(await db.query('select pos_update_deferred_serials($1,$2,$3,$4,true) result',[sale,ids.actor,v,[['DEF-1','DEF-2']]])).rows[0].result;
 await rejects('select pos_update_deferred_serials($1,$2,$3,$4,true)',[sale,ids.actor,v,[[]]],'deferred_version_conflict');
 quote.items[0].serials=['DEF-1','DEF-2'];const result=(await db.query(post,[sale,ids.actor,d.version,quote])).rows[0].result;const again=(await db.query(post,[sale,ids.actor,1,quote])).rows[0].result;
 assert(JSON.stringify(result)===JSON.stringify(again),'Post retry changed bill');
 stock=(await db.query('select * from stock_levels where branch_id=$1 and product_id=$2',[ids.branch,product])).rows[0];assert(Number(stock.qty_on_hand)===2&&Number(stock.qty_reserved_order)===0,'Stock posted/reservation released more than once');
 const o=(await db.query('select * from orders where client_uuid=$1',[sale])).rows[0];assert(new Date(o.sale_occurred_at).toISOString()===when.replace('Z','.000Z'),'Actual sale date lost');assert(o.deferred_sale_id===sale,'Pending reference lost');
 assert(Number((await db.query('select count(*) from order_payments where order_id=$1',[o.id])).rows[0].count)===1,'Payment posted twice');
 assert(Number((await db.query("select count(*)from pos_integration_events where event_key=$1",['sale:'+sale])).rows[0].count)===1,'OW event duplicated');
 // Missing opening inventory may be recorded; it must not fabricate stock or silently post.
 const absent='00000000-0000-4000-8000-000000003004',emptySale='00000000-0000-4000-8000-000000003005';
 await db.query("insert into products(id,sku,name_th,price,cost)values($1,'DEF-EMPTY','Missing opening stock',107,10)",[absent]);
 const emptyDraft={...draft,items:[{...draft.items[0],product_id:absent,serials:[]}]};
 const empty=(await db.query(create,[emptySale,ids.actor,ids.branch,emptyDraft,when,false,'Missing stock',[]])).rows[0].result;
 assert(empty.issues.some(i=>i.code==='stock_uninitialized'),'Missing stock not flagged');const opening=(await db.query('select *from stock_levels where product_id=$1',[absent])).rows[0];assert(Number(opening.qty_on_hand)===0&&Number(opening.qty_reserved_order)===2&&opening.opening_pending,'Missing opening inventory lost pending reservation or fabricated On Hand');
 await db.query("select pos_review_product($1,$2,1,$3,'Confirm SN before opening stock')",[absent,ids.actor,{track_serial:true,serial_policy_confirmed:true,is_active:false}]);
 await db.query('update stock_levels set qty_on_hand=3 where product_id=$1',[absent]);
 const loaded=(await db.query('select *from stock_levels where product_id=$1',[absent])).rows[0];assert(Number(loaded.qty_reserved_order)===2&&!loaded.opening_pending,'Opening inventory did not preserve pending quantity');
 await db.query('select pos_cancel_deferred_sale($1,$2,$3,$4)',[emptySale,ids.actor,empty.version,'Not delivered or paid']);
 assert(!(await db.query("select has_function_privilege('anon','pos_post_deferred_sale(uuid,uuid,integer,jsonb,boolean)','execute') allowed")).rows[0].allowed,'Public deferred posting exposed');
 console.log('PASS: deferred sales durable reservation/idempotency, missing SN, payment retry/overpayment, paid cancellation guard, rollback, serial claim/update, exactly-once posting, actual date, unknown stock and private RPCs');
}
