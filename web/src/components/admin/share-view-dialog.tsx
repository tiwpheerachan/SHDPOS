"use client";
// =====================================================================
// แชร์มุมมองตาราง: ใครเห็นได้บ้าง (เฉพาะฉัน / เลือกคน / ทุกคนที่ดูยอดขายได้) + ลิงก์สาธารณะ (เห็นเฉพาะมุมมองนี้)
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Lock, Users, UserPlus, Globe, Copy, Check, Loader2, Link2Off, Crown, Search } from "lucide-react";
import { tr } from "@/lib/i18n/tr";
import { PersonChip } from "@/components/admin/sheet-tags";

type Person = { id: string; name: string; photo: string | null };
type V = { id: string; name: string; shared: boolean; mine: boolean; owner: string; owner_person?: Person | null; shared_with?: Person[];
  link?: { token?: string; expires_at?: string | null; views?: number; active?: boolean; mode?: "live" | "snapshot"; snapshot_at?: string | null } | null };

export function ShareViewDialog({ view, canLink, onClose, onSave, onChanged, snapshot }: {
  view: V; canLink: boolean; onClose: () => void; snapshot?: () => Record<string, unknown>;
  onSave: (patch: { shared?: boolean; shared_with?: string[] }) => Promise<void>; onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"private" | "team">(view.shared ? "team" : "private");
  const [picked, setPicked] = useState<Person[]>(view.shared_with ?? []);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [copied, setCopied] = useState(false);
  const [days, setDays] = useState<number | null>(30);
  const [link, setLink] = useState(view.link ?? null);
  const [linkMode, setLinkMode] = useState<"live" | "snapshot">(view.link?.mode ?? "live");
  useEffect(() => { if (view.mine) void fetch("/api/admin/report-views?people=1", { cache: "no-store" }).then((r) => r.json()).then((j) => setPeople(j.people ?? [])).catch(() => setPeople([])); }, [view.mine]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);

  const options = useMemo(() => (people ?? []).filter((p) => !picked.some((x) => x.id === p.id) && (!q || p.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 8), [people, picked, q]);
  const url = link?.token ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/sheet/${link.token}` : "";
  const dirty = mode !== (view.shared ? "team" : "private") || picked.map((p) => p.id).sort().join() !== (view.shared_with ?? []).map((p) => p.id).sort().join();

  async function save() {
    setBusy(true); setErr("");
    try { await onSave({ shared: mode === "team", shared_with: picked.map((p) => p.id) }); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function linkAction(action: "link" | "unlink") {
    setBusy(true); setErr("");
    try {
      const snap = action === "link" && linkMode === "snapshot" ? snapshot?.() : undefined;
      if (action === "link" && linkMode === "snapshot" && !snap) throw Error(tr("เปิดแท็บมุมมองนี้ก่อน แล้วค่อยสร้างภาพนิ่ง", "Open this view's tab first to take a snapshot", "请先打开此视图再创建快照"));
      const r = await fetch("/api/admin/report-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id: view.id, days, mode: linkMode, snapshot: snap }) });
      const j = await r.json(); if (!r.ok) throw Error(j.error);
      setLink(j.link ? { ...j.link, views: 0 } : null); await onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const when = (s?: string | null) => (s ? new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : tr("ไม่หมดอายุ", "never", "永不"));

  return createPortal(
    <div className="fixed inset-0 z-[95] bg-black/30 grid place-items-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[520px] max-h-[90vh] overflow-auto bg-surface rounded-2xl shadow-pop border border-line">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-line">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold truncate">{tr("แชร์มุมมอง", "Share view", "共享视图")} “<span translate="no">{view.name}</span>”</p>
            <p className="text-xs text-muted">{tr("คนที่เห็นจะเห็นตัวกรอง/คอลัมน์ของมุมมองนี้ — ข้อมูลตามสิทธิ์สาขาของแต่ละคน", "Viewers get this view's filters/columns — data follows each person's branch access", "可见者看到此视图的筛选/列 — 数据按各自门店权限")}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-surface2 text-muted"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          {/* ใครเห็นได้บ้าง */}
          <section className="space-y-2">
            <p className="text-xs font-semibold text-muted">{tr("ใครเห็นมุมมองนี้ได้บ้าง", "Who can see this view", "谁能看到此视图")}</p>
            <div className="rounded-xl border border-line divide-y divide-line/70">
              <div className="flex items-center gap-2 px-3 py-2"><PersonChip name={view.owner_person?.name ?? view.owner ?? "—"} photo={view.owner_person?.photo} /><span className="ml-auto text-[11px] text-muted inline-flex items-center gap-1"><Crown size={11} />{tr("เจ้าของ", "Owner", "所有者")}</span></div>
              {(view.mine ? mode === "team" : view.shared) ? (
                <div className="flex items-center gap-2 px-3 py-2"><span className="h-[22px] w-[22px] rounded-full bg-brand/10 text-brand grid place-items-center"><Users size={12} /></span>{tr("ทุกคนที่มีสิทธิ์ดูยอดขาย", "Everyone who can view sales", "所有可查看销售的人")}</div>
              ) : null}
              {(view.mine ? picked : view.shared_with ?? []).map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2"><PersonChip name={p.name} photo={p.photo} />
                  {view.mine ? <button onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))} className="ml-auto h-6 w-6 grid place-items-center rounded-md text-muted hover:text-danger" aria-label={tr("เอาออก", "Remove", "移除")}><X size={12} /></button> : <span className="ml-auto text-[11px] text-muted">{tr("ดูได้", "Can view", "可查看")}</span>}
                </div>
              ))}
              {link?.token || link?.active ? <div className="flex items-center gap-2 px-3 py-2"><span className="h-[22px] w-[22px] rounded-full bg-warn/15 text-warn grid place-items-center"><Globe size={12} /></span>{tr("ทุกคนที่มีลิงก์สาธารณะ (เห็นเฉพาะตารางนี้)", "Anyone with the public link (this table only)", "持有公开链接的任何人（仅此表）")}</div> : null}
            </div>
          </section>

          {view.mine ? (
            <>
              <section className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setMode("private")} className={`rounded-xl border px-3 py-2.5 text-left ${mode === "private" ? "border-brand bg-brand/[0.06]" : "border-line hover:bg-surface2"}`}>
                    <span className="flex items-center gap-1.5 font-medium"><Lock size={13} />{tr("เฉพาะฉัน + คนที่เลือก", "Me + chosen people", "仅我 + 指定人员")}</span>
                  </button>
                  <button onClick={() => setMode("team")} className={`rounded-xl border px-3 py-2.5 text-left ${mode === "team" ? "border-brand bg-brand/[0.06]" : "border-line hover:bg-surface2"}`}>
                    <span className="flex items-center gap-1.5 font-medium"><Users size={13} />{tr("ทุกคนที่ดูยอดขายได้", "Everyone with sales access", "所有有销售权限的人")}</span>
                  </button>
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("เพิ่มคน — พิมพ์ชื่อ", "Add people — type a name", "添加人员 — 输入姓名")} className="w-full h-9 pl-8 pr-3 rounded-xl border border-line bg-surface text-sm" />
                </div>
                {q || options.length ? (
                  <div className="rounded-xl border border-line max-h-44 overflow-auto">
                    {people === null ? <p className="px-3 py-2 text-xs text-muted"><Loader2 size={12} className="inline animate-spin" /></p> : null}
                    {options.map((p) => (
                      <button key={p.id} onClick={() => { setPicked((x) => [...x, p]); setQ(""); }} className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-surface2 text-left">
                        <PersonChip name={p.name} photo={p.photo} /><UserPlus size={13} className="ml-auto text-muted" />
                      </button>
                    ))}
                    {people && !options.length ? <p className="px-3 py-2 text-xs text-muted">{tr("ไม่พบชื่อ", "No match", "无匹配")}</p> : null}
                  </div>
                ) : null}
                <div className="flex justify-end"><button onClick={() => void save()} disabled={!dirty || busy} className="h-9 px-4 rounded-xl bg-brand text-brandInk font-medium disabled:opacity-50 inline-flex items-center gap-1.5">{busy ? <Loader2 size={13} className="animate-spin" /> : null}{tr("บันทึกการแชร์", "Save sharing", "保存共享")}</button></div>
              </section>

              {/* ลิงก์สาธารณะ */}
              <section className="space-y-2 border-t border-line pt-4">
                <p className="text-xs font-semibold text-muted flex items-center gap-1.5"><Globe size={13} />{tr("ลิงก์สาธารณะ (ไม่ต้องล็อกอิน)", "Public link (no login)", "公开链接（无需登录）")}</p>
                <p className="text-[11.5px] text-muted">{tr("คนที่เปิดลิงก์จะเห็นเฉพาะตารางของมุมมองนี้ — ไม่เห็นเมนู/หน้าอื่น · ข้อมูลสดตามช่วงวันที่ของมุมมอง · ไม่มีต้นทุนและข้อมูลลูกค้า", "Link viewers see only this view's table — no menus or other pages · live data · no cost or customer data", "打开链接者仅能看到此视图表格 — 无菜单/其他页面 · 实时数据 · 不含成本与顾客信息")}</p>
                {!canLink ? <p className="text-[11.5px] text-warn">{tr("คุณยังไม่มีสิทธิ์สร้างลิงก์สาธารณะ (สิทธิ์ ‘แชร์รายงาน’)", "You need the ‘share reports’ permission to create public links", "需要“共享报表”权限")}</p>
                  : link?.token ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-line bg-surface2 text-xs font-mono" />
                        <button onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="h-9 px-3 rounded-xl border border-line inline-flex items-center gap-1.5 text-xs hover:bg-surface2">{copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}{tr("คัดลอก", "Copy", "复制")}</button>
                      </div>
                      <div className="flex items-center justify-between text-[11.5px] text-muted">
                        <span>{link.mode === "snapshot" ? tr(`ภาพนิ่ง ณ ${new Date(link.snapshot_at ?? "").toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}`, `Snapshot of ${new Date(link.snapshot_at ?? "").toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}`, "快照") : tr("ข้อมูลสด", "Live", "实时")} · {tr("หมดอายุ", "Expires", "到期")} {when(link.expires_at)} · {tr("เปิดแล้ว", "opened", "已打开")} {link.views ?? 0} {tr("ครั้ง", "times", "次")}</span>
                        <button onClick={() => void linkAction("unlink")} disabled={busy} className="inline-flex items-center gap-1 text-danger hover:underline"><Link2Off size={12} />{tr("ยกเลิกลิงก์", "Revoke link", "撤销链接")}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => setLinkMode("live")} className={`rounded-xl border px-3 py-2 text-left ${linkMode === "live" ? "border-brand bg-brand/[0.06]" : "border-line hover:bg-surface2"}`}>
                        <span className="block font-medium text-[12.5px]">{tr("ข้อมูลสด", "Live data", "实时数据")}</span>
                        <span className="block text-[11px] text-muted">{tr("อัปเดตตลอด + เปลี่ยนตามที่แก้มุมมอง", "Always current + follows view edits", "始终最新 + 跟随视图修改")}</span>
                      </button>
                      <button onClick={() => setLinkMode("snapshot")} disabled={!snapshot} className={`rounded-xl border px-3 py-2 text-left disabled:opacity-50 ${linkMode === "snapshot" ? "border-brand bg-brand/[0.06]" : "border-line hover:bg-surface2"}`}>
                        <span className="block font-medium text-[12.5px]">{tr("ภาพนิ่ง ณ ตอนนี้", "Snapshot now", "当前快照")}</span>
                        <span className="block text-[11px] text-muted">{snapshot ? tr("ข้อมูลและมุมมองคงที่ ไม่เปลี่ยน", "Data and view frozen", "数据与视图固定") : tr("เปิดแท็บนี้ก่อนจึงทำภาพนิ่งได้", "Open this tab first", "请先打开此标签")}</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={days ?? 0} onChange={(e) => setDays(Number(e.target.value) || null)} className="h-9 rounded-xl border border-line bg-surface px-2 text-xs">
                        {[[7, tr("7 วัน", "7 days", "7 天")], [30, tr("30 วัน", "30 days", "30 天")], [90, tr("90 วัน", "90 days", "90 天")], [0, tr("ไม่หมดอายุ", "No expiry", "永不过期")]].map(([v, l]) => <option key={String(v)} value={v as number}>{l as string}</option>)}
                      </select>
                      <button onClick={() => void linkAction("link")} disabled={busy} className="h-9 px-4 rounded-xl border border-brand text-brand font-medium inline-flex items-center gap-1.5 hover:bg-brand/5">{busy ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}{tr("สร้างลิงก์", "Create link", "创建链接")}</button>
                    </div>
                    </div>
                  )}
              </section>
            </>
          ) : <p className="text-xs text-muted">{tr("เฉพาะเจ้าของแก้การแชร์ได้ — ทำสำเนาไปเป็นของตัวเองแล้วแชร์ต่อได้", "Only the owner can change sharing — duplicate it to share your own copy", "仅所有者可更改共享 — 可复制后自行共享")}</p>}
          {err ? <p className="text-xs text-danger">{err}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
