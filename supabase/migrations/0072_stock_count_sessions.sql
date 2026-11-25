-- 0072 · รอบตรวจนับสต๊อกฝั่งเซิร์ฟเวอร์ (UAT F055–F063)
--   F055 เปิดรอบ + ขอบเขต (ทั้งร้าน/หมวด/แบรนด์/เลือก SKU · โซน · ผู้รับผิดชอบ)
--   F056/F057 นับขาด/เกิน → ยังไม่แตะสต๊อกจนอนุมัติ · ผลต่างมีเอกสาร + มูลค่าตามต้นทุน
--   F058 ช่องว่าง ≠ 0 (null = ยังไม่นับ · ต้องนับหรือ "ข้าม" พร้อมเหตุผลก่อนส่ง)
--   F059 นับซ้ำเมื่อผลต่างเกินเกณฑ์ (จำนวน / % / มูลค่า) · รอบ 2 = ค่าสุดท้าย
--   F060 โหมด freeze: ห้ามเคลื่อนไหวสต๊อกของสินค้าในรอบ (กันตั้งแต่จองตะกร้า + ที่ ledger)
--   F061 โหมด cut-off: บันทึกยอดระบบ ณ วินาทีที่นับแต่ละรายการ → ผลต่าง = นับได้ − ยอดระบบตอนนับ
--         ปรับเข้าสต๊อกเป็นส่วนต่าง (ไม่ทับยอดปัจจุบัน) → การขายหลังนับไม่ถูกนับซ้ำ
--   F062 สินค้า SN นับด้วยการสแกน · กัน SN ซ้ำในรอบ · แยก SN หาย / SN เกิน (เกินไม่เพิ่มสต๊อกอัตโนมัติ)
--   F063 ยกเลิกรอบ = ปลด freeze · อนุมัติซ้ำไม่ปรับซ้ำ (idempotent) · ผู้อนุมัติต้องไม่ใช่ผู้นับ
--   สาขาที่ผูก OneWarehouse: นับ/อนุมัติได้เป็นรายงานผลต่าง แต่ไม่ปรับยอดใน POS (สต๊อกจริงอยู่ OW/JST)
alter type serial_status add value if not exists 'missing';

