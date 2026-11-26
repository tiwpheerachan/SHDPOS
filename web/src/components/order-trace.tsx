"use client";
// แผนภาพ "ที่มาของบิล" — กดจากใบเสร็จ/รายการบิล/ประวัติ เพื่อดูว่าบิลไหลมาอย่างไรทีละขั้น (ข้อมูลจาก /api/pos/order-trace)
//   ที่มา → ราคาและโปร → ชำระเงิน → สต๊อก/SN → คลังกลาง/JST → แต้มสะสม → หลังการขาย  + ไทม์ไลน์ทุกเหตุการณ์
import { useEffect, useState } from "react";
import { GitBranch, Store, Tags, CreditCard, Boxes, Warehouse, Star, RotateCcw, ChevronRight, Loader2, ListTree, Clock3, FileStack, RefreshCw } from "lucide-react";
import { Drawer } from "@/components/ui";
import { OrderDocsPanel, StageDocs, useOrderDocs } from "@/components/order-docs";
import { DocViewer } from "@/components/doc-viewer";
import { AiBrief } from "@/components/ai-brief";
import { useSession } from "@/lib/store/session";
import { can } from "@/lib/permissions";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

type Status = "ok" | "warn" | "error" | "info" | "none";
type Detail = { label: string; value: string; tone?: Status; mono?: boolean };
type Stage = { key: string; title: string; status: Status; summary: string; at?: string | null; details: Detail[]; items?: { title: string; sub?: string; value?: string; tone?: Status; lines?: string[] }[] };
type Trace = { order: { order_no: string; status: string; grand_total: number; created_at: string; branch: string }; stages: Stage[]; timeline: { at: string; stage: string; label: string; tone?: Status; by?: string | null }[] };

