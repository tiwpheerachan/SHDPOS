// =====================================================================
// บันทึก "มุมมอง" (View) ที่ AI สร้าง — เก็บใน localStorage ต่อเครื่อง
//   (เฟสถัดไปย้ายขึ้น DB เพื่อแชร์ข้ามเครื่อง/ทีมได้)
// =====================================================================
import type { View } from "./engine";

const KEY = "shdpos.ai.views";

export function listViews(): View[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as View[]) : [];
    return Array.isArray(arr) ? arr.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")) : [];
  } catch { return []; }
}
export function saveView(v: View): View[] {
  const all = listViews().filter((x) => x.id !== v.id);
  all.unshift(v);
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(0, 100))); } catch { /* private mode */ }
  return listViews();
}
export function deleteView(id: string): View[] {
  try { localStorage.setItem(KEY, JSON.stringify(listViews().filter((x) => x.id !== id))); } catch { /* ignore */ }
  return listViews();
}
export function renameView(id: string, name: string): View[] {
  const all = listViews().map((x) => (x.id === id ? { ...x, name } : x));
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return listViews();
}
