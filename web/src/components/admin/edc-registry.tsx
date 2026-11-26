"use client";
// ทะเบียนเครื่อง EDC (ข้อมูลจริงในระบบ · 0080) + นำเข้าไฟล์ MID/TID ของธนาคาร + อัตรา MDR
//   เลขเต็มเห็นเฉพาะผู้มีสิทธิ์ edc.manage · อัตรา MDR แก้ได้เฉพาะ edc.mdr_manage · ทุกการแก้บันทึกประวัติ
//   ไฟล์ต้นทางอ่านอย่างเดียว ไม่เขียนกลับไปไฟล์/ชีทใด ๆ
import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Plus, Upload, Search, ShieldCheck, ShieldAlert, Pencil, Trash2, Loader2, FileSpreadsheet, AlertTriangle, Percent, Cpu, Store, Eye, EyeOff } from "lucide-react";
import { Badge, Button, Drawer, EmptyState, Field, Input, KpiTile, Modal, Select } from "@/components/ui";
import { useToast } from "@/components/toast-host";
import { readXlsx, parseEdcWorkbook, guessBranch, type ImportRow } from "@/lib/edc-import";

type Mid = { id?: string; service: string; installment_months: number; mid: string; tid: string | null; merchant_no?: string | null; note?: string | null };
type Terminal = { id: string; acquirer: string; branch_id: string | null; label: string | null; tid: string; status: string; replaced_by: string | null; shared_note: string | null; sim_no: string | null; sim_monthly_fee: number | null; note: string | null; verified: boolean; source: string | null; updated_at: string; mids: Mid[] };
type Branch = { id: string; code: string | null; name: string; name_th: string | null; is_active: boolean };
type Rate = { id: string; acquirer: string; service: string; card_type: string; installment_months: number; rate_pct: number; fixed_fee: number; vat_on_fee: boolean; effective_from: string; effective_to: string | null; note: string | null };
type Data = { terminals: Terminal[]; branches: Branch[]; rates: Rate[]; canManage: boolean; canMdr: boolean; full: boolean };

export const ACQ: Record<string, string> = { SCB: "SCB", KBANK: "KBANK", UOB: "UOB", KRUNGSRI: "กรุงศรี", CARDX: "CardX", BBL: "BBL", KTB: "KTB", TTB: "TTB", OTHER: "อื่น ๆ" };
export const SVC: Record<string, string> = { card: "บัตรเครดิต", debit: "บัตรเดบิต", unionpay: "UnionPay", alipay: "Alipay", wechat: "WeChat Pay", thqr: "Thai QR", qr_credit: "QR Credit", promptpay: "PromptPay", installment: "ผ่อน 0%", other: "อื่น ๆ" };
const STATUS: Record<string, [string, "ok" | "warn" | "danger" | "neutral" | "info"]> = { active: ["ใช้งาน", "ok"], spare: ["สำรอง", "info"], repair: ["ส่งซ่อม", "warn"], no_txn: ["ไม่มียอดชำระ", "warn"], retired: ["เลิกใช้", "neutral"] };
const MONTHS = [3, 4, 6, 9, 10, 12, 18, 24, 36];
const svcLabel = (m: Pick<Mid, "service" | "installment_months">) => (m.service === "installment" ? `ผ่อน ${m.installment_months} ด.` : SVC[m.service] ?? m.service);

async function api<T>(body?: unknown): Promise<T> {
  const r = await fetch("/api/admin/edc", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "ไม่สำเร็จ");
  return j as T;
}

export function useEdcData() {
  const [data, setData] = useState<Data | null>(null), [err, setErr] = useState("");
  const load = async () => { try { setData(await api<Data>()); setErr(""); } catch (e) { setErr(e instanceof Error ? e.message : "โหลดไม่สำเร็จ"); } };
  useEffect(() => { void load(); }, []);
  return { data, err, reload: load };
}