create table if not exists pos_count_sessions (
  id uuid primary key default gen_random_uuid(),
  count_no text not null unique,
  branch_id uuid not null references branches(id),
  scope_type text not null check (scope_type in ('full','opening','category','brand','products')),
  scope jsonb not null default '{}',
  zone text,
  mode text not null check (mode in ('freeze','cutoff')),
  blind boolean not null default true,
  thr_qty numeric not null default 0 check (thr_qty >= 0),
  thr_pct numeric not null default 0 check (thr_pct >= 0),
  thr_value numeric not null default 0 check (thr_value >= 0),
  recount_other boolean not null default true,   -- รอบนับซ้ำต้องเป็นคนละคนกับผู้นับรอบแรก
  status text not null default 'counting' check (status in ('counting','recount','review','approved','cancelled')),
  ow_linked boolean not null default false,
  posted boolean not null default false,
  assignees uuid[] not null default '{}',
  note text,
  created_by uuid not null references employees(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references employees(id), submitted_at timestamptz,
  approved_by uuid references employees(id), approved_at timestamptz,
  cancelled_by uuid references employees(id), cancelled_at timestamptz, cancel_reason text,
  result jsonb,
  version integer not null default 1
);
create index if not exists pos_count_sessions_branch on pos_count_sessions(branch_id, status, created_at desc);

create table if not exists pos_count_lines (
  session_id uuid not null references pos_count_sessions(id) on delete cascade,
  product_id uuid not null references products(id),
  sku text, name text,
  track_serial boolean not null default false,
  unit_cost numeric not null default 0,
  snapshot_qty numeric not null,
  expected_sns text[] not null default '{}',
  count1 numeric, count1_sns text[], count1_by uuid references employees(id), count1_at timestamptz, sys1 numeric,
  count2 numeric, count2_sns text[], count2_by uuid references employees(id), count2_at timestamptz, sys2 numeric,
  skipped boolean not null default false, skip_reason text,
  needs_recount boolean not null default false,
  final_qty numeric, final_sys numeric, variance numeric, variance_value numeric, posted_delta numeric,
  missing_sns text[], extra_sns text[],
  primary key (session_id, product_id)
);
create index if not exists pos_count_lines_product on pos_count_lines(product_id);

alter table pos_count_sessions enable row level security;
alter table pos_count_lines enable row level security;
revoke all on pos_count_sessions, pos_count_lines from anon, authenticated;

-- สินค้านี้อยู่ในรอบนับแบบ freeze ที่ยังไม่ปิดหรือไม่
create or replace function public.pos_count_frozen(p_branch uuid, p_product uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from pos_count_sessions s join pos_count_lines l on l.session_id=s.id
    where s.branch_id=p_branch and s.mode='freeze' and s.status in ('counting','recount','review') and l.product_id=p_product)
$$;

-- กันที่ ledger: ทุกการเคลื่อนไหว (ยกเว้นผลปรับจากการนับ) ของสินค้าที่ถูก freeze
create or replace function public.pos_count_freeze_guard_movement()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.type <> 'count_adjust' and pos_count_frozen(new.branch_id, new.product_id) then
    raise exception 'stock_frozen_for_count: %', (select sku from products where id=new.product_id);
  end if;
  return new;
end $$;
drop trigger if exists pos_count_freeze_movement on stock_movements;
create trigger pos_count_freeze_movement before insert on stock_movements for each row execute function pos_count_freeze_guard_movement();

-- กันตั้งแต่จองตะกร้า (ก่อนรับเงิน) — ไม่ให้ลูกค้าจ่ายแล้วตัดสต๊อกไม่ได้
create or replace function public.pos_count_freeze_guard_hold()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare pid uuid;
begin
  for pid in select distinct (i->>'product_id')::uuid from jsonb_array_elements(coalesce(new.quote->'items','[]'::jsonb)) i loop
    if pos_count_frozen(new.branch_id, pid) then
      raise exception 'stock_frozen_for_count: %', (select sku from products where id=pid);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists pos_count_freeze_hold on pos_checkout_holds;
create trigger pos_count_freeze_hold before insert on pos_checkout_holds for each row execute function pos_count_freeze_guard_hold();

-- ── เปิดรอบนับ ───────────────────────────────────────────────
create or replace function public.pos_count_open(p_actor uuid, p_branch uuid, p_scope_type text, p_scope jsonb, p_mode text,
  p_blind boolean, p_thr jsonb, p_note text, p_assignees uuid[])
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s pos_count_sessions; n int; pids uuid[]; clash text;
begin
  perform pos_assert_actor_active(p_actor);
  if p_mode not in ('freeze','cutoff') then raise exception 'count_invalid_mode'; end if;
  if p_scope_type not in ('full','opening','category','brand','products') then raise exception 'count_invalid_scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_branch::text,0));

  select array_agg(p.id order by p.sku) into pids from products p
   where p.is_stocked
     -- สินค้าปิดขายแล้วแต่ยังมีของในสาขา ต้องนับด้วย (ของยังอยู่จริง)
     and (p.is_active or p_scope_type='opening'
          or exists(select 1 from stock_levels sl0 where sl0.branch_id=p_branch and sl0.product_id=p.id and sl0.qty_on_hand<>0)
          or exists(select 1 from serials sr0 where sr0.branch_id=p_branch and sr0.product_id=p.id and sr0.status in ('in_stock','reserved')))
     and (p_scope_type not in ('category') or p.category_id = nullif(p_scope->>'category_id','')::uuid)
     and (p_scope_type not in ('brand') or p.brand_id = nullif(p_scope->>'brand_id','')::uuid)
     and (p_scope_type <> 'products' or p.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(p_scope->'product_ids','[]'::jsonb)) x))
     -- นับทั้งร้าน = สินค้าที่สาขานี้เคยมีสต๊อก/SN (นับเปิดระบบ = ทุกสินค้า)
     and (p_scope_type <> 'full' or exists(select 1 from stock_levels sl where sl.branch_id=p_branch and sl.product_id=p.id)
          or exists(select 1 from serials sr where sr.branch_id=p_branch and sr.product_id=p.id and sr.status in ('in_stock','reserved')));
  n := coalesce(array_length(pids,1),0);
  if n = 0 then raise exception 'count_empty_scope'; end if;
  if n > 5000 then raise exception 'count_scope_too_large'; end if;

  select s2.count_no into clash from pos_count_sessions s2 join pos_count_lines l on l.session_id=s2.id
   where s2.branch_id=p_branch and s2.status in ('counting','recount','review') and l.product_id = any(pids) limit 1;
  if clash is not null then raise exception 'count_overlap: %', clash; end if;

  if p_mode='freeze' and exists(select 1 from pos_checkout_holds h, lateral jsonb_array_elements(h.quote->'items') i
     where h.branch_id=p_branch and h.status='active' and (h.expires_at>now() or jsonb_array_length(h.recorded_payments)>0)
       and (i->>'product_id')::uuid = any(pids)) then
    raise exception 'count_has_active_checkout';
  end if;

  insert into pos_count_sessions(count_no, branch_id, scope_type, scope, zone, mode, blind, thr_qty, thr_pct, thr_value, recount_other, ow_linked, assignees, note, created_by)
  values (next_document_no('SC', 'stock_count:'||to_char(now() at time zone 'Asia/Bangkok','YYMMDD')), p_branch, p_scope_type, coalesce(p_scope,'{}'),
    nullif(trim(coalesce(p_scope->>'zone','')),''), p_mode, coalesce(p_blind,true),
    greatest(coalesce((p_thr->>'qty')::numeric,0),0), greatest(coalesce((p_thr->>'pct')::numeric,0),0), greatest(coalesce((p_thr->>'value')::numeric,0),0),
    coalesce((p_thr->>'recount_other')::boolean, true),
    exists(select 1 from pos_warehouse_links w where w.branch_id=p_branch), coalesce(p_assignees,'{}'), nullif(trim(coalesce(p_note,'')),''), p_actor)
  returning * into s;

  insert into pos_count_lines(session_id, product_id, sku, name, track_serial, unit_cost, snapshot_qty, expected_sns)
  select s.id, p.id, p.sku, p.name_th, p.track_serial, coalesce(p.cost,0),
    coalesce((select qty_on_hand from stock_levels sl where sl.branch_id=p_branch and sl.product_id=p.id),0),
    case when p.track_serial then coalesce((select array_agg(upper(trim(sr.serial_no)) order by sr.serial_no) from serials sr
      where sr.branch_id=p_branch and sr.product_id=p.id and sr.status in ('in_stock','reserved')),'{}') else '{}' end
  from products p where p.id = any(pids);

  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, after_data)
  values ('stock_count', p_actor, p_branch, 'pos_count_sessions', s.id, s.count_no,
    jsonb_build_object('event','open','scope_type',p_scope_type,'scope',p_scope,'mode',p_mode,'lines',n));
  return jsonb_build_object('id', s.id, 'count_no', s.count_no, 'lines', n, 'ow_linked', s.ow_linked);
