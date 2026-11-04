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
import StickerSlapFooter from "@/components/ui/sticker-slap-footer";

// สติ๊กเกอร์แบรนด์ของเรา (ตัดจากชุด SHD) สำหรับหน้า login
const StImg = ({ src }: { src: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={src} alt="" style={{ width: "100%", height: "auto", display: "block" }} draggable={false} />
);
const LOGIN_STICKERS = [
  { node: <StImg src="/stickers/shd.png" />, label: "SHD", size: 20 },
  { node: <StImg src="/stickers/shr-run.png" />, label: "SHR team" },
  { node: <StImg src="/stickers/globe.png" />, label: "analytics" },
  { node: <StImg src="/stickers/sincere.png" />, label: "真诚 sincere" },
  { node: <StImg src="/stickers/mutual.png" />, label: "共赢 mutual benefit" },
  { node: <StImg src="/stickers/target.png" />, label: "target" },
];

// แปลง safe profile จาก RPC (pos_login_by_pin) → Employee สำหรับ session
function profileToEmployee(p: any, branchId: string): Employee {
  return {
    id: p.id,
    employee_code: p.employee_code,
    first_name: p.first_name,
    last_name: p.last_name ?? null,
    nickname: p.nickname ?? null,
    role: p.role,
    data_scope: p.data_scope,
    home_branch_id: p.home_branch_id ?? branchId,
    branch_ids: p.branch_ids ?? [branchId],
    brand_ids: p.brand_ids ?? [],
    max_discount_percent: p.max_discount_percent ?? 0,
    can_open_drawer: p.can_open_drawer ?? false,
    status: p.status ?? "active",
    photo_url: p.photo_url ?? null,
  };
}

export default function PosLoginPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const session = useSession();
  const toast = useToast();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  // เมื่อ PIN ตรงกับหลายคน (เช่น default 1234 ซ้ำกัน) → ให้เลือกชื่อ
  const [pinMatches, setPinMatches] = useState<Employee[] | null>(null);

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

  // เปลี่ยนสาขา → ล้าง PIN + รายการที่ต้องเลือก
  useEffect(() => {
    setPin("");
    setPinMatches(null);
  }, [branchId]);

  // พิมพ์ PIN จากคีย์บอร์ดได้ (เมื่อเปิด modal PIN และยังไม่อยู่ขั้นเลือกชื่อ)
  useEffect(() => {
    if (!showPin || pinMatches) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key >= "0" && ev.key <= "9") {
        ev.preventDefault();
        setPin((p) => (p.length < 6 ? p + ev.key : p));
      } else if (ev.key === "Backspace") {
        ev.preventDefault();
        setPin((p) => p.slice(0, -1));
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        void submitPin();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        setPin("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPin, pinMatches, pin, branchId]);

  function wrongPin() {
    setError(true);
    setPin("");
    setTimeout(() => setError(false), 1200);
  }

  // เข้าสู่ระบบด้วย PIN อย่างเดียว → ระบบหาว่า PIN นี้เป็นของใครในสาขาที่เลือก
  async function submitPin() {
    if (!branchId || pin.length < 4 || pinBusy) return;
    setPinBusy(true);
    try {
      let matches: Employee[] = [];
      if (isLiveMode()) {
        const sb = supabase();
        const { data } = await sb!.rpc("pos_login_by_pin", { p_branch_id: branchId, p_pin: pin });
        matches = ((data as any[]) ?? []).map((p) => profileToEmployee(p, branchId));
      } else {
        // โหมดสาธิต: PIN 1234 ใช้ได้กับพนักงานในสาขา
        matches = pin === "1234" ? branchEmployees : [];
      }
      if (matches.length === 0) { wrongPin(); return; }
      if (matches.length === 1) { await finishLogin(matches[0]); return; }
      setPinMatches(matches); // PIN ซ้ำหลายคน → เลือกชื่อ
    } finally {
      setPinBusy(false);
    }
  }

  async function finishLogin(emp: Employee) {
    const terminal = await getTerminalForBranch(branchId);
    session.login(emp, branchId, terminal?.id ?? null);
    const shift = await currentShift(branchId);
    session.setShift(shift ?? null);
    try {
      await writeAudit({
        action: "login",
        actor_id: emp.id,
        branch_id: branchId,
        ref_table: null,
        ref_no: null,
        amount: null,
        after_data: { terminal: terminal?.code ?? null, via: "pin" },
        is_offline: typeof navigator !== "undefined" ? !navigator.onLine : false,
      });
    } catch { /* ไม่บล็อกการเข้าสู่ระบบ */ }
    toast.push({ tone: "ok", title: `${t.login.enter} · ${emp.nickname ?? emp.first_name}` });
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
    <div className="relative min-h-screen overflow-hidden bg-[#f1ece4]">
      {/* พื้นหลัง sticker slap — wordmark "shdpos" + สติ๊กเกอร์ */}
      <StickerSlapFooter
        wordmark="shdpos"
        height="100svh"
        homeHref="/pos"
        navLabel=""
        chatHref=""
        jobs={[]}
        address={[]}
        email=""
        socials={[]}
        credits={[]}
        note=""
        mapLabel=""
        stickers={LOGIN_STICKERS}
        paper="#f1ece4"
        panel="#4a6cf0"
        ink="#141414"
        accent="#FF725E"
        className="absolute inset-0"
      />

      {/* การ์ดล็อกอิน ทับบนพาเนล */}
      <div className="absolute inset-0 z-20 flex items-center justify-center px-5 py-8 overflow-y-auto pointer-events-none">
        <div className="w-full max-w-md relative pointer-events-auto">
          {/* หัวข้อ */}
          <div className="flex flex-col items-center text-center mb-4">
            <h1 className="text-lg font-semibold tracking-tight text-white drop-shadow-sm">ยินดีต้อนรับ 👋</h1>
            <p className="text-xs text-white/85 mt-1">ยืนยันตัวตนเพื่อเข้าใช้งาน SHDPOS</p>
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
      </div>

      {/* ── Modal: เข้าด้วย PIN พนักงาน (ใส่ PIN → ระบบรู้เองว่าเป็นใคร) ── */}
      <Modal
        open={showPin}
        onClose={() => { setShowPin(false); setPinMatches(null); setPin(""); }}
        size="sm"
        title="เข้าด้วยรหัส PIN พนักงาน"
      >
        <div className="space-y-4">
          <div>
            <label className="label">{t.common.branch}</label>
            <div className="relative">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="pl-9">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>
                ))}
              </Select>
            </div>
          </div>

          {pinMatches ? (
            /* PIN ตรงกับหลายคน → ให้เลือกชื่อ */
            <div>
              <p className="text-sm font-medium text-center">เลือกชื่อของคุณ</p>
              <p className="text-[11px] text-muted text-center mb-3">PIN นี้ตรงกับพนักงานหลายคนในสาขานี้ (ควรตั้ง PIN ไม่ให้ซ้ำกัน)</p>
              <div className="grid gap-2 max-h-[46vh] overflow-y-auto pr-1">
                {pinMatches.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => void finishLogin(e)}
                    className="text-left rounded-xl border border-line bg-surface hover:bg-surface2 px-3.5 py-3 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {e.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.photo_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-surface2 grid place-items-center text-xs font-semibold shrink-0">
                          {(e.nickname ?? e.first_name).slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.nickname ?? e.first_name}</p>
                        <p className="text-[11px] text-muted truncate">{e.employee_code} · {ROLE_LABEL[e.role][locale]}</p>
                      </div>
                      <ChevronRight size={16} className="ml-auto text-muted shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => { setPinMatches(null); setPin(""); }} className="mt-3 w-full text-xs text-muted hover:text-ink">← ใส่ PIN ใหม่</button>
            </div>
          ) : (
            /* ใส่ PIN */
            <div className="flex flex-col">
              <p className="text-sm font-medium text-center">ใส่รหัส PIN</p>
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
                onEnter={() => void submitPin()}
                enterLabel={t.login.enter}
                extra={
                  <button onClick={() => setPin("")} className="h-14 rounded-xl bg-surface2 border border-line grid place-items-center text-muted">
                    <Delete size={18} />
                  </button>
                }
              />
              <Button variant="primary" className="w-full mt-3" disabled={pin.length < 4 || pinBusy} onClick={() => void submitPin()}>
                {pinBusy ? "กำลังตรวจสอบ…" : t.login.enter}
              </Button>
              {!isLiveMode() ? <p className="text-[11px] text-muted text-center mt-3">{t.login.demoHint}</p> : null}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
