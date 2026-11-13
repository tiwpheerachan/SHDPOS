// =====================================================================
// ข้อมูลตัวอย่างสำหรับ "โหมดสาธิต" — ใช้ตอนยังไม่ต่อ Supabase
// โครงสร้างตรงกับ schema จริง เพื่อให้สลับไป live ได้โดยไม่ต้องแก้ UI
//
// รายชื่อสาขา/แบรนด์/ชื่อพนักงาน อ้างอิงจากไฟล์ยอดขายหน้าร้านปี 2024
// =====================================================================

import type {
  Brand, Branch, Terminal, Employee, Product, Category, StockLevel, Order, OrderItem,
  PaymentMethod, AuditEntry, Customer,
} from "./types";
import { round2 } from "./money";

/** PRNG แบบ seed คงที่ — ข้อมูลสาธิตจะเหมือนเดิมทุกครั้งที่เปิด */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const id = (p: string, n: number) => `${p}-${String(n).padStart(4, "0")}-0000-0000-000000000000`;

// ---------------------------------------------------------------------
// BRANDS
// ---------------------------------------------------------------------
export const DEMO_BRANDS: Brand[] = [
  { id: id("b", 1), code: "70MAI", name: "70mai", name_th: "70mai", name_zh: "70迈", color: "#e11d48" },
  { id: id("b", 2), code: "ANKER", name: "Anker", name_th: "Anker", name_zh: "安克", color: "#0ea5e9" },
  { id: id("b", 3), code: "SOUNDCORE", name: "Soundcore", name_th: "Soundcore", name_zh: "声阔", color: "#06b6d4" },
  { id: id("b", 4), code: "DREAME", name: "Dreame", name_th: "Dreame", name_zh: "追觅", color: "#7c3aed" },
  { id: id("b", 5), code: "DDPAI", name: "DDPAI", name_th: "DDPAI", name_zh: "盯盯拍", color: "#f59e0b" },
];
const bId = (code: string) => DEMO_BRANDS.find((b) => b.code === code)!.id;

