-- =====================================================================
-- SHD POS — 0026_pos_active_gift_campaigns.sql
-- ดึงแคมเปญ "ของแถมอัตโนมัติ" ที่ใช้ได้กับสาขา/ช่องทาง/ช่วงเวลาปัจจุบัน
--   ให้ POS ประเมินตะกร้าแล้วเติมของแถมเอง (brand ตรวจรายบรรทัดฝั่ง client)
-- =====================================================================
create or replace function public.pos_active_gift_campaigns(p_branch_id uuid, p_channel text)
returns setof json
language sql
security definer
set search_path = public, extensions
as $$
  select to_json(x) from (
    select
      c.id, c.name, c.brand_ids, c.eligible_scope, c.eligible_min_qty,
      c.eligible_across_sku, c.min_spend, c.gift_mode, c.gift_per_qty, c.gift_cap,
      coalesce((select json_agg(cp.sku) from campaign_products cp
                where cp.campaign_id = c.id and cp.role = 'eligible'), '[]'::json) as eligible_skus,
      coalesce((select json_agg(json_build_object('sku', cp.sku, 'gift_qty', cp.gift_qty)) from campaign_products cp
                where cp.campaign_id = c.id and cp.role = 'gift'), '[]'::json) as gift_skus
    from campaigns c
    where c.active and c.is_automatic and c.promo_type = 'gift'
      and (c.starts_at is null or current_date >= c.starts_at)
      and (c.ends_at is null or current_date <= c.ends_at)
      and (array_length(c.branch_ids, 1) is null or p_branch_id = any(c.branch_ids))
      and (array_length(c.channels, 1) is null or p_channel = any(c.channels))
    order by c.created_at
  ) x;
$$;

revoke all on function public.pos_active_gift_campaigns(uuid, text) from public;
grant execute on function public.pos_active_gift_campaigns(uuid, text) to anon, authenticated;
