-- 0080 · ทะเบียนเครื่อง EDC จริง (สาขา → เครื่อง → MID ต่อบริการ/แผนผ่อน) + อัตรา MDR + ผูกการรับชำระกับเครื่อง
--   • เก็บเลข MID/TID เต็ม (เจ้าของอนุญาต 2026-11-26) — อ่าน/แก้ผ่าน API ฝั่งเซิร์ฟเวอร์เท่านั้น (สิทธิ์ edc.manage) · หน้าจอทั่วไปเห็นแบบมาสก์
--   • อัตรา MDR ให้เจ้าของ/ฝ่ายบัญชีกรอกเอง (สิทธิ์ edc.mdr_manage) มีวันมีผล — ค่าธรรมเนียมคำนวณตอนรับชำระ แล้วบันทึกลง order_payments.fee_amount
--   • order_payments + edc_terminal_id/tid → ใบเสร็จ/รายงานรู้ว่ารูดเครื่องไหน MID/TID อะไร (สำหรับจับคู่ statement ธนาคาร)
create table if not exists pos_edc_terminals (
  id uuid primary key default gen_random_uuid(),
  acquirer text not null check (acquirer in ('SCB','KBANK','UOB','KRUNGSRI','CARDX','BBL','KTB','TTB','OTHER')),
  branch_id uuid references branches(id),           -- null = เครื่องกลาง/อีเวนต์ (ใช้ได้หลายสาขา)
  label text,                                       -- ชื่อเรียก/ชื่อตามไฟล์ธนาคาร
  tid text not null check (tid ~ '^[0-9A-Za-z-]{4,32}$'),
  status text not null default 'active' check (status in ('active','spare','repair','no_txn','retired')),
  replaced_by uuid references pos_edc_terminals(id),
  shared_note text,                                 -- เช่น ใช้ร่วม 70mai/Anker ในงานอีเวนต์
  sim_no text,
  sim_monthly_fee numeric(10,2) check (sim_monthly_fee is null or sim_monthly_fee >= 0),
  note text,
  verified boolean not null default false,
  verified_by uuid references employees(id),
  verified_at timestamptz,
  source text,                                      -- manual | import:<ชื่อไฟล์>
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid references employees(id),
  updated_at timestamptz not null default now(),
  unique (acquirer, tid)
);
create index if not exists pos_edc_terminals_branch on pos_edc_terminals(branch_id) where status = 'active';

create table if not exists pos_edc_mids (
  id uuid primary key default gen_random_uuid(),
  terminal_id uuid not null references pos_edc_terminals(id) on delete cascade,
  service text not null check (service in ('card','debit','unionpay','alipay','wechat','thqr','qr_credit','promptpay','installment','other')),
  installment_months int not null default 0 check (installment_months = 0 or installment_months in (3,4,6,9,10,12,18,24,36)),
  mid text not null check (mid ~ '^[0-9A-Za-z-]{4,32}$'),
  tid text check (tid is null or tid ~ '^[0-9A-Za-z-]{4,32}$'),  -- TID เฉพาะแผน (UOB ผ่อนแยก TID) · null = ใช้ TID ของเครื่อง
  merchant_no text,
  note text,
  created_at timestamptz not null default now(),
  check ((service = 'installment') = (installment_months > 0)),
  unique (terminal_id, service, installment_months)
);

create table if not exists pos_mdr_rates (
  id uuid primary key default gen_random_uuid(),
  acquirer text not null check (acquirer in ('SCB','KBANK','UOB','KRUNGSRI','CARDX','BBL','KTB','TTB','OTHER')),
  service text not null check (service in ('card','debit','unionpay','alipay','wechat','thqr','qr_credit','promptpay','installment','other')),
  card_type text not null default 'all' check (card_type in ('all','visa','mastercard','jcb','amex','unionpay','debit','local')),
  installment_months int not null default 0,
  rate_pct numeric(7,4) not null check (rate_pct >= 0 and rate_pct <= 20),
  fixed_fee numeric(10,2) not null default 0 check (fixed_fee >= 0),
  vat_on_fee boolean not null default true,         -- ธนาคารคิด VAT 7% บนค่าธรรมเนียม
  effective_from date not null default current_date,
  effective_to date,
  note text,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  ended_by uuid references employees(id),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists pos_mdr_rates_lookup on pos_mdr_rates(acquirer, service, installment_months, effective_from desc);

alter table pos_edc_terminals enable row level security;
alter table pos_edc_mids enable row level security;
alter table pos_mdr_rates enable row level security;
revoke all on pos_edc_terminals, pos_edc_mids, pos_mdr_rates from anon, authenticated;

-- อัตราที่มีผล ณ วันที่ (เฉพาะประเภทบัตรก่อน แล้วค่อย 'all')
create or replace function pos_mdr_rate_for(p_acquirer text, p_service text, p_months int, p_card_type text, p_on date)
returns pos_mdr_rates language sql stable set search_path = public as $$
  select r.* from pos_mdr_rates r
   where r.acquirer = p_acquirer and r.service = p_service and r.installment_months = coalesce(p_months, 0)
     and r.card_type in (coalesce(p_card_type, 'all'), 'all')
     and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
   order by (r.card_type = coalesce(p_card_type, 'all')) desc, r.effective_from desc, r.created_at desc
   limit 1;
$$;
revoke all on function pos_mdr_rate_for(text,text,int,text,date) from public, anon, authenticated;

-- การรับชำระผูกเครื่อง/TID
alter table order_payments add column if not exists edc_terminal_id uuid references pos_edc_terminals(id);
alter table order_payments add column if not exists tid text;

-- ให้ฟังก์ชันสร้างบิลบันทึก edc_terminal_id + tid ด้วย (แก้เฉพาะคำสั่ง insert order_payments — ส่วนอื่นคงเดิม)
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pos_create_order_internal';
  if v_def is null then raise exception 'pos_create_order_internal not found'; end if;
  if position('edc_terminal_id' in v_def) > 0 then return; end if;   -- ทำไปแล้ว
  v_new := replace(v_def,
    'approval_code, mid, reference_no, installment_months, fee_amount)',
    'approval_code, mid, reference_no, installment_months, fee_amount, edc_terminal_id, tid)');
  v_new := replace(v_new,
    'coalesce((v_pay->>''fee_amount'')::numeric, 0));',
    'coalesce((v_pay->>''fee_amount'')::numeric, 0), nullif(v_pay->>''edc_terminal_id'','''')::uuid, nullif(v_pay->>''tid'',''''));');
  if v_new = v_def or position('edc_terminal_id' in v_new) = 0 or position('nullif(v_pay->>''tid''' in v_new) = 0 then
    raise exception 'patch pos_create_order_internal: pattern not found';
  end if;
  execute v_new;
end $$;