// ---------------------------------------------------------------------
// BRANCHES — 29 สาขาจริง
// ---------------------------------------------------------------------
const BRANCH_SRC: [string, string, string, string, string][] = [
  ["70MAI-RAMINTRA", "70mai Ramintra", "70mai รามอินทรา", "70MAI", "กรุงเทพมหานคร"],
  ["70MAI-KANJANA", "70mai Kanchanaphisek", "70mai กาญจนาภิเษก", "70MAI", "กรุงเทพมหานคร"],
  ["70MAI-CHONBURI", "70mai Chonburi", "70mai ชลบุรี", "70MAI", "ชลบุรี"],
  ["70MAI-THAPHRA", "70mai Tha Phra", "70mai ท่าพระ", "70MAI", "กรุงเทพมหานคร"],
  ["70MAI-RANGSIT", "70mai Rangsit", "70mai รังสิต", "70MAI", "ปทุมธานี"],
  ["70MAI-RATCHA", "70mai Ratchaphruek", "70mai ราชพฤกษ์", "70MAI", "นนทบุรี"],
  ["ANKER-CTW", "Anker Central World", "Anker เซ็นทรัลเวิลด์", "ANKER", "กรุงเทพมหานคร"],
  ["ANKER-RAMA9", "Anker Central Rama 9", "Anker เซ็นทรัลพระราม 9", "ANKER", "กรุงเทพมหานคร"],
  ["ANKER-CTPARK", "Anker Central Park", "Anker เซ็นทรัลปาร์ค", "ANKER", "กรุงเทพมหานคร"],
  ["ANKER-FASHION", "Anker Fashion Island", "Anker แฟชั่นไอส์แลนด์", "ANKER", "กรุงเทพมหานคร"],
  ["ANKER-PINKLAO", "Anker Central Pinklao", "Anker เซ็นทรัลปิ่นเกล้า", "ANKER", "กรุงเทพมหานคร"],
  ["ANKER-BANGKAPI", "Anker The Mall Bangkapi", "Anker เดอะมอลล์บางกะปิ", "ANKER", "กรุงเทพมหานคร"],
  ["ANKER-NGAMWONG", "Anker The Mall Ngamwongwan", "Anker เดอะมอลล์งามวงศ์วาน", "ANKER", "นนทบุรี"],
  ["ANKER-NORTHVILLE", "Anker North Ville", "Anker นอร์ธวิลล์", "ANKER", "กรุงเทพมหานคร"],
  ["ANKER-KHONKAEN", "Anker Central Khon Kaen", "Anker เซ็นทรัลขอนแก่น", "ANKER", "ขอนแก่น"],
  ["DREAME-WESTGATE", "Dreame Central Westgate", "Dreame เซ็นทรัลเวสต์เกต", "DREAME", "นนทบุรี"],
  ["DREAME-SEACON", "Dreame Seacon Srinakarin", "Dreame ซีคอนศรีนครินทร์", "DREAME", "กรุงเทพมหานคร"],
  ["DREAME-RAMA2", "Dreame Central Rama 2", "Dreame เซ็นทรัลพระราม 2", "DREAME", "กรุงเทพมหานคร"],
  ["DREAME-MEGA", "Dreame Mega Bangna", "Dreame เมกาบางนา", "DREAME", "สมุทรปราการ"],
  ["DREAME-NGAMWONG", "Dreame The Mall Ngamwongwan", "Dreame เดอะมอลล์งามวงศ์วาน", "DREAME", "นนทบุรี"],
  ["DREAME-PINKLAO", "Dreame Central Pinklao", "Dreame เซ็นทรัลปิ่นเกล้า", "DREAME", "กรุงเทพมหานคร"],
  ["DREAME-EASTVILLE", "Dreame East Ville", "Dreame อีสต์วิลล์", "DREAME", "กรุงเทพมหานคร"],
  ["DREAME-NORTHVILLE", "Dreame North Ville", "Dreame นอร์ธวิลล์", "DREAME", "กรุงเทพมหานคร"],
  ["DREAME-BANGNA", "Dreame Central Bangna", "Dreame เซ็นทรัลบางนา", "DREAME", "กรุงเทพมหานคร"],
  ["DREAME-HAPPITAT", "Dreame Happitat", "Dreame แฮปปิแทต", "DREAME", "กรุงเทพมหานคร"],
  ["DDPAI-PINKLAO", "DDPAI SUSCO Pinklao", "DDPAI ซัสโก้ ปิ่นเกล้า", "DDPAI", "กรุงเทพมหานคร"],
  ["ANKER-VD-BANGNA", "Vending Anker Mega Bangna", "ตู้ Anker เมกาบางนา", "ANKER", "สมุทรปราการ"],
  ["ANKER-VD-SIAM", "Vending Anker BTS Siam", "ตู้ Anker BTS สยาม", "ANKER", "กรุงเทพมหานคร"],
  ["HQ-WAREHOUSE", "SHD HQ Warehouse", "คลังสินค้าสำนักงานใหญ่", "70MAI", "กรุงเทพมหานคร"],
];

export const DEMO_BRANCHES: Branch[] = BRANCH_SRC.map((b, i) => ({
  id: id("c", i + 1),
  code: b[0],
  name: b[1],
  name_th: b[2],
  brand_id: bId(b[3]),
  branch_type: b[0].startsWith("ANKER-VD") ? "vending" : b[0] === "HQ-WAREHOUSE" ? "warehouse" : "brand_shop",
  province: b[4],
  tax_branch_no: String(i + 1).padStart(5, "0"),
  is_active: true,
}));
const cId = (code: string) => DEMO_BRANCHES.find((b) => b.code === code)!.id;

export const DEMO_TERMINALS: Terminal[] = DEMO_BRANCHES.filter((b) => b.branch_type !== "warehouse").map(
  (b, i) => ({
    id: id("t", i + 1),
    branch_id: b.id,
    code: "POS-01",
    name: `${b.name} เครื่อง 1`,
    receipt_prefix: b.code.replace(/[^A-Z0-9]/g, "").slice(0, 3) + "1",
    customer_display: true,
  })
);

