-- =====================================================================
-- SHD POS — seed.sql
-- ข้อมูลตั้งต้น: permission matrix, แบรนด์, สาขาจริง 29 สาขา,
-- หมวดสินค้า, สินค้าตัวอย่าง, พนักงานตัวอย่าง, เครื่อง POS, settings
--
-- NOTE: รายการสาขา/แบรนด์อ้างอิงจากไฟล์ยอดขาย offline ปี 2024 ที่ส่งมา
--       (98,445 บรรทัด / 4 แบรนด์ / 29 สาขา / 293 พนักงาน / 1,250 SKU)
--       ส่วนสินค้าจริงให้ import จากฐานข้อมูลภายหลัง — ที่นี่ใส่เป็นตัวอย่าง
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PERMISSIONS
-- ---------------------------------------------------------------------
insert into permissions(key, module, label_th, label_en, label_zh, is_sensitive) values
  ('pos.sell',              'pos',       'ขายสินค้า',                 'Sell',                  '销售',       false),
  ('pos.discount',          'pos',       'ให้ส่วนลด',                 'Discount',              '折扣',       false),
  ('pos.price_override',    'pos',       'แก้ราคาขาย',                'Price override',        '改价',       true),
  ('pos.void',              'pos',       'ยกเลิกบิล',                 'Void order',            '作废订单',    true),
  ('pos.reprint',           'pos',       'พิมพ์สลิปซ้ำ',               'Reprint receipt',       '重打小票',    false),
  ('pos.open_drawer',       'pos',       'เปิดลิ้นชักเงินสด',           'Open cash drawer',      '开钱箱',      true),
  ('pos.quotation',         'pos',       'ออกใบเสนอราคา',              'Quotation',             '报价单',      false),
  ('return.create',         'returns',   'รับคืน/เปลี่ยนสินค้า',        'Return / Exchange',     '退换货',      false),
  ('return.approve',        'returns',   'อนุมัติการคืนสินค้า',         'Approve return',        '审批退货',    true),
  ('inventory.view',        'inventory', 'ดูสต๊อก',                    'View stock',            '查看库存',    false),
  ('inventory.adjust',      'inventory', 'ปรับสต๊อก',                  'Adjust stock',          '库存调整',    true),
  ('inventory.count',       'inventory', 'นับสต๊อก',                   'Stock count',           '盘点',       false),
  ('transfer.request',      'transfer',  'ขอโอนย้ายสินค้า',             'Request transfer',      '申请调拨',    false),
  ('transfer.approve',      'transfer',  'อนุมัติโอนย้าย',              'Approve transfer',      '审批调拨',    true),
  ('transfer.receive',      'transfer',  'รับสินค้าโอนเข้า',            'Receive transfer',      '接收调拨',    false),
  ('shift.open',            'shift',     'เปิดกะ',                     'Open shift',            '开班',       false),
  ('shift.close',           'shift',     'ปิดกะ',                      'Close shift',           '关班',       false),
  ('shift.force_close',     'shift',     'ปิดกะแทนคนอื่น',              'Force close shift',     '强制关班',    true),
  ('cash.adjust',           'shift',     'ปรับยอดเงินสด',               'Cash adjustment',       '现金调整',    true),
  ('report.employee_perf',  'report',    'ดู performance พนักงาน',      'Employee performance',  '员工业绩',    false),
  ('report.cost',           'report',    'ดูต้นทุน',                   'View cost',             '查看成本',    true),
  ('report.gross_profit',   'report',    'ดูกำไรขั้นต้น',               'View gross profit',     '查看毛利',    true),
  ('admin.employee_manage', 'admin',     'จัดการพนักงาน',               'Manage employees',      '员工管理',    true),
  ('admin.permission_manage','admin',    'กำหนดสิทธิ์',                 'Manage permissions',    '权限管理',    true),
  ('admin.product_manage',  'admin',     'จัดการสินค้า/ราคา',           'Manage products',       '商品管理',    true),
  ('admin.branch_manage',   'admin',     'จัดการสาขา',                  'Manage branches',       '门店管理',    true),
  ('admin.settings',        'admin',     'ตั้งค่าระบบ',                 'System settings',       '系统设置',    true),
  ('audit.view',            'admin',     'ดู audit log',                'View audit log',        '审计日志',    true),
  ('customer.manage',       'customer',  'จัดการข้อมูลลูกค้า',           'Manage customers',      '客户管理',    false),
  ('tax.issue_full',        'tax',       'ออกใบกำกับภาษีเต็มรูป',        'Issue full tax invoice','开全额税票',  false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2) ROLE PERMISSION MATRIX
