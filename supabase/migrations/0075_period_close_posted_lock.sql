-- 0075 · ปิดงวด + ล็อกเอกสารที่ Post แล้ว + สรุปยอดขายสุทธิ (UAT F009 · F036 · F064 · F068 · F070)
--
-- ① ล็อกเอกสารที่ Post แล้ว (F009/F036) — แก้ยอดเงียบ ๆ / ลบตรง ๆ ไม่ได้ แม้ใช้ service role
--    orders        : เลข/สาขา/ยอดเงิน/VAT/ผู้ขาย/วันที่สร้าง ห้ามเปลี่ยน · วันขาย (sale_occurred_at) ตั้งได้ครั้งเดียว
--                    สถานะเดินหน้าเท่านั้น (completed → partially_refunded → refunded · → voided) · ห้ามลบ
--    order_items   : จำนวน/ราคา/ยอด/สินค้า ห้ามเปลี่ยน · returned_qty เพิ่มได้ไม่เกินจำนวนขาย · ห้ามลบ
--    order_payments, stock_movements, credit_notes : ห้ามแก้/ลบ (แก้ด้วยเอกสารกลับรายการเท่านั้น)
--    tax_invoices  : เปลี่ยนได้เฉพาะ issued → cancelled (+ผู้ยกเลิก/เหตุผล) · ห้ามลบ
--    การแก้ไขที่ถูกต้อง = เอกสารใหม่อ้างเอกสารเดิม (คืนสินค้า / ใบลดหนี้ / ออกใบกำกับแทน) → ประวัติครบ
--
-- ② ปิดงวด (F070) — รายเดือน รายสาขา
--    ปิดแล้ว: บันทึกที่มีวันที่ธุรกิจในงวดนั้นไม่ได้ (บิลย้อนหลัง/บิลค้างส่งที่ลงวันย้อน, การเคลื่อนไหวสต๊อก, เงินเข้า-ออกลิ้นชัก)
--    รายการวันนี้ที่อ้างบิลเก่า (คืนสินค้า/ใบลดหนี้) ยังทำได้ — ลงในงวดปัจจุบัน (ถูกหลักบัญชี)
--    ปิดได้เมื่อ: งวดจบแล้ว · ไม่มีกะค้าง · ไม่มีคำขอคืน/บิลค้างส่ง/รอบนับที่ยังไม่ปิด
--    ปิดแต่ละครั้งเก็บ snapshot สรุปยอดเป็น version (ปิด → เปิดใหม่ → ปิดอีก = version 2) · เปิดใหม่ต้องมีสิทธิ์ + เหตุผล
--
-- ③ สรุปยอดขายสุทธิ (F068) = ขาย − คืนเงินจากการรับคืน − ใบลดหนี้ส่วนลด
--    (CN ที่ออกจากการรับคืนไม่หักซ้ำ — เงินคืนไปแล้วในใบรับคืน) · บิลยกเลิกแยกแสดง ไม่นับในยอดขาย
--    + สมการสต๊อก (F064): ยกมา + เข้า − ออก = คงเหลือ ต่อประเภทการเคลื่อนไหว

-- ── ① ล็อกเอกสาร ────────────────────────────────────────────
create or replace function pos_lock_orders()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare rank_old int; rank_new int;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'posted_document_delete_forbidden: orders %', old.order_no; end if;
    return old;
  end if;
  if old.status = 'draft' then return new; end if;
  if new.order_no is distinct from old.order_no or new.branch_id is distinct from old.branch_id
     or new.subtotal is distinct from old.subtotal or new.discount_total is distinct from old.discount_total
     or new.vat_amount is distinct from old.vat_amount or new.grand_total is distinct from old.grand_total
     or new.cashier_id is distinct from old.cashier_id or new.created_at is distinct from old.created_at
     or new.client_uuid is distinct from old.client_uuid then
    raise exception 'posted_document_locked: orders % (ใช้การคืนสินค้า/ใบลดหนี้แทน)', old.order_no;
  end if;
  if old.sale_occurred_at is not null and new.sale_occurred_at is distinct from old.sale_occurred_at then
    raise exception 'posted_document_locked: orders % sale_occurred_at', old.order_no;
  end if;
  rank_old := case old.status when 'completed' then 1 when 'partially_refunded' then 2 when 'refunded' then 3 when 'voided' then 4 else 0 end;
  rank_new := case new.status when 'completed' then 1 when 'partially_refunded' then 2 when 'refunded' then 3 when 'voided' then 4 else 0 end;
  if rank_new < rank_old or (old.status in ('refunded','voided') and new.status <> old.status) then
    raise exception 'posted_status_backward: orders % % → %', old.order_no, old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists pos_lock_orders on orders;
create trigger pos_lock_orders before update or delete on orders for each row execute function pos_lock_orders();

