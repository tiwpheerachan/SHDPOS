-- 0064 · กฎแต้มช่วงเวลาข้ามเที่ยงคืน (เช่น 22:00–02:00) เดิมไม่เคยทำงาน (ต้องทั้ง ≥22:00 และ <02:00 พร้อมกัน)
--   time_from > time_to = ช่วงข้ามคืน → ตรงเมื่อ ≥ time_from หรือ < time_to · วันในสัปดาห์ยังนับตามวันของเวลาบิล
do $$ declare d text;
  o text := $q$and (time_from is null or lt::time >= time_from) and (time_to is null or lt::time < time_to)$q$;
  n text := $q$and (case when time_from is not null and time_to is not null and time_from > time_to
                  then lt::time >= time_from or lt::time < time_to
                  else (time_from is null or lt::time >= time_from) and (time_to is null or lt::time < time_to) end)$q$;
begin
  d := pg_get_functiondef('pos_loyalty_calc(uuid,text,uuid,timestamptz,numeric,jsonb,integer)'::regprocedure);
  if position(n in d) > 0 then return; end if;
  if position(o in d) = 0 then raise exception '0064: patch point not found in pos_loyalty_calc'; end if;
  execute replace(d, o, n);
end $$;
revoke all on function pos_loyalty_calc(uuid,text,uuid,timestamptz,numeric,jsonb,integer) from public, anon, authenticated;