// ═══════════════ ทะเบียนเครื่อง ═══════════════
export function EdcRegistry({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const toast = useToast();
  const [q, setQ] = useState(""), [fAcq, setFAcq] = useState(""), [fBranch, setFBranch] = useState(""), [fStatus, setFStatus] = useState("live");
  const [edit, setEdit] = useState<Terminal | null>(null), [importOpen, setImportOpen] = useState(false), [reveal, setReveal] = useState(false);
  const bName = (id: string | null) => { if (!id) return "เครื่องกลาง / อีเวนต์"; const b = data.branches.find((x) => x.id === id); return b ? b.name_th ?? b.name : "—"; };
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
    try { await api({ action: "verify", id: t.id, verified: !t.verified }); await reload(); toast.push({ tone: "ok", title: t.verified ? "ยกเลิกการยืนยันแล้ว" : "ยืนยันเครื่องแล้ว" }); }
    catch (e) { toast.push({ tone: "danger", title: "ไม่สำเร็จ", body: e instanceof Error ? e.message : "" }); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="เครื่องที่ใช้อยู่" value={String(live.filter((t) => t.status === "active").length)} sub={`ทั้งหมด ${data.terminals.length} · เลิกใช้ ${data.terminals.length - live.length}`} icon={<Cpu size={16} />} accent="lavender" />
        <KpiTile label="สาขาที่มีเครื่อง" value={String(new Set(live.map((t) => t.branch_id).filter(Boolean)).size)} sub={noBranch ? `ยังไม่ผูกสาขา ${noBranch} เครื่อง` : "ผูกสาขาครบ"} icon={<Store size={16} />} accent={noBranch ? "peach" : "mint"} />
        <KpiTile label="ยืนยันแล้ว" value={`${live.filter((t) => t.verified).length}/${live.length}`} sub="ตรวจกับเอกสารธนาคารแล้ว" icon={<ShieldCheck size={16} />} accent="lime" />
        <KpiTile label="บริการที่ยังไม่มีอัตรา MDR" value={String(missingRate.length)} sub={missingRate.length ? "ค่าธรรมเนียมจะเป็น 0 จนกว่าจะตั้ง" : "ครบทุกบริการ"} icon={<Percent size={16} />} accent={missingRate.length ? "peach" : "mint"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา สาขา / TID / MID" className="pl-9 h-9" /></div>
        <Select value={fAcq} onChange={(e) => setFAcq(e.target.value)} className="h-9 w-32"><option value="">ทุกธนาคาร</option>{Object.entries(ACQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select value={fBranch} onChange={(e) => setFBranch(e.target.value)} className="h-9 w-48"><option value="">ทุกสาขา</option><option value="_none">ยังไม่ผูกสาขา / เครื่องกลาง</option>{data.branches.filter((b) => b.is_active).map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}</Select>
        <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="h-9 w-36"><option value="live">ยังไม่เลิกใช้</option><option value="">ทุกสถานะ</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</Select>
        <div className="ml-auto flex items-center gap-2">
          {data.full ? <button onClick={() => setReveal(!reveal)} className="h-9 px-3 rounded-xl border border-line text-xs inline-flex items-center gap-1.5 hover:bg-surface2">{reveal ? <EyeOff size={14} /> : <Eye size={14} />}{reveal ? "ซ่อนเลขเต็ม" : "แสดงเลขเต็ม"}</button> : <span className="text-[11px] text-muted">เลขถูกมาสก์ (ต้องมีสิทธิ์จัดการ EDC)</span>}
          {data.canManage ? <>
            <Button variant="ghost" className="h-9" onClick={() => setImportOpen(true)}><Upload size={15} /> นำเข้าไฟล์ธนาคาร</Button>
            <Button variant="primary" className="h-9" onClick={() => setEdit({ id: "", acquirer: "KBANK", branch_id: null, label: "", tid: "", status: "active", replaced_by: null, shared_note: null, sim_no: null, sim_monthly_fee: null, note: null, verified: false, source: "manual", updated_at: "", mids: [{ service: "card", installment_months: 0, mid: "", tid: null }] })}><Plus size={15} /> เพิ่มเครื่อง</Button>
          </> : null}
        </div>
      </div>

      {!data.terminals.length ? (
        <EmptyState icon={<CreditCard size={26} />} title="ยังไม่มีเครื่อง EDC ในทะเบียน" body={data.canManage ? "กด “นำเข้าไฟล์ธนาคาร” เพื่ออ่านไฟล์ MID/TID (.xlsx) หรือเพิ่มทีละเครื่อง" : "ให้ผู้มีสิทธิ์จัดการ EDC นำเข้าข้อมูล"} />
      ) : !list.length ? <EmptyState icon={<Search size={22} />} title="ไม่พบเครื่องตามตัวกรอง" /> : (
        <div className="space-y-3">
          {groups.map(([bid, ts]) => (
            <div key={bid} className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-line bg-surface2/40 flex items-center gap-2">
                <Store size={14} className={bid === "_none" ? "text-warn" : "text-brand"} />
                <p className="text-sm font-semibold">{bid === "_none" ? "ยังไม่ผูกสาขา / เครื่องกลาง" : bName(bid)}</p>
                <span className="text-[11px] text-muted">{ts.length} เครื่อง</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[11px] text-muted"><tr className="border-b border-line">
                    <th className="text-left font-medium px-4 py-2 w-24">ธนาคาร</th><th className="text-left font-medium px-2 py-2">ชื่อในไฟล์ / ชื่อเรียก</th><th className="text-left font-medium px-2 py-2">TID</th>
                    <th className="text-left font-medium px-2 py-2">บริการ · MID</th><th className="text-left font-medium px-2 py-2">ซิม</th><th className="text-center font-medium px-2 py-2">สถานะ</th><th className="text-center font-medium px-2 py-2">ยืนยัน</th><th className="w-10" />
                  </tr></thead>
                  <tbody className="divide-y divide-line">{ts.map((t) => {
                    const st = STATUS[t.status] ?? [t.status, "neutral"];
                    const repl = t.replaced_by ? data.terminals.find((x) => x.id === t.replaced_by) : null;
                    return (
                      <tr key={t.id} className={t.status === "retired" ? "opacity-55" : ""}>
                        <td className="px-4 py-2.5 font-semibold">{ACQ[t.acquirer] ?? t.acquirer}</td>
                        <td className="px-2 py-2.5 max-w-[200px]"><span className="block truncate">{t.label ?? "—"}</span>{t.note ? <span className="block text-[10.5px] text-muted truncate" title={t.note}>{t.note}</span> : null}{repl ? <span className="block text-[10.5px] text-muted">แทนด้วย TID {mask(repl.tid)}</span> : null}</td>
                        <td className="px-2 py-2.5 font-mono">{mask(t.tid)}</td>
                        <td className="px-2 py-2.5"><div className="flex flex-wrap gap-1 max-w-[380px]">{t.mids.length ? t.mids.map((m) => (
                          <span key={`${m.service}${m.installment_months}`} className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded-md bg-surface2" title={`MID ${m.mid}${m.tid ? ` · TID ${m.tid}` : ""}`}>
                            <b className="font-medium">{svcLabel(m)}</b><span className="font-mono text-muted">{mask(m.mid)}</span>
                          </span>)) : <span className="text-warn inline-flex items-center gap-1"><AlertTriangle size={11} />ยังไม่มี MID</span>}</div></td>
                        <td className="px-2 py-2.5 font-mono text-muted">{t.sim_no ? mask(t.sim_no) : "—"}</td>
                        <td className="px-2 py-2.5 text-center"><Badge tone={st[1]}>{st[0]}</Badge></td>
                        <td className="px-2 py-2.5 text-center">{data.canManage ? <button onClick={() => void verify(t)} title={t.verified ? "ยืนยันแล้ว — กดเพื่อยกเลิก" : "กดเมื่อตรวจกับเอกสารธนาคารแล้ว"}>{t.verified ? <ShieldCheck size={16} className="text-ok" /> : <ShieldAlert size={16} className="text-warn" />}</button> : t.verified ? <ShieldCheck size={16} className="text-ok inline" /> : <ShieldAlert size={16} className="text-warn inline" />}</td>
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
  const [f, setF] = useState<Terminal>(t), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const setMid = (i: number, patch: Partial<Mid>) => setF({ ...f, mids: f.mids.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  async function save() {
    setBusy(true); setErr("");
    try { await api({ action: "save_terminal", terminal: { ...f, id: f.id || undefined } }); toast.push({ tone: "ok", title: "บันทึกเครื่องแล้ว" }); await onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "ไม่สำเร็จ"); } finally { setBusy(false); }
  }
  return (
    <Drawer open onClose={onClose} title={t.id ? `แก้ไขเครื่อง ${ACQ[t.acquirer] ?? t.acquirer}` : "เพิ่มเครื่อง EDC"} subtitle="ข้อมูลในระบบเราเท่านั้น · ทุกการแก้บันทึกประวัติ"
      footer={<><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button variant="primary" loading={busy} onClick={() => void save()}>บันทึก</Button></>}>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="ธนาคารผู้รับชำระ"><Select value={f.acquirer} onChange={(e) => setF({ ...f, acquirer: e.target.value })}>{Object.entries(ACQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="TID ของเครื่อง"><Input value={f.tid} onChange={(e) => setF({ ...f, tid: e.target.value.trim() })} className="font-mono" placeholder="8 หลัก" /></Field>
          <Field label="สาขา"><Select value={f.branch_id ?? ""} onChange={(e) => setF({ ...f, branch_id: e.target.value || null })}><option value="">เครื่องกลาง / อีเวนต์ (ใช้ได้ทุกสาขา)</option>{branches.filter((b) => b.is_active || b.id === f.branch_id).map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}</Select></Field>
          <Field label="สถานะ"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</Select></Field>
          <Field label="ชื่อเรียก / ชื่อในไฟล์ธนาคาร"><Input value={f.label ?? ""} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="ใช้ร่วม (เช่น อีเวนต์หลายแบรนด์)"><Input value={f.shared_note ?? ""} onChange={(e) => setF({ ...f, shared_note: e.target.value })} /></Field>
          <Field label="เบอร์ซิมในเครื่อง"><Input value={f.sim_no ?? ""} onChange={(e) => setF({ ...f, sim_no: e.target.value })} className="font-mono" /></Field>
          <Field label="ค่าซิม/เดือน (บาท)"><Input type="number" value={f.sim_monthly_fee ?? ""} onChange={(e) => setF({ ...f, sim_monthly_fee: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        </div>
        <Field label="หมายเหตุ"><Input value={f.note ?? ""} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <div>
          <div className="flex items-center justify-between mb-2"><p className="text-sm font-semibold">MID ตามบริการ / แผนผ่อน</p>
            <button onClick={() => setF({ ...f, mids: [...f.mids, { service: "card", installment_months: 0, mid: "", tid: null }] })} className="text-xs text-brand inline-flex items-center gap-1"><Plus size={13} />เพิ่มบริการ</button></div>
          <div className="space-y-2">{f.mids.map((m, i) => (
            <div key={i} className="grid grid-cols-[1.2fr_0.8fr_1.4fr_1fr_auto] gap-2 items-center">
              <Select value={m.service} onChange={(e) => setMid(i, { service: e.target.value, installment_months: e.target.value === "installment" ? (m.installment_months || 3) : 0 })}>{Object.entries(SVC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              {m.service === "installment" ? <Select value={m.installment_months} onChange={(e) => setMid(i, { installment_months: Number(e.target.value) })}>{MONTHS.map((x) => <option key={x} value={x}>{x} เดือน</option>)}</Select> : <span className="text-[11px] text-muted text-center">—</span>}
              <Input value={m.mid} onChange={(e) => setMid(i, { mid: e.target.value.trim() })} placeholder="MID" className="font-mono" />
              <Input value={m.tid ?? ""} onChange={(e) => setMid(i, { tid: e.target.value.trim() || null })} placeholder="TID เฉพาะแผน" className="font-mono" />
              <button onClick={() => setF({ ...f, mids: f.mids.filter((_, j) => j !== i) })} className="h-9 w-9 grid place-items-center rounded-lg text-muted hover:text-danger"><Trash2 size={14} /></button>
            </div>))}</div>
          <p className="text-[11px] text-muted mt-2">TID เฉพาะแผนเว้นว่างได้ = ใช้ TID ของเครื่อง · ผ่อนแต่ละแผนตั้งแยกได้ (เช่น UOB ใช้ TID/MID ต่างกันตามจำนวนเดือน)</p>
        </div>
        {err ? <p className="text-sm text-danger">{err}</p> : null}
      </div>
    </Drawer>
  );
}

function ImportModal({ branches, onClose, onDone }: { branches: Branch[]; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
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
    } catch (e) { setErr(`อ่านไฟล์ไม่ได้: ${e instanceof Error ? e.message : ""} (รองรับ .xlsx)`); }
  }
  const labels = useMemo(() => [...new Set(rows.map((r) => r.label))], [rows]);
  async function submit() {
    setBusy(true); setErr("");
    try {
      const j = await api<{ created: number; updated: number; mids: number; errors: string[] }>({ action: "import", filename: file, rows: rows.map((r) => ({ ...r, branch_id: map[r.label] || null })) });
      toast.push({ tone: j.errors.length ? "warn" : "ok", title: `นำเข้าแล้ว: เพิ่ม ${j.created} · อัปเดต ${j.updated} เครื่อง · MID ${j.mids}`, body: j.errors.length ? `${j.errors.length} แถวมีปัญหา: ${j.errors.slice(0, 3).join(" · ")}` : "ตรวจเลขกับเอกสารธนาคารแล้วกด “ยืนยัน” รายเครื่อง" });
      await onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "ไม่สำเร็จ"); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="นำเข้าทะเบียน MID/TID จากไฟล์ธนาคาร" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>ยกเลิก</Button><Button variant="primary" loading={busy} disabled={!rows.length} onClick={() => void submit()}><Upload size={15} /> นำเข้า {rows.length ? `${rows.length} เครื่อง` : ""}</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-[12.5px] text-muted">อ่านไฟล์ในเครื่องนี้ (ไม่แก้ไฟล์ต้นฉบับ) · เครื่องที่มีอยู่แล้ว (ธนาคาร+TID เดียวกัน) จะอัปเดตและเพิ่ม MID ที่ขาด · จับคู่ชื่อในไฟล์กับสาขาในระบบด้านล่างก่อนยืนยัน</p>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} className="w-full rounded-2xl border-2 border-dashed border-line hover:border-brand/50 px-4 py-5 text-center">
          <FileSpreadsheet size={22} className="mx-auto text-brand" /><p className="mt-1.5 font-medium">{file || "เลือกไฟล์ .xlsx"}</p><p className="text-[11px] text-muted">ชีทแยกธนาคาร (SCB / KBANK / UOB / krungsri / card x scb)</p>
        </button>
        {sheets.length ? <div className="flex flex-wrap gap-1.5">{sheets.map((s) => <span key={s.name} className={`text-[11px] px-2 py-1 rounded-lg border ${s.skipped ? "border-warn/40 text-warn" : "border-line"}`}>{s.name} → {s.acquirer ?? "?"} · {s.skipped ?? `${s.rows} เครื่อง`}</span>)}</div> : null}
        {labels.length ? <div>
          <p className="text-[11px] font-semibold text-muted mb-1">จับคู่ชื่อในไฟล์ → สาขาในระบบ ({labels.filter((l) => map[l]).length}/{labels.length} จับคู่แล้ว)</p>
          <div className="max-h-64 overflow-auto rounded-xl border border-line divide-y divide-line">
            {labels.map((l) => { const n = rows.filter((r) => r.label === l); return (
              <div key={l} className="grid grid-cols-[1fr_1.2fr] gap-2 items-center px-3 py-1.5">
                <span className="text-xs truncate" title={l}>{l} <span className="text-muted">· {n.length} เครื่อง ({[...new Set(n.map((r) => r.acquirer))].join("/")})</span></span>
                <Select value={map[l] ?? ""} onChange={(e) => setMap({ ...map, [l]: e.target.value })} className={`h-8 text-xs ${map[l] ? "" : "border-warn/60"}`}><option value="">— ยังไม่ผูก (เครื่องกลาง) —</option>{active.map((b) => <option key={b.id} value={b.id}>{b.name_th ?? b.name}</option>)}</Select>
              </div>); })}
          </div></div> : null}
        {warnings.length ? <details className="rounded-xl border border-warn/30 bg-warn/5 px-3 py-2"><summary className="text-xs text-warn cursor-pointer inline-flex items-center gap-1"><AlertTriangle size={12} />ข้อควรตรวจ {warnings.length} รายการ</summary><ul className="mt-1.5 text-[11px] text-muted space-y-0.5 list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></details> : null}
        {err ? <p className="text-danger text-sm">{err}</p> : null}
      </div>
    </Modal>
  );
}

// ═══════════════ อัตรา MDR ═══════════════
export function MdrRates({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const toast = useToast();
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
    try { await api({ action: "add_rate", ...form, rate_pct: Number(form.rate_pct), fixed_fee: Number(form.fixed_fee || 0) }); toast.push({ tone: "ok", title: "บันทึกอัตราแล้ว", body: "อัตราเดิมของชุดเดียวกันถูกปิดให้อัตโนมัติ" }); setForm(null); await reload(); }
    catch (e) { toast.push({ tone: "danger", title: "บันทึกไม่สำเร็จ", body: e instanceof Error ? e.message : "" }); } finally { setBusy(false); }
  }
  async function end(r: Rate) {
    try { await api({ action: "end_rate", id: r.id, effective_to: today }); await reload(); toast.push({ tone: "ok", title: "สิ้นสุดอัตราแล้ว" }); }
    catch (e) { toast.push({ tone: "danger", title: "ไม่สำเร็จ", body: e instanceof Error ? e.message : "" }); }
  }
  const sample = form && Number(form.rate_pct) >= 0 ? (() => { const base = (10000 * Number(form.rate_pct || 0)) / 100 + Number(form.fixed_fee || 0); return form.vat_on_fee ? base * 1.07 : base; })() : 0;
  return (
    <div className="space-y-4">
      {needs.length ? (
        <div className="card p-4">
          <p className="text-sm font-semibold inline-flex items-center gap-1.5"><AlertTriangle size={14} className="text-warn" />บริการที่เครื่องใช้อยู่แต่ยังไม่มีอัตรา ({needs.length})</p>
          <p className="text-[11px] text-muted mt-0.5">ระหว่างนี้ค่าธรรมเนียมของบิลจะบันทึกเป็น 0 · {data.canMdr ? "กดเพื่อกรอกอัตรา" : "ให้เจ้าของ/ฝ่ายบัญชี (สิทธิ์ตั้งอัตรา MDR) กรอก"}</p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">{needs.map((n) => (
            <button key={`${n.acquirer}${n.service}${n.months}`} disabled={!data.canMdr} onClick={() => open({ acquirer: n.acquirer, service: n.service, installment_months: n.months })}
              className="text-[11.5px] px-2.5 py-1 rounded-lg border border-line hover:border-brand/50 hover:bg-brand/5 disabled:hover:bg-transparent disabled:cursor-default">{ACQ[n.acquirer] ?? n.acquirer} · {svcLabel({ service: n.service, installment_months: n.months })} <span className="text-muted">({n.terms} เครื่อง)</span></button>))}</div>
        </div>) : null}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
          <Percent size={14} className="text-brand" /><p className="text-sm font-semibold">อัตราค่าธรรมเนียมบัตร (MDR)</p>
          <label className="text-[11px] text-muted inline-flex items-center gap-1 ml-2"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />แสดงอัตราที่สิ้นสุดแล้ว</label>
          {data.canMdr ? <Button variant="primary" className="h-8 ml-auto" onClick={() => open()}><Plus size={14} /> เพิ่มอัตรา</Button> : <span className="ml-auto text-[11px] text-muted">ดูได้อย่างเดียว (ต้องมีสิทธิ์ตั้งอัตรา MDR)</span>}
        </div>
        {!rates.length ? <p className="text-sm text-muted text-center py-10">ยังไม่มีอัตรา — ให้เจ้าของ/ฝ่ายบัญชีกรอกตามสัญญากับธนาคาร</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead className="bg-surface2/50 text-[11px] text-muted"><tr>
              <th className="text-left font-medium px-4 py-2">ธนาคาร</th><th className="text-left font-medium px-2 py-2">บริการ</th><th className="text-left font-medium px-2 py-2">ประเภทบัตร</th>
              <th className="text-right font-medium px-2 py-2">อัตรา %</th><th className="text-right font-medium px-2 py-2">ค่าคงที่</th><th className="text-center font-medium px-2 py-2">+VAT</th>
              <th className="text-left font-medium px-2 py-2">มีผล</th><th className="text-left font-medium px-2 py-2">หมายเหตุ</th><th className="w-20" />
            </tr></thead>
            <tbody className="divide-y divide-line">{rates.map((r) => (
              <tr key={r.id} className={activeRate(r) ? "" : "opacity-55"}>
                <td className="px-4 py-2.5 font-semibold">{ACQ[r.acquirer] ?? r.acquirer}</td><td className="px-2 py-2.5">{svcLabel(r)}</td><td className="px-2 py-2.5 text-muted">{r.card_type === "all" ? "ทุกประเภท" : r.card_type}</td>
                <td className="px-2 py-2.5 text-right tnum font-semibold">{Number(r.rate_pct).toFixed(2)}%</td><td className="px-2 py-2.5 text-right tnum">{Number(r.fixed_fee).toFixed(2)}</td><td className="px-2 py-2.5 text-center">{r.vat_on_fee ? "✓" : "—"}</td>
                <td className="px-2 py-2.5 whitespace-nowrap">{r.effective_from} → {r.effective_to ?? "ปัจจุบัน"}</td><td className="px-2 py-2.5 text-muted max-w-[200px] truncate">{r.note ?? ""}</td>
                <td className="pr-3 py-2.5 text-right">{data.canMdr && !r.effective_to ? <button onClick={() => void end(r)} className="text-[11px] text-danger">สิ้นสุด</button> : null}</td>
              </tr>))}</tbody>
          </table></div>)}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title="เพิ่มอัตรา MDR" size="sm"
        footer={<><Button variant="ghost" onClick={() => setForm(null)}>ยกเลิก</Button><Button variant="primary" loading={busy} disabled={!form || form.rate_pct === ""} onClick={() => void save()}>บันทึก</Button></>}>
        {form ? <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ธนาคาร"><Select value={form.acquirer} onChange={(e) => setForm({ ...form, acquirer: e.target.value })}>{Object.entries(ACQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="บริการ"><Select value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value, installment_months: e.target.value === "installment" ? form.installment_months || 3 : 0 })}>{Object.entries(SVC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            {form.service === "installment" ? <Field label="แผนผ่อน"><Select value={form.installment_months} onChange={(e) => setForm({ ...form, installment_months: Number(e.target.value) })}>{MONTHS.map((x) => <option key={x} value={x}>{x} เดือน</option>)}</Select></Field> : null}
            <Field label="ประเภทบัตร"><Select value={form.card_type} onChange={(e) => setForm({ ...form, card_type: e.target.value })}>{[["all", "ทุกประเภท"], ["visa", "Visa"], ["mastercard", "Mastercard"], ["jcb", "JCB"], ["amex", "Amex"], ["unionpay", "UnionPay"], ["debit", "เดบิต"], ["local", "บัตรในประเทศ"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="อัตรา (%)"><Input type="number" step="0.01" min={0} max={20} value={form.rate_pct} onChange={(e) => setForm({ ...form, rate_pct: e.target.value })} placeholder="เช่น 1.60" /></Field>
            <Field label="ค่าคงที่ต่อรายการ (บาท)"><Input type="number" step="0.01" min={0} value={form.fixed_fee} onChange={(e) => setForm({ ...form, fixed_fee: e.target.value })} /></Field>
            <Field label="มีผลตั้งแต่"><Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.vat_on_fee} onChange={(e) => setForm({ ...form, vat_on_fee: e.target.checked })} />ธนาคารคิด VAT 7% บนค่าธรรมเนียม</label>
          <Field label="หมายเหตุ (เช่น อ้างอิงสัญญา)"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <p className="text-[11.5px] text-muted rounded-lg bg-surface2/60 px-3 py-2">ตัวอย่าง: รูด 10,000 บาท → ค่าธรรมเนียม <b className="text-ink tnum">{sample.toFixed(2)}</b> บาท · อัตราเดิมของชุดเดียวกันจะถูกปิดก่อนวันเริ่มใหม่อัตโนมัติ</p>
        </div> : null}
      </Modal>
    </div>
  );
}
