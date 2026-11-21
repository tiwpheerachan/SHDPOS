import { isLiveMode } from "@/lib/supabase/client";
import { uuidv4 } from "@/lib/uuid";
export async function checkoutRequest(
  action: string,
  id: string,
  branchId: string,
  extra: Record<string, unknown> = {},
) {
  const r = await fetch("/api/pos/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, id, branch_id: branchId, ...extra }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "เชื่อม Checkout กลางไม่สำเร็จ");
  return data;
}
/** Persist operation identity before collecting money, so refresh/retry never creates a fresh charge. */
export function checkoutIdentity(
  branchId: string,
  actorId: string,
  fingerprint: string,
): string {
  if (!isLiveMode()) return uuidv4();
  const key = `shdpos.checkout:${actorId}:${branchId}`;
  const previous = JSON.parse(localStorage.getItem(key) || "null");
  if (previous && previous.fingerprint !== fingerprint)
    throw new Error(
      "มีรายการรับชำระเดิมค้างอยู่ กรุณาเปิดศูนย์ตรวจสอบรายการก่อนเริ่มบิลใหม่",
    );
  if (previous) return previous.id;
  const id = uuidv4();
  localStorage.setItem(
    key,
    JSON.stringify({ id, fingerprint, at: new Date().toISOString() }),
  );
  return id;
}
export function clearCheckoutIdentity(branchId: string, actorId: string) {
  const key = `shdpos.checkout:${actorId}:${branchId}`;
  const saved = JSON.parse(localStorage.getItem(key) || "null");
  if (saved?.id) localStorage.removeItem(`shdpos.payment:${saved.id}`);
  localStorage.removeItem(key);
}
