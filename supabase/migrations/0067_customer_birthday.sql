-- 0067 · วันเกิดลูกค้าจากหน้าร้าน + กันโกงแต้มวันเกิด
--   • pos_customer_upsert รับ birth_date (ตรวจช่วงวันที่) · หน้าร้านตั้งได้ครั้งเดียว (ไม่เขียนทับของเดิม — แก้ได้ที่หลังบ้าน)
--   • customers.birth_date_set_at: เวลาที่ตั้ง/แก้วันเกิด (trigger) — กฎวันเกิดใช้ได้เมื่อวันเกิดอยู่ในระบบ ≥ 30 วัน
--     (กันสร้างลูกค้า/แก้วันเกิดเป็นวันนี้เพื่อรับแต้มวันเกิด) · ข้อมูลเดิม (null) ถือว่าผ่าน
alter table customers add column if not exists birth_date_set_at timestamptz;

create or replace function fn_customer_birthday_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.birth_date is not null then new.birth_date_set_at := now(); end if;
  elsif new.birth_date is distinct from old.birth_date then
    new.birth_date_set_at := case when new.birth_date is null then null else now() end;
  end if;
  return new;
end $$;
drop trigger if exists trg_customer_birthday_stamp on customers;
create trigger trg_customer_birthday_stamp before insert or update of birth_date on customers
  for each row execute function fn_customer_birthday_stamp();

create or replace function pos_customer_upsert(p_payload json)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_name text := btrim(coalesce(p_payload->>'name', ''));
  v_birth date;
  v_row customers%rowtype;
begin
  if v_name = '' then raise exception 'name required'; end if;
  begin v_birth := nullif(p_payload->>'birth_date', '')::date; exception when others then raise exception 'birth_date_invalid'; end;
  if v_birth is not null and (v_birth > (now() at time zone 'Asia/Bangkok')::date or v_birth < date '1900-01-01') then raise exception 'birth_date_invalid'; end if;
  if v_id is not null then
    insert into customers (id, name, phone, email, tax_id, tax_name, tax_address, source, first_branch_id, note, birth_date)
    values (v_id, v_name, nullif(p_payload->>'phone', ''), nullif(p_payload->>'email', ''), nullif(p_payload->>'tax_id', ''),
            nullif(p_payload->>'tax_name', ''), nullif(p_payload->>'tax_address', ''), nullif(p_payload->>'source', ''),
            nullif(p_payload->>'first_branch_id', '')::uuid, nullif(p_payload->>'note', ''), v_birth)
    on conflict (id) do update set
      name = excluded.name,
      phone = coalesce(excluded.phone, customers.phone),
      email = coalesce(excluded.email, customers.email),
      tax_id = coalesce(excluded.tax_id, customers.tax_id),
      tax_name = coalesce(excluded.tax_name, customers.tax_name),
      tax_address = coalesce(excluded.tax_address, customers.tax_address),
      note = coalesce(excluded.note, customers.note),
      birth_date = coalesce(customers.birth_date, excluded.birth_date),  -- หน้าร้านเติมได้ แต่ไม่เขียนทับ
      updated_at = now()
    returning * into v_row;
  else
    insert into customers (name, phone, email, tax_id, tax_name, tax_address, source, first_branch_id, note, birth_date)
    values (v_name, nullif(p_payload->>'phone', ''), nullif(p_payload->>'email', ''), nullif(p_payload->>'tax_id', ''),
            nullif(p_payload->>'tax_name', ''), nullif(p_payload->>'tax_address', ''), nullif(p_payload->>'source', ''),
            nullif(p_payload->>'first_branch_id', '')::uuid, nullif(p_payload->>'note', ''), v_birth)
    returning * into v_row;
  end if;
  return to_json(v_row);
end $$;

-- กฎวันเกิด: นับเฉพาะวันเกิดที่อยู่ในระบบ ≥ 30 วัน (ณ เวลาบิล)
do $$ declare d text;
  o text := $q$select birth_date into v_birth from customers where id = p_customer;$q$;
  n text := $q$select birth_date into v_birth from customers where id = p_customer and (birth_date_set_at is null or birth_date_set_at <= at_ts - interval '30 days');$q$;
begin
  d := pg_get_functiondef('pos_loyalty_calc(uuid,text,uuid,timestamptz,numeric,jsonb,integer,jsonb)'::regprocedure);
  if position(n in d) > 0 then return; end if;
  if position(o in d) = 0 then raise exception '0067: patch point not found'; end if;
  execute replace(d, o, n);
end $$;
revoke all on function pos_loyalty_calc(uuid,text,uuid,timestamptz,numeric,jsonb,integer,jsonb) from public, anon, authenticated;