// ---------------------------------------------------------------------
// CATEGORIES
// ---------------------------------------------------------------------
export const DEMO_CATEGORIES: Category[] = [
  { id: id("g", 1), code: "DASHCAM", name_th: "กล้องติดรถยนต์", name_en: "Dash Camera", name_zh: "行车记录仪", sort_order: 1 },
  { id: id("g", 2), code: "ACC-CAR", name_th: "อุปกรณ์เสริมรถยนต์", name_en: "Car Accessories", name_zh: "汽车配件", sort_order: 2 },
  { id: id("g", 3), code: "MEMORY", name_th: "เมมโมรี่การ์ด", name_en: "Memory Card", name_zh: "存储卡", sort_order: 3 },
  { id: id("g", 4), code: "POWER", name_th: "พาวเวอร์แบงค์/ชาร์จ", name_en: "Power / Charging", name_zh: "充电产品", sort_order: 4 },
  { id: id("g", 5), code: "CABLE", name_th: "สายชาร์จ", name_en: "Cables", name_zh: "数据线", sort_order: 5 },
  { id: id("g", 6), code: "AUDIO", name_th: "หูฟัง/ลำโพง", name_en: "Audio", name_zh: "音频", sort_order: 6 },
  { id: id("g", 7), code: "CLEANING", name_th: "เครื่องทำความสะอาด", name_en: "Home Cleaning", name_zh: "清洁电器", sort_order: 7 },
  { id: id("g", 8), code: "SUPPLIES", name_th: "อะไหล่/น้ำยา", name_en: "Supplies", name_zh: "耗材", sort_order: 8 },
  { id: id("g", 9), code: "SERVICE", name_th: "ค่าบริการติดตั้ง", name_en: "Installation", name_zh: "安装服务", sort_order: 9 },
  { id: id("g", 10), code: "FEE", name_th: "ค่าใช้จ่ายอื่น", name_en: "Other Fees", name_zh: "其他费用", sort_order: 10 },
];
const gId = (code: string) => DEMO_CATEGORIES.find((c) => c.code === code)!.id;

