-- =====================================================================
-- 0060 — โปรรายสินค้า (line campaigns): แคมเปญที่ผูกสินค้า ลด "ที่บรรทัดสินค้านั้น" · หลายโปรต่อบิลได้
--   • เครื่องส่งแค่ items[i].line_campaign_code — เซิร์ฟเวอร์ตรวจสิทธิ์และคิดยอดเองทั้งหมด (พนักงานแก้ยอดไม่ได้)
--   • ไม่นับรวมเพดานส่วนลดของพนักงาน (คิดหลัง validateQuote) · ฐาน = ยอดบรรทัดหลังส่วนลดที่พนักงานกดเอง
--   • amount = ลดต่อชิ้น × จำนวน (ไม่เกินยอดบรรทัด) · percent = % ของยอดบรรทัด · max_discount = เพดานต่อบรรทัด
--   • บันทึก: items[i].campaign_* + promo_snapshot.line_campaigns + promotion_campaign_ids (โควตา/ประวัติ)
--   • JST เห็นเป็นส่วนลดรายการของบรรทัดนั้น (lineDiscount) — ไม่ต้องสร้างแคมเปญใน JST
-- =====================================================================
create or replace function pos_apply_line_campaigns(p_id uuid, p_branch uuid, p_quote jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  it jsonb; items jsonb := '[]'; lc jsonb := '[]'; ids jsonb := '[]'; c campaigns; v_code text;
  d numeric; base numeric; qty numeric; gross numeric; total_d numeric := 0; total numeric;
  customer uuid := nullif(p_quote->>'customer_id','')::uuid; today date := (now() at time zone 'Asia/Bangkok')::date; idx int := -1;
begin
  if not exists (select 1 from jsonb_array_elements(coalesce(p_quote->'items','[]')) i where nullif(trim(i->>'line_campaign_code'),'') is not null) then
    return p_quote;
  end if;
  -- ล็อกแคมเปญที่ใช้ เรียงตาม id (กันโควตาชนกันข้ามสาขา)
  perform 1 from campaigns where upper(campaigns.code) in (
    select upper(trim(i->>'line_campaign_code')) from jsonb_array_elements(p_quote->'items') i where nullif(trim(i->>'line_campaign_code'),'') is not null
  ) order by id for update;
  for it in select value from jsonb_array_elements(p_quote->'items') loop
    idx := idx + 1;
    v_code := nullif(upper(trim(it->>'line_campaign_code')),'');
    if v_code is null then items := items || jsonb_build_array(it); continue; end if;
    select * into c from campaigns where upper(campaigns.code) = v_code order by id limit 1;
    if not found then raise exception 'line_campaign_not_found'; end if;
    if not c.active or c.archived_at is not null or c.promo_type <> 'discount'
       or (c.starts_at is not null and today < c.starts_at) or (c.ends_at is not null and today > c.ends_at)
       or (cardinality(c.branch_ids) > 0 and not p_branch = any(c.branch_ids))
       or (cardinality(c.channels) > 0 and not (p_quote->>'channel') = any(c.channels)) then
      raise exception 'line_campaign_not_applicable';
    end if;
    if c.eligible_scope = 'all'
       or not exists (select 1 from campaign_products cp where cp.campaign_id = c.id and cp.role = 'eligible' and cp.product_id = (it->>'product_id')::uuid)
       or (cardinality(c.brand_ids) > 0 and not exists (select 1 from products p where p.id = (it->>'product_id')::uuid and p.brand_id = any(c.brand_ids))) then
      raise exception 'line_campaign_product_mismatch';
    end if;
    qty := (it->>'qty')::numeric; gross := (it->>'unit_price')::numeric * qty;
    if gross < c.min_spend or qty < coalesce(c.eligible_min_qty, 1) then raise exception 'line_campaign_minimum_not_met'; end if;
    if c.target_segment <> 'all' and (customer is null or customer_segment(customer) <> c.target_segment) then raise exception 'coupon_customer_segment'; end if;
    if not (ids ? c.id::text) then
      perform pos_check_campaign_quota(c.id, p_id, customer);
      ids := ids || jsonb_build_array(c.id::text);
    end if;
    base := (it->>'line_total')::numeric;
    d := case when c.discount_type = 'percent' then round(base * c.discount_value / 100, 2) else least(c.discount_value * qty, base) end;
    if c.max_discount is not null then d := least(d, c.max_discount); end if;
    d := round(greatest(0, least(d, base)), 2);
    it := it || jsonb_build_object(
      'manual_discount', (it->>'discount_amount')::numeric,
      'discount_amount', round((it->>'discount_amount')::numeric + d, 2),
      'line_total', round(base - d, 2),
      'vat_amount', round((base - d) - (base - d) / 1.07, 2),
      'gross_profit', round((base - d) / 1.07 - (it->>'cost_total')::numeric, 2),
      'campaign_id', c.id, 'campaign_code', c.code, 'campaign_discount', d);
    items := items || jsonb_build_array(it);
    lc := lc || jsonb_build_array(jsonb_build_object('campaign_id', c.id, 'code', c.code, 'name', c.name, 'sku', it->>'sku', 'product_id', it->>'product_id', 'line', idx, 'discount', d));
    total_d := total_d + d;
  end loop;
  total := round((p_quote->>'grand_total')::numeric - total_d, 2);
  if total <= 0 then raise exception 'promotion_requires_positive_payable'; end if;
  return p_quote || jsonb_build_object('items', items, 'discount_total', round((p_quote->>'discount_total')::numeric + total_d, 2),
    'grand_total', total, 'vat_amount', round(total - total / 1.07, 2), 'line_campaigns', lc, 'line_campaign_ids', ids);
end $$;

-- โปรรายสินค้า → โปรทั้งบิล/ของแถม/แต้ม (เดิม) → รวมรายการแคมเปญที่ใช้
create or replace function pos_quote_with_lines(p_id uuid, p_branch uuid, p_base jsonb, p_coupon text, p_points integer, p_gifts jsonb, p_preview boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b jsonb; q jsonb; ids jsonb;
begin
  b := pos_apply_line_campaigns(p_id, p_branch, p_base);
  q := pos_promoted_quote(p_id, p_branch, b, p_coupon, p_points, p_gifts, p_preview);
  if b ? 'line_campaigns' then
    if (b->'line_campaign_ids') ? coalesce(q#>>'{promo_snapshot,coupon,campaign_id}', '') and nullif(q->>'coupon_code','') is not null then
      raise exception 'campaign_used_twice';
    end if;
    select coalesce(jsonb_agg(distinct x), '[]') into ids from (
      select jsonb_array_elements_text(coalesce(q->'promotion_campaign_ids','[]')) x
      union select jsonb_array_elements_text(b->'line_campaign_ids')) s;
    q := q || jsonb_build_object('promotion_campaign_ids', ids,
      'promo_snapshot', coalesce(q->'promo_snapshot','{}') || jsonb_build_object('line_campaigns', b->'line_campaigns'));
  end if;
  return q;
end $$;

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
  -- promotion_request ต้องเป็นคำขอดิบ (เทียบตอนจองซ้ำ) ไม่ใช่ base ที่หักโปรรายสินค้าแล้ว
  q := q || jsonb_build_object('promotion_request', request);
  if not p_preview then
    if (q->>'grand_total')::numeric <> p_expected then raise exception 'promotion_total_changed_preview_required'; end if;
    perform pos_reserve_checkout(p_id, p_actor, p_branch, q);
  end if;
  return jsonb_build_object('id', p_id, 'quote', q, 'coupon_discount', q->'coupon_discount', 'grand_total', q->'grand_total',
    'campaign_id', q#>'{promo_snapshot,coupon,campaign_id}', 'line_campaigns', coalesce(q#>'{promo_snapshot,line_campaigns}', '[]'));
end $$;

-- บันทึกการใช้แคมเปญ: ยอดลดของโปรรายสินค้าเข้า pos_campaign_uses.discount ด้วย (เดิมนับแค่คูปองทั้งบิล)
do $$
declare d text; o text; n text;
begin
  d := pg_get_functiondef('pos_commit_checkout'::regproc);
  o := $q$case when campaign=h.quote#>>'{promo_snapshot,coupon,campaign_id}'then coalesce((h.quote->>'coupon_discount')::numeric,0)else 0 end$q$;
  n := $q$(case when campaign=h.quote#>>'{promo_snapshot,coupon,campaign_id}'then coalesce((h.quote->>'coupon_discount')::numeric,0)else 0 end)+coalesce((select sum((x->>'discount')::numeric)from jsonb_array_elements(coalesce(h.quote#>'{promo_snapshot,line_campaigns}','[]'))x where x->>'campaign_id'=campaign),0)$q$;
  if position(n in d) > 0 then return; end if;            -- รันซ้ำได้
  if position(o in d) = 0 then raise exception 'pos_commit_checkout: ไม่พบจุดที่ต้องแก้'; end if;
  execute replace(d, o, n);
end $$;

revoke all on function pos_apply_line_campaigns(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function pos_quote_with_lines(uuid,uuid,jsonb,text,integer,jsonb,boolean) from public, anon, authenticated;
