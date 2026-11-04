"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Delete, ChevronRight, Building2, ShieldCheck, LogOut, KeyRound, ArrowRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listBranches, listEmployees, getTerminalForBranch, writeAudit, currentShift } from "@/lib/data/repo";
import type { Branch, Employee } from "@/lib/types";
import { Button, Card, Numpad, Select, Badge, Modal } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/permissions";
import { isLiveMode, supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/toast-host";
import { useCentral } from "@/lib/sso/use-central";
import { buildSsoEmployee, matchBranch } from "@/lib/sso/map-employee";

export default function PosLoginPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const session = useSession();
  const toast = useToast();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // ── SSO ระบบกลาง ──
  const central = useCentral();
  const [ssoBusy, setSsoBusy] = useState(false);
  useEffect(() => {
    void central.refresh();
    // แจ้ง error จาก callback (เช่น ?sso_error=verify_failed)
    const p = new URLSearchParams(window.location.search);
    const err = p.get("sso_error");
    if (err) toast.push({ tone: "danger", title: "เข้าสู่ระบบ SSO ไม่สำเร็จ", body: err });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void (async () => {
      const [b, e] = await Promise.all([listBranches(), listEmployees()]);
      const shops = b.filter((x) => x.branch_type !== "warehouse");
      setBranches(shops);
      setEmployees(e);
      setBranchId(session.branchId ?? shops[0]?.id ?? "");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const branchEmployees = useMemo(
    () => employees.filter((e) =>
      e.status === "active" &&
      // HQ / brand admin เข้าได้จากทุกสาขา · พนักงานสาขาเข้าเฉพาะสาขาตัวเอง
      (e.data_scope === "company" || e.data_scope === "brand" || e.home_branch_id === branchId || e.branch_ids.includes(branchId))
    ),
    [employees, branchId]
  );

  useEffect(() => {
    if (selected && !branchEmployees.find((e) => e.id === selected.id)) setSelected(null);
  }, [branchEmployees, selected]);

  // พิมพ์ PIN จากคีย์บอร์ดได้: ตัวเลข 0-9, Backspace ลบ, Enter ยืนยัน, Esc ล้าง
  useEffect(() => {
    if (!selected) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key >= "0" && ev.key <= "9") {
        ev.preventDefault();
        setPin((p) => (p.length < 6 ? p + ev.key : p));
      } else if (ev.key === "Backspace") {
        ev.preventDefault();
        setPin((p) => p.slice(0, -1));
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        void submit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        setPin("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, pin, branchId]);

  async function submit() {
    if (!selected || !branchId) return;
    // โหมดจริง: ตรวจ PIN ฝั่ง server ด้วย bcrypt (RPC pos_login) | โหมดสาธิต: PIN = 1234
    let ok: boolean;
    if (isLiveMode()) {
      const sb = supabase();
      const { data } = await sb!.rpc("pos_login", { p_code: selected.employee_code, p_pin: pin });
      ok = Boolean(data);
    } else {
      ok = pin === (selected.pin ?? "1234");
    }
    if (!ok) {
      setError(true);
      setPin("");
      setTimeout(() => setError(false), 1200);
      return;
    }
    const terminal = await getTerminalForBranch(branchId);
    session.login(selected, branchId, terminal?.id ?? null);
    const shift = await currentShift(branchId);
    session.setShift(shift ?? null);
    await writeAudit({
      action: "login",
      actor_id: selected.id,
      branch_id: branchId,
      ref_table: null,
      ref_no: null,
      amount: null,
      after_data: { terminal: terminal?.code ?? null },
      is_offline: typeof navigator !== "undefined" ? !navigator.onLine : false,
    });
    toast.push({ tone: "ok", title: `${t.login.enter} · ${selected.nickname ?? selected.first_name}` });
    router.push("/");
  }

  // เลือกสาขาให้อัตโนมัติจากหมวกหลักของ SSO (ถ้าตรงกับสาขาในระบบ)
  useEffect(() => {
    if (!central.authenticated || !central.profile?.branch || !branches.length) return;
    const b = matchBranch(branches, central.profile.branch);
    if (b) setBranchId(b.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [central.authenticated, central.profile?.branch, branches]);

  // เข้าสู่ระบบด้วย SSO — ไม่ต้องใส่ PIN (ระบบกลางยืนยันตัวตนแล้ว) แต่ยังต้องเลือกสาขา
  async function ssoLogin() {
    if (!central.authenticated || !central.profile || !central.authz?.allowed) return;
    const bid = branchId || matchBranch(branches, central.profile.branch)?.id || branches[0]?.id || "";
    if (!bid) {
      toast.push({ tone: "warn", title: "ยังไม่มีสาขาให้เลือก" });
      return;
    }
    setSsoBusy(true);
    try {
      const emp = buildSsoEmployee(central.profile, central.authz, bid);
      const terminal = await getTerminalForBranch(bid);
      session.login(emp, bid, terminal?.id ?? null);
      const shift = await currentShift(bid);
      session.setShift(shift ?? null);
      try {
        await writeAudit({
          action: "login",
          actor_id: emp.id,
          branch_id: bid,
          ref_table: null,
          ref_no: null,
          amount: null,
          after_data: { via: "sso", email: central.profile.email },
          is_offline: typeof navigator !== "undefined" ? !navigator.onLine : false,
        });
      } catch {
        /* audit ผ่าน SSO id ที่ไม่ใช่ uuid อาจล้มในโหมดจริง — ไม่บล็อกการเข้าสู่ระบบ */
      }
      toast.push({ tone: "ok", title: `${t.login.enter} · ${central.profile.name}` });
      router.push("/");
    } finally {
      setSsoBusy(false);
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-5 bg-bg overflow-hidden">
      <div className="w-full max-w-md relative z-10">
        {/* โลโก้ + หัวข้อ */}
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/logo.png" alt="SHD POS" className="w-14 h-14 object-contain mb-3" />
          <h1 className="text-xl font-semibold tracking-tight">SHD POS</h1>
          <p className="text-sm text-muted mt-1">ยืนยันตัวตนเพื่อเข้าใช้งานระบบ</p>
          <div className="mt-2">
            <Badge tone={isLiveMode() ? "ok" : "warn"}>{isLiveMode() ? "เชื่อมต่อฐานข้อมูล" : "โหมดสาธิต"}</Badge>
          </div>
        </div>

        <Card className="p-6">
          {session.employee ? (
            /* ── เข้าสู่ระบบอยู่แล้ว ── */
            <div className="text-center">
              <div className="flex items-center justify-center gap-3 mb-4">
                {session.employee?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={session.employee.photo_url} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-brand/30" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-brand/15 grid place-items-center text-base font-semibold">
                    {(session.employee?.nickname ?? session.employee?.first_name ?? "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="text-left">
                  <p className="text-sm font-semibold">{session.employee?.nickname ?? session.employee?.first_name}</p>
                  <p className="text-[11px] text-muted">เข้าสู่ระบบอยู่</p>
                </div>
              </div>
              <Button variant="primary" className="w-full" onClick={() => router.push("/")}>
                เข้าใช้งานต่อ <ArrowRight size={16} />
              </Button>
              <button
                onClick={() => {
                  const wasSso = session.employee?.id?.startsWith("sso:");
                  session.logout();
                  if (wasSso) window.location.href = "/sso/logout";
                }}
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-danger"
              >
                <LogOut size={14} /> ออกจากระบบ / สลับผู้ใช้
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* ── วิธีหลัก: บัญชีกลาง (SSO) ── */}
              {central.authenticated && central.profile ? (
                <div className="rounded-2xl border border-brand/30 bg-brand/5 p-3.5">
                  <div className="flex items-center gap-3">
                    {central.profile.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={central.profile.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover shrink-0 ring-2 ring-brand/30" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-brand/15 grid place-items-center shrink-0">
                        <ShieldCheck size={18} className="text-brand" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-semibold truncate">{central.profile.name}</p>
                      <p className="text-[11px] text-muted truncate">
                        {[central.profile.department, central.profile.branch].filter(Boolean).join(" · ") || central.profile.email}
                      </p>
                    </div>
                  </div>

                  {central.authz?.allowed ? (
                    <div className="mt-3 space-y-2">
                      <div className="relative">
                        <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="pl-9">
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>
                          ))}
                        </Select>
                      </div>
                      <Button variant="primary" className="w-full" disabled={ssoBusy} onClick={() => void ssoLogin()}>
                        {ssoBusy ? "กำลังเข้า…" : "เข้าสู่ระบบ"} <ArrowRight size={16} />
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 text-[11px] text-warn bg-warn/10 rounded-lg px-3 py-2 leading-snug">
                      บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน SHD POS — กรุณาติดต่อแอดมินเพื่อเพิ่มสิทธิ์
                    </p>
                  )}
                  <div className="mt-2 text-center">
                    <a href="/sso/logout" className="text-[11px] text-muted hover:text-ink">ออกจากบัญชีกลาง</a>
                  </div>
                </div>
              ) : (
                <a
                  href="/sso/login?next=/pos"
                  className="flex items-center justify-center gap-2 rounded-2xl bg-brand text-brandInk hover:opacity-90 px-4 py-3.5 text-sm font-semibold transition-opacity"
                >
                  <ShieldCheck size={18} /> เข้าสู่ระบบด้วยบัญชีกลาง SHD
                </a>
              )}

              {/* ตัวคั่น */}
              <div className="flex items-center gap-3 text-[11px] text-muted">
                <span className="h-px bg-line flex-1" /> หรือ <span className="h-px bg-line flex-1" />
              </div>

              {/* ── วิธีสำรอง: PIN พนักงาน ── */}
              <button
                onClick={() => setShowPin(true)}
                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface hover:bg-surface2 px-4 py-3 text-sm font-medium transition-colors"
              >
                <KeyRound size={16} className="text-muted" /> เข้าด้วยรหัส PIN พนักงาน
              </button>
            </div>
          )}
        </Card>
      </div>

      {/* ── Modal: เข้าด้วย PIN พนักงาน (วิธีสำรอง) ── */}
      <Modal open={showPin} onClose={() => setShowPin(false)} size="lg" title="เข้าด้วยรหัส PIN พนักงาน">
        <div className="grid sm:grid-cols-2 gap-5">
          {/* เลือกสาขา + พนักงาน */}
          <div className="flex flex-col min-h-0">
            <label className="label">{t.common.branch}</label>
            <div className="relative mb-3">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="pl-9">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>
                ))}
              </Select>
            </div>
            <label className="label">{t.login.selectEmployee}</label>
            <div className="grid gap-2 overflow-y-auto max-h-[46vh] pr-1">
              {branchEmployees.map((e) => (
                <button
                  key={e.id}
                  onClick={() => { setSelected(e); setPin(""); }}
                  className={`text-left rounded-xl border px-3.5 py-3 transition-colors ${
                    selected?.id === e.id ? "border-brand bg-brand/5" : "border-line bg-surface hover:bg-surface2"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-surface2 grid place-items-center text-xs font-semibold shrink-0">
                      {(e.nickname ?? e.first_name).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{e.nickname ?? e.first_name}</p>
                      <p className="text-[11px] text-muted truncate">{e.employee_code} · {ROLE_LABEL[e.role][locale]}</p>
                    </div>
                    <ChevronRight size={16} className="ml-auto text-muted shrink-0" />
                  </div>
                </button>
              ))}
              {!branchEmployees.length ? (
                <p className="text-xs text-muted py-6 text-center">ไม่มีพนักงานในสาขานี้</p>
              ) : null}
            </div>
          </div>

          {/* PIN pad */}
          <div className="flex flex-col">
            <p className="text-sm font-medium text-center">
              {selected ? selected.nickname ?? selected.first_name : t.login.selectEmployee}
            </p>
            <p className="text-xs text-muted text-center mt-0.5">{t.login.subtitle}</p>
            <div className={`flex justify-center gap-3 my-5 ${error ? "animate-pop" : ""}`}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={`w-3 h-3 rounded-full transition-colors ${error ? "bg-danger" : i < pin.length ? "bg-brand" : "bg-line"}`} />
              ))}
            </div>
            {error ? <p className="text-xs text-danger text-center -mt-3 mb-3">{t.login.wrongPin}</p> : null}
            <Numpad
              onDigit={(d) => { if (d === ".") return; setPin((p) => (p.length < 6 ? p + d : p)); }}
              onBackspace={() => setPin((p) => p.slice(0, -1))}
              onClear={() => setPin("")}
              onEnter={() => void submit()}
              enterLabel={t.login.enter}
              extra={
                <button onClick={() => setPin("")} className="h-14 rounded-xl bg-surface2 border border-line grid place-items-center text-muted">
                  <Delete size={18} />
                </button>
              }
            />
            <Button variant="primary" className="w-full mt-3" disabled={!selected || pin.length < 4} onClick={() => void submit()}>
              {t.login.enter}
            </Button>
            {!isLiveMode() ? <p className="text-[11px] text-muted text-center mt-3">{t.login.demoHint}</p> : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