// ---------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------
type P = [string, string, string, string, string, string, number, number, boolean, string];
const PRODUCT_SRC: P[] = [
  ["70M-A510-1", "70MAI", "DASHCAM", "70mai Dash Cam A510", "70mai A510", "70迈 A510", 4990, 2890, true, "goods"],
  ["70M-A810-2", "70MAI", "DASHCAM", "70mai Dash Cam A810 หน้า-หลัง", "70mai A810-2", "70迈 A810", 6234, 3568, true, "goods"],
  ["70M-OMNI-64", "70MAI", "DASHCAM", "70mai Dash Cam Omni 64GB", "70mai Omni 64G", "70迈 Omni", 6299, 3950, true, "goods"],
  ["70M-A400-IV", "70MAI", "DASHCAM", "70mai Dash Cam A400 สีงาช้าง", "70mai A400 Ivory", "70迈 A400", 2399, 1321, true, "goods"],
  ["70M-A200-C", "70MAI", "DASHCAM", "70mai Dash Cam A200 Type-C", "70mai A200-1 Type-C", "70迈 A200", 1790, 940, true, "goods"],
  ["70M-M310", "70MAI", "DASHCAM", "70mai Dash Cam M310", "70mai M310", "70迈 M310", 1590, 830, true, "goods"],
  ["70M-UP03", "70MAI", "ACC-CAR", "สายจอดเฝ้าระวัง 70mai UP03", "70mai Parking Cable UP03", "70迈 UP03", 599, 262, false, "goods"],
  ["70M-UP04-4G", "70MAI", "ACC-CAR", "ชุดต่อไฟ 4G 70mai UP04", "70mai 4G Hardwire Kit UP04", "70迈 UP04", 1899, 1074, false, "goods"],
  ["VLNKO-U3-128", "70MAI", "MEMORY", "เมมโมรี่การ์ด Vlnko U3 128GB", "Vlnko U3 128GB", "Vlnko U3 128GB", 450, 254, false, "goods"],
  ["VLNKO-U3-64", "70MAI", "MEMORY", "เมมโมรี่การ์ด Vlnko U3 64GB", "Vlnko U3 64GB", "Vlnko U3 64GB", 250, 103, false, "goods"],
  ["VLNKO-32", "70MAI", "MEMORY", "เมมโมรี่การ์ด Vlnko 32GB", "Vlnko 32GB", "Vlnko 32GB", 180, 73, false, "goods"],
  ["A110DH11", "ANKER", "POWER", "Anker Power Bank 10000mAh 22.5W", "Anker Power Bank 10K", "安克充电宝 10K", 1290, 690, true, "goods"],
  ["A2688E41", "ANKER", "POWER", "Anker Prime Charger 3-in-1 100W", "Anker Prime Charger 100W", "安克 Prime 100W", 2590, 1490, true, "goods"],
  ["A8060H11", "ANKER", "CABLE", "สาย Anker Zolo USB-C 240W 0.9ม.", "Anker Zolo C-C 240W 3ft", "安克 Zolo 240W", 490, 240, false, "goods"],
  ["A1652", "ANKER", "POWER", "Anker MagGo Wireless Charger", "Anker MagGo Charger", "安克 MagGo", 1690, 890, true, "goods"],
  ["SC-Q45", "SOUNDCORE", "AUDIO", "หูฟัง Soundcore Life Q45", "Soundcore Life Q45", "声阔 Q45", 3490, 1990, true, "goods"],
  ["SC-P40I", "SOUNDCORE", "AUDIO", "หูฟัง Soundcore P40i", "Soundcore P40i", "声阔 P40i", 1790, 940, true, "goods"],
  ["SC-MOTION300", "SOUNDCORE", "AUDIO", "ลำโพง Soundcore Motion 300", "Soundcore Motion 300", "声阔 Motion 300", 2790, 1590, true, "goods"],
  ["DRM-X40U", "DREAME", "CLEANING", "Dreame X40 Ultra หุ่นยนต์ดูดฝุ่น", "Dreame X40 Ultra", "追觅 X40 Ultra", 42900, 26900, true, "goods"],
  ["DRM-H12", "DREAME", "CLEANING", "Dreame H12 Pro เครื่องดูดฝุ่นเปียก", "Dreame H12 Pro", "追觅 H12 Pro", 16900, 10200, true, "goods"],
  ["DRM-L10S", "DREAME", "CLEANING", "Dreame L10s Ultra", "Dreame L10s Ultra", "追觅 L10s", 29900, 18400, true, "goods"],
  ["DRM-CLEAN1L", "DREAME", "SUPPLIES", "น้ำยาทำความสะอาดพื้น Dreame 1L", "Dreame Floor Cleaner 1L", "追觅清洁液 1L", 590, 260, false, "goods"],
  ["DDP-MIX5", "DDPAI", "DASHCAM", "DDPAI Mix5 Pro", "DDPAI Mix5 Pro", "盯盯拍 Mix5", 5990, 3490, true, "goods"],
  ["DDP-N5", "DDPAI", "DASHCAM", "DDPAI N5 Dual", "DDPAI N5 Dual", "盯盯拍 N5", 4290, 2490, true, "goods"],
  ["SVC-FR-4DR", "70MAI", "SERVICE", "ค่าติดตั้ง รถทั่วไป หน้า-หลัง 4 ประตู", "Install Front+Rear 4-door", "安装 4门", 1200, 0, false, "service"],
  ["SVC-FR-HB", "70MAI", "SERVICE", "ค่าติดตั้ง รถทั่วไป หน้า-หลัง Hatchback", "Install Front+Rear HB", "安装 掀背", 1500, 0, false, "service"],
  ["SVC-EU-HB", "70MAI", "SERVICE", "ค่าติดตั้ง รถยุโรป/EV หน้า-หลัง", "Install EU/EV Front+Rear", "安装 欧系/EV", 1800, 0, false, "service"],
  ["SVC-REMOVE", "70MAI", "SERVICE", "ค่าถอด-รื้อระบบกล้องเก่า", "Remove old camera", "拆除旧设备", 300, 0, false, "service"],
  ["FEE-TRAVEL", "70MAI", "FEE", "ค่าเดินทางบริการนอกสถานที่", "On-site travel fee", "上门服务费", 500, 0, false, "fee"],
];