--    effect: allow / deny / approval   |   limit_value: เพดาน % ส่วนลด
-- ---------------------------------------------------------------------
delete from role_permissions;
insert into role_permissions(role, permission, effect, limit_value) values
-- ===== STAFF (พนักงานขาย) =====
  ('staff','pos.sell','allow',null),
  ('staff','pos.discount','allow',5),                 -- ลดได้เองไม่เกิน 5%
  ('staff','pos.price_override','deny',null),
  ('staff','pos.void','approval',null),
  ('staff','pos.reprint','approval',null),
  ('staff','pos.open_drawer','deny',null),
  ('staff','pos.quotation','allow',null),
  ('staff','return.create','approval',null),
  ('staff','inventory.view','allow',null),            -- เห็นเฉพาะสาขาตัวเอง (data_scope)
  ('staff','inventory.count','allow',null),
  ('staff','shift.open','allow',null),
  ('staff','shift.close','allow',null),
  ('staff','report.employee_perf','allow',null),      -- เห็นแค่ของตัวเอง (scope=own)
  ('staff','customer.manage','allow',null),
  ('staff','tax.issue_full','allow',null),
-- ===== SUPERVISOR (หัวหน้ากะ) =====
  ('supervisor','pos.sell','allow',null),
  ('supervisor','pos.discount','allow',10),
  ('supervisor','pos.price_override','approval',null),
  ('supervisor','pos.void','allow',null),
  ('supervisor','pos.reprint','allow',null),
  ('supervisor','pos.open_drawer','allow',null),
  ('supervisor','pos.quotation','allow',null),
  ('supervisor','return.create','allow',null),
  ('supervisor','return.approve','allow',null),
  ('supervisor','inventory.view','allow',null),
  ('supervisor','inventory.count','allow',null),
  ('supervisor','transfer.request','allow',null),
  ('supervisor','transfer.receive','allow',null),
  ('supervisor','shift.open','allow',null),
  ('supervisor','shift.close','allow',null),
  ('supervisor','cash.adjust','approval',null),
  ('supervisor','report.employee_perf','allow',null),
  ('supervisor','report.gross_profit','allow',null),  -- Limited (เห็นเฉพาะสาขา)
  ('supervisor','customer.manage','allow',null),
  ('supervisor','tax.issue_full','allow',null),
-- ===== MANAGER (ผู้จัดการร้าน) =====
  ('manager','pos.sell','allow',null),
  ('manager','pos.discount','allow',20),
  ('manager','pos.price_override','allow',null),
  ('manager','pos.void','allow',null),
  ('manager','pos.reprint','allow',null),
  ('manager','pos.open_drawer','allow',null),
  ('manager','pos.quotation','allow',null),
  ('manager','return.create','allow',null),
  ('manager','return.approve','allow',null),
  ('manager','inventory.view','allow',null),
  ('manager','inventory.adjust','allow',null),
  ('manager','inventory.count','allow',null),
  ('manager','transfer.request','allow',null),
  ('manager','transfer.approve','allow',null),
  ('manager','transfer.receive','allow',null),
  ('manager','shift.open','allow',null),
  ('manager','shift.close','allow',null),
  ('manager','shift.force_close','allow',null),
  ('manager','cash.adjust','allow',null),
  ('manager','report.employee_perf','allow',null),
  ('manager','report.cost','allow',null),             -- Limited: เห็นต้นทุนเฉพาะสาขา
  ('manager','report.gross_profit','allow',null),
  ('manager','admin.employee_manage','allow',null),
  ('manager','customer.manage','allow',null),
  ('manager','audit.view','allow',null),
  ('manager','tax.issue_full','allow',null),
