// ลิงก์ใบเสร็จออนไลน์สำหรับ QR บนสลิป — รอไม่เกิน 2.5 วิ (ไม่ให้การพิมพ์ช้า) · ไม่ได้ = ไม่พิมพ์ QR
export async function receiptLink(clientUuid?: string | null): Promise<string | null> {
  if (!clientUuid || typeof window === "undefined") return null;
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(`/api/pos/receipt-link?client_uuid=${clientUuid}`, { cache: "no-store", signal: ctrl.signal });
    const j = (await r.json()) as { url?: string | null };
    return r.ok && j.url ? new URL(j.url, window.location.origin).href : null;
  } catch { return null; } finally { clearTimeout(t); }
}
