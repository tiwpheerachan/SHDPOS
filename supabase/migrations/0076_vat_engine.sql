-- 0076 · ภาษีมูลค่าเพิ่มรายบรรทัด (UAT F027 ภาษีแยก · F028 ภาษีรวม · F029 ปัดเศษ) — สูตรเดียวกับ web/src/lib/tax.ts ทุกสตางค์
--   pos_quote_finalize_vat(quote): ขั้นสุดท้ายก่อนจองตะกร้า (หลังโปรรายสินค้า/คูปอง/แต้ม)
--     • กระจายส่วนลดหัวบิล (= ผลรวม line_total − grand_total) ลงรายการตามสัดส่วน ด้วยจำนวนเต็มสตางค์ (เศษเหลือมากสุดได้ก่อน)
--     • VAT รายบรรทัดตาม vat_mode/vat_rate ของสินค้า: inclusive ถอด VAT จากยอด · exclusive บวก VAT เพิ่ม · exempt ไม่มี VAT
--     • หัวบิล: vat_amount = ผลรวม VAT รายบรรทัด (ไม่มีเศษลอย) · grand_total = ผลรวมยอดรายการ (+VAT แยก)
--     • ทำซ้ำได้ (vat_finalized) · บิลที่สินค้าเป็น "รวม VAT" ทั้งหมด → grand_total เท่าเดิมทุกสตางค์
create or replace function pos_vat_halfup(a bigint, b bigint, c bigint)
returns bigint language sql immutable as $$ select floor((2 * a * b + c)::numeric / (2 * c))::bigint $$;

create or replace function pos_quote_finalize_vat(q jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare items jsonb := coalesce(q->'items','[]'::jsonb); n int := jsonb_array_length(coalesce(q->'items','[]'::jsonb));
  lc bigint[]; al bigint[]; modes text[]; bps bigint[]; s bigint := 0; dc bigint; rem bigint; i int; it jsonb; p products;
  net bigint; vat bigint; tot bigint; tot_sum bigint := 0; vat_sum bigint := 0; ex_sum bigint := 0; out jsonb := '[]'::jsonb; r record;
begin
  if coalesce(q->>'vat_finalized','') = 'true' or n = 0 then return q; end if;
  lc := array_fill(0::bigint, array[n]); al := array_fill(0::bigint, array[n]); modes := array_fill('inclusive'::text, array[n]); bps := array_fill(700::bigint, array[n]);
  for i in 1..n loop
    it := items->(i-1);
    lc[i] := greatest(round(coalesce((it->>'line_total')::numeric, 0) * 100), 0);
    s := s + lc[i];
    select * into p from products where id = nullif(it->>'product_id','')::uuid;
    if found then modes[i] := coalesce(p.vat_mode::text, 'inclusive'); bps[i] := round(coalesce(p.vat_rate, 7) * 100); end if;
  end loop;
  dc := greatest(least(s - round(coalesce((q->>'grand_total')::numeric, 0) * 100)::bigint, s), 0);
  if s > 0 then
    for i in 1..n loop al[i] := floor((dc * lc[i])::numeric / s)::bigint; end loop;
    rem := dc - (select coalesce(sum(x),0) from unnest(al) x);
    for r in select ord, (dc * lc[ord]) % s frac from generate_series(1, n) ord order by 2 desc, 1 asc loop
      exit when rem <= 0;
      if lc[r.ord] - al[r.ord] > 0 then al[r.ord] := al[r.ord] + 1; rem := rem - 1; end if;
    end loop;
  end if;
  for i in 1..n loop
    it := items->(i-1);
    net := lc[i] - al[i];
    vat := case when modes[i] = 'exempt' or bps[i] <= 0 then 0
                when modes[i] = 'exclusive' then pos_vat_halfup(net, bps[i], 10000)
                else pos_vat_halfup(net, bps[i], 10000 + bps[i]) end;
    tot := case when modes[i] = 'exclusive' then net + vat else net end;
    tot_sum := tot_sum + tot; vat_sum := vat_sum + vat; if modes[i] = 'exclusive' then ex_sum := ex_sum + vat; end if;
    out := out || jsonb_build_array(it || jsonb_build_object(
      'vat_mode', modes[i], 'vat_rate', bps[i] / 100.0, 'vat_amount', vat / 100.0, 'bill_discount_alloc', al[i] / 100.0, 'net_amount', tot / 100.0,
      'gross_profit', round((tot - vat) / 100.0 - coalesce((it->>'cost_total')::numeric, 0), 2)));
  end loop;
  return q || jsonb_build_object('items', out, 'grand_total', tot_sum / 100.0, 'vat_amount', vat_sum / 100.0, 'exclusive_vat', ex_sum / 100.0, 'vat_finalized', true);
end $$;

-- ขั้นจองตะกร้า: คิด VAT รายบรรทัดเป็นขั้นสุดท้าย (แก้จาก 0060)
create or replace function pos_prepare_promoted_checkout(p_id uuid, p_actor uuid, p_branch uuid, p_base jsonb, p_coupon text, p_points integer, p_gifts jsonb, p_expected numeric, p_preview boolean DEFAULT false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare q jsonb; h pos_checkout_holds; request jsonb;
begin
  if not p_preview and (p_expected is null or p_expected <= 0 or p_expected::text in ('NaN','Infinity','-Infinity')) then raise exception 'invalid_expected_payable'; end if;
  perform pos_assert_actor_active(p_actor);
  perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text, 0));
  select * into h from pos_checkout_holds where id = p_id for update;
  request := jsonb_build_object('base', p_base, 'coupon', coalesce(upper(trim(p_coupon)),''), 'points', p_points, 'gifts', p_gifts);
  if found and not p_preview then
    if h.actor_id <> p_actor or h.branch_id <> p_branch or h.status <> 'active' or h.quote->'promotion_request' is distinct from request then raise exception 'checkout_conflict'; end if;
    if h.expires_at <= now() and jsonb_array_length(h.recorded_payments) = 0 then
      q := pos_quote_with_lines(p_id, p_branch, p_base, p_coupon, p_points, p_gifts, false);
    else q := h.quote; end if;
  else q := pos_quote_with_lines(p_id, p_branch, p_base, p_coupon, p_points, p_gifts, p_preview); end if;
  q := pos_quote_finalize_vat(q);
  q := q || jsonb_build_object('promotion_request', request);
  if not p_preview then
    if (q->>'grand_total')::numeric <> p_expected then raise exception 'promotion_total_changed_preview_required'; end if;
    perform pos_reserve_checkout(p_id, p_actor, p_branch, q);
  end if;
  return jsonb_build_object('id', p_id, 'quote', q, 'coupon_discount', q->'coupon_discount', 'grand_total', q->'grand_total',
    'vat_amount', q->'vat_amount', 'exclusive_vat', q->'exclusive_vat',
    'campaign_id', q#>'{promo_snapshot,coupon,campaign_id}', 'line_campaigns', coalesce(q#>'{promo_snapshot,line_campaigns}', '[]'));
end $$;

revoke all on function pos_vat_halfup(bigint,bigint,bigint), pos_quote_finalize_vat(jsonb) from public, anon, authenticated;
grant execute on function pos_quote_finalize_vat(jsonb) to service_role;
