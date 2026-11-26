-- 0083 · ค่าคอม: เลือกได้ว่าขั้นยอดนับจาก "ยอดพนักงานรายคน" หรือ "ยอดรวมทั้งสาขา"
--   tier_scope = employee (เดิม) → ยอดของคนนั้นถึงขั้นไหน ใช้อัตรานั้น
--   tier_scope = branch          → ยอดรวมของสาขาในกฎนี้ถึงขั้นไหน ทุกคนในสาขานั้นได้อัตราขั้นนั้น (คิดจากยอดของตัวเอง)
--   รายงานคืน branch_id + ยอดที่ใช้ตัดขั้น (tier_units/tier_sales) เพื่อบอก "อีกเท่าไหร่ถึงขั้นถัดไป"
alter table pos_commission_rules add column if not exists tier_scope text not null default 'employee' check (tier_scope in ('employee','branch'));

create or replace function pos_save_commission_rule(p_actor uuid, p_rule jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r pos_commission_rules; v_id uuid := nullif(p_rule->>'id','')::uuid; v_scope text := p_rule->>'scope'; v_before jsonb; v_tiers jsonb; t jsonb; prev numeric := -1;
begin
  perform pos_assert_actor_active(p_actor);
  select coalesce(jsonb_agg(jsonb_build_object('min', (x->>'min')::numeric, 'rate', (x->>'rate')::numeric) order by (x->>'min')::numeric), '[]') into v_tiers from jsonb_array_elements(coalesce(p_rule->'tiers','[]')) x;
  for t in select value from jsonb_array_elements(v_tiers) loop
    if (t->>'min')::numeric < 0 or (t->>'rate')::numeric < 0 or (t->>'min')::numeric = prev then raise exception 'commission_invalid_tiers'; end if;
    if p_rule->>'calc' = 'percent' and (t->>'rate')::numeric > 100 then raise exception 'commission_invalid_tiers'; end if;
    prev := (t->>'min')::numeric;
  end loop;
  if v_id is not null then
    select * into r from pos_commission_rules where id = v_id for update;
    if not found then raise exception 'commission_rule_not_found'; end if;
    if r.version <> coalesce((p_rule->>'version')::int, -1) then raise exception 'commission_version_conflict'; end if;
    v_before := to_jsonb(r);
    update pos_commission_rules set name = btrim(p_rule->>'name'), scope = v_scope, brand_id = nullif(p_rule->>'brand_id','')::uuid, category_id = nullif(p_rule->>'category_id','')::uuid,
      product_ids = case when v_scope = 'sku' then coalesce(array(select (x)::uuid from jsonb_array_elements_text(coalesce(p_rule->'product_ids','[]')) x), '{}') else '{}' end,
      branch_ids = coalesce(array(select (x)::uuid from jsonb_array_elements_text(coalesce(p_rule->'branch_ids','[]')) x), '{}'),
      basis = p_rule->>'basis', calc = p_rule->>'calc', tier_scope = coalesce(p_rule->>'tier_scope', r.tier_scope), tiers = v_tiers,
      starts_at = (p_rule->>'starts_at')::timestamptz, ends_at = (p_rule->>'ends_at')::timestamptz,
      status = coalesce(p_rule->>'status', r.status), note = nullif(btrim(coalesce(p_rule->>'note','')),''), updated_by = p_actor, updated_at = now(), version = version + 1
    where id = v_id returning * into r;
  else
    insert into pos_commission_rules(name, scope, brand_id, category_id, product_ids, branch_ids, basis, calc, tier_scope, tiers, starts_at, ends_at, note, created_by, updated_by)
    values (btrim(p_rule->>'name'), v_scope, nullif(p_rule->>'brand_id','')::uuid, nullif(p_rule->>'category_id','')::uuid,
      case when v_scope = 'sku' then coalesce(array(select (x)::uuid from jsonb_array_elements_text(coalesce(p_rule->'product_ids','[]')) x), '{}') else '{}' end,
      coalesce(array(select (x)::uuid from jsonb_array_elements_text(coalesce(p_rule->'branch_ids','[]')) x), '{}'),
      p_rule->>'basis', p_rule->>'calc', coalesce(p_rule->>'tier_scope','employee'), v_tiers, (p_rule->>'starts_at')::timestamptz, (p_rule->>'ends_at')::timestamptz,
      nullif(btrim(coalesce(p_rule->>'note','')),''), p_actor, p_actor)
    returning * into r;
  end if;
  insert into audit_logs(action, actor_id, ref_table, ref_id, ref_no, before_data, after_data)
  values (case when v_id is null then 'commission_rule_create' else 'commission_rule_update' end, p_actor, 'pos_commission_rules', r.id, r.name, v_before, to_jsonb(r));
  return to_jsonb(r);
end $$;

drop function if exists pos_commission_report(timestamptz, timestamptz, uuid[]);
create or replace function pos_commission_report(p_from timestamptz, p_to timestamptz, p_branches uuid[] default null)
returns table(rule_id uuid, employee_id uuid, branch_id uuid, units numeric, sales numeric, bills bigint, tier_units numeric, tier_sales numeric, tier_min numeric, rate numeric, commission numeric, next_min numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with ord as (
    select o.id, o.branch_id, o.grand_total, o.salesperson_id, o.cashier_id, coalesce(o.sale_occurred_at, o.created_at) at,
      nullif((select sum(i.line_total) from order_items i where i.order_id = o.id and not coalesce(i.is_gift,false)), 0) lines_total
    from orders o
    where o.status in ('completed','partially_refunded') and coalesce(o.sale_occurred_at, o.created_at) >= p_from and coalesce(o.sale_occurred_at, o.created_at) < p_to
      and (p_branches is null or o.branch_id = any(p_branches))
  ), line as (
    select ord.id order_id, ord.branch_id, ord.at, coalesce(i.salesperson_id, ord.salesperson_id, ord.cashier_id) emp, i.product_id, p.category_id, p.brand_id,
      greatest(i.qty - coalesce(i.returned_qty,0), 0) qty_net,
      case when i.qty > 0 then i.line_total * coalesce(ord.grand_total / ord.lines_total, 1) * greatest(i.qty - coalesce(i.returned_qty,0), 0) / i.qty else 0 end net
    from ord join order_items i on i.order_id = ord.id join products p on p.id = i.product_id
    where not coalesce(i.is_gift,false)
  ), matched as (
    select l.*, r.id rule_id, r.tier_scope from line l
    join lateral (
      select x.id, x.tier_scope from pos_commission_rules x
      where x.status = 'active' and x.starts_at <= l.at and x.ends_at > l.at
        and (cardinality(x.branch_ids) = 0 or l.branch_id = any(x.branch_ids))
        and ((x.scope = 'sku' and l.product_id = any(x.product_ids))
          or (x.scope = 'category' and x.category_id = l.category_id and (x.brand_id is null or x.brand_id = l.brand_id))
          or (x.scope = 'brand' and x.brand_id = l.brand_id))
      order by case x.scope when 'sku' then 0 when 'category' then 1 else 2 end, x.created_at desc limit 1
    ) r on true
    where l.emp is not null and l.qty_net > 0
  ), emp_agg as (
    -- ยอดพนักงาน: กฎแบบรายคน = รวมทุกสาขา (branch_id null) · กฎแบบทั้งสาขา = แยกตามสาขา
    select m.rule_id, m.emp, case when m.tier_scope = 'branch' then m.branch_id end b, m.tier_scope,
      sum(m.qty_net) units, round(sum(m.net), 2) sales, count(distinct m.order_id) bills
    from matched m group by 1, 2, 3, 4
  ), br_agg as (
    select m.rule_id, m.branch_id b, sum(m.qty_net) units, round(sum(m.net), 2) sales from matched m where m.tier_scope = 'branch' group by 1, 2
  ), base as (
    select a.*, coalesce(bg.units, a.units) t_units, coalesce(bg.sales, a.sales) t_sales
    from emp_agg a left join br_agg bg on a.tier_scope = 'branch' and bg.rule_id = a.rule_id and bg.b = a.b
  )
  select x.rule_id, x.emp, x.b, x.units, x.sales, x.bills, x.t_units, x.t_sales, t.tmin, t.trate,
    round(case when t.trate is null then 0 when r.calc = 'per_unit' then x.units * t.trate else x.sales * t.trate / 100 end, 2),
    (select min((j->>'min')::numeric) from jsonb_array_elements(r.tiers) j where (j->>'min')::numeric > case r.basis when 'units' then x.t_units else x.t_sales end)
  from base x join pos_commission_rules r on r.id = x.rule_id
  left join lateral (
    select (j->>'min')::numeric tmin, (j->>'rate')::numeric trate from jsonb_array_elements(r.tiers) j
    where (j->>'min')::numeric <= case r.basis when 'units' then x.t_units else x.t_sales end
    order by (j->>'min')::numeric desc limit 1
  ) t on true
$$;
revoke all on function pos_commission_report(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function pos_commission_report(timestamptz, timestamptz, uuid[]) to service_role;
