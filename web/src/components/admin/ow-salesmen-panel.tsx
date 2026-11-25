"use client";
// ผูกพนักงาน POS ↔ พนักงานขาย JST (ERIS-254) — บิลที่ส่ง OW หลังผูกจะมี salespersonId
import { useEffect, useMemo, useState } from "react";
import { UserRound, RefreshCw, Wand2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";

type Emp = { id: string; employee_code: string | null; first_name: string | null; last_name: string | null; nickname: string | null; job_title: string | null; status: string | null; bills_90d: number };
type Data = { linked: boolean; ow_branch_id?: string; employees: Emp[]; map: { employee_id: string; jst_user_id: string; jst_name: string | null }[]; jst: { id: string; name: string }[]; jst_error: string | null };
type Br = { id: string; code: string; name: string; name_th: string | null };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/^(นาย|นางสาว|นาง|น\.ส\.|mr\.?|ms\.?|mrs\.?)/, "");
const empName = (e: Emp) => [e.first_name, e.last_name].filter(Boolean).join(" ") || e.nickname || e.employee_code || e.id.slice(0, 8);

export function OwSalesmenPanel() {
  const [branches, setBranches] = useState<Br[]>([]), [linked, setLinked] = useState<Set<string>>(new Set());
  const [branch, setBranch] = useState(""), [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({}), [busy, setBusy] = useState<string | null>(null), [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  useEffect(() => { void (async () => {
    const r = await fetch("/api/admin/ow-outbox", { cache: "no-store" }); const j = await r.json(); if (!r.ok) { setMsg({ ok: false, t: j.error }); return; }
    const ids = new Set<string>(j.sale_links.map((x: { branch_id: string }) => x.branch_id));
    setLinked(ids); setBranches((j.branches as Br[]).filter((b) => ids.has(b.id)));
    const first = j.sale_links[0]?.branch_id; if (first) setBranch(first);
  })(); }, []);

  async function load(b = branch) {
    if (!b) return;
    setData(null); setDraft({});
    const r = await fetch(`/api/admin/ow-salesmen?branch_id=${b}`, { cache: "no-store" }); const j = await r.json();
    if (!r.ok) { setMsg({ ok: false, t: j.error }); return; }
    setData(j);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [branch]);

  const current = (id: string) => draft[id] ?? data?.map.find((m) => m.employee_id === id)?.jst_user_id ?? "";
  const jstName = (uid: string) => data?.jst.find((x) => x.id === uid)?.name ?? data?.map.find((m) => m.jst_user_id === uid)?.jst_name ?? null;
  const dirty = useMemo(() => Object.entries(draft).filter(([id, v]) => v !== (data?.map.find((m) => m.employee_id === id)?.jst_user_id ?? "")), [draft, data]);

  // เดาคู่จากชื่อ (ชื่อจริง/ชื่อเล่น ตรงกับชื่อใน JST) — เติมเป็นร่าง ให้ตรวจก่อนบันทึก
  function autoMatch() {
    if (!data?.jst.length) return;
    const next: Record<string, string> = {};
    for (const e of data.employees) {
      if (current(e.id)) continue;
      const keys = [empName(e), e.first_name ?? "", e.nickname ?? ""].filter((x) => x.length >= 2).map(norm);
      const hit = data.jst.filter((j) => keys.some((k) => norm(j.name).includes(k) || k.includes(norm(j.name))));
      if (hit.length === 1) next[e.id] = hit[0].id;
    }
    setDraft((d) => ({ ...d, ...next }));
    setMsg({ ok: true, t: `จับคู่จากชื่อได้ ${Object.keys(next).length} คน — ตรวจแล้วกดบันทึก` });
  }

  async function saveAll() {
    setBusy("all"); setMsg(null);
    try {
      for (const [id, v] of dirty) {
        const r = await fetch("/api/admin/ow-salesmen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch_id: branch, employee_id: id, jst_user_id: v || null, jst_name: v ? jstName(v) : null }) });
        const j = await r.json(); if (!r.ok) throw Error(j.error);
      }
      setMsg({ ok: true, t: `บันทึก ${dirty.length} รายการแล้ว — บิลถัดไปจะส่งพนักงานขายเข้า JST` }); await load();
    } catch (e) { setMsg({ ok: false, t: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ" }); } finally { setBusy(null); }
  }

  const mappedCount = data ? data.employees.filter((e) => current(e.id)).length : 0;
  return (
    <section className="rounded-2xl border border-line/70 bg-surface overflow-hidden">
      <div className="p-3 border-b border-line flex flex-wrap items-center gap-2">
        <UserRound size={15} className="text-brand" />
        <p className="text-sm font-semibold mr-2">พนักงานขาย JST</p>
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-8 rounded-lg bg-surface2/70 border border-line text-xs px-2">
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_th || b.name}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={() => void load()}><RefreshCw size={13} /> โหลดใหม่</Button>
        <Button size="sm" variant="soft" disabled={!data?.jst.length} onClick={autoMatch}><Wand2 size={13} /> จับคู่จากชื่อ</Button>
        <Button size="sm" variant="primary" disabled={!dirty.length} loading={busy === "all"} onClick={() => void saveAll()}>บันทึก {dirty.length ? `(${dirty.length})` : ""}</Button>
        <span className="text-[11px] text-muted ml-auto">บิลส่ง <code>salespersonId</code> = พนักงานขายของบิล (ไม่ระบุใช้แคชเชียร์) · ไม่ผูก = ไม่ส่ง</span>
      </div>
      {!linked.size ? <p className="px-4 py-6 text-xs text-muted">ยังไม่มีสาขาที่ผูกสาขาขาย OneWarehouse — ผูกที่แท็บ "ผูกสาขา" ก่อน</p> : null}
      {msg ? <p role={msg.ok ? undefined : "alert"} className={`px-4 py-2 text-xs ${msg.ok ? "text-ok bg-ok/5" : "text-danger bg-danger/5"}`}>{msg.t}</p> : null}
      {data?.jst_error ? <p className="px-4 py-2 text-xs text-warn bg-warn/5">{data.jst_error}</p> : null}
      {data ? (
        <div className="max-h-[calc(100vh-300px)] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-muted sticky top-0"><tr>
              <th className="text-left font-semibold px-4 py-2">พนักงาน POS</th><th className="text-right font-semibold px-3 py-2">บิล 90 วัน</th>
              <th className="text-left font-semibold px-3 py-2">พนักงานขาย JST ({data.jst.length})</th><th className="text-left font-semibold px-3 py-2">สถานะ</th>
            </tr></thead>
            <tbody>
              {data.employees.map((e) => { const v = current(e.id), changed = draft[e.id] !== undefined && dirty.some(([id]) => id === e.id); return (
                <tr key={e.id} className={`border-t border-line/60 ${changed ? "bg-brand/5" : ""}`}>
                  <td className="px-4 py-2"><p className="font-medium">{empName(e)}{e.nickname && e.nickname !== empName(e) ? <span className="text-muted font-normal"> ({e.nickname})</span> : null}</p><p className="text-[10px] text-muted">{e.employee_code ?? ""}{e.job_title ? ` · ${e.job_title}` : ""}</p></td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.bills_90d}</td>
                  <td className="px-3 py-2">
                    {data.jst.length ? (
                      <select value={v} onChange={(x) => setDraft((d) => ({ ...d, [e.id]: x.target.value }))} className="h-8 w-64 rounded-lg bg-surface2/70 border border-line px-2">
                        <option value="">— ไม่ผูก —</option>
                        {v && !data.jst.some((j) => j.id === v) ? <option value={v}>{v} (ไม่พบในรายชื่อปัจจุบัน)</option> : null}
                        {data.jst.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.id}</option>)}
                      </select>
                    ) : (
                      <input value={v} onChange={(x) => setDraft((d) => ({ ...d, [e.id]: x.target.value.trim() }))} placeholder="JST UserId" className="h-8 w-48 rounded-lg bg-surface2/70 border border-line px-2 font-mono" />
                    )}
                  </td>
                  <td className="px-3 py-2">{v ? <Badge tone="ok">ผูกแล้ว{jstName(v) ? ` · ${jstName(v)}` : ""}</Badge> : e.bills_90d ? <Badge tone="warn">ยังไม่ผูก</Badge> : <Badge tone="neutral">ยังไม่ผูก</Badge>}</td>
                </tr>); })}
              {!data.employees.length ? <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">ไม่พบพนักงานของสาขานี้</td></tr> : null}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-muted border-t border-line">ผูกแล้ว {mappedCount}/{data.employees.length} คน · สาขาขาย OW {data.ow_branch_id ?? "—"}</p>
        </div>
      ) : branch ? <p className="px-4 py-6 text-xs text-muted">กำลังโหลด…</p> : null}
    </section>
  );
}