create or replace function pos_lock_order_items()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare st order_status;
begin
  select status into st from orders where id = coalesce(old.order_id, new.order_id);
  if st is null or st = 'draft' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'posted_document_delete_forbidden: order_items'; end if;
  if new.order_id is distinct from old.order_id or new.product_id is distinct from old.product_id or new.sku is distinct from old.sku
     or new.qty is distinct from old.qty or new.unit_price is distinct from old.unit_price or new.line_total is distinct from old.line_total
     or new.discount_amount is distinct from old.discount_amount then
    raise exception 'posted_document_locked: order_items';
  end if;
  if coalesce(new.returned_qty,0) < coalesce(old.returned_qty,0) or coalesce(new.returned_qty,0) > new.qty then
    raise exception 'posted_document_locked: order_items returned_qty';
  end if;
  return new;
end $$;
drop trigger if exists pos_lock_order_items on order_items;
create trigger pos_lock_order_items before update or delete on order_items for each row execute function pos_lock_order_items();

create or replace function pos_lock_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'posted_document_locked: % (แก้ด้วยเอกสารกลับรายการเท่านั้น)', tg_table_name;
end $$;
create or replace function pos_lock_order_payments()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from orders o where o.id = old.order_id and o.status <> 'draft') then
    raise exception 'posted_document_locked: order_payments (แก้ด้วยเอกสารกลับรายการเท่านั้น)';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists pos_lock_order_payments on order_payments;
create trigger pos_lock_order_payments before update or delete on order_payments for each row execute function pos_lock_order_payments();
drop trigger if exists pos_lock_stock_movements on stock_movements;
create trigger pos_lock_stock_movements before update or delete on stock_movements for each row execute function pos_lock_immutable();
drop trigger if exists pos_lock_credit_notes on credit_notes;
create trigger pos_lock_credit_notes before update or delete on credit_notes for each row execute function pos_lock_immutable();

create or replace function pos_lock_tax_invoices()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'posted_document_delete_forbidden: tax_invoices %', old.invoice_no; end if;
  if old.status = 'cancelled'
     or new.invoice_no is distinct from old.invoice_no or new.order_id is distinct from old.order_id or new.buyer is distinct from old.buyer
     or new.amount_total is distinct from old.amount_total or new.amount_vat is distinct from old.amount_vat
     or new.amount_before_vat is distinct from old.amount_before_vat or new.issued_at is distinct from old.issued_at
     or (new.status = 'cancelled' and coalesce(btrim(new.cancel_reason),'') = '') then
    raise exception 'posted_document_locked: tax_invoices % (ยกเลิกแล้วออกใบใหม่แทน)', old.invoice_no;
  end if;
  return new;
end $$;
drop trigger if exists pos_lock_tax_invoices on tax_invoices;
create trigger pos_lock_tax_invoices before update or delete on tax_invoices for each row execute function pos_lock_tax_invoices();

-- ── ② ปิดงวด ────────────────────────────────────────────────
create table if not exists pos_periods (
  branch_id uuid not null references branches(id),
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'open' check (status in ('open','closed')),
  version integer not null default 0,
  closed_by uuid references employees(id), closed_at timestamptz,
  reopened_by uuid references employees(id), reopened_at timestamptz, reopen_reason text,
  primary key (branch_id, period)
);
create table if not exists pos_period_versions (
  branch_id uuid not null references branches(id),
  period text not null,
  version integer not null,
  summary jsonb not null,
  closed_by uuid references employees(id),
  closed_at timestamptz not null default now(),
  note text,
  primary key (branch_id, period, version)
);
alter table pos_periods enable row level security;
alter table pos_period_versions enable row level security;
revoke all on pos_periods, pos_period_versions from anon, authenticated;

create or replace function pos_period_of(p_ts timestamptz)
returns text language sql immutable as $$ select to_char(p_ts at time zone 'Asia/Bangkok', 'YYYY-MM') $$;

create or replace function pos_period_closed(p_branch uuid, p_ts timestamptz)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_ts is not null and exists (select 1 from pos_periods where branch_id = p_branch and period = pos_period_of(p_ts) and status = 'closed')
$$;

-- กันบันทึกเข้างวดที่ปิด
create or replace function pos_period_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare ts timestamptz; br uuid;
begin
  if tg_table_name = 'orders' then
    if tg_op = 'UPDATE' and new.sale_occurred_at is not distinct from old.sale_occurred_at then return new; end if;
    ts := coalesce(new.sale_occurred_at, new.created_at); br := new.branch_id;
  elsif tg_table_name = 'stock_movements' then ts := coalesce(new.occurred_at, now()); br := new.branch_id;
  elsif tg_table_name = 'cash_movements' then ts := coalesce(new.created_at, now()); br := new.branch_id;
  else return new; end if;
  if pos_period_closed(br, ts) then
    raise exception 'period_closed: % (งวดนี้ปิดแล้ว — ขอเปิดงวดใหม่จากผู้มีสิทธิ์ หรือบันทึกเป็นรายการปรับปรุงในงวดปัจจุบัน)', pos_period_of(ts);
  end if;
  return new;
