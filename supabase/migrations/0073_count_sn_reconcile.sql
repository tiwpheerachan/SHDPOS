-- 0073 · ตรวจนับ: กระทบยอดราย SN ("SN ไหนยังอยู่ ตรงกับระบบไหม หลังการขาย")
--   ทุก SN ที่สแกน + ทุก SN ที่ระบบคาดว่าอยู่ → จัดหมวดเป็น sn_check:
--     match        ตรง: อยู่สาขานี้ สินค้านี้ พร้อมขาย
--     missing      หาย: ระบบว่าอยู่ แต่ไม่พบตอนนับ (SN ที่ขาย/โอนออกหลังสแกนไม่นับเป็นหาย)
--     sold         ขายแล้วแต่ยังอยู่ในร้าน ⚠ อาจส่งเครื่องผิดชิ้นให้ลูกค้า (อ้างเลขบิล)
--     other_branch เป็นของสาขาอื่น / ระหว่างโอน
--     wrong_product SN นี้เป็นของสินค้าอื่น (วางผิดที่/ติดฉลากผิด)
--     not_sellable ชำรุด/ตัดจำหน่าย/หาย/รับคืน
--     unknown      ไม่มีในระบบ
--   สาขาผูก OneWarehouse: API ถามคลังกลางทีละ SN แล้วเขียน sn_check ก่อนส่งตรวจ (POS ไม่มีรายการ SN ของคลังกลาง)
--     → ขาด = ยอดระบบ − SN ที่ตรง (ระบุเลขที่หายไม่ได้ จนกว่า OW จะมี API รายการ SN ตามคลัง)
alter table pos_count_lines add column if not exists sn_check jsonb;

