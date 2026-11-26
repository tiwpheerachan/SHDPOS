export async function testPromotedCheckout(db,ids){
 const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
 async function rejects(sql,args,message){try{await db.query(sql,args)}catch(e){if(e.message.includes(message))return;throw e}throw Error('Expected '+message)}
 const customer='00000000-0000-4000-8000-000000002001',sale='00000000-0000-4000-8000-000000002002',other='00000000-0000-4000-8000-000000002003',campaign='00000000-0000-4000-8000-000000002004';
 await db.query("insert into customers(id,name,points)values($1,'UAT member',200)",[customer]);
 await db.query("insert into campaigns(id,name,code,discount_type,discount_value,active,usage_limit,per_customer_limit,eligible_scope,eligible_min_qty)values($1,'Discount','SAVE10','amount',10,true,1,null,'selected',1)",[campaign]);
 await db.query("insert into campaign_products(campaign_id,product_id,sku,role)values($1,$2,'SKU','eligible')",[campaign,ids.product]);
 const base={branch_id:ids.branch,client_uuid:sale,channel:'offline',cashier_id:ids.actor,customer_id:customer,subtotal:107,discount_total:0,grand_total:107,vat_amount:7,items:[{product_id:ids.product,sku:'SKU',name:'Test',kind:'goods',qty:1,unit_price:107,line_total:107,unit_cost:50,cost_total:50,gross_profit:50,serials:[]}]};
 const sql='select pos_prepare_promoted_checkout($1,$2,$3,$4,$5,$6,$7,$8,$9) result';
 const preview=(await db.query(sql,[sale,ids.actor,ids.branch,base,'SAVE10',10,[],null,true])).rows[0].result;
 assert(Number(preview.grand_total)===87,'Authoritative coupon+points total');
 assert(Number((await db.query('select count(*)from pos_checkout_holds where id=$1',[sale])).rows[0].count)===0,'Preview reserved stock');
 await rejects(sql,[sale,ids.actor,ids.branch,base,'SAVE10',10,[],null,false],'invalid_expected_payable');
 await rejects(sql,[sale,ids.actor,ids.branch,base,'SAVE10',10,[],88,false],'promotion_total_changed');
 await db.query(sql,[sale,ids.actor,ids.branch,base,'SAVE10',10,[],87,false]);
 await rejects(sql,[other,ids.actor,ids.branch,{...base,client_uuid:other},'SAVE10',0,[],97,false],'campaign_usage_limit');
 // Expired reservations no longer own campaign quota; renewal must reacquire it.
 await db.query("update pos_checkout_holds set expires_at=now()-interval '1 minute'where id=$1",[sale]);
 await db.query(sql,[other,ids.actor,ids.branch,{...base,client_uuid:other},'SAVE10',0,[],97,false]);
 await rejects(sql,[sale,ids.actor,ids.branch,base,'SAVE10',10,[],87,false],'campaign_usage_limit');
 await db.query('select pos_release_checkout($1,$2)',[other,ids.actor]);
 await db.query(sql,[sale,ids.actor,ids.branch,base,'SAVE10',10,[],87,false]);
 const payments=[{method:'credit_card',amount:87,reference_no:'PROMO-UAT'}];
 await db.query('select pos_record_checkout_payment($1,$2,$3)',[sale,ids.actor,payments[0]]);
 await db.query('select pos_commit_checkout($1,$2,$3)',[sale,ids.actor,payments]);
 await db.query('select pos_commit_checkout($1,$2,$3)',[sale,ids.actor,payments]);
 assert(Number((await db.query('select points from customers where id=$1',[customer])).rows[0].points)===194,'Points not atomic or redeemed twice');
 assert(Number((await db.query('select count(*) from coupon_redemptions where client_uuid=$1',[sale])).rows[0].count)===1,'Coupon redeemed twice');
 assert(Number((await db.query('select count(*) from pos_campaign_uses where checkout_id=$1',[sale])).rows[0].count)===1,'Campaign use not atomic');
 const giftCampaign='00000000-0000-4000-8000-000000002010',giftSale='00000000-0000-4000-8000-000000002011',giftProduct='00000000-0000-4000-8000-000000001001';
 await db.query("insert into campaigns(id,name,active,is_automatic,promo_type,eligible_scope,eligible_min_qty,gift_mode,gift_per_qty,per_customer_limit)values($1,'Gift',true,true,'gift','selected',1,'per_bill',1,null)",[giftCampaign]);
 await db.query("insert into campaign_products(campaign_id,product_id,sku,role,gift_qty)values($1,$2,'SKU','eligible',1),($1,$3,'OPS','gift',1)",[giftCampaign,ids.product,giftProduct]);
 const gift={product_id:giftProduct,sku:'OPS',qty:1,unit_price:0,is_gift:true,gift_source:'campaign',gift_campaign_id:giftCampaign,serials:[]};
 const giftBase={...base,client_uuid:giftSale,customer_id:null};
 await rejects(sql,[giftSale,ids.actor,ids.branch,giftBase,null,0,[{...gift,qty:2}],107,false],'campaign_gift_mismatch');
 await rejects(sql,[giftSale,ids.actor,ids.branch,giftBase,null,0,[{...gift,gift_source:'manual'}],107,false],'campaign_gift_mismatch');
 await db.query(sql,[giftSale,ids.actor,ids.branch,giftBase,null,0,[gift],107,false]);
 const giftPayment={method:'credit_card',amount:107,reference_no:'GIFT-UAT'};
 await db.query('select pos_record_checkout_payment($1,$2,$3)',[giftSale,ids.actor,giftPayment]);
 await db.query('select pos_commit_checkout($1,$2,$3)',[giftSale,ids.actor,[giftPayment]]);
 assert(Number((await db.query('select qty_on_hand from stock_levels where branch_id=$1 and product_id=$2',[ids.branch,giftProduct])).rows[0].qty_on_hand)===0,'Gift stock not deducted');
 const order=(await db.query('select gross_profit from orders where client_uuid=$1',[giftSale])).rows[0];assert(Number(order.gross_profit)===10,'Gift costs missing from profit');
 assert(!(await db.query("select has_function_privilege('anon','pos_commit_checkout(uuid,uuid,jsonb)','EXECUTE') allowed")).rows[0].allowed,'Public commit function exposed');
 await db.query('update campaigns set usage_limit=1 where id=$1',[giftCampaign]);
 const next='00000000-0000-4000-8000-000000002012';
 const exhausted=(await db.query(sql,[next,ids.actor,ids.branch,{...giftBase,client_uuid:next},null,0,[],null,true])).rows[0].result;
 assert(exhausted.quote.items.length===1,'Exhausted automatic gift blocked ordinary sale');
 const available=(await db.query("select pos_available_gift_campaigns($1,null,'offline') result",[ids.branch])).rows[0].result;
 assert(available.length===0,'Exhausted gift still offered in POS');
 console.log('PASS: authoritative coupon/points preview, quota reservations/expiry renewal, missing/changed totals, atomic redemption/idempotency, automatic gift validation, stock and profit');
 await testMultiBrandGifts(db,ids,sql,rejects,assert);
}