const ICON: Record<string, typeof Store> = { origin: Store, price: Tags, payment: CreditCard, stock: Boxes, jst: Warehouse, loyalty: Star, after: RotateCcw, audit: ListTree };
const TONE: Record<Status, { dot: string; ring: string; text: string; soft: string }> = {
  ok: { dot: "bg-emerald-500", ring: "border-emerald-500/40", text: "text-emerald-600 dark:text-emerald-400", soft: "bg-emerald-500/8" },
  warn: { dot: "bg-amber-500", ring: "border-amber-500/50", text: "text-amber-600 dark:text-amber-400", soft: "bg-amber-500/8" },
  error: { dot: "bg-red-500", ring: "border-red-500/50", text: "text-red-600 dark:text-red-400", soft: "bg-red-500/8" },
  info: { dot: "bg-sky-500", ring: "border-sky-500/40", text: "text-sky-600 dark:text-sky-400", soft: "bg-sky-500/8" },
  none: { dot: "bg-line", ring: "border-line", text: "text-muted", soft: "bg-surface2/60" },
};
const toneLabel = (s: Status): string => ({ ok: tr("เรียบร้อย", "OK", "正常"), warn: tr("ต้องติดตาม", "Needs follow-up", "需跟进"), error: tr("มีปัญหา", "Issue", "有问题"), info: tr("ข้อมูล", "Info", "信息"), none: tr("ไม่เกี่ยวข้อง", "N/A", "不适用") })[s];
const statusLabel = (s: string): string | undefined => ({ completed: tr("สำเร็จ", "Completed", "已完成"), voided: tr("ยกเลิกแล้ว", "Voided", "已作废"), refunded: tr("คืนครบ", "Refunded", "已全额退款"), partially_refunded: tr("คืนบางส่วน", "Partially refunded", "部分退款") } as Record<string, string>)[s];
const fmtTime = (iso: string) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** ปุ่มเปิดแผนภาพ — ใส่ได้ทุกที่ที่มีเลขบิล */
export function OrderTraceButton({ clientUuid, orderNo, className, label }: { clientUuid?: string | null; orderNo?: string | null; className?: string; label?: string }) {
  const L = useL();
  const [open, setOpen] = useState(false);
  const { employee } = useSession();
  // ซ่อนเมื่อรู้ว่าไม่มีสิทธิ์ (หลังบ้านบางหน้าไม่มี employee ในเครื่อง → ให้เซิร์ฟเวอร์ตัดสิน)
  if (!clientUuid && !orderNo) return null;
  if (employee && !can(employee, "sales.trace")) return null;
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }} title={L("ดูแผนภาพที่มาของบิล", "View bill trace diagram", "查看账单来源图")}
        className={className ?? "inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line text-xs font-medium hover:border-brand/50 hover:bg-brand/5"}>
        <GitBranch size={13} className="text-brand" />{label ?? L("ที่มาของบิล", "Bill trace", "账单来源")}
      </button>
      {open ? <OrderTraceDrawer clientUuid={clientUuid} orderNo={orderNo} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function OrderTraceDrawer({ clientUuid, orderNo, onClose }: { clientUuid?: string | null; orderNo?: string | null; onClose: () => void }) {
  const L = useL();
  const [data, setData] = useState<Trace | null>(null), [err, setErr] = useState("");
  const [sel, setSel] = useState("origin"), [view, setView] = useState<"flow" | "timeline" | "docs">("flow");
  useEffect(() => {
    let alive = true;
    const q = clientUuid ? `client_uuid=${clientUuid}` : `order_no=${encodeURIComponent(orderNo ?? "")}`;
    fetch(`/api/pos/order-trace?${q}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!alive) return; if (!r.ok) setErr(j.error ?? tr("โหลดไม่สำเร็จ", "Failed to load", "加载失败")); else { setData(j); const bad = (j as Trace).stages.find((s) => s.status === "error" || s.status === "warn"); if (bad) setSel(bad.key); } })
      .catch(() => alive && setErr(tr("โหลดไม่สำเร็จ — ตรวจการเชื่อมต่อ", "Failed to load — check your connection", "加载失败 — 请检查网络连接")));
    return () => { alive = false; };
  }, [clientUuid, orderNo]);
  const docs = useOrderDocs(clientUuid, orderNo);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const docCount = (k: string) => (docs ?? []).filter((d) => d.stage === k && d.available).length;
  const stage = data?.stages.find((s) => s.key === sel) ?? data?.stages[0];
  const issues = data?.stages.filter((s) => s.status === "warn" || s.status === "error") ?? [];

  return (
    <Drawer open onClose={onClose} width="xl"
      title={<span className="inline-flex items-center gap-2"><GitBranch size={17} className="text-brand" />{L("ที่มาของบิล", "Bill trace", "账单来源")} <span className="font-mono" translate="no">{data?.order.order_no ?? orderNo ?? ""}</span></span>}
      subtitle={data ? `${statusLabel(data.order.status) ?? data.order.status} · ${data.order.grand_total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} ฿ · ${fmtTime(data.order.created_at)}` : L("กำลังรวบรวมข้อมูลจากทุกระบบ…", "Gathering data from all systems…", "正在从各系统汇总数据…")}>
      <div className="p-5 space-y-4">
        {err ? <p role="alert" className="rounded-xl bg-red-500/8 text-red-600 text-sm px-4 py-3">{err}</p> : null}
        {!data && !err ? <div className="py-16 grid place-items-center text-muted text-sm gap-2"><Loader2 className="animate-spin" size={20} />{L("กำลังโหลด…", "Loading…", "加载中…")}</div> : null}
        {data ? <>
          <AiBrief endpoint={`/api/pos/order-summary?${clientUuid ? `client_uuid=${clientUuid}` : `order_no=${encodeURIComponent(orderNo ?? "")}`}`} onJump={(k) => { setView("flow"); setSel(k); }} stages={data.stages} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-surface2 border border-line p-0.5 h-9">
              {([["flow", L("แผนภาพ", "Diagram", "流程图"), GitBranch], ["timeline", L("ไทม์ไลน์", "Timeline", "时间线"), Clock3], ["docs", L("เอกสาร", "Documents", "单据"), FileStack]] as const).map(([k, l, I]) => (
                <button key={k} onClick={() => setView(k)} className={`px-3 rounded-[10px] text-xs font-medium inline-flex items-center gap-1.5 ${view === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}><I size={13} />{l}</button>
              ))}
            </div>
            {issues.length ? <span className="text-xs text-amber-600 inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />{L("ต้องติดตาม", "Needs follow-up", "需跟进")}: {issues.map((s) => s.title).join(", ")}</span> : <span className="text-xs text-emerald-600 inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />{L("ครบทุกขั้น", "All steps complete", "所有环节已完成")}</span>}
          </div>

          {view === "flow" ? <>
            {/* แผนภาพลำดับขั้น — ทุกขั้นในแถวเดียว เส้นเชื่อมสีตามสถานะ */}
            <div className="rounded-2xl border border-line bg-surface2/30 px-2 py-4">
              <div className="grid grid-cols-7">
                {data.stages.map((s, i) => {
                  const T = TONE[s.status], I = ICON[s.key] ?? Store, on = s.key === stage?.key;
                  const next = data.stages[i + 1];
                  return (
                    <button key={s.key} onClick={() => setSel(s.key)} className="relative flex flex-col items-center gap-1.5 px-0.5 group" title={s.summary}>
                      {next ? <span className={`absolute top-[19px] left-1/2 w-full h-0.5 ${s.status === "none" || next.status === "none" ? "bg-line" : TONE[next.status === "ok" ? s.status : next.status].dot} opacity-60`} /> : null}
                      <span className={`relative z-[1] h-10 w-10 grid place-items-center rounded-full border-2 bg-surface transition ${T.ring} ${T.text} ${on ? "ring-4 ring-brand/15 scale-110" : "group-hover:scale-105"} ${s.status === "none" ? "opacity-50" : ""}`}>
                        <I size={16} />
                        <span className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${T.dot}`} />
                        {docCount(s.key) ? <span className="absolute -bottom-1 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-ink text-surface text-[9px] font-semibold grid place-items-center" title={L(`เอกสาร ${docCount(s.key)} ใบ`, `${docCount(s.key)} document(s)`, `${docCount(s.key)} 份单据`)}>{docCount(s.key)}</span> : null}
                      </span>
                      <span className={`text-[10.5px] leading-tight text-center ${on ? "font-semibold text-ink" : "text-muted"}`}>{s.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* รายละเอียดขั้นที่เลือก */}
            {stage ? (
              <section className={`rounded-2xl border ${TONE[stage.status].ring} overflow-hidden`}>
                <div className={`px-4 py-3 flex items-center gap-2 ${TONE[stage.status].soft}`}>
                  {(() => { const I = ICON[stage.key] ?? Store; return <I size={16} className={TONE[stage.status].text} />; })()}
                  <p className="text-sm font-semibold">{stage.title}</p>
                  <span className={`text-[11px] font-medium ${TONE[stage.status].text}`}>· {toneLabel(stage.status)}</span>
                  <span className="ml-auto text-xs text-muted truncate">{stage.summary}</span>
                </div>
                {stage.details.length ? (
                  <dl className="divide-y divide-line/60 px-4">
                    {stage.details.map((d, i) => (
                      <div key={i} className="py-2 grid grid-cols-[minmax(120px,38%)_1fr] gap-3 text-xs">
                        <dt className="text-muted">{d.label}</dt>
                        <dd className={`${d.mono ? "font-mono" : ""} ${d.tone ? TONE[d.tone].text : "text-ink"} break-words`}>{d.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {stage.items?.length ? (
                  <div className="p-3 grid sm:grid-cols-2 gap-2 border-t border-line/60">
                    {stage.items.map((it, i) => (
                      <div key={i} className="rounded-xl border border-line bg-surface px-3 py-2 text-xs">
                        <p className="flex items-start gap-2"><span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${TONE[it.tone ?? "none"].dot}`} /><span className="font-medium flex-1 break-words">{it.title}</span>{it.value ? <span className="tnum font-semibold">{it.value}</span> : null}</p>
                        {it.sub ? <p className="text-muted ml-3.5 truncate">{it.sub}</p> : null}
                        {it.lines?.length ? <ul className="ml-3.5 mt-1 space-y-0.5 text-muted">{it.lines.map((l, j) => <li key={j} className="break-words">{l}</li>)}</ul> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {!stage.details.length && !stage.items?.length ? <p className="px-4 py-6 text-xs text-muted text-center">{stage.summary}</p> : null}
                {docs ? <StageDocs docs={docs} stage={stage.key} onOpen={setViewKey} onMore={() => setView("docs")} /> : null}
              </section>
            ) : null}
          </> : view === "docs" ? (
            <OrderDocsPanel clientUuid={clientUuid} orderNo={orderNo} />
          ) : (
            <ol className="relative ml-2 border-l border-line space-y-3 py-1">
              {data.timeline.map((t, i) => {
                const T = TONE[t.tone ?? "info"], I = ICON[t.stage] ?? Clock3, st = data.stages.find((s) => s.key === t.stage);
                return (
                  <li key={i} className="ml-5 relative">
                    <span className={`absolute -left-[29px] top-0.5 h-6 w-6 grid place-items-center rounded-full border border-line bg-surface ${T.text}`}><I size={12} /></span>
                    <p className="text-xs font-medium">{t.label}</p>
                    <p className="text-[11px] text-muted">{fmtTime(t.at)}{st ? ` · ${st.title}` : ""}{t.by ? ` · ${t.by}` : ""}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </> : null}
      </div>
      {viewKey && docs ? <DocViewer docs={docs} startKey={viewKey} onClose={() => setViewKey(null)} /> : null}
    </Drawer>
  );
}