export const DEMO_PRODUCTS: Product[] = PRODUCT_SRC.map((p, i) => ({
  id: id("p", i + 1),
  sku: p[0],
  brand_id: bId(p[1]),
  category_id: gId(p[2]),
  kind: p[9] as Product["kind"],
  name_th: p[3],
  name_en: p[4],
  name_zh: p[5],
  short_name: p[4],
  unit: p[9] === "goods" ? "ชิ้น" : "รายการ",
  price: p[6],
  cost: p[7],
  vat_rate: 7,
  is_discountable: true,
  max_discount_percent: null,
  track_serial: p[8],
  warranty_months: p[9] === "goods" ? 24 : 0,
  is_stocked: p[9] === "goods",
  reorder_point: p[6] > 10000 ? 2 : p[6] > 3000 ? 4 : 10,
  barcodes: [`885${String(1000000 + i * 7919).padStart(10, "0")}`],
  is_active: true,
}));

// ---------------------------------------------------------------------
// EMPLOYEES — ชื่อเล่นอิงจากพนักงานขายจริงในไฟล์ปี 2024
// ---------------------------------------------------------------------
type E = [string, string, string, Employee["role"], Employee["data_scope"], string, number, boolean];
const EMPLOYEE_SRC: E[] = [
  ["EMP-0001", "Rice", "rice", "hq", "company", "HQ-WAREHOUSE", 100, true],
  ["EMP-0101", "Nattasak", "nattasak", "manager", "branch", "70MAI-RAMINTRA", 20, true],
  ["EMP-0102", "Tanakorn", "tanakorn", "supervisor", "branch", "70MAI-RAMINTRA", 10, true],
  ["EMP-0103", "Nichakan", "nichakan", "staff", "own", "70MAI-RAMINTRA", 5, false],
  ["EMP-0104", "Thada", "thada", "staff", "own", "70MAI-RAMINTRA", 5, false],
  ["EMP-0111", "Anusorn", "anusorn", "manager", "branch", "70MAI-KANJANA", 20, true],
  ["EMP-0112", "Namfon", "namfon", "staff", "own", "70MAI-KANJANA", 5, false],
  ["EMP-0201", "Chananthorn", "chananthorn", "manager", "branch", "ANKER-CTW", 20, true],
  ["EMP-0202", "Somsak", "som", "staff", "own", "ANKER-CTW", 5, false],
  ["EMP-0203", "Kanchaporn", "kanchaporn", "staff", "own", "ANKER-CTW", 5, false],
  ["EMP-0211", "Awirut", "awirut", "supervisor", "branch", "ANKER-RAMA9", 10, true],
  ["EMP-0301", "Queenkanok", "queenkanok", "manager", "branch", "DREAME-WESTGATE", 20, true],
  ["EMP-0302", "Patchara", "พัชรา", "staff", "own", "DREAME-WESTGATE", 5, false],
  ["EMP-0303", "Thitima", "ธิติมา", "staff", "own", "DREAME-SEACON", 5, false],
  ["EMP-9001", "Brand Admin 70mai", "ba70mai", "brand_admin", "brand", "HQ-WAREHOUSE", 0, false],
  ["EMP-9002", "Brand Admin Anker", "baanker", "brand_admin", "brand", "HQ-WAREHOUSE", 0, false],
];

export const DEMO_EMPLOYEES: Employee[] = EMPLOYEE_SRC.map((e, i) => {
  const home = cId(e[5]);
  const role = e[3];
  return {
    id: id("e", i + 1),
    employee_code: e[0],
    first_name: e[1],
    last_name: null,
    nickname: e[2],
    role,
    data_scope: e[4],
    home_branch_id: home,
    branch_ids:
      role === "hq"
        ? DEMO_BRANCHES.map((b) => b.id)
        : role === "brand_admin"
        ? DEMO_BRANCHES.filter((b) =>
            e[0] === "EMP-9001" ? b.code.startsWith("70MAI") : b.code.startsWith("ANKER")
          ).map((b) => b.id)
        : [home],
    brand_ids:
      e[0] === "EMP-9001" ? [bId("70MAI")] : e[0] === "EMP-9002" ? [bId("ANKER"), bId("SOUNDCORE")] : [],
    max_discount_percent: e[6],
    can_open_drawer: e[7],
    status: "active",
    pin: "1234",
  };
});