// Multi-brand branch: campaign for brands [A,B]; buying an A (or B) item awards gifts from brand B and brand A in one bill.
async function testMultiBrandGifts(db,ids,sql,rejects,assert){
 const id=n=>'00000000-0000-4000-8000-0000000085'+String(n).padStart(2,'0');
 const brandA=id(1),brandB=id(2),pA=id(3),pB=id(4),pA2=id(5),pBuyB=id(6),camp=id(7),sale=id(8),saleB=id(9);
 await db.query("insert into brands(id,code,name)values($1,'MB-A','Brand A'),($2,'MB-B','Brand B')",[brandA,brandB]);
 await db.query('update branches set brand_id=$2 where id=$1',[ids.branch,brandA]);
 await db.query('insert into branch_brands(branch_id,brand_id)values($1,$2),($1,$3)',[ids.branch,brandA,brandB]);
 await db.query("insert into products(id,sku,name_th,price,cost,brand_id)values($1,'MB-A-CAM','A camera',107,50,$5),($2,'MB-B-ACC','B accessory',214,30,$6),($3,'MB-A-CARD','A card',53.5,5,$5),($4,'MB-B-VAC','B vacuum',107,40,$6)",[pA,pB,pA2,pBuyB,brandA,brandB]);
 await db.query('insert into stock_levels(branch_id,product_id,qty_on_hand)values($1,$2,1),($1,$3,1),($1,$4,1),($1,$5,1)',[ids.branch,pA,pB,pA2,pBuyB]);
 await db.query("insert into campaigns(id,name,active,is_automatic,promo_type,eligible_scope,eligible_min_qty,gift_mode,gift_per_qty,per_customer_limit,brand_ids,branch_ids)values($1,'Multi-brand gift',true,true,'gift','all',1,'per_bill',1,null,$2,$3)",[camp,[brandA,brandB],[ids.branch]]);
 await db.query("insert into campaign_products(campaign_id,product_id,sku,role,gift_qty)values($1,$2,'MB-B-ACC','gift',1),($1,$3,'MB-A-CARD','gift',1)",[camp,pB,pA2]);
 const available=(await db.query("select pos_available_gift_campaigns($1,null,'offline') result",[ids.branch])).rows[0].result;
 const offered=available.find(c=>c.id===camp);
 assert(offered&&offered.brand_ids.length===2&&offered.gift_skus.length===2,'Multi-brand gift campaign not offered at multi-brand branch');
 const item=(p,sku,price,cost)=>({product_id:p,sku,name:sku,kind:'goods',qty:1,unit_price:price,line_total:price,unit_cost:cost,cost_total:cost,gross_profit:price/1.07-cost,serials:[]});
 const base={branch_id:ids.branch,client_uuid:sale,channel:'offline',cashier_id:ids.actor,customer_id:null,subtotal:107,discount_total:0,grand_total:107,vat_amount:7,items:[item(pA,'MB-A-CAM',107,50)]};
 const gift=(p,sku)=>({product_id:p,sku,qty:1,unit_price:0,is_gift:true,gift_source:'campaign',gift_campaign_id:camp,serials:[]});
 const gifts=[gift(pB,'MB-B-ACC'),gift(pA2,'MB-A-CARD')];
 // A POS that could not load the other brand's gift product must not silently drop it.
 await rejects(sql,[sale,ids.actor,ids.branch,base,null,0,[gifts[1]],null,true],'campaign_gifts_changed_reload');
 await rejects(sql,[sale,ids.actor,ids.branch,base,null,0,[gifts[0],{...gifts[1],unit_price:1}],107,false],'campaign_gift_mismatch');
 // Buying a brand-B item also qualifies (campaign covers brands A and B).
 const previewB=(await db.query(sql,[saleB,ids.actor,ids.branch,{...base,client_uuid:saleB,items:[item(pBuyB,'MB-B-VAC',107,40)]},null,0,gifts,null,true])).rows[0].result;
 assert(previewB.quote.items.filter(i=>i.is_gift).length===2,'Brand-B purchase did not earn multi-brand gifts');
 await db.query(sql,[sale,ids.actor,ids.branch,base,null,0,gifts,107,false]);
 const pay={method:'credit_card',amount:107,reference_no:'MULTIBRAND-UAT'};
 await db.query('select pos_record_checkout_payment($1,$2,$3)',[sale,ids.actor,pay]);
 await db.query('select pos_commit_checkout($1,$2,$3)',[sale,ids.actor,[pay]]);
 const rows=(await db.query('select oi.sku,oi.unit_price,oi.is_gift,oi.gift_campaign_id,p.brand_id from order_items oi join orders o on o.id=oi.order_id join products p on p.id=oi.product_id where o.client_uuid=$1 order by oi.sku',[sale])).rows;
 const giftRows=rows.filter(r=>r.is_gift);
 assert(rows.length===3&&giftRows.length===2,'Multi-brand gift bill lines missing');
 assert(new Set(giftRows.map(r=>r.brand_id)).size===2&&giftRows.every(r=>Number(r.unit_price)===0&&r.gift_campaign_id===camp),'Cross-brand gifts not recorded at zero price');
 const held=(await db.query('select quote from pos_checkout_holds where id=$1',[sale])).rows[0].quote;
 assert(Number(held.items.find(i=>i.sku==='MB-B-ACC').list_price)===214,'Gift list price must be the product price');
 const left=(await db.query('select product_id,qty_on_hand from stock_levels where branch_id=$1 and product_id=any($2)',[ids.branch,[pA,pB,pA2]])).rows;
 assert(left.length===3&&left.every(r=>Number(r.qty_on_hand)===0),'Cross-brand gift stock not deducted');
 // Leave the shared fixture branch as later suites expect it.
 await db.query('update campaigns set active=false where id=$1',[camp]);
 await db.query('delete from branch_brands where branch_id=$1',[ids.branch]);
 await db.query('update branches set brand_id=null where id=$1',[ids.branch]);
 console.log('PASS: multi-brand branch gifts — brands [A,B] campaign, A or B purchase earns brand-B + brand-A gifts at ฿0, stale catalog rejected, stock deducted');
}
