// จับคู่ชื่อร้าน Dataverse → สาขาเรา (ชื่อจริงจากระบบเดิม)
import { matchBranch, matchPerson, personKey } from "../src/lib/server/dataverse";
import { legacyChannel, cleanSaleType } from "../src/lib/legacy-expand";
let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error(`${m}: ได้ ${JSON.stringify(a)} ต้องการ ${JSON.stringify(b)}`); n++; };
const B = [
  ["70MAI-KANJANA", "70mai Kanchanaphisek"], ["70MAI-RAMINTRA", "70mai Ramintra"], ["70MAI-CHONBURI", "70mai Chonburi"], ["70MAI-RATCHA", "70mai Ratchaphruek"], ["70MAI-THAPHRA", "70mai Tha Phra"], ["70MAI-RANGSIT", "70mai Rangsit"],
  ["ANKER-CTW", "Anker Central World"], ["ANKER-NGAMWONG", "Anker The Mall Ngamwongwan"], ["ANKER-VD-SIAM", "Vending Anker BTS Siam"], ["ANKER-VD-BANGNA", "Vending Anker Mega Bangna"], ["ANKER-BANGKAPI", "Anker The Mall Bangkapi"],
  ["DREAME-RAMA2", "Dreame Central Rama 2"], ["DREAME-MEGA", "Dreame Mega Bangna"], ["DREAME-NGAMWONG", "Dreame The Mall Ngamwongwan"], ["DREAME-WESTGATE", "Dreame Central Westgate"], ["DDPAI-PINKLAO", "DDPAI SUSCO Pinklao"],
].map(([code, name]) => ({ id: code, code, name, name_th: null, brand_id: null }));
const m = (s: string) => matchBranch(s, B)?.branch_id ?? null;
eq(m("70mai kanjana"), "70MAI-KANJANA", "ชื่อตามรหัสสาขา"); eq(m("70Mai Ratchaphruek"), "70MAI-RATCHA", "ตัวพิมพ์ต่าง"); eq(m("70mai Tha Phra"), "70MAI-THAPHRA", "ตรงตัว");
eq(m("Vending-BTS Siam ANKER"), "ANKER-VD-SIAM", "ลำดับคำต่าง"); eq(m("Vending-Anker Mega bangna"), "ANKER-VD-BANGNA", "ขีดแทนเว้นวรรค");
eq(m("Anker The mall ngarmvongvan"), "ANKER-NGAMWONG", "สะกดต่าง"); eq(m("Dreame The mall ngarmvongvan"), "DREAME-NGAMWONG", "สะกดต่าง (คนละแบรนด์)");
eq(m("Dreame central rama2"), "DREAME-RAMA2", "เลขติดคำ"); eq(m("Dreame mega bangna"), "DREAME-MEGA", "ห้าง"); eq(m("DDPAI SUSCO Pinklao"), "DDPAI-PINKLAO", "ตรง");
eq(m("70mai Srinakarin"), null, "ไม่มีสาขานี้ในระบบ = ไม่จับมั่ว"); eq(m("Impactmungthongthani 23 Oct - 1 Nov 26"), null, "อีเวนต์ไม่จับ");
// พนักงานขาย (ชื่อพิมพ์เอง) → พนักงานในระบบ: จับเฉพาะเมื่อชัดเจน 1 คน
const E = [
  { id: "e1", first_name: "ณัฐศักดิ์", last_name: "ใจดี", nickname: "นัท", email: "nattasak@shd-technology.co.th" },
  { id: "e2", first_name: "Somchai", last_name: "Dee", nickname: "Som", email: "somchai.d@shd-technology.co.th" },
  { id: "e3", first_name: "Somsak", last_name: "Rak", nickname: "Som", email: "somsak@shd-technology.co.th" },
  { id: "e4", first_name: "ปาริชาติ", last_name: "สุข", nickname: null, email: null },
];
eq(matchPerson("nattasak", E), "e1", "ชื่ออีเมล"); eq(matchPerson("  Nattasak ", E), "e1", "ตัวพิมพ์/ช่องว่าง"); eq(matchPerson("ปาริชาติ", E), "e4", "ชื่อไทย");
eq(matchPerson("som", E), null, "ชื่อเล่นซ้ำ 2 คน = ไม่จับมั่ว"); eq(matchPerson("somchai", E), "e2", "ชื่ออีเมลส่วนแรก"); eq(matchPerson("ใครก็ไม่รู้", E), null, "ไม่มีในระบบ");
eq(matchPerson("pheerachan", [{ id: "t", first_name: "Tiw - Pheerachan (Senior Full Stack AI Engineer)", last_name: null, nickname: null, email: null }]), "t", "รูปแบบ ชื่อเล่น - ชื่อ (ตำแหน่ง)");
eq(personKey("  Kan  Chaporn "), "kan chaporn", "key ปกติ"); eq(personKey(""), null, "ว่าง");
eq(legacyChannel("online-shopee", false), "online_shopee", "Shopee"); eq(legacyChannel("LZD", false), "online_lazada", "Lazada"); eq(legacyChannel("TikTok", false), "online_tiktok", "TikTok");
eq(legacyChannel("online-website", false), "online_website", "เว็บไซต์"); eq(legacyChannel("offline", false), "offline", "หน้าร้าน"); eq(legacyChannel("online-shopee", true), "event", "อีเวนต์คงเป็นอีเวนต์");
eq(cleanSaleType("ขายสินค้า商品销售"), "ขายสินค้า", "ตัดภาษาจีน"); eq(cleanSaleType("บริการติดตั้ง安装服务"), "บริการติดตั้ง", "บริการ");
console.log(`PASS: ${n} Dataverse place matching checks (places, salespeople, channels, sale types — no false match)`);