-- ===== BRAND ADMIN (ดูแลรายแบรนด์ — ไม่ขายหน้าร้าน) =====
  ('brand_admin','pos.sell','deny',null),
  ('brand_admin','pos.discount','deny',null),
  ('brand_admin','return.approve','allow',null),
  ('brand_admin','inventory.view','allow',null),
  ('brand_admin','inventory.adjust','allow',null),
  ('brand_admin','transfer.request','allow',null),
  ('brand_admin','transfer.approve','allow',null),
  ('brand_admin','report.employee_perf','allow',null),
  ('brand_admin','report.cost','allow',null),
  ('brand_admin','report.gross_profit','allow',null),
  ('brand_admin','admin.product_manage','allow',null),
  ('brand_admin','admin.employee_manage','allow',null),
  ('brand_admin','admin.permission_manage','allow',null),
  ('brand_admin','audit.view','allow',null),
-- ===== HQ (สำนักงานใหญ่ — เห็นทุกอย่าง) =====
  ('hq','pos.sell','allow',null),
  ('hq','pos.discount','allow',100),
  ('hq','pos.price_override','allow',null),
  ('hq','pos.void','allow',null),
  ('hq','pos.reprint','allow',null),
  ('hq','pos.open_drawer','allow',null),
  ('hq','pos.quotation','allow',null),
  ('hq','return.create','allow',null),
  ('hq','return.approve','allow',null),
  ('hq','inventory.view','allow',null),
  ('hq','inventory.adjust','allow',null),
  ('hq','inventory.count','allow',null),
  ('hq','transfer.request','allow',null),
  ('hq','transfer.approve','allow',null),
  ('hq','transfer.receive','allow',null),
  ('hq','shift.open','allow',null),
  ('hq','shift.close','allow',null),
  ('hq','shift.force_close','allow',null),
  ('hq','cash.adjust','allow',null),
  ('hq','report.employee_perf','allow',null),
  ('hq','report.cost','allow',null),
  ('hq','report.gross_profit','allow',null),
  ('hq','admin.employee_manage','allow',null),
  ('hq','admin.permission_manage','allow',null),
  ('hq','admin.product_manage','allow',null),
  ('hq','admin.branch_manage','allow',null),
  ('hq','admin.settings','allow',null),
  ('hq','audit.view','allow',null),
  ('hq','customer.manage','allow',null),
  ('hq','tax.issue_full','allow',null),
-- ===== AUDITOR (ตรวจสอบ — อ่านอย่างเดียว) =====
  ('auditor','inventory.view','allow',null),
  ('auditor','report.employee_perf','allow',null),
  ('auditor','report.cost','allow',null),
  ('auditor','report.gross_profit','allow',null),
  ('auditor','audit.view','allow',null);

-- ---------------------------------------------------------------------
-- 3) BRANDS
-- ---------------------------------------------------------------------
insert into brands(code, name, name_th, name_zh, color) values
  ('70MAI',    '70mai',     '70mai',     '70迈',   '#e11d48'),
  ('ANKER',    'Anker',     'Anker',     '安克',   '#0ea5e9'),
  ('SOUNDCORE','Soundcore', 'Soundcore', '声阔',   '#06b6d4'),
  ('DREAME',   'Dreame',    'Dreame',    '追觅',   '#7c3aed'),
  ('DDPAI',    'DDPAI',     'DDPAI',     '盯盯拍', '#f59e0b'),
  ('MOVA',     'Mova',      'Mova',      'Mova',  '#10b981'),
  ('LEVOIT',   'Levoit',    'Levoit',    'Levoit','#22c55e')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 4) BRANCHES — 29 สาขาจากข้อมูลจริงปี 2024
