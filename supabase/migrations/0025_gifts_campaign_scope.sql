-- =====================================================================
-- SHD POS — 0025_gifts_campaign_scope.sql
-- (A) ของแถม: บันทึกว่ารายการใดเป็นของแถม + ที่มา (แคมเปญ/ชุดขาย/พนักงาน)
--     ของแถมเป็น "สินค้าจริง" ราคาเรียกเก็บ 0 แต่ยังมีต้นทุน + ตัดสต๊อก
--     (ต้นทุน/กำไร/ตัดสต๊อก ทำผ่าน cost_total/gross_profit + product_id เดิม)
-- (B) แคมเปญ v2: ขอบเขต (แบรนด์/สาขา/ช่องทาง) + เลือกสินค้าร่วมรายการ (SKU)
--     + รูปแบบสิทธิ์ (ลด/ของแถม) — ตั้งค่าได้ รอ runtime ที่ POS เฟสถัดไป
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A) ของแถมในบิล
-- ---------------------------------------------------------------------
alter table order_items add column if not exists is_gift boolean not null default false;
alter table order_items add column if not exists gift_source text;          -- campaign | bundle | manual
alter table order_items add column if not exists gift_campaign_id uuid references campaigns(id) on delete set null;
alter table order_items add column if not exists gift_of_sku text;          -- แถมจากสินค้าตัวไหน (ถ้ามี)

-- ---------------------------------------------------------------------
-- (B) ขอบเขต + รูปแบบสิทธิ์ของแคมเปญ
-- ---------------------------------------------------------------------
alter table campaigns add column if not exists brand_ids uuid[] not null default '{}';
alter table campaigns add column if not exists branch_ids uuid[] not null default '{}';
alter table campaigns add column if not exists channels text[] not null default '{}';
alter table campaigns add column if not exists is_automatic boolean not null default false;   -- true = โปรอัตโนมัติ (ไม่ต้องกรอกรหัส)
alter table campaigns add column if not exists promo_type text not null default 'discount';   -- discount | gift
-- เงื่อนไขสินค้าร่วมรายการ
alter table campaigns add column if not exists eligible_scope text not null default 'all';     -- all | selected
alter table campaigns add column if not exists eligible_min_qty int;                           -- จำนวนขั้นต่ำของสินค้าร่วมรายการ
alter table campaigns add column if not exists eligible_across_sku boolean not null default true; -- นับรวมข้าม SKU ได้ไหม
-- ของแถม
alter table campaigns add column if not exists gift_mode text;                                 -- per_bill | per_item
alter table campaigns add column if not exists gift_per_qty int default 1;                      -- per_item: ซื้อร่วมรายการทุกกี่ชิ้น ได้แถม 1 ชุด
alter table campaigns add column if not exists gift_cap int;                                    -- เพดานจำนวนชุดของแถมต่อบิล

-- สินค้าที่ผูกกับแคมเปญ: role = eligible (ร่วมรายการ) | gift (ของแถม)
create table if not exists campaign_products (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  sku         text not null,
  name        text,
  role        text not null default 'eligible',   -- eligible | gift
  gift_qty    int not null default 1,              -- จำนวนต่อชุด (เฉพาะ role=gift)
  created_at  timestamptz not null default now()
);
create index if not exists idx_campaign_products on campaign_products(campaign_id, role);
alter table campaign_products enable row level security;

-- อ่านรายการสินค้าแคมเปญ (ให้ POS/แอดมินผ่าน anon ได้ เพื่อประเมินสิทธิ์)
create or replace function pos_campaign_products(p_campaign_id uuid)
returns setof json language sql security definer set search_path = public, extensions as $$
  select to_json(x) from (
    select id, campaign_id, product_id, sku, name, role, gift_qty
    from campaign_products where campaign_id = p_campaign_id order by role, sku
  ) x;
$$;
revoke all on function pos_campaign_products(uuid) from public;
grant execute on function pos_campaign_products(uuid) to anon, authenticated;
