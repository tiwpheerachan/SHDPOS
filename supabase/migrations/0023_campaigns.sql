-- =====================================================================
-- SHD POS — 0023_campaigns.sql
-- แคมเปญ/คูปองวัดผล
--   • คูปองเฉพาะกลุ่มลูกค้า (all/new/returning/vip/lost)
--   • เงื่อนไข: ยอดขั้นต่ำ, ช่วงเวลา, จำนวนครั้งใช้ได้ (รวม/ต่อคน)
--   • บันทึกการใช้ (coupon_redemptions) ผูกกับบิล → วัดยอดขายที่เกิดขึ้น
-- =====================================================================
create table if not exists campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  description    text,
  code           text unique,                       -- รหัสคูปอง (เก็บตัวพิมพ์ใหญ่)
  discount_type  text not null default 'amount',    -- amount | percent
  discount_value numeric(14,2) not null default 0,
  max_discount   numeric(14,2),                      -- เพดานส่วนลด (กรณี percent)
  min_spend      numeric(14,2) not null default 0,
  target_segment text not null default 'all',        -- all|new|returning|vip|lost
  starts_at      date,
  ends_at        date,
  usage_limit    int,                                -- ใช้ได้รวมกี่ครั้ง (null=ไม่จำกัด)
  per_customer_limit int default 1,
  active         boolean not null default true,
  created_by     uuid references employees(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists coupon_redemptions (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  customer_id     uuid references customers(id) on delete set null,
  order_id        uuid references orders(id) on delete set null,
  client_uuid     uuid,
  discount_amount numeric(14,2) not null default 0,
  order_total     numeric(14,2),
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_coupon_redemption_bill
  on coupon_redemptions(campaign_id, client_uuid) where client_uuid is not null;
create index if not exists idx_coupon_campaign on coupon_redemptions(campaign_id);

alter table campaigns enable row level security;
alter table coupon_redemptions enable row level security;

-- ---------------------------------------------------------------------
-- helper: กลุ่มลูกค้า (RFM แบบย่อ) — ตรงกับเกณฑ์ใน /api/admin/customers
-- ---------------------------------------------------------------------
create or replace function customer_segment(p_customer_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_cnt int; v_spend numeric; v_last timestamptz; v_days int;
begin
  select count(*), coalesce(sum(grand_total), 0), max(created_at)
    into v_cnt, v_spend, v_last
    from orders where customer_id = p_customer_id and status <> 'voided';
  if v_cnt = 0 then return 'new'; end if;
  v_days := floor(extract(epoch from (now() - v_last)) / 86400.0);
  if v_days > 180 then return 'lost'; end if;
  if v_spend >= 50000 or v_cnt >= 5 then return 'vip'; end if;
  if v_cnt >= 2 then return 'returning'; end if;
  return 'new';
end;
$$;

-- ---------------------------------------------------------------------
-- ตรวจคูปอง (ก่อนใช้) — คืน {valid, reason, discount, campaign_id, name}
-- ---------------------------------------------------------------------
create or replace function pos_validate_coupon(p_code text, p_customer_id uuid, p_subtotal numeric)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c         campaigns%rowtype;
  v_used    int;
  v_used_c  int;
  v_disc    numeric;
  v_seg     text;
begin
  select * into c from campaigns where upper(code) = upper(btrim(p_code)) and active limit 1;
  if not found then return json_build_object('valid', false, 'reason', 'ไม่พบคูปองนี้'); end if;

  if c.starts_at is not null and current_date < c.starts_at then
    return json_build_object('valid', false, 'reason', 'คูปองยังไม่เริ่ม');
  end if;
  if c.ends_at is not null and current_date > c.ends_at then
    return json_build_object('valid', false, 'reason', 'คูปองหมดอายุแล้ว');
  end if;
  if coalesce(p_subtotal, 0) < c.min_spend then
    return json_build_object('valid', false, 'reason', 'ยอดซื้อขั้นต่ำ ' || c.min_spend::int || ' บาท');
  end if;

  if c.usage_limit is not null then
    select count(*) into v_used from coupon_redemptions where campaign_id = c.id;
    if v_used >= c.usage_limit then
      return json_build_object('valid', false, 'reason', 'คูปองถูกใช้ครบจำนวนแล้ว');
    end if;
  end if;

  if p_customer_id is not null and c.per_customer_limit is not null then
    select count(*) into v_used_c from coupon_redemptions where campaign_id = c.id and customer_id = p_customer_id;
    if v_used_c >= c.per_customer_limit then
      return json_build_object('valid', false, 'reason', 'คุณใช้คูปองนี้ครบแล้ว');
    end if;
  end if;

  if c.target_segment <> 'all' then
    if p_customer_id is null then
      return json_build_object('valid', false, 'reason', 'คูปองนี้สำหรับสมาชิกเฉพาะกลุ่ม');
    end if;
    v_seg := customer_segment(p_customer_id);
    if v_seg <> c.target_segment then
      return json_build_object('valid', false, 'reason', 'คูปองนี้ไม่ตรงกับกลุ่มลูกค้า');
    end if;
  end if;

  if c.discount_type = 'percent' then
    v_disc := round(coalesce(p_subtotal, 0) * c.discount_value / 100.0, 2);
    if c.max_discount is not null then v_disc := least(v_disc, c.max_discount); end if;
  else
    v_disc := c.discount_value;
  end if;
  v_disc := least(v_disc, coalesce(p_subtotal, 0));

  return json_build_object('valid', true, 'discount', v_disc, 'campaign_id', c.id, 'name', c.name);
end;
$$;

revoke all on function pos_validate_coupon(text, uuid, numeric) from public;
grant execute on function pos_validate_coupon(text, uuid, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------
-- บันทึกการใช้คูปอง (ตอนขาย) — idempotent ด้วย client_uuid ของบิล
-- ---------------------------------------------------------------------
create or replace function pos_redeem_coupon(p_code text, p_customer_id uuid, p_client_uuid uuid, p_discount numeric)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c          campaigns%rowtype;
  v_order_id uuid;
  v_total    numeric;
begin
  select * into c from campaigns where upper(code) = upper(btrim(p_code)) and active limit 1;
  if not found then return json_build_object('ok', false, 'reason', 'not found'); end if;

  if exists (select 1 from coupon_redemptions where campaign_id = c.id and client_uuid = p_client_uuid) then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  select id, grand_total into v_order_id, v_total from orders where client_uuid = p_client_uuid;

  insert into coupon_redemptions(campaign_id, customer_id, order_id, client_uuid, discount_amount, order_total)
    values (c.id, p_customer_id, v_order_id, p_client_uuid, coalesce(p_discount, 0), v_total);

  return json_build_object('ok', true);
end;
$$;

revoke all on function pos_redeem_coupon(text, uuid, uuid, numeric) from public;
grant execute on function pos_redeem_coupon(text, uuid, uuid, numeric) to anon, authenticated;