-- ---------------------------------------------------------------------
insert into branches(code, name, name_th, erp_store_code, brand_id, branch_type, province, tax_branch_no)
select v.code, v.name, v.name_th, v.erp, b.id, v.btype, v.prov, v.taxno
from (values
  ('70MAI-RAMINTRA',  '70mai Ramintra',            '70mai รามอินทรา',        '[Brand Shop] 70mai - Ramindra',        '70MAI','brand_shop','กรุงเทพมหานคร','00001'),
  ('70MAI-KANJANA',   '70mai Kanchanaphisek',      '70mai กาญจนาภิเษก',      '[Brand Shop] 70mai - Kanchanaphisek',  '70MAI','brand_shop','กรุงเทพมหานคร','00002'),
  ('70MAI-CHONBURI',  '70mai Chonburi',            '70mai ชลบุรี',           '[Brand Shop] 70mai - Chonburi',        '70MAI','brand_shop','ชลบุรี','00003'),
  ('70MAI-THAPHRA',   '70mai Tha Phra',            '70mai ท่าพระ',           '[Brand Shop] - 70mai Thapra',          '70MAI','brand_shop','กรุงเทพมหานคร','00004'),
  ('70MAI-RANGSIT',   '70mai Rangsit',             '70mai รังสิต',           '[Brand Shop] 70mai - Rangsit',         '70MAI','brand_shop','ปทุมธานี','00005'),
  ('70MAI-RATCHA',    '70mai Ratchaphruek',        '70mai ราชพฤกษ์',         '[Brand Shop] 70mai - Ratchaphreuk',    '70MAI','brand_shop','นนทบุรี','00006'),
  ('ANKER-CTW',       'Anker Central World',       'Anker เซ็นทรัลเวิลด์',    'Anker - CentralWorld (BrandShop)',     'ANKER','brand_shop','กรุงเทพมหานคร','00007'),
  ('ANKER-RAMA9',     'Anker Central Rama 9',      'Anker เซ็นทรัลพระราม 9',  '[Brand Shop] Anker - Central Rama9',   'ANKER','brand_shop','กรุงเทพมหานคร','00008'),
  ('ANKER-CTPARK',    'Anker Central Park',        'Anker เซ็นทรัลปาร์ค',     '[Brand Shop] Anker - Central Park',    'ANKER','brand_shop','กรุงเทพมหานคร','00009'),
  ('ANKER-FASHION',   'Anker Fashion Island',      'Anker แฟชั่นไอส์แลนด์',    '[Brand Shop] Anker - Fashion Island',  'ANKER','brand_shop','กรุงเทพมหานคร','00010'),
  ('ANKER-PINKLAO',   'Anker Central Pinklao',     'Anker เซ็นทรัลปิ่นเกล้า',  '[Brand Shop] Anker - Central Pinklao', 'ANKER','brand_shop','กรุงเทพมหานคร','00011'),
  ('ANKER-BANGKAPI',  'Anker The Mall Bangkapi',   'Anker เดอะมอลล์บางกะปิ',  '[Brand Shop] Anker - The Mall Bangkapi','ANKER','brand_shop','กรุงเทพมหานคร','00012'),
  ('ANKER-NGAMWONG',  'Anker The Mall Ngamwongwan','Anker เดอะมอลล์งามวงศ์วาน','[Brand Shop] Anker - The Mall Ngamwongwan','ANKER','brand_shop','นนทบุรี','00013'),
  ('ANKER-NORTHVILLE','Anker North Ville',         'Anker นอร์ธวิลล์',        '[Brand Shop] Anker - Central Nothville','ANKER','brand_shop','กรุงเทพมหานคร','00014'),
  ('ANKER-KHONKAEN',  'Anker Central Khon Kaen',   'Anker เซ็นทรัลขอนแก่น',   '[Brand Shop] Anker - Central Khon Kaen','ANKER','brand_shop','ขอนแก่น','00015'),
  ('ANKER-VD-BANGNA', 'Vending Anker Mega Bangna', 'ตู้ Anker เมกาบางนา',     null,                                   'ANKER','vending','สมุทรปราการ','00016'),
  ('ANKER-VD-SIAM',   'Vending Anker BTS Siam',    'ตู้ Anker BTS สยาม',      null,                                   'ANKER','vending','กรุงเทพมหานคร','00017'),
  ('DREAME-WESTGATE', 'Dreame Central Westgate',   'Dreame เซ็นทรัลเวสต์เกต', 'Hashtag - Central Westgate',           'DREAME','shop_in_shop','นนทบุรี','00018'),
  ('DREAME-SEACON',   'Dreame Seacon Srinakarin',  'Dreame ซีคอนศรีนครินทร์',  'Dreame - (Srinakarin)',                'DREAME','brand_shop','กรุงเทพมหานคร','00019'),
  ('DREAME-RAMA2',    'Dreame Central Rama 2',     'Dreame เซ็นทรัลพระราม 2', '[Brand Shop] Dreame - Rama2',          'DREAME','brand_shop','กรุงเทพมหานคร','00020'),
  ('DREAME-MEGA',     'Dreame Mega Bangna',        'Dreame เมกาบางนา',        '[Brand Shop] Dreame - Mega Bang Na',   'DREAME','brand_shop','สมุทรปราการ','00021'),
  ('DREAME-NGAMWONG', 'Dreame The Mall Ngamwongwan','Dreame เดอะมอลล์งามวงศ์วาน','[Brand Shop] Dreame - The Mall Ngamwongwan','DREAME','brand_shop','นนทบุรี','00022'),
  ('DREAME-PINKLAO',  'Dreame Central Pinklao',    'Dreame เซ็นทรัลปิ่นเกล้า', '[Brand Shop] Dreame - Central Pin-klao','DREAME','brand_shop','กรุงเทพมหานคร','00023'),
  ('DREAME-EASTVILLE','Dreame East Ville',         'Dreame อีสต์วิลล์',       '[Brand Shop] Dreame - Central Eastville','DREAME','brand_shop','กรุงเทพมหานคร','00024'),
  ('DREAME-NORTHVILLE','Dreame North Ville',       'Dreame นอร์ธวิลล์',       '[Brand Shop] Dreame - Central Northville','DREAME','brand_shop','กรุงเทพมหานคร','00025'),
  ('DREAME-BANGNA',   'Dreame Central Bangna',     'Dreame เซ็นทรัลบางนา',    '[Brand Shop] - Dreame - Central Bangna','DREAME','brand_shop','กรุงเทพมหานคร','00026'),
  ('DREAME-HAPPITAT', 'Dreame Happitat',           'Dreame แฮปปิแทต',         '[Brand Shop] Dreame - Happitat',       'DREAME','brand_shop','กรุงเทพมหานคร','00027'),
  ('DDPAI-PINKLAO',   'DDPAI SUSCO Pinklao',       'DDPAI ซัสโก้ ปิ่นเกล้า',   '[Brand Shop] DDPAI - Susco Pinklao',   'DDPAI','brand_shop','กรุงเทพมหานคร','00028'),
  ('HQ-WAREHOUSE',    'SHD HQ Warehouse',          'คลังสินค้าสำนักงานใหญ่',   null,                                   '70MAI','warehouse','กรุงเทพมหานคร','00000')
) as v(code, name, name_th, erp, brand_code, btype, prov, taxno)
left join brands b on b.code = v.brand_code
on conflict (code) do nothing;