// ---------------------------------------------------------------------
// STOCK
// ---------------------------------------------------------------------
export function buildDemoStock(): StockLevel[] {
  const rnd = mulberry32(20260916);
  const out: StockLevel[] = [];
  for (const b of DEMO_BRANCHES) {
    if (b.branch_type === "warehouse") continue;
    for (const p of DEMO_PRODUCTS) {
      if (!p.is_stocked) continue;
      const sameBrand = p.brand_id === b.brand_id;
      const ankerShop = b.code.startsWith("ANKER") && p.brand_id === bId("SOUNDCORE");
      if (!sameBrand && !ankerShop) continue;
      const qty = Math.floor(rnd() * 45);
      out.push({
        branch_id: b.id,
        product_id: p.id,
        qty_on_hand: qty,
        qty_reserved: 0,
        reorder_point: p.reorder_point,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// CUSTOMERS
// ---------------------------------------------------------------------
export const DEMO_CUSTOMERS: Customer[] = [
  { id: id("u", 1), member_code: "M-000001", name: "คุณภาคิน วงศ์สว่าง", phone: "085-555-4649", email: null, tax_id: null, tax_name: null, tax_address: null, points: 320, store_credit: 0 },
  { id: id("u", 2), member_code: "M-000002", name: "คุณวรชาติ ศรีสุข", phone: "081-868-2828", email: null, tax_id: "0105556000123", tax_name: "บริษัท วรชาติ ทรานสปอร์ต จำกัด", tax_address: "กรุงเทพมหานคร", points: 1180, store_credit: 500 },
  { id: id("u", 3), member_code: "M-000003", name: "คุณนงนภัส ใจดี", phone: "095-515-4497", email: "nn@example.com", tax_id: null, tax_name: null, tax_address: null, points: 90, store_credit: 0 },
  { id: id("u", 4), member_code: "M-000004", name: "คุณธนกร เพชรรัตน์", phone: "062-114-7788", email: "thanakorn.p@example.com", tax_id: null, tax_name: null, tax_address: null, points: 540, store_credit: 0 },
  { id: id("u", 5), member_code: "M-000005", name: "คุณศิริพร มั่งมี", phone: "089-232-1145", email: null, tax_id: null, tax_name: null, tax_address: null, points: 2120, store_credit: 1500 },
  { id: id("u", 6), member_code: "M-000006", name: "คุณอรรถพล สุขเกษม", phone: "084-909-3321", email: "attapol@example.com", tax_id: "0105560001234", tax_name: "บริษัท สุขเกษม โฮลดิ้ง จำกัด", tax_address: "นนทบุรี", points: 760, store_credit: 0 },
  { id: id("u", 7), member_code: "M-000007", name: "คุณเมธาวี จันทร์เพ็ญ", phone: "091-554-8890", email: null, tax_id: null, tax_name: null, tax_address: null, points: 45, store_credit: 0 },
  { id: id("u", 8), member_code: "M-000008", name: "คุณกิตติศักดิ์ ว่องไว", phone: "086-778-2290", email: "kittisak.w@example.com", tax_id: null, tax_name: null, tax_address: null, points: 1890, store_credit: 300 },
  { id: id("u", 9), member_code: "M-000009", name: "คุณปวีณา แสงทอง", phone: "092-443-1180", email: null, tax_id: null, tax_name: null, tax_address: null, points: 310, store_credit: 0 },
  { id: id("u", 10), member_code: "M-000010", name: "คุณสมชาย เจริญพร", phone: "081-220-6677", email: null, tax_id: "0105559004567", tax_name: "ร้านเจริญพรอิเล็กทรอนิกส์", tax_address: "สมุทรปราการ", points: 3450, store_credit: 2000 },
  { id: id("u", 11), member_code: "M-000011", name: "คุณจุฑามาศ ทองดี", phone: "090-116-4432", email: "jutamas@example.com", tax_id: null, tax_name: null, tax_address: null, points: 180, store_credit: 0 },
  { id: id("u", 12), member_code: "M-000012", name: "คุณวิศรุต ภักดี", phone: "083-667-9900", email: null, tax_id: null, tax_name: null, tax_address: null, points: 920, store_credit: 0 },
  { id: id("u", 13), member_code: "M-000013", name: "คุณณัฐริกา พูนผล", phone: "088-335-1267", email: "nattarika@example.com", tax_id: null, tax_name: null, tax_address: null, points: 60, store_credit: 0 },
  { id: id("u", 14), member_code: "M-000014", name: "คุณอภิวัฒน์ รุ่งเรือง", phone: "094-889-5521", email: null, tax_id: "0105561007788", tax_name: "บริษัท รุ่งเรือง เทรดดิ้ง จำกัด", tax_address: "ปทุมธานี", points: 1340, store_credit: 0 },
];

// ---------------------------------------------------------------------
// ORDERS ย้อนหลัง 60 วัน — สำหรับ dashboard ให้เห็นกราฟจริง
// ---------------------------------------------------------------------
const PAY_MIX: [PaymentMethod, number][] = [
  ["credit_card", 0.45],
  ["qr_promptpay", 0.4],
  ["bank_transfer", 0.09],
  ["cash", 0.04],
  ["installment", 0.02],
];

function pickPayment(r: number): PaymentMethod {
  let acc = 0;
  for (const [m, w] of PAY_MIX) {
    acc += w;
    if (r <= acc) return m;
  }
  return "cash";
}

export function buildDemoOrders(days = 90): Order[] {
  const rnd = mulberry32(777);
  const orders: Order[] = [];
  const shops = DEMO_BRANCHES.filter((b) => b.branch_type === "brand_shop");
  const now = new Date();
  let seq = 0;

  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    const weekend = day.getDay() === 0 || day.getDay() === 6;

    for (const branch of shops) {
      const base = branch.code.startsWith("70MAI") ? 9 : branch.code.startsWith("ANKER") ? 7 : 5;
      const count = Math.max(1, Math.round(base * (weekend ? 1.45 : 1) * (0.6 + rnd() * 0.9)));
      const branchProducts = DEMO_PRODUCTS.filter(
        (p) => p.brand_id === branch.brand_id || (branch.code.startsWith("ANKER") && p.brand_id === bId("SOUNDCORE"))
      );
      if (!branchProducts.length) continue;
      const staff = DEMO_EMPLOYEES.filter((e) => e.home_branch_id === branch.id);

      for (let i = 0; i < count; i++) {
        const hour = 10 + Math.floor(rnd() * 11);
        const at = new Date(day);
        at.setHours(hour, Math.floor(rnd() * 60), 0, 0);
        if (at > now) continue;

        const nLines = 1 + Math.floor(rnd() * 3);
        const items: OrderItem[] = [];
        for (let k = 0; k < nLines; k++) {
          const p = branchProducts[Math.floor(rnd() * branchProducts.length)];
          const qty = 1 + (rnd() > 0.85 ? 1 : 0);
          const discPct = rnd() > 0.82 ? Math.round(rnd() * 5) : 0;
          const gross = p.price * qty;
          const disc = round2((gross * discPct) / 100);
          const total = round2(gross - disc);
          const costTotal = round2(p.cost * qty);
          items.push({
            id: id("i", ++seq),
            product_id: p.id,
            sku: p.sku,
            name: p.name_th,
            kind: p.kind === "service" ? "service" : p.kind === "fee" ? "fee" : "goods",
            qty,
            unit_price: p.price,
            discount_amount: disc,
            line_total: total,
            unit_cost: p.cost,
            cost_total: costTotal,
            gross_profit: round2(total / 1.07 - costTotal),
            serials: [],
            salesperson_id: staff.length ? staff[Math.floor(rnd() * staff.length)].id : null,
            returned_qty: 0,
          });
        }

        const grand = round2(items.reduce((s, it) => s + it.line_total, 0));
        const subtotal = round2(items.reduce((s, it) => s + it.unit_price * it.qty, 0));
        const costTotal = round2(items.reduce((s, it) => s + it.cost_total, 0));
        const method = pickPayment(rnd());
        const sp = items[0].salesperson_id;
        // ~32% ของบิลผูกกับลูกค้าสมาชิก (ให้หน้า CRM/ลูกค้ามีประวัติซื้อ)
        const cust = rnd() < 0.32 ? DEMO_CUSTOMERS[Math.floor(rnd() * DEMO_CUSTOMERS.length)] : null;

        orders.push({
          id: id("o", seq + 10000),
          order_no: `${branch.code.replace(/[^A-Z0-9]/g, "").slice(0, 3)}1-${at.toISOString().slice(2, 10).replace(/-/g, "")}-${String(i + 1).padStart(4, "0")}`,
          branch_id: branch.id,
          shift_id: null,
          cashier_id: sp,
          salesperson_id: sp,
          customer_id: cust?.id ?? null,
          customer_name: cust?.name ?? null,
          customer_phone: cust?.phone ?? null,
          status: rnd() > 0.995 ? "voided" : "completed",
          channel: rnd() > 0.92 ? "online_shopee" : "offline",
          subtotal,
          discount_total: round2(subtotal - grand),
          vat_amount: round2(grand - grand / 1.07),
          grand_total: grand,
          paid_total: grand,
          change_amount: 0,
          cost_total: costTotal,
          gross_profit: round2(grand / 1.07 - costTotal),
          items,
          payments: [{ method, amount: grand }],
          is_offline_origin: false,
          created_at: at.toISOString(),
        });
      }
    }
  }
  return orders.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function buildDemoAudit(orders: Order[]): AuditEntry[] {
  const out: AuditEntry[] = [];
  const recent = orders.slice(0, 60);
  recent.forEach((o, i) => {
    const emp = DEMO_EMPLOYEES.find((e) => e.id === o.cashier_id);
    out.push({
      id: id("a", i + 1),
      action: o.status === "voided" ? "void" : "sale",
      actor_id: o.cashier_id,
      actor_name: emp?.nickname ?? null,
      branch_id: o.branch_id,
      ref_table: "orders",
      ref_no: o.order_no,
      amount: o.grand_total,
      after_data: { items: o.items.length, channel: o.channel },
      is_offline: false,
      occurred_at: o.created_at,
    });
  });
  return out;
}

// ---------------------------------------------------------------------
// ORG POSITIONS (ผังองค์กรเริ่มต้นต่อสาขา) — ให้หน้าผัง/ตามตำแหน่งมีข้อมูลเลย
//   โครงสร้าง: คนตำแหน่งสูงสุดของสาขา = หัว, ที่เหลือรายงานตรงต่อหัว
//   เก็บลง localStorage (shdpos.org.<branchId>) ตอน seed — ผู้ใช้แก้ทับได้
// ---------------------------------------------------------------------
const ROLE_POS_CODE: Record<string, string> = {
  owner: "regional_manager", hq: "operations", brand_admin: "brand_manager",
  manager: "store_manager", supervisor: "shift_lead", staff: "sales", auditor: "admin",
};
const ROLE_RANK: Record<string, number> = { owner: 6, hq: 5, brand_admin: 4, manager: 3, supervisor: 2, staff: 1, auditor: 1 };

export function buildDemoOrgPositions(): { branchId: string; rows: { id: string; employee_id: string; title: string; reports_to: string | null; sort_order: number }[] }[] {
  const shops = DEMO_BRANCHES.filter((b) => b.branch_type === "brand_shop");
  const out: { branchId: string; rows: { id: string; employee_id: string; title: string; reports_to: string | null; sort_order: number }[] }[] = [];
  for (const b of shops) {
    const staff = DEMO_EMPLOYEES.filter((e) => e.home_branch_id === b.id && e.status === "active");
    if (!staff.length) continue;
    const sorted = [...staff].sort((a, z) => (ROLE_RANK[z.role] ?? 0) - (ROLE_RANK[a.role] ?? 0));
    const root = sorted[0];
    // ชั้นกลาง: supervisor รายงานหัว, staff รายงาน supervisor คนแรก (ถ้ามี) ไม่งั้นรายงานหัว
    const firstSup = sorted.find((e) => e.role === "supervisor" && e.id !== root.id);
    const rows = sorted.map((e, i) => {
      let reports_to: string | null = null;
      if (e.id !== root.id) reports_to = e.role === "staff" && firstSup ? firstSup.id : root.id;
      return { id: `pos-${b.id}-${e.id}`, employee_id: e.id, title: ROLE_POS_CODE[e.role] ?? "sales", reports_to, sort_order: i };
    });
    out.push({ branchId: b.id, rows });
  }
  return out;
}
