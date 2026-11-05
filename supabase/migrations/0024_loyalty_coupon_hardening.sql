-- =====================================================================
-- SHD POS — 0024_loyalty_coupon_hardening.sql
-- ทำให้การใช้แต้ม/คูปอง "ถูกต้องครบวงจร" ปลอดภัย กันหักซ้ำ
--   • หักแต้ม/คูปอง เฉพาะเมื่อ "บิลเข้าระบบแล้ว" (หาไม่เจอ → raise ให้ retry)
--   • กันซ้ำถาวรด้วยการผูกกับ order_id (ไม่ใช่แค่ client_uuid)
--   • หักแต้มไม่เกินยอดคงเหลือ (lock row) — กันติดลบ/ใช้ซ้ำหลายเครื่อง
--   • คูปอง: ตรวจเงื่อนไขซ้ำบนเซิร์ฟเวอร์ + คิดส่วนลดจากกติกาจริง (ไม่เชื่อหน้าจอ)
--   • ยกเลิก/คืนบิล → คืนสิทธิ์คูปอง (ลบ redemption) ให้โควตากลับมา
-- =====================================================================

-- ---------------------------------------------------------------------
-- หักแต้ม (redeem) — ปลอดภัย: ต้องมีบิลก่อน, กันซ้ำด้วย order_id, ไม่หักเกิน
-- ---------------------------------------------------------------------
create or replace function public.pos_redeem_points(
  p_customer_id uuid,
  p_points      int,
  p_client_uuid uuid,
  p_note        text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order_id uuid; v_order_no text; v_branch uuid;
  v_cur int; v_take int; v_bal int;
begin
  if p_customer_id is null or coalesce(p_points, 0) <= 0 then
    return json_build_object('ok', false, 'reason', 'noop');
  end if;

  select id, order_no, branch_id into v_order_id, v_order_no, v_branch
    from orders where client_uuid = p_client_uuid;
  if v_order_id is null then
    -- บิลยังไม่เข้า (create_order ยังไม่สำเร็จ) → โยน error ให้ตัวซิงก์ลองใหม่ภายหลัง
    raise exception 'order % not synced yet', p_client_uuid;
  end if;

  -- กันซ้ำถาวร: บิลนี้เคยหักแต้มแล้วหรือยัง
  if exists (select 1 from loyalty_ledger where order_id = v_order_id and kind = 'redeem') then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  select points into v_cur from customers where id = p_customer_id for update;
  if not found then raise exception 'customer not found'; end if;

  v_take := least(p_points, greatest(v_cur, 0));   -- ไม่หักเกินที่มีจริง
  update customers set points = points - v_take, updated_at = now()
    where id = p_customer_id returning points into v_bal;
  insert into loyalty_ledger(customer_id, order_id, branch_id, kind, points_delta, balance_points, note)
    values (p_customer_id, v_order_id, v_branch, 'redeem', -v_take, v_bal,
            coalesce(p_note, 'ใช้แต้มเป็นส่วนลดบิล ' || coalesce(v_order_no, '')));

  return json_build_object('ok', true, 'redeemed', v_take, 'balance_points', v_bal);
end;
$$;
revoke all on function public.pos_redeem_points(uuid, int, uuid, text) from public;
grant execute on function public.pos_redeem_points(uuid, int, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- บันทึกการใช้คูปอง — ตรวจกติกาซ้ำบนเซิร์ฟเวอร์ + คิดส่วนลดจากของจริง
-- ---------------------------------------------------------------------
create or replace function public.pos_redeem_coupon(p_code text, p_customer_id uuid, p_client_uuid uuid, p_discount numeric)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c          campaigns%rowtype;
  v_order_id uuid; v_subtotal numeric; v_total numeric;
  v_valid    json; v_disc numeric;
begin
  select * into c from campaigns where upper(code) = upper(btrim(p_code)) and active limit 1;
  if not found then return json_build_object('ok', false, 'reason', 'not found'); end if;

  select id, subtotal, grand_total into v_order_id, v_subtotal, v_total
    from orders where client_uuid = p_client_uuid;
  if v_order_id is null then
    raise exception 'order % not synced yet', p_client_uuid;
  end if;

  -- กันซ้ำ: บิลนี้เคยใช้คูปองนี้แล้ว
  if exists (select 1 from coupon_redemptions where campaign_id = c.id and client_uuid = p_client_uuid) then
    return json_build_object('ok', true, 'duplicate', true);
  end if;

  -- ตรวจกติกาซ้ำจาก subtotal จริงของบิล + คิดส่วนลดจากกติกา (ไม่เชื่อค่าหน้าจอ)
  v_valid := pos_validate_coupon(c.code, p_customer_id, v_subtotal);
  if (v_valid->>'valid')::boolean then
    v_disc := (v_valid->>'discount')::numeric;
  else
    -- ขายไปแล้ว บันทึกตามจริง (cap ไม่เกิน subtotal) เพื่อวัดผลไม่ให้ค้าง
    v_disc := least(coalesce(p_discount, 0), coalesce(v_subtotal, 0));
  end if;

  insert into coupon_redemptions(campaign_id, customer_id, order_id, client_uuid, discount_amount, order_total)
    values (c.id, p_customer_id, v_order_id, p_client_uuid, v_disc, v_total);

  return json_build_object('ok', true, 'discount', v_disc);
end;
$$;
revoke all on function public.pos_redeem_coupon(text, uuid, uuid, numeric) from public;
grant execute on function public.pos_redeem_coupon(text, uuid, uuid, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------
-- ยกเลิก/คืนบิล → คืนแต้ม+เครดิต (เดิม) + คืนสิทธิ์คูปอง (เพิ่ม)
-- ---------------------------------------------------------------------
create or replace function fn_loyalty_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_earn int; v_bal int; v_sum_pts int; v_sum_cr numeric;
begin
  if TG_OP = 'INSERT' then
    if NEW.customer_id is not null and NEW.status = 'completed' then
      v_earn := floor(coalesce(NEW.grand_total, 0) / 20.0);
      if v_earn > 0 then
        update customers set points = points + v_earn, updated_at = now()
          where id = NEW.customer_id returning points into v_bal;
        insert into loyalty_ledger(customer_id, order_id, branch_id, kind, points_delta, balance_points, note, expires_at)
          values (NEW.customer_id, NEW.id, NEW.branch_id, 'earn', v_earn, v_bal,
                  'ได้แต้มจากการซื้อ ' || NEW.order_no, now() + interval '12 months');
      end if;
    end if;
    return NEW;
  end if;

  if TG_OP = 'UPDATE'
     and OLD.status is distinct from NEW.status
     and NEW.status in ('voided', 'refunded') then
    -- คืนแต้ม/เครดิต (รวมถึงย้อนแต้มที่ใช้ redeem เพราะ sum ครอบคลุมทุกแถวของบิล)
    if NEW.customer_id is not null then
      select coalesce(sum(points_delta), 0), coalesce(sum(credit_delta), 0)
        into v_sum_pts, v_sum_cr
        from loyalty_ledger where order_id = NEW.id;
      if v_sum_pts <> 0 or v_sum_cr <> 0 then
        update customers
          set points = points - v_sum_pts, store_credit = store_credit - v_sum_cr, updated_at = now()
          where id = NEW.customer_id returning points into v_bal;
        insert into loyalty_ledger(customer_id, order_id, branch_id, kind, points_delta, credit_delta, balance_points, note)
          values (NEW.customer_id, NEW.id, NEW.branch_id, 'reverse', -v_sum_pts, -v_sum_cr, v_bal,
                  'ยกเลิก/คืนบิล ' || NEW.order_no);
      end if;
    end if;
    -- คืนสิทธิ์คูปอง → โควตากลับมาใช้ได้
    delete from coupon_redemptions where order_id = NEW.id;
  end if;
  return NEW;
end;
$$;