insert into branch_brands(branch_id, brand_id)
select b.id, b.brand_id from branches b where b.brand_id is not null
on conflict do nothing;

-- Anker shop ขาย Soundcore ด้วย
insert into branch_brands(branch_id, brand_id)
select b.id, s.id from branches b, brands s
where b.code like 'ANKER-%' and s.code = 'SOUNDCORE'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5) CATEGORIES
-- ---------------------------------------------------------------------
insert into categories(code, name_th, name_en, name_zh, sort_order) values
  ('DASHCAM',   'กล้องติดรถยนต์',     'Dash Camera',        '行车记录仪', 1),
  ('ACC-CAR',   'อุปกรณ์เสริมรถยนต์', 'Car Accessories',    '汽车配件',   2),
  ('MEMORY',    'เมมโมรี่การ์ด',      'Memory Card',        '存储卡',     3),
  ('POWER',     'พาวเวอร์แบงค์/ชาร์จ', 'Power / Charging',   '充电产品',   4),
  ('CABLE',     'สายชาร์จ',          'Cables',             '数据线',     5),
  ('AUDIO',     'หูฟัง/ลำโพง',        'Audio',              '音频',       6),
  ('CLEANING',  'เครื่องทำความสะอาด',  'Home Cleaning',      '清洁电器',   7),
  ('SUPPLIES',  'อะไหล่/น้ำยา',       'Supplies & Parts',   '耗材',       8),
  ('SERVICE',   'ค่าบริการติดตั้ง',    'Installation Service','安装服务',   9),
  ('FEE',       'ค่าใช้จ่ายอื่น',      'Other Fees',         '其他费用',  10)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 6) PRODUCTS ตัวอย่าง (โครงสร้างสำหรับ import ของจริงทีหลัง)