end $$;
drop trigger if exists pos_period_guard on orders;
create trigger pos_period_guard before insert or update of sale_occurred_at on orders for each row execute function pos_period_guard();
drop trigger if exists pos_period_guard on stock_movements;
create trigger pos_period_guard before insert on stock_movements for each row execute function pos_period_guard();
drop trigger if exists pos_period_guard on cash_movements;
create trigger pos_period_guard before insert on cash_movements for each row execute function pos_period_guard();

-- ── ③ สรุปยอดขายสุทธิ + สมการสต๊อก ของช่วงวันที่ (เวลาไทย) ─────
create or replace function pos_period_summary(p_branch uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a timestamptz := (p_from::timestamp at time zone 'Asia/Bangkok'); b timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Bangkok');
  sales jsonb; voids jsonb; rets jsonb; cns jsonb; pays jsonb; cash jsonb; stock jsonb; warn jsonb; s_gross numeric; s_vat numeric; r_amt numeric; r_vat numeric; c_amt numeric; c_vat numeric;
begin
  select coalesce(sum(grand_total),0), coalesce(sum(vat_amount),0), jsonb_build_object('bills', count(*), 'gross', coalesce(sum(grand_total),0), 'vat', coalesce(sum(vat_amount),0))
    into s_gross, s_vat, sales
    from orders where branch_id = p_branch and status <> 'draft' and status <> 'voided' and coalesce(sale_occurred_at, created_at) >= a and coalesce(sale_occurred_at, created_at) < b;
  select jsonb_build_object('bills', count(*), 'amount', coalesce(sum(grand_total),0)) into voids
    from orders where branch_id = p_branch and status = 'voided' and coalesce(sale_occurred_at, created_at) >= a and coalesce(sale_occurred_at, created_at) < b;
  -- คืนเงินจากการรับคืน (ไม่รวมยกเลิกบิล — แยกแสดงแล้ว) ลงตามวันที่คืนเสร็จ
  select coalesce(sum(r.refund_amount),0), coalesce(sum(round(r.refund_amount * o.vat_amount / nullif(o.grand_total,0), 2)),0),
         jsonb_build_object('count', count(*), 'amount', coalesce(sum(r.refund_amount),0))
    into r_amt, r_vat, rets
    from returns r join orders o on o.id = r.order_id
   where r.branch_id = p_branch and r.status = 'completed' and r.kind = 'return' and r.completed_at >= a and r.completed_at < b;
  -- ใบลดหนี้: หักเฉพาะชนิดส่วนลด (ชนิดรับคืนแสดงเพื่ออ้างอิง ไม่หักซ้ำ)
  select coalesce(sum(amount_total) filter (where kind = 'discount'),0), coalesce(sum(amount_vat) filter (where kind = 'discount'),0),
         jsonb_build_object('discount_count', count(*) filter (where kind = 'discount'), 'discount_amount', coalesce(sum(amount_total) filter (where kind = 'discount'),0),
                            'return_linked_count', count(*) filter (where kind = 'return'), 'return_linked_amount', coalesce(sum(amount_total) filter (where kind = 'return'),0))
    into c_amt, c_vat, cns
    from credit_notes where branch_id = p_branch and issued_at >= a and issued_at < b;
  select coalesce(jsonb_object_agg(method, amt), '{}') into pays from (
    select p.method::text method, sum(p.amount) amt from order_payments p join orders o on o.id = p.order_id
     where o.branch_id = p_branch and o.status <> 'draft' and o.status <> 'voided' and coalesce(o.sale_occurred_at, o.created_at) >= a and coalesce(o.sale_occurred_at, o.created_at) < b group by 1) z;
  select coalesce(jsonb_object_agg(type, amt), '{}') into cash from (
    select type::text, sum(amount) amt from cash_movements where branch_id = p_branch and created_at >= a and created_at < b group by 1) z;
  -- สมการสต๊อก: ยกมา + เคลื่อนไหวในช่วง = คงเหลือ (ราย SKU รวม) · แยกตามประเภท
  select jsonb_build_object(
      'opening', coalesce((select sum(qty_delta) from stock_movements where branch_id = p_branch and occurred_at < a),0),
      'by_type', coalesce((select jsonb_object_agg(type, q) from (select type::text, sum(qty_delta) q from stock_movements where branch_id = p_branch and occurred_at >= a and occurred_at < b group by 1) z), '{}'),
      'movement', coalesce((select sum(qty_delta) from stock_movements where branch_id = p_branch and occurred_at >= a and occurred_at < b),0),
      'closing', coalesce((select sum(qty_delta) from stock_movements where branch_id = p_branch and occurred_at < b),0),
      'skus_out_of_balance', (select count(*) from stock_levels sl where sl.branch_id = p_branch and b > now()
          and sl.qty_on_hand <> coalesce((select sum(qty_delta) from stock_movements m where m.branch_id = p_branch and m.product_id = sl.product_id),0)))
    into stock;
  select jsonb_build_object(
      'open_shifts', (select count(*) from shifts where branch_id = p_branch and status = 'open' and opened_at < b),
      'pending_returns', (select count(*) from returns where branch_id = p_branch and status = 'pending_approval' and created_at < b),
      'pending_deferred_sales', (select count(*) from pos_deferred_sales where branch_id = p_branch and state = 'pending' and occurred_at < b),
      'open_counts', (select count(*) from pos_count_sessions where branch_id = p_branch and status in ('counting','recount','review') and created_at < b))
    into warn;
  return jsonb_build_object('branch_id', p_branch, 'from', p_from, 'to', p_to,
    'sales', sales, 'voids', voids, 'returns', rets, 'credit_notes', cns,
    'net_sales', s_gross - r_amt - c_amt, 'net_vat', s_vat - r_vat - c_vat,
    'payments', pays, 'cash_movements', cash, 'stock', stock, 'open_items', warn, 'generated_at', now());
end $$;

create or replace function pos_period_close(p_actor uuid, p_branch uuid, p_period text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p pos_periods; d1 date; d2 date; s jsonb; w jsonb; v int;
begin
  perform pos_assert_actor_active(p_actor);
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'period_invalid'; end if;
  d1 := to_date(p_period || '-01', 'YYYY-MM-DD'); d2 := (d1 + interval '1 month' - interval '1 day')::date;
  if (now() at time zone 'Asia/Bangkok')::date <= d2 then raise exception 'period_not_ended: %', p_period; end if;
  perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));
  insert into pos_periods(branch_id, period) values (p_branch, p_period) on conflict do nothing;
  select * into p from pos_periods where branch_id = p_branch and period = p_period for update;
  if p.status = 'closed' then return jsonb_build_object('duplicate', true, 'version', p.version); end if;
  s := pos_period_summary(p_branch, d1, d2);
  w := s->'open_items';
  if (w->>'open_shifts')::int + (w->>'pending_returns')::int + (w->>'pending_deferred_sales')::int + (w->>'open_counts')::int > 0 then
    raise exception 'period_has_open_items: %', w::text;
  end if;
  v := p.version + 1;
  update pos_periods set status = 'closed', version = v, closed_by = p_actor, closed_at = now() where branch_id = p_branch and period = p_period;
  insert into pos_period_versions(branch_id, period, version, summary, closed_by, note) values (p_branch, p_period, v, s, p_actor, nullif(btrim(coalesce(p_note,'')),''));
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_no, amount, after_data)
  values ('period_close', p_actor, p_branch, 'pos_periods', p_period || ' v' || v, (s->>'net_sales')::numeric, jsonb_build_object('version', v, 'net_sales', s->'net_sales', 'net_vat', s->'net_vat'));
  return jsonb_build_object('closed', true, 'version', v, 'summary', s);
