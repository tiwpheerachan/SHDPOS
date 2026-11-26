"use client";
// ทะเบียนเครื่อง EDC (ข้อมูลจริงในระบบ · 0080) + นำเข้าไฟล์ MID/TID ของธนาคาร + อัตรา MDR
//   เลขเต็มเห็นเฉพาะผู้มีสิทธิ์ edc.manage · อัตรา MDR แก้ได้เฉพาะ edc.mdr_manage · ทุกการแก้บันทึกประวัติ
//   ไฟล์ต้นทางอ่านอย่างเดียว ไม่เขียนกลับไปไฟล์/ชีทใด ๆ
import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Plus, Upload, Search, ShieldCheck, ShieldAlert, Pencil, Trash2, Loader2, FileSpreadsheet, AlertTriangle, Percent, Cpu, Store, Eye, EyeOff } from "lucide-react";
import { Badge, Button, Drawer, EmptyState, Field, Input, KpiTile, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast-host";
import { readXlsx, parseEdcWorkbook, guessBranch, type ImportRow } from "@/lib/edc-import";
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";

type Mid = { id?: string; service: string; installment_months: number; mid: string; tid: string | null; merchant_no?: string | null; note?: string | null };
type Terminal = { id: string; acquirer: string; branch_id: string | null; label: string | null; tid: string; status: string; replaced_by: string | null; shared_note: string | null; sim_no: string | null; sim_monthly_fee: number | null; note: string | null; verified: boolean; source: string | null; updated_at: string; mids: Mid[] };
type Branch = { id: string; code: string | null; name: string; name_th: string | null; is_active: boolean };
type Rate = { id: string; acquirer: string; service: string; card_type: string; installment_months: number; rate_pct: number; fixed_fee: number; vat_on_fee: boolean; effective_from: string; effective_to: string | null; note: string | null };
type Data = { terminals: Terminal[]; branches: Branch[]; rates: Rate[]; canManage: boolean; canMdr: boolean; full: boolean };

export const ACQ = (): Record<string, string> => ({ SCB: "SCB", KBANK: "KBANK", UOB: "UOB", KRUNGSRI: tr("กรุงศรี", "Krungsri", "大城银行"), CARDX: "CardX", BBL: "BBL", KTB: "KTB", TTB: "TTB", OTHER: tr("อื่น ๆ", "Other", "其他") });
export const SVC = (): Record<string, string> => ({ card: tr("บัตรเครดิต", "Credit card", "信用卡"), debit: tr("บัตรเดบิต", "Debit card", "借记卡"), unionpay: "UnionPay", alipay: "Alipay", wechat: "WeChat Pay", thqr: "Thai QR", qr_credit: "QR Credit", promptpay: "PromptPay", installment: tr("ผ่อน 0%", "0% installment", "0% 分期"), other: tr("อื่น ๆ", "Other", "其他") });
const STATUS = (): Record<string, [string, "ok" | "warn" | "danger" | "neutral" | "info"]> => ({ active: [tr("ใช้งาน", "Active", "使用中"), "ok"], spare: [tr("สำรอง", "Spare", "备用"), "info"], repair: [tr("ส่งซ่อม", "In repair", "维修中"), "warn"], no_txn: [tr("ไม่มียอดชำระ", "No transactions", "无交易"), "warn"], retired: [tr("เลิกใช้", "Retired", "已停用"), "neutral"] });
const MONTHS = [3, 4, 6, 9, 10, 12, 18, 24, 36];
const svcLabel = (m: Pick<Mid, "service" | "installment_months">) => (m.service === "installment" ? tr(`ผ่อน ${m.installment_months} ด.`, `${m.installment_months}-mo inst.`, `分期 ${m.installment_months} 期`) : SVC()[m.service] ?? m.service);

async function api<T>(body?: unknown): Promise<T> {
  const r = await fetch("/api/admin/edc", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? tr("ไม่สำเร็จ", "Failed", "失败"));
  return j as T;
}

export function useEdcData() {
  const [data, setData] = useState<Data | null>(null), [err, setErr] = useState("");
  const load = async () => { try { setData(await api<Data>()); setErr(""); } catch (e) { setErr(e instanceof Error ? e.message : tr("โหลดไม่สำเร็จ", "Failed to load", "加载失败")); } };
  useEffect(() => { void load(); }, []);
  return { data, err, reload: load };
}

// ═══════════════ ทะเบียนเครื่อง ═══════════════
export function EdcRegistry({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const toast = useToast();
  const L = useL();
  const ACQL = ACQ(), STATUSL = STATUS();
  const [q, setQ] = useState(""), [fAcq, setFAcq] = useState(""), [fBranch, setFBranch] = useState(""), [fStatus, setFStatus] = useState("live");
  const [edit, setEdit] = useState<Terminal | null>(null), [importOpen, setImportOpen] = useState(false), [reveal, setReveal] = useState(false);
  const bName = (id: string | null) => { if (!id) return L("เครื่องกลาง / อีเวนต์", "Shared / event terminal", "公用 / 活动终端"); const b = data.branches.find((x) => x.id === id); return b ? b.name_th ?? b.name : "—"; };
  const mask = (v: string | null) => (!v ? "—" : reveal || !data.full ? v : `••••${v.slice(-4)}`);
  const list = useMemo(() => data.terminals.filter((t) =>
    (!fAcq || t.acquirer === fAcq) && (!fBranch || (fBranch === "_none" ? !t.branch_id : t.branch_id === fBranch)) &&
    (fStatus === "" || (fStatus === "live" ? t.status !== "retired" : t.status === fStatus)) &&
    (!q || `${t.label ?? ""} ${t.tid} ${bName(t.branch_id)} ${t.mids.map((m) => m.mid).join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [data, q, fAcq, fBranch, fStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = data.terminals.filter((t) => t.status !== "retired");
  const noBranch = live.filter((t) => !t.branch_id).length;
  const today = new Date().toISOString().slice(0, 10);
  const missingRate = useMemo(() => {
    const need = new Set<string>();
    for (const t of live) if (t.status === "active") for (const m of t.mids) need.add(`${t.acquirer}|${m.service}|${m.installment_months}`);
    const have = new Set(data.rates.filter((r) => r.effective_from <= today && (!r.effective_to || r.effective_to >= today)).map((r) => `${r.acquirer}|${r.service}|${r.installment_months}`));
    return [...need].filter((k) => !have.has(k));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // จัดกลุ่มตามสาขา
  const groups = useMemo(() => {
    const m = new Map<string, Terminal[]>();
    for (const t of list) { const k = t.branch_id ?? "_none"; m.set(k, [...(m.get(k) ?? []), t]); }
    return [...m.entries()].sort((a, b) => (a[0] === "_none" ? 1 : b[0] === "_none" ? -1 : bName(a[0]).localeCompare(bName(b[0]), "th")));
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  async function verify(t: Terminal) {
    try { await api({ action: "verify", id: t.id, verified: !t.verified }); await reload(); toast.push({ tone: "ok", title: t.verified ? L("ยกเลิกการยืนยันแล้ว", "Verification removed", "已取消确认") : L("ยืนยันเครื่องแล้ว", "Terminal verified", "终端已确认") }); }
    catch (e) { toast.push({ tone: "danger", title: L("ไม่สำเร็จ", "Failed", "失败"), body: e instanceof Error ? e.message : "" }); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={L("เครื่องที่ใช้อยู่", "Active terminals", "使用中终端")} value={String(live.filter((t) => t.status === "active").length)} sub={L(`ทั้งหมด ${data.terminals.length} · เลิกใช้ ${data.terminals.length - live.length}`, `Total ${data.terminals.length} · retired ${data.terminals.length - live.length}`, `共 ${data.terminals.length} · 已停用 ${data.terminals.length - live.length}`)} icon={<Cpu size={16} />} accent="lavender" />
        <KpiTile label={L("สาขาที่มีเครื่อง", "Branches with terminals", "有终端的门店")} value={String(new Set(live.map((t) => t.branch_id).filter(Boolean)).size)} sub={noBranch ? L(`ยังไม่ผูกสาขา ${noBranch} เครื่อง`, `${noBranch} not linked to a branch`, `${noBranch} 台未绑定门店`) : L("ผูกสาขาครบ", "All linked", "已全部绑定")} icon={<Store size={16} />} accent={noBranch ? "peach" : "mint"} />
        <KpiTile label={L("ยืนยันแล้ว", "Verified", "已确认")} value={`${live.filter((t) => t.verified).length}/${live.length}`} sub={L("ตรวจกับเอกสารธนาคารแล้ว", "Checked against bank documents", "已与银行文件核对")} icon={<ShieldCheck size={16} />} accent="lime" />
        <KpiTile label={L("บริการที่ยังไม่มีอัตรา MDR", "Services without MDR rate", "未设 MDR 费率的服务")} value={String(missingRate.length)} sub={missingRate.length ? L("ค่าธรรมเนียมจะเป็น 0 จนกว่าจะตั้ง", "Fees record as 0 until set", "设置前手续费记为 0") : L("ครบทุกบริการ", "All services covered", "所有服务已设置")} icon={<Percent size={16} />} accent={missingRate.length ? "peach" : "mint"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ค้นหา สาขา / TID / MID", "Search branch / TID / MID", "搜索 门店 / TID / MID")} className="pl-9 h-9" /></div>
        <Select value={fAcq} onChange={(e) => setFAcq(e.target.value)} className="h-9 w-32"><option value="">{L("ทุกธนาคาร", "All banks", "所有银行")}</option>{Object.entries(ACQL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className="h-9 w-48"><option value="">{L("ทุกสาขา", "All branches", "所有门店")}</option><option value="_none">{L("ยังไม่ผูกสาขา / เครื่องกลาง", "Unlinked / shared terminals", "未绑定 / 公用终端")}</option>{data.branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}</Select>
        <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="h-9 w-36"><option value="live">{L("ยังไม่เลิกใช้", "Not retired", "未停用")}</option><option value="">{L("ทุกสถานะ", "All statuses", "所有状态")}</option>{Object.entries(STATUSL).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</Select>
        <div className="ml-auto flex items-center gap-2">
          {data.full ? <button onClick={() => setReveal(!reveal)} className="h-9 px-3 rounded-xl border border-line text-xs inline-flex items-center gap-1.5 hover:bg-surface2">{reveal ? <EyeOff size={14} /> : <Eye size={14} />}{reveal ? L("ซ่อนเลขเต็ม", "Hide full numbers", "隐藏完整号码") : L("แสดงเลขเต็ม", "Show full numbers", "显示完整号码")}</button> : <span className="text-[11px] text-muted">{L("เลขถูกมาสก์ (ต้องมีสิทธิ์จัดการ EDC)", "Numbers masked (requires EDC manage permission)", "号码已遮蔽（需要 EDC 管理权限）")}</span>}
          {data.canManage ? <>
            <Button variant="ghost" className="h-9" onClick={() => setImportOpen(true)}><Upload size={15} /> {L("นำเข้าไฟล์ธนาคาร", "Import bank file", "导入银行文件")}</Button>
            <Button variant="primary" className="h-9" onClick={() => setEdit({ id: "", acquirer: "KBANK", branch_id: null, label: "", tid: "", status: "active", replaced_by: null, shared_note: null, sim_no: null, sim_monthly_fee: null, note: null, verified: false, source: "manual", updated_at: "", mids: [{ service: "card", installment_months: 0, mid: "", tid: null }] })}><Plus size={15} /> {L("เพิ่มเครื่อง", "Add terminal", "添加终端")}</Button>
          </> : null}
        </div>
      </div>

      {!data.terminals.length ? (
        <EmptyState icon={<CreditCard size={26} />} title={L("ยังไม่มีเครื่อง EDC ในทะเบียน", "No EDC terminals registered yet", "尚未登记 EDC 终端")} body={data.canManage ? L("กด “นำเข้าไฟล์ธนาคาร” เพื่ออ่านไฟล์ MID/TID (.xlsx) หรือเพิ่มทีละเครื่อง", "Click “Import bank file” to read a MID/TID file (.xlsx), or add terminals one by one", "点击“导入银行文件”读取 MID/TID 文件（.xlsx），或逐台添加") : L("ให้ผู้มีสิทธิ์จัดการ EDC นำเข้าข้อมูล", "Ask someone with EDC manage permission to import data", "请有 EDC 管理权限的人员导入数据")} />
      ) : !list.length ? <EmptyState icon={<Search size={22} />} title={L("ไม่พบเครื่องตามตัวกรอง", "No terminals match the filters", "没有符合筛选条件的终端")} /> : (
        <div className="space-y-3">
          {groups.map(([bid, ts]) => (
            <div key={bid} className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line bg-surface2/40 flex items-center gap-2">
                <Store size={14} className={bid === "_none" ? "text-warn" : "text-brand"} />
                <p className="text-sm font-semibold">{bid === "_none" ? L("ยังไม่ผูกสาขา / เครื่องกลาง", "Unlinked / shared terminals", "未绑定 / 公用终端") : bName(bid)}</p>
                <span className="text-[11px] text-muted">{ts.length} {L("เครื่อง", "terminals", "台")}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[11px] text-muted"><tr className="border-b border-line">
                    <th className="text-left font-medium px-4 py-2 w-24">{L("ธนาคาร", "Bank", "银行")}</th><th className="text-left font-medium px-2 py-2">{L("ชื่อในไฟล์ / ชื่อเรียก", "File name / label", "文件名称 / 名称")}</th><th className="text-left font-medium px-2 py-2">TID</th>
                    <th className="text-left font-medium px-2 py-2">{L("บริการ · MID", "Service · MID", "服务 · MID")}</th><th className="text-left font-medium px-2 py-2">{L("ซิม", "SIM", "SIM 卡")}</th><th className="text-center font-medium px-2 py-2">{L("สถานะ", "Status", "状态")}</th><th className="text-center font-medium px-2 py-2">{L("ยืนยัน", "Verified", "确认")}</th><th className="w-10" />
                  </tr></thead>
                  <tbody className="divide-y divide-line">{ts.map((t) => {
                    const st = STATUSL[t.status] ?? [t.status, "neutral"];
                    const repl = t.replaced_by ? data.terminals.find((x) => x.id === t.replaced_by) : null;
                    return (
                      <tr key={t.id} className={t.status === "retired" ? "opacity-55" : ""}>
                        <td className="px-4 py-2.5 font-semibold">{ACQL[t.acquirer] ?? t.acquirer}</td>
                        <td className="px-2 py-2.5 max-w-[200px]"><span className="block truncate">{t.label ?? "—"}</span>{t.note ? <span className="block text-[10.5px] text-muted truncate" title={t.note}>{t.note}</span> : null}{repl ? <span className="block text-[10.5px] text-muted">{L("แทนด้วย TID", "Replaced by TID", "已替换为 TID")} <span translate="no">{mask(repl.tid)}</span></span> : null}</td>
                        <td className="px-2 py-2.5 font-mono" translate="no">{mask(t.tid)}</td>
                        <td className="px-2 py-2.5"><div className="flex flex-wrap gap-1 max-w-[380px]">{t.mids.length ? t.mids.map((m) => (
                          <span key={`${m.service}${m.installment_months}`} className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded-md bg-surface2" title={`MID ${m.mid}${m.tid ? ` · TID ${m.tid}` : ""}`}>
                            <b className="font-medium">{svcLabel(m)}</b><span className="font-mono text-muted" translate="no">{mask(m.mid)}</span>
                          </span>)) : <span className="text-warn inline-flex items-center gap-1"><AlertTriangle size={11} />{L("ยังไม่มี MID", "No MID yet", "尚无 MID")}</span>}</div></td>
                        <td className="px-2 py-2.5 font-mono text-muted">{t.sim_no ? mask(t.sim_no) : "—"}</td>
                        <td className="px-2 py-2.5 text-center"><Badge tone={st[1]}>{st[0]}</Badge></td>
                        <td className="px-2 py-2.5 text-center">{data.canManage ? <button onClick={() => void verify(t)} title={t.verified ? L("ยืนยันแล้ว — กดเพื่อยกเลิก", "Verified — click to undo", "已确认 — 点击取消") : L("กดเมื่อตรวจกับเอกสารธนาคารแล้ว", "Click once checked against bank documents", "与银行文件核对后点击")}>{t.verified ? <ShieldCheck size={16} className="text-ok" /> : <ShieldAlert size={16} className="text-warn" />}</button> : t.verified ? <ShieldCheck size={16} className="text-ok inline" /> : <ShieldAlert size={16} className="text-warn inline" />}</td>
                        <td className="pr-3 py-2.5">{data.canManage ? <button onClick={() => setEdit(t)} className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:bg-surface2"><Pencil size={14} /></button> : null}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit ? <TerminalDrawer t={edit} branches={data.branches} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reload(); }} /> : null}
      {importOpen ? <ImportModal branches={data.branches} onClose={() => setImportOpen(false)} onDone={async () => { setImportOpen(false); await reload(); }} /> : null}
    </div>
  );
}

function TerminalDrawer({ t, branches, onClose, onSaved }: { t: Terminal; branches: Branch[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const L = useL();
  const ACQL = ACQ(), SVCL = SVC(), STATUSL = STATUS();
  const [f, setF] = useState<Terminal>(t), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const setMid = (i: number, patch: Partial<Mid>) => setF({ ...f, mids: f.mids.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  async function save() {
    setBusy(true); setErr("");
    try { await api({ action: "save_terminal", terminal: { ...f, id: f.id || undefined } }); toast.push({ tone: "ok", title: L("บันทึกเครื่องแล้ว", "Terminal saved", "终端已保存") }); await onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : L("ไม่สำเร็จ", "Failed", "失败")); } finally { setBusy(false); }
  }
  return (
    <Drawer open onClose={onClose} title={t.id ? `${L("แก้ไขเครื่อง", "Edit terminal", "编辑终端")} ${ACQL[t.acquirer] ?? t.acquirer}` : L("เพิ่มเครื่อง EDC", "Add EDC terminal", "添加 EDC 终端")} subtitle={L("ข้อมูลในระบบเราเท่านั้น · ทุกการแก้บันทึกประวัติ", "Stored in our system only · every change is logged", "仅存于本系统 · 所有修改均有记录")}
      footer={<><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{L("บันทึก", "Save", "保存")}</Button></>}>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={L("ธนาคารผู้รับชำระ", "Acquiring bank", "收单银行")}><Select value={f.acquirer} onChange={(e) => setF({ ...f, acquirer: e.target.value })}>{Object.entries(ACQL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label={L("TID ของเครื่อง", "Terminal TID", "终端 TID")}><Input value={f.tid} onChange={(e) => setF({ ...f, tid: e.target.value.trim() })} className="font-mono" placeholder={L("8 หลัก", "8 digits", "8 位")} /></Field>
          <Field label={L("สาขา", "Branch", "门店")}><Select value={f.branch_id ?? ""} onChange={(e) => setF({ ...f, branch_id: e.target.value || null })}><option value="">{L("เครื่องกลาง / อีเวนต์ (ใช้ได้ทุกสาขา)", "Shared / event (any branch)", "公用 / 活动（所有门店可用）")}</option>{branches.filter((b) => b.is_active || b.id === f.branch_id).map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}</Select></Field>
          <Field label={L("สถานะ", "Status", "状态")}><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(STATUSL).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</Select></Field>
          <Field label={L("ชื่อเรียก / ชื่อในไฟล์ธนาคาร", "Label / name in bank file", "名称 / 银行文件中的名称")}><Input value={f.label ?? ""} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label={L("ใช้ร่วม (เช่น อีเวนต์หลายแบรนด์)", "Shared use (e.g. multi-brand event)", "共用（如多品牌活动）")}><Input value={f.shared_note ?? ""} onChange={(e) => setF({ ...f, shared_note: e.target.value })} /></Field>
          <Field label={L("เบอร์ซิมในเครื่อง", "SIM number", "SIM 卡号")}><Input value={f.sim_no ?? ""} onChange={(e) => setF({ ...f, sim_no: e.target.value })} className="font-mono" /></Field>
          <Field label={L("ค่าซิม/เดือน (บาท)", "SIM fee/month (THB)", "SIM 月费（泰铢）")}><Input type="number" value={f.sim_monthly_fee ?? ""} onChange={(e) => setF({ ...f, sim_monthly_fee: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        </div>
        <Field label={L("หมายเหตุ", "Note", "备注")}><Input value={f.note ?? ""} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div>
          <div className="flex items-center justify-between mb-2"><p className="text-sm font-semibold">{L("MID ตามบริการ / แผนผ่อน", "MID by service / installment plan", "按服务 / 分期方案的 MID")}</p>
            <button onClick={() => setF({ ...f, mids: [...f.mids, { service: "card", installment_months: 0, mid: "", tid: null }] })} className="text-xs text-brand inline-flex items-center gap-1"><Plus size={13} />{L("เพิ่มบริการ", "Add service", "添加服务")}</button></div>
          <div className="space-y-2">{f.mids.map((m, i) => (
            <div key={i} className="grid grid-cols-[1.2fr_0.8fr_1.4fr_1fr_auto] gap-2 items-center">
              <Select value={m.service} onChange={(e) => setMid(i, { service: e.target.value, installment_months: e.target.value === "installment" ? (m.installment_months || 3) : 0 })}>{Object.entries(SVCL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              {m.service === "installment" ? <Select value={m.installment_months} onChange={(e) => setMid(i, { installment_months: Number(e.target.value) })}>{MONTHS.map((x) => <option key={x} value={x}>{x} {L("เดือน", "months", "个月")}</option>)}</Select> : <span className="text-[11px] text-muted text-center">—</span>}
              <Input value={m.mid} onChange={(e) => setMid(i, { mid: e.target.value.trim() })} placeholder="MID" className="font-mono" />
              <Input value={m.tid ?? ""} onChange={(e) => setMid(i, { tid: e.target.value.trim() || null })} placeholder={L("TID เฉพาะแผน", "Plan-specific TID", "方案专用 TID")} className="font-mono" />
              <button onClick={() => setF({ ...f, mids: f.mids.filter((_, j) => j !== i) })} className="h-9 w-9 grid place-items-center rounded-lg text-muted hover:text-danger"><Trash2 size={14} /></button>
            </div>))}</div>
          <p className="text-[11px] text-muted mt-2">{L("TID เฉพาะแผนเว้นว่างได้ = ใช้ TID ของเครื่อง · ผ่อนแต่ละแผนตั้งแยกได้ (เช่น UOB ใช้ TID/MID ต่างกันตามจำนวนเดือน)", "Plan TID may be blank = uses the terminal TID · each installment plan can be set separately (e.g. UOB uses different TID/MID per term)", "方案 TID 可留空 = 使用终端 TID · 各分期方案可单独设置（如 UOB 按期数使用不同 TID/MID）")}</p>
        </div>
        {err ? <p className="text-sm text-danger">{err}</p> : null}
      </div>
    </Drawer>
  );
}

function ImportModal({ branches, onClose, onDone }: { branches: Branch[]; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const L = useL();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState(""), [rows, setRows] = useState<ImportRow[]>([]), [warnings, setWarnings] = useState<string[]>([]), [sheets, setSheets] = useState<{ name: string; acquirer: string | null; rows: number; skipped: string | null }[]>([]);
  const [map, setMap] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const active = branches.filter((b) => b.is_active);
  async function onFile(f: File) {
    setErr(""); setFile(f.name);
    try {
      const res = parseEdcWorkbook(readXlsx(new Uint8Array(await f.arrayBuffer())));
      setRows(res.rows); setWarnings(res.warnings); setSheets(res.sheets);
      const m: Record<string, string> = {};
      for (const r of res.rows) if (!(r.label in m)) m[r.label] = guessBranch(r.label, active) ?? "";
      setMap(m);
    } catch (e) { setErr(`${L("อ่านไฟล์ไม่ได้:", "Cannot read file:", "无法读取文件：")} ${e instanceof Error ? e.message : ""} ${L("(รองรับ .xlsx)", "(.xlsx supported)", "（支持 .xlsx）")}`); }
  }
  const labels = useMemo(() => [...new Set(rows.map((r) => r.label))], [rows]);
  async function submit() {
    setBusy(true); setErr("");
    try {
      const j = await api<{ created: number; updated: number; mids: number; errors: string[] }>({ action: "import", filename: file, rows: rows.map((r) => ({ ...r, branch_id: map[r.label] || null })) });
      toast.push({ tone: j.errors.length ? "warn" : "ok", title: L(`นำเข้าแล้ว: เพิ่ม ${j.created} · อัปเดต ${j.updated} เครื่อง · MID ${j.mids}`, `Imported: ${j.created} added · ${j.updated} terminals updated · MID ${j.mids}`, `已导入：新增 ${j.created} · 更新 ${j.updated} 台 · MID ${j.mids}`), body: j.errors.length ? L(`${j.errors.length} แถวมีปัญหา: ${j.errors.slice(0, 3).join(" · ")}`, `${j.errors.length} rows had issues: ${j.errors.slice(0, 3).join(" · ")}`, `${j.errors.length} 行有问题：${j.errors.slice(0, 3).join(" · ")}`) : L("ตรวจเลขกับเอกสารธนาคารแล้วกด “ยืนยัน” รายเครื่อง", "Check numbers against bank documents, then click “Verify” per terminal", "与银行文件核对号码后，逐台点击“确认”") });
      await onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : L("ไม่สำเร็จ", "Failed", "失败")); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={L("นำเข้าทะเบียน MID/TID จากไฟล์ธนาคาร", "Import MID/TID registry from bank file", "从银行文件导入 MID/TID 登记")} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!rows.length} onClick={() => void submit()}><Upload size={15} /> {L("นำเข้า", "Import", "导入")} {rows.length ? `${rows.length} ${L("เครื่อง", "terminals", "台")}` : ""}</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-[12.5px] text-muted">{L("อ่านไฟล์ในเครื่องนี้ (ไม่แก้ไฟล์ต้นฉบับ) · เครื่องที่มีอยู่แล้ว (ธนาคาร+TID เดียวกัน) จะอัปเดตและเพิ่ม MID ที่ขาด · จับคู่ชื่อในไฟล์กับสาขาในระบบด้านล่างก่อนยืนยัน", "File is read on this device (original untouched) · existing terminals (same bank+TID) are updated and missing MIDs added · match file names to branches below before confirming", "在本机读取文件（不修改原文件）· 已有终端（同银行+TID）将更新并补充缺少的 MID · 确认前请在下方将文件名称与系统门店匹配")}</p>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-line hover:border-brand/50 px-4 py-5 text-center">
          <FileSpreadsheet size={22} className="mx-auto text-brand" /><p className="mt-1.5 font-medium">{file || L("เลือกไฟล์ .xlsx", "Choose .xlsx file", "选择 .xlsx 文件")}</p><p className="text-[11px] text-muted">{L("ชีทแยกธนาคาร", "One sheet per bank", "按银行分表")} (SCB / KBANK / UOB / krungsri / card x scb)</p>
        </button>
        {sheets.length ? <div className="flex flex-wrap gap-1.5">{sheets.map((s) => <span key={s.name} className={`text-[11px] px-2 py-1 rounded-lg border ${s.skipped ? "border-warn/40 text-warn" : "border-line"}`}>{s.name} → {s.acquirer ?? "?"} · {s.skipped ?? `${s.rows} ${L("เครื่อง", "terminals", "台")}`}</span>)}</div> : null}
        {labels.length ? <div>
          <p className="text-[11px] font-semibold text-muted mb-1">{L("จับคู่ชื่อในไฟล์ → สาขาในระบบ", "Match file names → system branches", "匹配文件名称 → 系统门店")} ({labels.filter((l) => map[l]).length}/{labels.length} {L("จับคู่แล้ว", "matched", "已匹配")})</p>
          <div className="max-h-64 overflow-auto rounded-xl border border-line divide-y divide-line">
            {labels.map((l) => { const n = rows.filter((r) => r.label === l); return (
              <div key={l} className="grid grid-cols-[1fr_1.2fr] gap-2 items-center px-3 py-1.5">
                <span className="text-xs truncate" title={l}>{l} <span className="text-muted">· {n.length} {L("เครื่อง", "terminals", "台")} ({[...new Set(n.map((r) => r.acquirer))].join("/")})</span></span>
                <Select value={map[l] ?? ""} onChange={(e) => setMap({ ...map, [l]: e.target.value })} className={`h-8 text-xs ${map[l] ? "" : "border-warn/60"}`}><option value="">{L("— ยังไม่ผูก (เครื่องกลาง) —", "— Not linked (shared) —", "— 未绑定（公用）—")}</option>{active.map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}</Select>
              </div>); })}
          </div></div> : null}
        {warnings.length ? <details className="rounded-xl border border-warn/30 bg-warn/5 px-3 py-2"><summary className="text-xs text-warn cursor-pointer inline-flex items-center gap-1"><AlertTriangle size={12} />{L(`ข้อควรตรวจ ${warnings.length} รายการ`, `${warnings.length} items to check`, `${warnings.length} 项需核对`)}</summary><ul className="mt-1.5 text-[11px] text-muted space-y-0.5 list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></details> : null}
        {err ? <p className="text-danger text-sm">{err}</p> : null}
      </div>
    </Modal>
  );
}

// ═══════════════ อัตรา MDR ═══════════════
export function MdrRates({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const toast = useToast();
  const L = useL();
  const ACQL = ACQ(), SVCL = SVC();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<{ acquirer: string; service: string; card_type: string; installment_months: number; rate_pct: string; fixed_fee: string; vat_on_fee: boolean; effective_from: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false), [showOld, setShowOld] = useState(false);
  const activeRate = (r: Rate) => r.effective_from <= today && (!r.effective_to || r.effective_to >= today);
  const rates = data.rates.filter((r) => showOld || !r.effective_to || r.effective_to >= today);
  // บริการที่เครื่องในทะเบียนใช้อยู่แต่ยังไม่มีอัตรา
  const needs = useMemo(() => {
    const m = new Map<string, { acquirer: string; service: string; months: number; terms: number }>();
    for (const t of data.terminals) if (t.status === "active") for (const x of t.mids) { const k = `${t.acquirer}|${x.service}|${x.installment_months}`; const c = m.get(k) ?? { acquirer: t.acquirer, service: x.service, months: x.installment_months, terms: 0 }; c.terms++; m.set(k, c); }
    return [...m.values()].filter((n) => !data.rates.some((r) => activeRate(r) && r.acquirer === n.acquirer && r.service === n.service && r.installment_months === n.months)).sort((a, b) => a.acquirer.localeCompare(b.acquirer) || a.service.localeCompare(b.service) || a.months - b.months);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (p?: Partial<NonNullable<typeof form>>) => setForm({ acquirer: "KBANK", service: "card", card_type: "all", installment_months: 0, rate_pct: "", fixed_fee: "0", vat_on_fee: true, effective_from: today, note: "", ...p });
  async function save() {
    if (!form) return;
    setBusy(true);
    try { await api({ action: "add_rate", ...form, rate_pct: Number(form.rate_pct), fixed_fee: Number(form.fixed_fee || 0) }); toast.push({ tone: "ok", title: L("บันทึกอัตราแล้ว", "Rate saved", "费率已保存"), body: L("อัตราเดิมของชุดเดียวกันถูกปิดให้อัตโนมัติ", "The previous rate for the same set was closed automatically", "同组旧费率已自动结束") }); setForm(null); await reload(); }
    catch (e) { toast.push({ tone: "danger", title: L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"), body: e instanceof Error ? e.message : "" }); } finally { setBusy(false); }
  }
  async function end(r: Rate) {
    try { await api({ action: "end_rate", id: r.id, effective_to: today }); await reload(); toast.push({ tone: "ok", title: L("สิ้นสุดอัตราแล้ว", "Rate ended", "费率已结束") }); }
    catch (e) { toast.push({ tone: "danger", title: L("ไม่สำเร็จ", "Failed", "失败"), body: e instanceof Error ? e.message : "" }); }
  }
  const sample = form && Number(form.rate_pct) >= 0 ? (() => { const base = (10000 * Number(form.rate_pct || 0)) / 100 + Number(form.fixed_fee || 0); return form.vat_on_fee ? base * 1.07 : base; })() : 0;
  return (
    <div className="space-y-4">
      {needs.length ? (
        <div className="card p-4">
          <p className="text-sm font-semibold inline-flex items-center gap-1.5"><AlertTriangle size={14} className="text-warn" />{L("บริการที่เครื่องใช้อยู่แต่ยังไม่มีอัตรา", "Services in use without a rate", "使用中但未设费率的服务")} ({needs.length})</p>
          <p className="text-[11px] text-muted mt-0.5">{L("ระหว่างนี้ค่าธรรมเนียมของบิลจะบันทึกเป็น 0", "Meanwhile bill fees are recorded as 0", "在此期间单据手续费记为 0")} · {data.canMdr ? L("กดเพื่อกรอกอัตรา", "click to enter a rate", "点击填写费率") : L("ให้เจ้าของ/ฝ่ายบัญชี (สิทธิ์ตั้งอัตรา MDR) กรอก", "ask the owner/accounting (MDR rate permission) to enter it", "请店主/财务（有 MDR 费率权限）填写")}</p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">{needs.map((n) => (
            <button key={`${n.acquirer}${n.service}${n.months}`} disabled={!data.canMdr} onClick={() => open({ acquirer: n.acquirer, service: n.service, installment_months: n.months })}
              className="text-[11.5px] px-2.5 py-1 rounded-lg border border-line hover:border-brand/50 hover:bg-brand/5 disabled:hover:bg-transparent disabled:cursor-default">{ACQL[n.acquirer] ?? n.acquirer} · {svcLabel({ service: n.service, installment_months: n.months })} <span className="text-muted">({n.terms} {L("เครื่อง", "terminals", "台")})</span></button>))}</div>
        </div>) : null}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
          <Percent size={14} className="text-brand" /><p className="text-sm font-semibold">{L("อัตราค่าธรรมเนียมบัตร (MDR)", "Card fee rates (MDR)", "刷卡手续费率（MDR）")}</p>
          <label className="text-[11px] text-muted inline-flex items-center gap-1 ml-2"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />{L("แสดงอัตราที่สิ้นสุดแล้ว", "Show ended rates", "显示已结束费率")}</label>
          {data.canMdr ? <Button variant="primary" className="h-8 ml-auto" onClick={() => open()}><Plus size={14} /> {L("เพิ่มอัตรา", "Add rate", "添加费率")}</Button> : <span className="ml-auto text-[11px] text-muted">{L("ดูได้อย่างเดียว (ต้องมีสิทธิ์ตั้งอัตรา MDR)", "View only (requires MDR rate permission)", "仅可查看（需要 MDR 费率权限）")}</span>}
        </div>
        {!rates.length ? <p className="text-sm text-muted text-center py-10">{L("ยังไม่มีอัตรา — ให้เจ้าของ/ฝ่ายบัญชีกรอกตามสัญญากับธนาคาร", "No rates yet — owner/accounting should enter them per the bank contract", "暂无费率 — 请店主/财务按银行合同填写")}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead className="bg-surface2/50 text-[11px] text-muted"><tr>
              <th className="text-left font-medium px-4 py-2">{L("ธนาคาร", "Bank", "银行")}</th><th className="text-left font-medium px-2 py-2">{L("บริการ", "Service", "服务")}</th><th className="text-left font-medium px-2 py-2">{L("ประเภทบัตร", "Card type", "卡类型")}</th>
              <th className="text-right font-medium px-2 py-2">{L("อัตรา %", "Rate %", "费率 %")}</th><th className="text-right font-medium px-2 py-2">{L("ค่าคงที่", "Fixed fee", "固定费")}</th><th className="text-center font-medium px-2 py-2">+VAT</th>
              <th className="text-left font-medium px-2 py-2">{L("มีผล", "Effective", "生效期")}</th><th className="text-left font-medium px-2 py-2">{L("หมายเหตุ", "Note", "备注")}</th><th className="w-20" />
            </tr></thead>
            <tbody className="divide-y divide-line">{rates.map((r) => (
              <tr key={r.id} className={activeRate(r) ? "" : "opacity-55"}>
                <td className="px-4 py-2.5 font-semibold">{ACQL[r.acquirer] ?? r.acquirer}</td><td className="px-2 py-2.5">{svcLabel(r)}</td><td className="px-2 py-2.5 text-muted">{r.card_type === "all" ? L("ทุกประเภท", "All types", "所有类型") : r.card_type}</td>
                <td className="px-2 py-2.5 text-right tnum font-semibold">{Number(r.rate_pct).toFixed(2)}%</td><td className="px-2 py-2.5 text-right tnum">{Number(r.fixed_fee).toFixed(2)}</td><td className="px-2 py-2.5 text-center">{r.vat_on_fee ? "✓" : "—"}</td>
                <td className="px-2 py-2.5 whitespace-nowrap">{r.effective_from} → {r.effective_to ?? L("ปัจจุบัน", "Present", "至今")}</td><td className="px-2 py-2.5 text-muted max-w-[200px] truncate">{r.note ?? ""}</td>
                <td className="pr-3 py-2.5 text-right">{data.canMdr && !r.effective_to ? <button onClick={() => void end(r)} className="text-[11px] text-danger">{L("สิ้นสุด", "End", "结束")}</button> : null}</td>
              </tr>))}</tbody>
          </table></div>)}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title={L("เพิ่มอัตรา MDR", "Add MDR rate", "添加 MDR 费率")} size="sm"
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>{L("ยกเลิก", "Cancel", "取消")}</Button><Button variant="primary" loading={busy} disabled={!form || form.rate_pct === ""} onClick={() => void save()}>{L("บันทึก", "Save", "保存")}</Button></>}>
        {form ? <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={L("ธนาคาร", "Bank", "银行")}><Select value={form.acquirer} onChange={(e) => setForm({ ...form, acquirer: e.target.value })}>{Object.entries(ACQL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label={L("บริการ", "Service", "服务")}><Select value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value, installment_months: e.target.value === "installment" ? form.installment_months || 3 : 0 })}>{Object.entries(SVCL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            {form.service === "installment" ? <Field label={L("แผนผ่อน", "Installment plan", "分期方案")}><Select value={form.installment_months} onChange={(e) => setForm({ ...form, installment_months: Number(e.target.value) })}>{MONTHS.map((x) => <option key={x} value={x}>{x} {L("เดือน", "months", "个月")}</option>)}</Select></Field> : null}
            <Field label={L("ประเภทบัตร", "Card type", "卡类型")}><Select value={form.card_type} onChange={(e) => setForm({ ...form, card_type: e.target.value })}>{[["all", L("ทุกประเภท", "All types", "所有类型")], ["visa", "Visa"], ["mastercard", "Mastercard"], ["jcb", "JCB"], ["amex", "Amex"], ["unionpay", "UnionPay"], ["debit", L("เดบิต", "Debit", "借记卡")], ["local", L("บัตรในประเทศ", "Domestic card", "国内卡")]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label={L("อัตรา (%)", "Rate (%)", "费率（%）")}><Input type="number" step="0.01" min={0} max={20} value={form.rate_pct} onChange={(e) => setForm({ ...form, rate_pct: e.target.value })} placeholder={L("เช่น 1.60", "e.g. 1.60", "例如 1.60")} /></Field>
            <Field label={L("ค่าคงที่ต่อรายการ (บาท)", "Fixed fee per transaction (THB)", "每笔固定费（泰铢）")}><Input type="number" step="0.01" min={0} value={form.fixed_fee} onChange={(e) => setForm({ ...form, fixed_fee: e.target.value })} /></Field>
            <Field label={L("มีผลตั้งแต่", "Effective from", "生效日期")}><Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.vat_on_fee} onChange={(e) => setForm({ ...form, vat_on_fee: e.target.checked })} />{L("ธนาคารคิด VAT 7% บนค่าธรรมเนียม", "Bank charges 7% VAT on the fee", "银行对手续费加收 7% VAT")}</label>
          <Field label={L("หมายเหตุ (เช่น อ้างอิงสัญญา)", "Note (e.g. contract reference)", "备注（如合同编号）")}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <p className="text-[11.5px] text-muted rounded-lg bg-surface2/60 px-3 py-2">{L("ตัวอย่าง: รูด 10,000 บาท → ค่าธรรมเนียม", "Example: 10,000 THB charge → fee", "示例：刷 10,000 泰铢 → 手续费")} <b className="text-ink tnum">{sample.toFixed(2)}</b> {L("บาท · อัตราเดิมของชุดเดียวกันจะถูกปิดก่อนวันเริ่มใหม่อัตโนมัติ", "THB · the previous rate for the same set closes automatically before the new start date", "泰铢 · 同组旧费率将在新费率生效前自动结束")}</p>
        </div> : null}
      </Modal>
    </div>
  );
}
