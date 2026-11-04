-- =====================================================================
-- 0010 — RPC (SECURITY DEFINER) สำหรับ sync ops ที่เหลือ ให้ client (anon)
-- เขียนผ่านฟังก์ชันที่ควบคุมได้ (รูปแบบเดียวกับ create_order) แทนการเปิด
-- anon insert ตรง ๆ บนตาราง (ปลอดภัยกว่า) — idempotent ด้วย id/on conflict
-- =====================================================================

-- ---- audit log ----
create or replace function public.sync_audit(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs(action, actor_id, branch_id, terminal_id, ref_table, ref_no, amount, before_data, after_data, is_offline, occurred_at)
  select r.action, r.actor_id, r.branch_id, r.terminal_id, r.ref_table, r.ref_no, r.amount, r.before_data, r.after_data,
         coalesce(r.is_offline, false), coalesce(r.occurred_at, now())
  from jsonb_populate_record(null::audit_logs, p_payload) r;
end $$;

-- ---- open shift ----
create or replace function public.sync_open_shift(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r shifts;
begin
  r := jsonb_populate_record(null::shifts, p_payload);
  insert into shifts(id, shift_no, branch_id, terminal_id, opened_by, status, opening_cash, expected_cash,
                     counted_cash, cash_variance, total_sales, total_orders, opened_at, closed_at, note)
  values (r.id, r.shift_no, r.branch_id, r.terminal_id, r.opened_by, coalesce(r.status,'open'), coalesce(r.opening_cash,0),
          r.expected_cash, r.counted_cash, r.cash_variance, coalesce(r.total_sales,0), coalesce(r.total_orders,0),
          coalesce(r.opened_at, now()), r.closed_at, r.note)
  on conflict (id) do nothing;
end $$;

-- ---- return (+ items) ----
create or replace function public.sync_return(p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r returns; ins uuid; it jsonb;
begin
  r := jsonb_populate_record(null::returns, p_payload);
  insert into returns(id, return_no, order_id, branch_id, type, status, reason_code, reason_note,
                      refund_method, refund_amount, requested_by, approved_by, created_at)
  values (r.id, r.return_no, r.order_id, r.branch_id, r.type, coalesce(r.status,'completed'), r.reason_code, r.reason_note,
          r.refund_method, coalesce(r.refund_amount,0), r.requested_by, r.approved_by, coalesce(r.created_at, now()))
  on conflict (id) do nothing
  returning id into ins;

  if ins is not null then
    for it in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) loop
      insert into return_items(id, return_id, product_id, sku, name, qty, unit_price, line_total, condition)
      values (gen_random_uuid(), ins, nullif(it->>'product_id','')::uuid, it->>'sku', it->>'name',
              coalesce((it->>'qty')::numeric,0), coalesce((it->>'unit_price')::numeric,0),
              coalesce((it->>'line_total')::numeric,0), it->>'condition');
    end loop;
  end if;
end $$;

revoke all on function public.sync_audit(jsonb), public.sync_open_shift(jsonb), public.sync_return(jsonb) from public;
grant execute on function public.sync_audit(jsonb), public.sync_open_shift(jsonb), public.sync_return(jsonb) to anon, authenticated;
