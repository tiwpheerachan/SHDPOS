"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Delete, ChevronRight, Building2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { listBranches, listEmployees, getTerminalForBranch, writeAudit, currentShift } from "@/lib/data/repo";
import type { Branch, Employee } from "@/lib/types";
import { Button, Card, Numpad, Select, Badge } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/permissions";
import { isLiveMode, supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/toast-host";

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
    router.push(shift ? "/pos/sell" : "/pos/shift");
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* ฝั่งซ้าย: เลือกสาขา + พนักงาน */}
      <div className="p-6 sm:p-10 flex flex-col">
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.png" alt="SHD POS" className="w-10 h-10 object-contain" />
          <div>
            <h1 className="text-lg font-semibold">SHD POS</h1>
            <p className="text-xs text-muted">{t.login.title}</p>
          </div>
          <div className="ml-auto">
            <Badge tone={isLiveMode() ? "ok" : "warn"}>{isLiveMode() ? "Supabase" : "Demo"}</Badge>
          </div>
        </div>

        <div className="mb-5">
          <label className="label">{t.common.branch}</label>
          <div className="relative">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="pl-9">
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {locale === "th" ? b.name_th ?? b.name : b.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <label className="label">{t.login.selectEmployee}</label>
        <div className="grid sm:grid-cols-2 gap-2 overflow-y-auto flex-1 min-h-0 pr-1">
          {branchEmployees.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                setSelected(e);
                setPin("");
              }}
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
                  <p className="text-[11px] text-muted truncate">
                    {e.employee_code} · {ROLE_LABEL[e.role][locale]}
                  </p>
                </div>
                <ChevronRight size={16} className="ml-auto text-muted shrink-0" />
              </div>
            </button>
          ))}
          {!branchEmployees.length ? (
            <p className="text-xs text-muted col-span-full py-6 text-center">ไม่มีพนักงานในสาขานี้</p>
          ) : null}
        </div>
      </div>

      {/* ฝั่งขวา: PIN pad */}
      <div className="bg-surface2 p-6 sm:p-10 flex items-center justify-center">
        <Card className="w-full max-w-sm p-6">
          <p className="text-sm font-medium text-center">
            {selected ? selected.nickname ?? selected.first_name : t.login.selectEmployee}
          </p>
          <p className="text-xs text-muted text-center mt-0.5">{t.login.subtitle}</p>

          <div className={`flex justify-center gap-3 my-6 ${error ? "animate-pop" : ""}`}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={`w-3 h-3 rounded-full transition-colors ${
                  error ? "bg-danger" : i < pin.length ? "bg-brand" : "bg-line"
                }`}
              />
            ))}
          </div>
          {error ? <p className="text-xs text-danger text-center -mt-3 mb-3">{t.login.wrongPin}</p> : null}

          <Numpad
            onDigit={(d) => {
              if (d === ".") return;
              setPin((p) => (p.length < 6 ? p + d : p));
            }}
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
        </Card>
      </div>
    </div>
  );
}
