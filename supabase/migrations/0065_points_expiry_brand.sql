-- 0065 · แต้มหมดอายุ: แยกตามแบรนด์ + กระเป๋าแบรนด์ตรง + ดูแต้มใกล้หมดอายุ
--   เดิม expire_points_one ตัดแค่ customers.points (กระเป๋าแบรนด์ค้างยอดเก่า) และไม่มีตัวรันอัตโนมัติ (ไม่มี pg_cron)
--   • loyalty_open_lots(customer): ก้อนแต้มที่ยังเหลือ (FIFO ตามเวลาได้รับ แยกแบรนด์) — สูตรเดียวใช้ทั้งตัดหมดอายุและแจ้งใกล้หมด
--   • expire_points_one: ล็อกลูกค้า → ตัดต่อแบรนด์ + ledger รายการ expire มี brand_id
--   • pos_points_expiring(customer, days): แต้มที่จะหมดใน N วัน (รวม + ก้อนแรกที่จะหมด + รายแบรนด์)
--   • ตัวรันรายวันอยู่ในลูปของเซิร์ฟเวอร์ (instrumentation) · บันทึก audit 'points_expire_run' กันรันซ้ำวันเดียวกัน
create or replace function loyalty_open_lots(p_cust uuid)
returns table(brand_id uuid, remaining integer, expires_at timestamptz, earned_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare g record; r record; amt bigint[]; ex timestamptz[]; at timestamptz[]; bid uuid[]; head int; need bigint; take bigint; i int;
begin
  for g in select distinct l.brand_id as b from loyalty_ledger l where l.customer_id = p_cust loop
    amt := '{}'; ex := '{}'; at := '{}'; head := 1;
    for r in select l.points_delta, coalesce(l.expires_at, 'infinity'::timestamptz) e, l.created_at
               from loyalty_ledger l where l.customer_id = p_cust and l.brand_id is not distinct from g.b and l.points_delta <> 0
              order by l.created_at, l.id loop
      if r.points_delta > 0 then
        amt := amt || r.points_delta::bigint; ex := ex || r.e; at := at || r.created_at;
      else
        need := -r.points_delta;
        while need > 0 and head <= coalesce(array_length(amt, 1), 0) loop
          take := least(need, amt[head]); amt[head] := amt[head] - take; need := need - take;
          if amt[head] = 0 then head := head + 1; end if;
        end loop;
      end if;
    end loop;
    i := head;
    while i <= coalesce(array_length(amt, 1), 0) loop
      if amt[i] > 0 then
        brand_id := g.b; remaining := amt[i]::int; expires_at := nullif(ex[i], 'infinity'::timestamptz); earned_at := at[i];
        return next;
      end if;
      i := i + 1;
    end loop;
  end loop;
end $$;

create or replace function expire_points_one(p_cust uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare b record; v_bal int; v_bw int; total int := 0;
begin
  perform 1 from customers where id = p_cust for update;  -- กันรันซ้อน (ตัดซ้ำ)
  for b in select l.brand_id, sum(l.remaining)::int amt from loyalty_open_lots(p_cust) l
            where l.expires_at is not null and l.expires_at < now() group by l.brand_id loop
    v_bw := null;
    update customers set points = greatest(points - b.amt, 0), updated_at = now() where id = p_cust returning points into v_bal;
    if b.brand_id is not null then
      update brand_wallets set points = greatest(points - b.amt, 0), updated_at = now()
       where customer_id = p_cust and brand_id = b.brand_id returning points into v_bw;
    end if;
    insert into loyalty_ledger(customer_id, brand_id, kind, points_delta, balance_points, note)
    values (p_cust, b.brand_id, 'expire', -b.amt, coalesce(v_bw, v_bal), 'แต้มหมดอายุ');
    total := total + b.amt;
  end loop;
  return total;
end $$;

create or replace function expire_points(p_customer_id uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cust uuid; v_total int := 0;
begin
  for v_cust in select distinct customer_id from loyalty_ledger
                 where points_delta > 0 and expires_at is not null and expires_at < now()
                   and (p_customer_id is null or customer_id = p_customer_id) loop
    v_total := v_total + expire_points_one(v_cust);
  end loop;
  return v_total;
end $$;

create or replace function pos_points_expiring(p_cust uuid, p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with lots as (select * from loyalty_open_lots(p_cust) l where l.expires_at is not null and l.expires_at < now() + make_interval(days => greatest(p_days, 0)))
  select jsonb_build_object(
    'total', coalesce((select sum(remaining) from lots), 0),
    'next_at', (select min(expires_at) from lots),
    'next_points', coalesce((select sum(remaining) from lots where expires_at = (select min(expires_at) from lots)), 0),
    'by_brand', coalesce((select jsonb_agg(jsonb_build_object('brand_id', brand_id, 'points', pts, 'next_at', nx)) from
                 (select brand_id, sum(remaining) pts, min(expires_at) nx from lots group by brand_id) s), '[]'::jsonb))
$$;

revoke all on function loyalty_open_lots(uuid), expire_points_one(uuid), expire_points(uuid), pos_points_expiring(uuid, integer) from public, anon, authenticated;

-- ตัวรันรายวัน (เรียกจากเซิร์ฟเวอร์ทุก ~30 นาที) — วันละครั้งตามเวลาไทย · หลายอินสแตนซ์พร้อมกันปลอดภัย (advisory lock + audit ของวันนี้)
create or replace function pos_daily_points_expiry()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare today date := (now() at time zone 'Asia/Bangkok')::date; n int;
begin
  perform pg_advisory_xact_lock(hashtext('pos_daily_points_expiry'));
  if exists (select 1 from audit_logs where action = 'points_expire_run' and after_data->>'day' = today::text) then
    return jsonb_build_object('ran', false, 'day', today);
  end if;
  n := expire_points(null);
  insert into audit_logs(action, amount, after_data) values ('points_expire_run', n, jsonb_build_object('day', today, 'points', n));
  return jsonb_build_object('ran', true, 'day', today, 'points', n);
end $$;
revoke all on function pos_daily_points_expiry() from public, anon, authenticated;

-- รายงาน: ลูกค้าที่มีแต้มจะหมดอายุใน N วัน (เรียงตามวันหมด) — ให้ทีมการตลาดติดต่อชวนใช้แต้ม (สิทธิ์ loyalty.manage ที่ API)
create or replace function pos_points_expiring_report(p_days integer default 30, p_brand uuid default null, p_limit integer default 500)
returns table(customer_id uuid, name text, phone text, points integer, expiring integer, next_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.name, c.phone, c.points, x.pts::int, x.nx
    from (select distinct l.customer_id from loyalty_ledger l
           where l.points_delta > 0 and l.expires_at is not null and l.expires_at < now() + make_interval(days => greatest(p_days, 0))
             and (p_brand is null or l.brand_id = p_brand)) cand
    cross join lateral (select sum(o.remaining) pts, min(o.expires_at) nx from loyalty_open_lots(cand.customer_id) o
                         where o.expires_at is not null and o.expires_at < now() + make_interval(days => greatest(p_days, 0))
                           and (p_brand is null or o.brand_id = p_brand)) x
    join customers c on c.id = cand.customer_id
   where x.pts > 0
   order by x.nx, x.pts desc
   limit least(greatest(p_limit, 1), 5000)
$$;
revoke all on function pos_points_expiring_report(integer, uuid, integer) from public, anon, authenticated;