end $$;

create or replace function pos_period_reopen(p_actor uuid, p_branch uuid, p_period text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p pos_periods;
begin
  perform pos_assert_actor_active(p_actor);
  if length(btrim(coalesce(p_reason,''))) < 5 then raise exception 'period_reopen_reason_required'; end if;
  select * into p from pos_periods where branch_id = p_branch and period = p_period for update;
  if not found or p.status <> 'closed' then raise exception 'period_not_closed: %', p_period; end if;
  update pos_periods set status = 'open', reopened_by = p_actor, reopened_at = now(), reopen_reason = btrim(p_reason) where branch_id = p_branch and period = p_period;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_no, after_data)
  values ('period_reopen', p_actor, p_branch, 'pos_periods', p_period || ' v' || p.version, jsonb_build_object('version', p.version, 'reason', btrim(p_reason)));
  return jsonb_build_object('reopened', true, 'version', p.version);
end $$;

revoke all on function pos_lock_orders(), pos_lock_order_items(), pos_lock_order_payments(), pos_lock_immutable(), pos_lock_tax_invoices(), pos_period_closed(uuid,timestamptz), pos_period_guard(),
  pos_period_summary(uuid,date,date), pos_period_close(uuid,uuid,text,text), pos_period_reopen(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function pos_period_summary(uuid,date,date), pos_period_close(uuid,uuid,text,text), pos_period_reopen(uuid,uuid,text,text), pos_period_closed(uuid,timestamptz) to service_role;
