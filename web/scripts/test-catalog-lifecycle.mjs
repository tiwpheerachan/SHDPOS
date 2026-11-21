import assert from 'node:assert/strict';
export async function testCatalog(db,ids){
 const source='test:catalog';
 await db.query("update products set image_url='https://local.test/own.jpg' where id=$1",[ids.product]);
 const create=async()=> (await db.query("insert into pos_catalog_runs(source,environment,created_by,warehouse_id)values($1,'uat',$2,'WH')returning *",[source,ids.actor])).rows[0];
 const checkpoint=async(run,action,data)=>(await db.query('select pos_catalog_checkpoint($1,$2,$3,$4,$5) r',[run.id,ids.actor,run.version,action,data])).rows[0].r;
 const apply=async(run,keys,expected,prices=false)=>(await db.query('select pos_catalog_import($1,$2,$3,$4,$5,$6) r',[run.id,ids.actor,run.version,keys,expected,prices])).rows[0].r;
 const detail=(sku,extra={})=>({sku,name:'Source name',barcode:null,short_name:null,brand:null,category:null,image_url:null,serial_tracking:false,is_combined:false,sale_price:200,cost_price:999,...extra});
 const hydrated=(sku,d)=>({sku_key:sku,detail:d,detail_status:'ok',stock_qty:119,bom_status:'unknown'});
 await db.query("insert into pos_warehouse_links(source,warehouse_id,branch_id,updated_by)values($1,'WH',$2,$3)",[source,ids.branch,ids.actor]);
 let run=await create();
 run=await checkpoint(run,'page',{cursor:null,items:[{sku:'SKU'},{sku:'NEW'}],has_more:false,next_cursor:null});
 // A lost response/repeated old version cannot apply the page twice.
 await assert.rejects(checkpoint({...run,version:1},'page',{cursor:null,items:[],has_more:false,next_cursor:null}),/version_conflict/);
 run=await checkpoint(run,'hydrate',{items:[hydrated('SKU',detail('SKU',{barcode:'BAR1',image_url:'https://remote.test/source.jpg'})),hydrated('NEW',detail('NEW',{sale_price:null,cost_price:null,serial_tracking:null,is_combined:null}))]});
 const old=(await db.query('select id,updated_at from products where id=$1',[ids.product])).rows[0];
 const expected={SKU:{id:old.id,updated_at:old.updated_at},NEW:{id:null,updated_at:null}};
 run=await apply(run,['SKU','NEW'],expected);
 let rows=(await db.query("select * from products where sku in ('SKU','NEW')order by sku")).rows;
 const original=rows.find(p=>p.sku==='SKU'),added=rows.find(p=>p.sku==='NEW');
 assert.equal(original.id,ids.product);assert.equal(original.name_th,'Test');assert.equal(original.image_url,'https://local.test/own.jpg');assert.equal(Number(original.price),107);assert.equal(Number(original.cost),50);
 assert.equal(added.is_active,false);assert.equal(Number(added.price),0);
 const link=(await db.query('select * from pos_catalog_links where product_id=$1',[added.id])).rows[0];assert.equal(link.source_detail.serial_tracking,null);assert.ok(link.readiness.some(s=>s.includes('SN')));
 const qty=Number((await db.query('select qty_on_hand from stock_levels where branch_id=$1',[ids.branch])).rows[0].qty_on_hand);assert.equal(qty,2);
 const countBefore=(await db.query('select count(*)::int n from products')).rows[0].n;
 run=await apply(run,['SKU','NEW'],expected);assert.equal((await db.query('select count(*)::int n from products')).rows[0].n,countBefore);
 // A second run targets the same product, while a stale preview is refused.
 let next=await create();next=await checkpoint(next,'page',{cursor:null,items:[{sku:'SKU'}],has_more:false,next_cursor:null});next=await checkpoint(next,'hydrate',{items:[hydrated('SKU',detail('SKU',{sale_price:0}))]});
 next=await apply(next,['SKU'],{SKU:{id:ids.product,updated_at:'2000-01-01T00:00:00Z'}},true);
 assert.match((await db.query("select import_error from pos_catalog_items where run_id=$1 and sku_key='SKU'",[next.id])).rows[0].import_error,/ข้อมูล POS เปลี่ยน/);
 const now=(await db.query('select updated_at from products where id=$1',[ids.product])).rows[0].updated_at;
 next=await apply(next,['SKU'],{SKU:{id:ids.product,updated_at:now}},true);assert.equal(Number((await db.query('select price from products where id=$1',[ids.product])).rows[0].price),0);
 assert.equal((await db.query("select count(*)::int n from products where sku='NEW'")).rows[0].n,1); // Absence from the new run does not delete.
 // A conflicting barcode does not create an orphan product.
 let bad=await create();bad=await checkpoint(bad,'page',{cursor:null,items:[{sku:'COLLIDE'}],has_more:false,next_cursor:null});bad=await checkpoint(bad,'hydrate',{items:[hydrated('COLLIDE',detail('COLLIDE',{barcode:'BAR1'}))]});bad=await apply(bad,['COLLIDE'],{COLLIDE:{id:null,updated_at:null}});
 assert.equal((await db.query("select count(*)::int n from products where sku='COLLIDE'")).rows[0].n,0);
 assert.match((await db.query('select import_error from pos_catalog_items where run_id=$1',[bad.id])).rows[0].import_error,/บาร์โค้ด/);
 let loop=await create();loop=await checkpoint(loop,'page',{cursor:null,items:[],has_more:true,next_cursor:'A'});await assert.rejects(checkpoint(loop,'page',{cursor:'A',items:[],has_more:true,next_cursor:'A'}),/cursor_loop/);
 // Failed rows can be reset without re-fetching successful/imported rows.
 let retry=await create();retry=await checkpoint(retry,'page',{cursor:null,items:[{sku:'FAIL'},{sku:'OK'}],has_more:false,next_cursor:null});retry=await checkpoint(retry,'hydrate',{items:[{sku_key:'FAIL',detail_status:'error',detail_error:'timeout',detail:null,bom_status:'unknown'},hydrated('OK',detail('OK'))]});retry=await checkpoint(retry,'retry',{});
 const states=(await db.query('select sku_key,detail_status from pos_catalog_items where run_id=$1 order by sku_key',[retry.id])).rows;assert.deepEqual(states.map(s=>s.detail_status),['pending','ok']);
 assert.equal((await db.query('select count(*)::int n from pos_catalog_import_events')).rows[0].n,3);
 await db.exec('set role anon');await assert.rejects(db.query('select pos_catalog_stats($1)',[run.id]),/permission denied/);await db.exec('reset role');
 console.log('PASS: catalog lifecycle (stable IDs, safe merge, inactive new SKU, unknown flags, no stock posting, retry, cursor loop, stale preview, barcode conflict, no deletion)');
}