-- ---------------------------------------------------------------------
insert into products(sku, brand_id, category_id, kind, name_th, name_en, name_zh, short_name,
                     price, cost, track_serial, warranty_months, is_stocked, reorder_point)
select v.sku, b.id, c.id, v.kind::product_kind, v.th, v.en, v.zh, v.short,
       v.price, v.cost, v.serial, v.warranty, v.stocked, v.rp
from (values
  ('70M-A510-1',  '70MAI','DASHCAM','goods','70mai Dash Cam A510','70mai A510-1','70迈 A510','70mai A510',        4990, 2890, true, 24, true, 5),
  ('70M-A810-2',  '70MAI','DASHCAM','goods','70mai Dash Cam A810 หน้า-หลัง','70mai A810-2','70迈 A810','70mai A810-2', 6234, 3568, true, 24, true, 4),
  ('70M-OMNI-64', '70MAI','DASHCAM','goods','70mai Dash Cam Omni 64GB','70mai Omni Black 64G','70迈 Omni','70mai Omni 64G',6299, 3950, true, 24, true, 3),
  ('70M-A400-IV', '70MAI','DASHCAM','goods','70mai Dash Cam A400 สีงาช้าง','70mai A400 Ivory','70迈 A400','70mai A400',  2399, 1321, true, 24, true, 5),
  ('70M-UP03',    '70MAI','ACC-CAR','goods','สายจอดเฝ้าระวัง 70mai UP03','70mai Parking Cable UP03','70迈 UP03','UP03 Cable', 599,  262, false, 12, true, 10),
  ('70M-UP04-4G', '70MAI','ACC-CAR','goods','ชุดต่อไฟ 4G 70mai UP04','70mai 4G Hardwire Kit UP04','70迈 UP04','UP04 4G',   1899, 1074, false, 12, true, 6),
  ('VLNKO-U3-128','70MAI','MEMORY','goods','เมมโมรี่การ์ด Vlnko U3 128GB','Vlnko U3 128GB','Vlnko U3 128GB','SD 128GB',     450,  254, false, 12, true, 20),
  ('VLNKO-U3-64', '70MAI','MEMORY','goods','เมมโมรี่การ์ด Vlnko U3 64GB','Vlnko U3 64GB','Vlnko U3 64GB','SD 64GB',         250,  103, false, 12, true, 20),
  ('A110DH11',    'ANKER','POWER','goods','Anker Power Bank 10000mAh 22.5W','Anker Power Bank (10K 22.5W)','安克充电宝','Anker PB 10K',1290, 690, true, 18, true, 8),
  ('A2688E41',    'ANKER','POWER','goods','Anker Prime Charger 3-in-1 100W','Anker Prime Charger 100W','安克充电器','Anker Prime 100W',2590,1490, true, 18, true, 6),
  ('A8060H11',    'ANKER','CABLE','goods','สาย Anker Zolo USB-C 240W 0.9ม.','Anker Zolo C-C 240W 3ft','安克数据线','Zolo C-C 240W',  490,  240, false, 18, true, 15),
  ('SC-Q45',      'SOUNDCORE','AUDIO','goods','หูฟัง Soundcore Life Q45','Soundcore Life Q45','声阔 Q45','SC Q45',         3490, 1990, true, 18, true, 5),
  ('DRM-X40U',    'DREAME','CLEANING','goods','Dreame X40 Ultra หุ่นยนต์ดูดฝุ่น','Dreame X40 Ultra','追觅 X40','Dreame X40U', 42900,26900, true, 24, true, 2),
  ('DRM-H12',     'DREAME','CLEANING','goods','Dreame H12 Pro เครื่องดูดฝุ่นเปียก','Dreame H12 Pro','追觅 H12','Dreame H12',   16900,10200, true, 24, true, 3),
  ('DRM-CLEAN1L', 'DREAME','SUPPLIES','goods','น้ำยาทำความสะอาดพื้น Dreame 1L','Dreame Floor Cleaner 1L','清洁液 1L','น้ำยา 1L',  590,  260, false, 0, true, 12),
  ('DDP-MIX5',    'DDPAI','DASHCAM','goods','DDPAI Mix5 Pro','DDPAI Mix5 Pro','盯盯拍 Mix5','DDPAI Mix5',                  5990, 3490, true, 24, true, 3),
  ('SVC-FR-4DR',  '70MAI','SERVICE','service','ค่าติดตั้ง รถทั่วไป หน้า-หลัง 4 ประตู','Install Front+Rear 4-door','安装服务','ติดตั้ง 4ปต.',1200, 0, false, 0, false, 0),
  ('SVC-FR-HB',   '70MAI','SERVICE','service','ค่าติดตั้ง รถทั่วไป หน้า-หลัง Hatchback','Install Front+Rear Hatchback','安装服务','ติดตั้ง HB',1500, 0, false, 0, false, 0),
  ('SVC-EU-HB',   '70MAI','SERVICE','service','ค่าติดตั้ง รถยุโรป/EV หน้า-หลัง Hatchback','Install EU/EV Front+Rear HB','安装服务','ติดตั้ง EU',1800, 0, false, 0, false, 0),
  ('SVC-REMOVE',  '70MAI','SERVICE','service','ค่าถอด-รื้อระบบกล้องเก่า','Remove old camera system','拆除服务','ค่าถอด',       300,  0, false, 0, false, 0),
  ('FEE-TRAVEL',  '70MAI','FEE','fee','ค่าเดินทางบริการนอกสถานที่','On-site travel fee','上门服务费','ค่าเดินทาง',            500,  0, false, 0, false, 0)
) as v(sku, brand_code, cat_code, kind, th, en, zh, short, price, cost, serial, warranty, stocked, rp)
left join brands b on b.code = v.brand_code
left join categories c on c.code = v.cat_code
on conflict (sku) do nothing;

