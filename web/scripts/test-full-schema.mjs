import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {uuid_ossp} from '@electric-sql/pglite/contrib/uuid_ossp';
const db=new PGlite({extensions:{pgcrypto,'uuid-ossp':uuid_ossp}});
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.uid() returns uuid language sql as 'select null::uuid';create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create schema extensions;`);
await db.exec('create extension pgcrypto with schema extensions');
const files=fs.readdirSync('../supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
for(const f of files){try{
 if(f.startsWith('0033_')) await db.exec("alter type employee_role add value if not exists 'owner'"); // Documented prerequisite of existing 0033.
 await db.exec(fs.readFileSync('../supabase/migrations/'+f,'utf8'));}catch(e){console.error('FAILED migration',f,e.message);process.exitCode=1;await db.close();process.exit();}}
console.log('PASS: '+files.length+' complete migrations applied to isolated PostgreSQL');
// Production writer, not the stub used by the focused locking tests.
const ids={branch:'00000000-0000-4000-8000-000000000001',actor:'00000000-0000-4000-8000-000000000002',product:'00000000-0000-4000-8000-000000000003',sale:'00000000-0000-4000-8000-000000000004'};
await db.query("insert into branches(id,code,name,name_th) values($1,'TEST','Test','Test')",[ids.branch]);
await db.query("insert into employees(id,employee_code,first_name,role,home_branch_id) values($1,'TEST','Test','manager',$2)",[ids.actor,ids.branch]);
await db.query("insert into products(id,sku,name_th,price,cost) values($1,'SKU','Test',107,50)",[ids.product]);
await db.query('insert into stock_levels(branch_id,product_id,qty_on_hand) values($1,$2,1)',[ids.branch,ids.product]);
const quote={branch_id:ids.branch,client_uuid:ids.sale,channel:'offline',cashier_id:ids.actor,subtotal:107,discount_total:0,grand_total:107,vat_amount:7,items:[{product_id:ids.product,sku:'SKU',name:'Test',kind:'goods',qty:1,unit_price:107,line_total:107,unit_cost:50,cost_total:50,gross_profit:50,serials:[]}]};
await db.query('select pos_reserve_checkout($1,$2,$3,$4)',[ids.sale,ids.actor,ids.branch,quote]);
await db.query('select pos_record_checkout_payment($1,$2,$3)',[ids.sale,ids.actor,{method:'credit_card',amount:107,reference_no:'TEST'}]);
await db.query('select pos_commit_checkout($1,$2,$3)',[ids.sale,ids.actor,[{method:'credit_card',amount:107,reference_no:'TEST'}]]);
const {rows}=await db.query('select qty_on_hand from stock_levels where branch_id=$1',[ids.branch]);if(Number(rows[0].qty_on_hand)!==0)throw Error('Stock not deducted correctly');
const gp=await db.query('select gross_profit from orders where client_uuid=$1',[ids.sale]);if(Number(gp.rows[0].gross_profit)!==50)throw Error('Gross profit must exclude VAT');
console.log('PASS: real legacy writer commits through secure checkout, with VAT excluded from gross profit');
const lines=[{product_id:ids.product,expected:0,counted:2,reason:'Opening test'}];
await db.query('select pos_approve_count($1,$2,$3,$4)',['COUNT-1',ids.branch,ids.actor,lines]);
await db.query('select pos_approve_count($1,$2,$3,$4)',['COUNT-1',ids.branch,ids.actor,lines]);
const counted=await db.query('select qty_on_hand from stock_levels where branch_id=$1',[ids.branch]);if(Number(counted.rows[0].qty_on_hand)!==2)throw Error('Count repeated stock effect');
try{await db.query('select pos_release_checkout($1,$2)',[ids.sale,ids.actor]);throw Error('Committed checkout was released');}catch(e){if(!e.message.includes('already_committed'))throw e;}
console.log('PASS: central count is idempotent and committed checkout cannot be released');
await (await import('./test-catalog-lifecycle.mjs')).testCatalog(db,ids);
await db.close();
