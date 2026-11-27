// จับคู่ชื่อร้าน Dataverse → สาขาเรา (ชื่อจริงจากระบบเดิม)
import { matchBranch } from "../src/lib/server/dataverse";
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
console.log(`PASS: ${n} Dataverse place matching checks (code names, word order, spelling variants, no false match)`);