create or replace function public.pos_count_submit(p_actor uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s pos_count_sessions; pending int; recount_n int := 0; round2 boolean; unchecked int;
begin
  perform pos_assert_actor_active(p_actor);
  select * into s from pos_count_sessions where id=p_session for update;
  if not found then raise exception 'count_not_found'; end if;
  if s.status not in ('counting','recount') then raise exception 'count_wrong_status: %', s.status; end if;
  round2 := s.status='recount';
  select count(*) into pending from pos_count_lines where session_id=p_session and not skipped
    and (case when round2 then needs_recount and count2 is null else count1 is null end);
  if pending > 0 then raise exception 'count_incomplete: %', pending; end if;

  update pos_count_lines l set
    final_qty = coalesce(l.count2, l.count1),
    final_sys = case when l.count2 is not null then l.sys2 else l.sys1 end,
    variance = coalesce(l.count2, l.count1) - (case when l.count2 is not null then l.sys2 else l.sys1 end),
    variance_value = round((coalesce(l.count2, l.count1) - (case when l.count2 is not null then l.sys2 else l.sys1 end)) * l.unit_cost, 2)
  where l.session_id=p_session and not l.skipped;

  if s.ow_linked then
    -- คลังกลาง: sn_check ต้องถูกเขียนโดย API (ถาม OW ทีละ SN) ครบทุก SN ที่สแกน
    select count(*) into unchecked from pos_count_lines l where l.session_id=p_session and l.track_serial and not l.skipped
      and cardinality(coalesce(coalesce(l.count2_sns, l.count1_sns),'{}')) <> coalesce(jsonb_array_length(l.sn_check),0);
    if unchecked > 0 then raise exception 'count_sn_unverified: %', unchecked; end if;
    update pos_count_lines l set
      missing_sns = '{}',
      extra_sns = coalesce((select array_agg(e->>'sn' order by e->>'sn') from jsonb_array_elements(l.sn_check) e where e->>'verdict' <> 'match'),'{}'),
      variance = (select count(*) from jsonb_array_elements(l.sn_check) e where e->>'verdict'='match') - l.final_sys,
      variance_value = round(((select count(*) from jsonb_array_elements(l.sn_check) e where e->>'verdict'='match') - l.final_sys) * l.unit_cost, 2)
    where l.session_id=p_session and l.track_serial and not l.skipped;
  else
    -- POS: SN หาย = อยู่สาขานี้ตอนนี้แต่ไม่ถูกสแกน
    update pos_count_lines l set
      missing_sns = coalesce((select array_agg(x order by x) from (select upper(trim(sr.serial_no)) x from serials sr
          where sr.branch_id=s.branch_id and sr.product_id=l.product_id and sr.status in ('in_stock','reserved')) a
          where not (x = any(coalesce(coalesce(l.count2_sns, l.count1_sns),'{}')))),'{}')
    where l.session_id=p_session and l.track_serial and not l.skipped;
    -- จัดหมวดทุก SN ที่สแกน + SN ที่หาย
    update pos_count_lines l set sn_check = (
      select coalesce(jsonb_agg(c order by c->>'verdict' <> 'match' desc, c->>'sn'), '[]'::jsonb) from (
        select jsonb_strip_nulls(jsonb_build_object('sn', x.sn,
          'verdict', case
            when sr.id is null then 'unknown'
            when sr.product_id <> l.product_id then 'wrong_product'
            when sr.branch_id = s.branch_id and sr.status in ('in_stock','reserved') then 'match'
            when sr.status = 'sold' then 'sold'
            when sr.branch_id is distinct from s.branch_id then 'other_branch'   -- อยู่ผิดที่มาก่อนสภาพ
            when sr.status in ('defective','scrapped','missing','returned') then 'not_sellable'
            else 'other_branch' end,
          'status', sr.status::text,
          'ref', case when sr.status='sold' then (select o.order_no from orders o where o.id=sr.sold_order_id)
                      when sr.branch_id is distinct from s.branch_id then (select b.name_th from branches b where b.id=sr.branch_id) end,
          'other_sku', case when sr.product_id <> l.product_id then (select p.sku from products p where p.id=sr.product_id) end)) c
        from unnest(coalesce(coalesce(l.count2_sns, l.count1_sns),'{}')) x(sn)
        left join lateral (select * from serials z where upper(trim(z.serial_no))=x.sn
          order by (z.product_id=l.product_id) desc, (z.branch_id=s.branch_id) desc, z.updated_at desc limit 1) sr on true
        union all
        select jsonb_build_object('sn', m, 'verdict', 'missing') from unnest(coalesce(l.missing_sns,'{}')) m
      ) t)
    where l.session_id=p_session and l.track_serial and not l.skipped;
    update pos_count_lines l set
      extra_sns = coalesce((select array_agg(e->>'sn' order by e->>'sn') from jsonb_array_elements(l.sn_check) e where e->>'verdict' not in ('match','missing')),'{}')
    where l.session_id=p_session and l.track_serial and not l.skipped;
    -- ผลต่าง SN = ค่าที่ขาดมากกว่า ระหว่าง (นับได้ − ระบบ) กับ −(SN หาย) · SN เกินไม่บวกเอง
    update pos_count_lines l set variance = least(l.variance, -cardinality(coalesce(l.missing_sns,'{}'))),
      variance_value = round(least(l.variance, -cardinality(coalesce(l.missing_sns,'{}'))) * l.unit_cost, 2)
    where l.session_id=p_session and l.track_serial and not l.skipped;
  end if;

  if not round2 then
    update pos_count_lines l set needs_recount = true
     where l.session_id=p_session and not l.skipped and (
       (l.variance <> 0 and abs(l.variance) > s.thr_qty)
       or (l.variance <> 0 and s.thr_pct > 0 and abs(l.variance) * 100 / greatest(abs(l.final_sys),1) > s.thr_pct)
       or (l.variance <> 0 and s.thr_value > 0 and abs(l.variance_value) > s.thr_value)
       or (l.track_serial and (cardinality(coalesce(l.missing_sns,'{}'))>0 or cardinality(coalesce(l.extra_sns,'{}'))>0)));
    get diagnostics recount_n = row_count;
  end if;

  if recount_n > 0 then
    update pos_count_sessions set status='recount', version=version+1 where id=p_session;
  else
    update pos_count_sessions set status='review', submitted_by=p_actor, submitted_at=now(), version=version+1 where id=p_session;
  end if;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, after_data)
  values ('stock_count', p_actor, s.branch_id, 'pos_count_sessions', s.id, s.count_no,
    jsonb_build_object('event', case when recount_n>0 then 'recount_required' else 'submitted' end, 'recount_lines', recount_n, 'round', case when round2 then 2 else 1 end,
      'sn_sold_present', (select count(*) from pos_count_lines l, jsonb_array_elements(coalesce(l.sn_check,'[]')) e where l.session_id=p_session and e->>'verdict'='sold')));
  return jsonb_build_object('status', case when recount_n>0 then 'recount' else 'review' end, 'recount', recount_n,
    'sn_summary', (select jsonb_object_agg(v, n) from (select e->>'verdict' v, count(*) n from pos_count_lines l, jsonb_array_elements(coalesce(l.sn_check,'[]')) e
      where l.session_id=p_session group by 1) z));
end $$;

-- API เขียนผลตรวจ SN จากคลังกลาง (service role เท่านั้น)
create or replace function public.pos_count_set_sn_check(p_session uuid, p_product uuid, p_check jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p_check) <> 'array' then raise exception 'count_invalid_sn_check'; end if;
  update pos_count_lines l set sn_check = p_check
   from pos_count_sessions s where s.id=l.session_id and l.session_id=p_session and l.product_id=p_product and s.status in ('counting','recount');
end $$;
revoke all on function public.pos_count_set_sn_check(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.pos_count_set_sn_check(uuid,uuid,jsonb) to service_role;