end $$;

-- ── บันทึกยอดนับ (รอบ 1 หรือรอบนับซ้ำ) ──────────────────────
--   p_lines: [{product_id, qty: number|null, sns: [..]|null, skip: bool, skip_reason}]
create or replace function public.pos_count_record(p_actor uuid, p_session uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s pos_count_sessions; ln jsonb; l pos_count_lines; pid uuid; q numeric; sns text[]; sysq numeric; dup text; round2 boolean; done int := 0;
begin
  perform pos_assert_actor_active(p_actor);
  select * into s from pos_count_sessions where id=p_session for update;
  if not found then raise exception 'count_not_found'; end if;
  if s.status not in ('counting','recount') then raise exception 'count_wrong_status: %', s.status; end if;
  if cardinality(s.assignees) > 0 and not (p_actor = any(s.assignees) or p_actor = s.created_by) then raise exception 'count_not_assignee'; end if;
  round2 := s.status = 'recount';
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'count_invalid_lines'; end if;

  for ln in select value from jsonb_array_elements(p_lines) loop
    pid := (ln->>'product_id')::uuid;
    select * into l from pos_count_lines where session_id=p_session and product_id=pid for update;
    if not found then raise exception 'count_line_not_in_session'; end if;
    if round2 and not l.needs_recount then raise exception 'count_line_not_in_recount: %', l.sku; end if;
    if round2 and s.recount_other and l.count1_by = p_actor then raise exception 'recount_must_be_other_counter: %', l.sku; end if;

    if coalesce((ln->>'skip')::boolean,false) then
      if round2 then raise exception 'count_cannot_skip_recount'; end if;
      if length(trim(coalesce(ln->>'skip_reason',''))) < 3 then raise exception 'count_skip_reason_required'; end if;
      update pos_count_lines set skipped=true, skip_reason=trim(ln->>'skip_reason'), count1=null, count1_sns=null, count1_by=p_actor, count1_at=now(), sys1=null
       where session_id=p_session and product_id=pid;
      done := done + 1; continue;
    end if;

    sns := null; q := null;
    if l.track_serial then
      if ln ? 'sns' and jsonb_typeof(ln->'sns')='array' then
        select array_agg(v order by v) into sns from (select upper(trim(x)) v from jsonb_array_elements_text(ln->'sns') x where trim(x)<>'') t;
        sns := coalesce(sns,'{}');
        if (select count(*) from unnest(sns)) <> (select count(distinct x) from unnest(sns) x) then raise exception 'serial_duplicate_scan: %', l.sku; end if;
        -- SN เดียวกันห้ามถูกนับในสินค้าอื่นของรอบเดียวกัน
        select x into dup from unnest(sns) x where exists(select 1 from pos_count_lines o where o.session_id=p_session and o.product_id<>pid
          and x = any(coalesce(case when round2 and o.needs_recount then o.count2_sns else o.count1_sns end,'{}'))) limit 1;
        if dup is not null then raise exception 'serial_counted_twice: %', dup; end if;
        q := cardinality(sns);
      elsif ln->'qty' is not null and jsonb_typeof(ln->'qty')='number' then
        raise exception 'serial_scan_required: %', l.sku;
      end if;
    elsif ln->'qty' is not null and jsonb_typeof(ln->'qty')='number' then
      q := (ln->>'qty')::numeric;
      if q < 0 or q > 1000000 then raise exception 'count_invalid_qty: %', l.sku; end if;
    elsif ln ? 'qty' and jsonb_typeof(ln->'qty') not in ('null') then
      raise exception 'count_invalid_qty: %', l.sku;
    end if;

    -- ยอดระบบ ณ วินาทีที่นับ (cut-off รายบรรทัด)
    sysq := case when q is null then null else coalesce((select qty_on_hand from stock_levels where branch_id=s.branch_id and product_id=pid),0) end;
    if round2 then
      update pos_count_lines set count2=q, count2_sns=sns, count2_by=case when q is null then null else p_actor end, count2_at=case when q is null then null else now() end, sys2=sysq
       where session_id=p_session and product_id=pid;
    else
      update pos_count_lines set skipped=false, skip_reason=null, count1=q, count1_sns=sns, count1_by=case when q is null then null else p_actor end,
        count1_at=case when q is null then null else now() end, sys1=sysq
       where session_id=p_session and product_id=pid;
    end if;
    done := done + 1;
  end loop;
  update pos_count_sessions set version=version+1 where id=p_session;
  return jsonb_build_object('saved', done,
    'pending', (select count(*) from pos_count_lines where session_id=p_session and not skipped and
       (case when round2 then needs_recount and count2 is null else count1 is null end)));
end $$;

-- ── ส่งตรวจ: ตรวจครบ + คำนวณผลต่าง + ตัดสินนับซ้ำ ───────────
create or replace function public.pos_count_submit(p_actor uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s pos_count_sessions; pending int; recount_n int := 0; round2 boolean;
begin
  perform pos_assert_actor_active(p_actor);
  select * into s from pos_count_sessions where id=p_session for update;
  if not found then raise exception 'count_not_found'; end if;
  if s.status not in ('counting','recount') then raise exception 'count_wrong_status: %', s.status; end if;
  round2 := s.status='recount';
  select count(*) into pending from pos_count_lines where session_id=p_session and not skipped
    and (case when round2 then needs_recount and count2 is null else count1 is null end);
  if pending > 0 then raise exception 'count_incomplete: %', pending; end if;

  -- ผลต่าง = นับได้ − ยอดระบบตอนนับ · มูลค่าตามต้นทุนมาตรฐาน
  update pos_count_lines l set
    final_qty = coalesce(l.count2, l.count1),
    final_sys = case when l.count2 is not null then l.sys2 else l.sys1 end,
    variance = coalesce(l.count2, l.count1) - (case when l.count2 is not null then l.sys2 else l.sys1 end),
    variance_value = round((coalesce(l.count2, l.count1) - (case when l.count2 is not null then l.sys2 else l.sys1 end)) * l.unit_cost, 2)
  where l.session_id=p_session and not l.skipped;

  -- SN หาย/เกิน (เทียบ SN ที่ยังอยู่สาขาตอนนี้ · SN ที่ขาย/โอนออกหลังนับไม่นับเป็นหาย)
  update pos_count_lines l set
    missing_sns = coalesce((select array_agg(x order by x) from (select upper(trim(sr.serial_no)) x from serials sr
        where sr.branch_id=s.branch_id and sr.product_id=l.product_id and sr.status in ('in_stock','reserved')) a
        where not (x = any(coalesce(coalesce(l.count2_sns, l.count1_sns),'{}')))),'{}'),
    extra_sns = coalesce((select array_agg(x order by x) from unnest(coalesce(coalesce(l.count2_sns, l.count1_sns),'{}')) x
        where not (x = any(l.expected_sns)) and not exists(select 1 from serials sr where upper(trim(sr.serial_no))=x
          and sr.branch_id=s.branch_id and sr.product_id=l.product_id and sr.status in ('in_stock','reserved'))),'{}')
  where l.session_id=p_session and l.track_serial and not l.skipped;
  -- สินค้า SN: ผลต่าง = ค่าที่ "ขาดมากกว่า" ระหว่าง (นับได้ − ระบบ) กับ −(SN หาย)
  --   • SN เกินไม่บวกสต๊อกเอง (ต้องตรวจที่มา) → "หาย 1 เกิน 1" ไม่กลบกันเป็น 0
  --   • ยอดในระบบมากกว่า SN ที่รู้จัก (เช่น SN อยู่ที่คลังกลาง) → ส่วนขาดที่ไม่มี SN ก็ยังถูกรายงาน
  update pos_count_lines l set variance = least(l.variance, -cardinality(coalesce(l.missing_sns,'{}'))),
    variance_value = round(least(l.variance, -cardinality(coalesce(l.missing_sns,'{}'))) * l.unit_cost, 2)
  where l.session_id=p_session and l.track_serial and not l.skipped;

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
    jsonb_build_object('event', case when recount_n>0 then 'recount_required' else 'submitted' end, 'recount_lines', recount_n, 'round', case when round2 then 2 else 1 end));
  return jsonb_build_object('status', case when recount_n>0 then 'recount' else 'review' end, 'recount', recount_n);
end $$;

-- ── อนุมัติ + ปรับสต๊อก (ครั้งเดียว) ───────────────────────────
create or replace function public.pos_count_approve(p_actor uuid, p_session uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s pos_count_sessions; l pos_count_lines; cur numeric; delta numeric; sn text; sid uuid;
  plus numeric := 0; minus numeric := 0; vplus numeric := 0; vminus numeric := 0; adj int := 0; extras int := 0; res jsonb;
begin
  perform pos_assert_actor_active(p_actor);
  select * into s from pos_count_sessions where id=p_session for update;
  if not found then raise exception 'count_not_found'; end if;
  if s.status='approved' then return jsonb_build_object('duplicate', true, 'result', s.result); end if;
  if s.status <> 'review' then raise exception 'count_wrong_status: %', s.status; end if;
  if exists(select 1 from pos_count_lines where session_id=p_session and (count1_by=p_actor or count2_by=p_actor)) then
    raise exception 'approver_must_differ_from_counter';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('checkout:'||s.branch_id::text,0));

  for l in select * from pos_count_lines where session_id=p_session and not skipped order by sku loop
    if l.variance > 0 then plus := plus + l.variance; vplus := vplus + l.variance_value; elsif l.variance < 0 then minus := minus - l.variance; vminus := vminus - l.variance_value; end if;
    extras := extras + cardinality(coalesce(l.extra_sns,'{}'));
    if s.ow_linked then continue; end if;   -- สาขาผูก OW: รายงานผลต่างอย่างเดียว
    if l.track_serial then
      -- SN หาย → สถานะ missing + ตัดออกทีละชิ้น · SN เกิน → ไม่เพิ่มสต๊อกเอง (ต้องตรวจที่มา)
      delta := 0;
      foreach sn in array coalesce(l.missing_sns,'{}') loop
        select id into sid from serials where upper(trim(serial_no))=sn and branch_id=s.branch_id and product_id=l.product_id and status in ('in_stock','reserved') for update;
        if sid is null then continue; end if;
        update serials set status='missing', note=concat_ws(' · ', nullif(note,''), 'ไม่พบตอนนับ '||s.count_no), updated_at=now() where id=sid;
        perform apply_stock_movement(s.branch_id, l.product_id, 'count_adjust', -1, 'pos_count_sessions', s.id, s.count_no, p_actor, sid, l.unit_cost, 'นับไม่พบ SN '||sn);
        delta := delta - 1;
      end loop;
      -- ส่วนขาดที่ไม่มี SN ให้ระบุ (ยอดระบบเกินจำนวน SN ที่รู้จัก) → ตัดเป็นจำนวน
      if l.variance < delta then
        select coalesce(qty_on_hand,0) into cur from stock_levels where branch_id=s.branch_id and product_id=l.product_id for update;
        if coalesce(cur,0) + (l.variance - delta) < 0 then raise exception 'count_negative_result: %', l.sku; end if;
        perform apply_stock_movement(s.branch_id, l.product_id, 'count_adjust', l.variance - delta, 'pos_count_sessions', s.id, s.count_no, p_actor, null, l.unit_cost,
          'ผลนับ '||s.count_no||' ส่วนขาดที่ไม่มี SN ระบุ');
        delta := l.variance;
      end if;
    else
      delta := l.variance;
      if delta <> 0 then
        select coalesce(qty_on_hand,0) into cur from stock_levels where branch_id=s.branch_id and product_id=l.product_id for update;
        if coalesce(cur,0) + delta < 0 then raise exception 'count_negative_result: %', l.sku; end if;
        perform apply_stock_movement(s.branch_id, l.product_id, 'count_adjust', delta, 'pos_count_sessions', s.id, s.count_no, p_actor, null, l.unit_cost,
          'ผลนับ '||s.count_no||' (นับ '||l.final_qty||' / ระบบ '||l.final_sys||')');
      end if;
    end if;
    if delta <> 0 then adj := adj + 1; end if;
    update pos_count_lines set posted_delta=delta where session_id=p_session and product_id=l.product_id;
    update stock_levels set last_counted_at=now() where branch_id=s.branch_id and product_id=l.product_id;
  end loop;

  res := jsonb_build_object('adjusted_lines', adj, 'qty_plus', plus, 'qty_minus', minus, 'value_plus', vplus, 'value_minus', vminus,
    'extra_sns', extras, 'posted', not s.ow_linked, 'note', nullif(trim(coalesce(p_note,'')),''));
  update pos_count_sessions set status='approved', posted = not s.ow_linked, approved_by=p_actor, approved_at=now(), result=res, version=version+1 where id=p_session;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, amount, after_data)
  values ('stock_count', p_actor, s.branch_id, 'pos_count_sessions', s.id, s.count_no, vplus - vminus, jsonb_build_object('event','approved') || res);
  return jsonb_build_object('approved', true, 'result', res);
