// =====================================================================
// สายอนุมัติ (Approval Rules) — ตั้งว่า "ใครอนุมัติได้" ต่อกระบวนการ
//   ขอบเขต: ตามแบรนด์ (ครอบทุกสาขาของแบรนด์) หรือ ตามสาขา (ตั้งทับเฉพาะจุด)
//   เก็บใน kv ของ Dexie (local-first เหมือนใบโอนย้าย) — ย้ายขึ้น Supabase ได้ภายหลัง
// =====================================================================
import { kvGet, kvSet } from "../offline/db";
import { nanoid } from "nanoid";

/** กระบวนการที่ตั้งสายอนุมัติได้ (ตอนนี้มีโอนย้าย · ออกแบบให้เพิ่มได้) */
export type ApprovalProcess = "transfer";

export interface ApprovalRule {
  id: string;
  process: ApprovalProcess;
  scope: "brand" | "branch";
  scope_id: string;                 // brand_id หรือ branch_id
  approver_ids: string[];           // employee ids
  /** (สำหรับ scope=branch) ใช้เฉพาะรายชื่อนี้ ไม่รวมผู้อนุมัติของแบรนด์ */
  override_brand?: boolean;
  note?: string | null;
  is_active?: boolean;
  updated_at: string;
  updated_by?: string | null;
}

const KEY = "approval_rules";

export async function listApprovalRules(): Promise<ApprovalRule[]> {
  return kvGet<ApprovalRule[]>(KEY, []);
}
export async function saveApprovalRules(rules: ApprovalRule[]): Promise<void> {
  await kvSet(KEY, rules);
}

/** ตั้ง/อัปเดตสายอนุมัติของ (process, scope, scope_id) — รายชื่อว่าง = ลบ rule นั้น */
export async function setApproverRule(input: {
  process: ApprovalProcess; scope: "brand" | "branch"; scope_id: string;
  approver_ids: string[]; override_brand?: boolean; note?: string | null; by?: string | null;
}): Promise<ApprovalRule[]> {
  const rules = await listApprovalRules();
  const i = rules.findIndex((r) => r.process === input.process && r.scope === input.scope && r.scope_id === input.scope_id);
  const clean = Array.from(new Set(input.approver_ids.filter(Boolean)));
  // ไม่มีผู้อนุมัติ และไม่ได้ override → ไม่มีความหมาย ลบทิ้ง
  if (!clean.length && !input.override_brand) {
    if (i >= 0) { rules.splice(i, 1); await saveApprovalRules(rules); }
    return rules;
  }
  const next: ApprovalRule = {
    id: i >= 0 ? rules[i].id : nanoid(10),
    process: input.process, scope: input.scope, scope_id: input.scope_id,
    approver_ids: clean, override_brand: input.scope === "branch" ? !!input.override_brand : undefined,
    note: input.note ?? null, is_active: true, updated_at: new Date().toISOString(), updated_by: input.by ?? null,
  };
  if (i >= 0) rules[i] = next; else rules.push(next);
  await saveApprovalRules(rules);
  return rules;
}

/**
 * หาผู้อนุมัติที่ "ตั้งค่าไว้" สำหรับสาขาหนึ่ง (รวมกฎแบรนด์)
 * คืน null = ไม่มีกฎเลย (ให้ผู้เรียก fallback เป็นสิทธิ์ permission เดิม)
 */
export function resolveApprovers(
  rules: ApprovalRule[],
  opts: { process: ApprovalProcess; branchId: string; brandId?: string | null },
): string[] | null {
  const act = rules.filter((r) => r.process === opts.process && r.is_active !== false);
  const branchRule = act.find((r) => r.scope === "branch" && r.scope_id === opts.branchId);
  const brandRule = opts.brandId ? act.find((r) => r.scope === "brand" && r.scope_id === opts.brandId) : undefined;
  if (!branchRule && !brandRule) return null; // ไม่มีกฎ → ใช้ระบบสิทธิ์เดิม
  const ids = new Set<string>();
  // กฎแบรนด์ครอบทุกสาขา เว้นแต่สาขานี้สั่ง override
  if (brandRule && !(branchRule?.override_brand)) brandRule.approver_ids.forEach((x) => ids.add(x));
  if (branchRule) branchRule.approver_ids.forEach((x) => ids.add(x));
  return Array.from(ids);
}