-- บาร์โค้ดตัวอย่าง
insert into product_barcodes(product_id, barcode)
select id, '885' || lpad((row_number() over (order by sku))::text, 10, '0')
from products
on conflict (barcode) do nothing;

-- ---------------------------------------------------------------------
-- 7) EMPLOYEES ตัวอย่าง (PIN ทดสอบ — ต้องเปลี่ยนก่อนใช้จริง)
--    PIN hash ตัวอย่างนี้คือ placeholder; ระบบจริงใช้ bcrypt ฝั่ง Edge Function
-- ---------------------------------------------------------------------
insert into employees(employee_code, first_name, last_name, nickname, role, data_scope,
                      home_branch_id, max_discount_percent, can_open_drawer, status)
select v.code, v.fn, v.ln, v.nick, v.role::employee_role, v.scope::data_scope,
       b.id, v.disc, v.drawer, 'active'
from (values
  ('EMP-0001','Rice','(Tech Lead)','rice','hq','company','HQ-WAREHOUSE',100,true),
  ('EMP-0101','Nattasak','S.','nattasak','manager','branch','70MAI-RAMINTRA',20,true),
  ('EMP-0102','Tanakorn','P.','tanakorn','supervisor','branch','70MAI-RAMINTRA',10,true),
  ('EMP-0103','Nichakan','T.','nichakan','staff','own','70MAI-RAMINTRA',5,false),
  ('EMP-0201','Chananthorn','K.','chananthorn','manager','branch','ANKER-CTW',20,true),
  ('EMP-0202','Somsak','L.','som','staff','own','ANKER-CTW',5,false),
  ('EMP-0301','Queenkanok','R.','queenkanok','manager','branch','DREAME-WESTGATE',20,true),
  ('EMP-0302','Patchara','M.','พัชรา','staff','own','DREAME-WESTGATE',5,false),
  ('EMP-9001','Brand','Admin 70mai','ba70mai','brand_admin','brand','HQ-WAREHOUSE',0,false),
  ('EMP-9002','Brand','Admin Anker','baanker','brand_admin','brand','HQ-WAREHOUSE',0,false)
) as v(code, fn, ln, nick, role, scope, branch_code, disc, drawer)
left join branches b on b.code = v.branch_code
on conflict (employee_code) do nothing;