end $$;

-- ── ยกเลิกรอบ (ปลด freeze · ไม่แตะสต๊อก) ─────────────────────
create or replace function public.pos_count_cancel(p_actor uuid, p_session uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s pos_count_sessions;
begin
  perform pos_assert_actor_active(p_actor);
  select * into s from pos_count_sessions where id=p_session for update;
  if not found then raise exception 'count_not_found'; end if;
  if s.status='cancelled' then return jsonb_build_object('duplicate', true); end if;
  if s.status='approved' then raise exception 'count_already_posted'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'count_cancel_reason_required'; end if;
  update pos_count_sessions set status='cancelled', cancelled_by=p_actor, cancelled_at=now(), cancel_reason=trim(p_reason), version=version+1 where id=p_session;
  insert into audit_logs(action, actor_id, branch_id, ref_table, ref_id, ref_no, after_data)
  values ('stock_count', p_actor, s.branch_id, 'pos_count_sessions', s.id, s.count_no, jsonb_build_object('event','cancelled','reason',trim(p_reason)));
  return jsonb_build_object('cancelled', true);
end $$;

revoke all on function public.pos_count_frozen(uuid,uuid), public.pos_count_freeze_guard_movement(), public.pos_count_freeze_guard_hold(),
  public.pos_count_open(uuid,uuid,text,jsonb,text,boolean,jsonb,text,uuid[]), public.pos_count_record(uuid,uuid,jsonb),
  public.pos_count_submit(uuid,uuid), public.pos_count_approve(uuid,uuid,text), public.pos_count_cancel(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.pos_count_open(uuid,uuid,text,jsonb,text,boolean,jsonb,text,uuid[]), public.pos_count_record(uuid,uuid,jsonb),
  public.pos_count_submit(uuid,uuid), public.pos_count_approve(uuid,uuid,text), public.pos_count_cancel(uuid,uuid,text) to service_role;