insert into employee_branches(employee_id, branch_id, is_primary)
select e.id, e.home_branch_id, true from employees e where e.home_branch_id is not null
on conflict do nothing;

-- HQ เห็นทุกสาขา
insert into employee_branches(employee_id, branch_id)
select e.id, b.id from employees e, branches b where e.role = 'hq'
on conflict do nothing;

insert into employee_brands(employee_id, brand_id)
select e.id, br.id from employees e, brands br
where (e.employee_code = 'EMP-9001' and br.code = '70MAI')
   or (e.employee_code = 'EMP-9002' and br.code in ('ANKER','SOUNDCORE'))
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 8) TERMINALS
-- ---------------------------------------------------------------------
insert into terminals(branch_id, code, name, receipt_prefix, customer_display)
select b.id, 'POS-01', b.name || ' เครื่อง 1',
       upper(left(regexp_replace(b.code, '[^A-Z0-9]', '', 'g'), 3)) || '1', true
from branches b where b.branch_type <> 'warehouse'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 9) STOCK ตั้งต้น
-- ---------------------------------------------------------------------
insert into stock_levels(branch_id, product_id, qty_on_hand, reorder_point)
select b.id, p.id,
       case when p.is_stocked then (10 + (abs(hashtext(b.code || p.sku)) % 40)) else 0 end,
       p.reorder_point
from branches b
cross join products p
where b.branch_type in ('brand_shop','shop_in_shop')
  and (p.brand_id = b.brand_id or p.kind in ('service','fee'))
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 10) SETTINGS
-- ---------------------------------------------------------------------
insert into settings(key, scope, value, description) values
  ('company.profile','global', jsonb_build_object(
      'name_th','บริษัท เอส เอช ดี เทคโนโลยี จำกัด',
      'name_en','SHD Technology Co., Ltd.',
      'tax_id','0000000000000',
      'address','กรุงเทพมหานคร',
      'phone','02-000-0000'), 'ข้อมูลบริษัทสำหรับหัวใบเสร็จ/ใบกำกับภาษี'),
  ('tax.vat','global', jsonb_build_object('rate',7,'mode','inclusive'), 'อัตรา VAT'),
  ('etax.provider','global', jsonb_build_object('provider','manual','enabled',false), 'ผู้ให้บริการ e-Tax Invoice'),
  ('pos.defaults','global', jsonb_build_object(
      'theme','light','language','th','receipt_copies',1,
      'require_salesperson',true,'allow_mixed_payment',true,
      'offline_max_pending',500), 'ค่าเริ่มต้นหน้าร้าน'),
  ('discount.thresholds','global', jsonb_build_object(
      'staff',5,'supervisor',10,'manager',20,'above','hq_approval'), 'เพดานส่วนลดตามระดับ'),
  ('printer.default','global', jsonb_build_object(
      'type','escpos','width',48,'bridge_url','http://127.0.0.1:9110'), 'ค่าเริ่มต้นเครื่องพิมพ์')
on conflict (key) do nothing;
