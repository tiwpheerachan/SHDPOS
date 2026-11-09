"use client";

// =====================================================================
// CustomerPicker — ชีตเลือก/สร้างลูกค้า ก่อนจ่ายบิล (ดีไซน์กระจก iOS)
//   • ค้นหาด้วยชื่อ / เบอร์โทร / รหัสสมาชิก (debounce)
//   • ไม่พบ → สร้างใหม่ได้ทันที (ชื่อ + เบอร์ + อีเมล/เลขภาษี)
//   • เลือกแล้วคืน customer เต็ม record กลับไปผูกกับบิล
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, UserPlus, X, Phone, Star, Check, Loader2, IdCard } from "lucide-react";
import { searchCustomers, createCustomer } from "@/lib/data/repo";
import { useI18n } from "@/lib/i18n/provider";
import { Avatar } from "@/components/ui";
import type { Customer } from "@/lib/types";

const GLASS_CSS = `
.cxp-wrap { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; justify-content: center; }
@media (min-width: 640px){ .cxp-wrap { align-items: center; padding: 24px; } }
.cxp-scrim { position: absolute; inset: 0; background: rgba(15,17,21,.38); backdrop-filter: blur(6px) saturate(120%); -webkit-backdrop-filter: blur(6px) saturate(120%); }
.cxp-sheet {
  position: relative; width: 100%; max-width: 480px; max-height: 88vh; display: flex; flex-direction: column;
  border-radius: 28px 28px 0 0; overflow: hidden;
  background: rgba(255,255,255,.72);
  backdrop-filter: blur(28px) saturate(180%); -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255,255,255,.55);
  box-shadow: 0 -8px 60px rgba(15,17,21,.22), 0 2px 0 rgba(255,255,255,.6) inset;
  animation: cxpUp .32s cubic-bezier(.22,1,.36,1);
}
@media (min-width: 640px){ .cxp-sheet { border-radius: 28px; } }
:root[data-theme="dark"] .cxp-sheet {
  background: rgba(28,30,33,.72); border-color: rgba(255,255,255,.1);
  box-shadow: 0 -8px 60px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.08) inset;
}
@keyframes cxpUp { from { transform: translateY(14px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
.cxp-grip { width: 38px; height: 5px; border-radius: 99px; background: rgba(120,120,128,.35); margin: 10px auto 2px; }
@media (min-width: 640px){ .cxp-grip { display:none } }
.cxp-head { padding: 6px 18px 12px; }
.cxp-title { font-size: 19px; font-weight: 700; letter-spacing: -.01em; color: rgb(var(--c-ink)); }
.cxp-sub { font-size: 12.5px; color: rgb(var(--c-muted)); margin-top: 1px; }
.cxp-x { position:absolute; top:14px; right:14px; width:32px; height:32px; display:grid; place-items:center; border-radius:99px;
  background: rgba(120,120,128,.14); color: rgb(var(--c-muted)); border:0; cursor:pointer; }
.cxp-x:hover { background: rgba(120,120,128,.24); }
.cxp-searchbar { position: relative; padding: 0 18px 10px; }
.cxp-search {
  width: 100%; height: 46px; padding: 0 16px 0 42px; border-radius: 15px; font-size: 15px;
  background: rgba(118,118,128,.12); border: 1px solid transparent; color: rgb(var(--c-ink)); outline: none;
}
.cxp-search:focus { background: rgba(255,255,255,.9); border-color: rgba(121,80,216,.5); box-shadow: 0 0 0 4px rgba(121,80,216,.14); }
:root[data-theme="dark"] .cxp-search:focus { background: rgba(0,0,0,.35); }
.cxp-search-ic { position:absolute; left: 32px; top: 13px; color: rgb(var(--c-muted)); pointer-events:none; }
.cxp-list { overflow-y: auto; padding: 2px 10px 10px; }
.cxp-row {
  display:flex; align-items:center; gap: 12px; width:100%; text-align:left; padding: 11px 10px; border-radius: 16px;
  border: 0; background: transparent; cursor: pointer; color: rgb(var(--c-ink)); transition: background .12s;
}
.cxp-row:hover, .cxp-row:focus-visible { background: rgba(118,118,128,.12); outline: none; }
.cxp-row.active { background: rgba(121,80,216,.12); }
.cxp-ava { width: 42px; height: 42px; border-radius: 99px; flex-shrink:0; display:grid; place-items:center; font-weight:700; font-size:15px;
  color:#fff; background: linear-gradient(145deg,#7950D8,#9D80F0); box-shadow: 0 3px 10px rgba(121,80,216,.3); }
.cxp-nm { font-size: 15px; font-weight: 600; line-height: 1.2; }
.cxp-meta { font-size: 12.5px; color: rgb(var(--c-muted)); display:flex; align-items:center; gap: 10px; margin-top: 2px; }
.cxp-chip { display:inline-flex; align-items:center; gap:3px; font-size: 11px; font-weight:600; padding: 2px 8px; border-radius:99px;
  background: rgba(255,159,10,.16); color:#b25e00; }
:root[data-theme="dark"] .cxp-chip { color:#ffd48a; }
.cxp-create {
  display:flex; align-items:center; gap: 12px; width: 100%; padding: 13px 14px; margin: 4px 0 2px; border-radius: 16px;
  border: 0; cursor: pointer; background: rgba(121,80,216,.1); color:#7950D8; font-weight:600; font-size: 14.5px;
}
.cxp-create:hover { background: rgba(121,80,216,.18); }
.cxp-empty { text-align:center; color: rgb(var(--c-muted)); font-size: 13.5px; padding: 26px 10px 10px; }
.cxp-form { padding: 4px 18px 6px; display:flex; flex-direction:column; gap: 10px; }
.cxp-field { position: relative; }
.cxp-inp {
  width:100%; height: 46px; padding: 0 14px; border-radius: 14px; font-size: 15px;
  background: rgba(118,118,128,.1); border: 1px solid rgba(120,120,128,.2); color: rgb(var(--c-ink)); outline:none;
}
.cxp-inp:focus { border-color: rgba(121,80,216,.55); box-shadow: 0 0 0 4px rgba(121,80,216,.13); background: rgba(255,255,255,.8); }
:root[data-theme="dark"] .cxp-inp:focus { background: rgba(0,0,0,.3); }
.cxp-inp2 { padding-left: 40px; }
.cxp-inp-ic { position:absolute; left: 13px; top: 14px; color: rgb(var(--c-muted)); }
.cxp-foot { padding: 12px 18px calc(16px + env(safe-area-inset-bottom)); display:flex; gap: 10px; }
.cxp-btn { flex:1; height: 50px; border-radius: 15px; font-weight: 700; font-size: 15.5px; border:0; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:7px; }
.cxp-btn-primary { background: linear-gradient(180deg,#7950D8,#6840C4); color:#fff; box-shadow: 0 6px 18px rgba(121,80,216,.35); }
.cxp-btn-primary:disabled { opacity:.5; cursor:not-allowed; box-shadow:none; }
.cxp-btn-ghost { background: rgba(118,118,128,.14); color: rgb(var(--c-ink)); flex: 0 0 110px; }
.cxp-grow { display:flex; flex-direction:column; min-height: 0; }
`;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function CustomerPicker({
  open,
  onClose,
  onPick,
  branchId,
  initialQuery = "",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (c: Customer) => void;
  branchId?: string | null;
  initialQuery?: string;
}) {
  const { locale } = useI18n();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"search" | "create">("search");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", tax_id: "" });
  const searchRef = useRef<HTMLInputElement>(null);

  // รีเซ็ตทุกครั้งที่เปิด
  useEffect(() => {
    if (open) {
      setQ(initialQuery);
      setMode("search");
      setResults([]);
      setForm({ name: "", phone: "", email: "", tax_id: "" });
      setTimeout(() => searchRef.current?.focus(), 120);
    }
  }, [open, initialQuery]);

  // ปิดด้วย Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ค้นหาแบบ debounce
  useEffect(() => {
    if (!open || mode !== "search") return;
    const term = q.trim();
    if (!term) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const rows = await searchCustomers(term);
        setResults(rows);
      } finally {
        setLoading(false);
      }
    }, 260);
    return () => clearTimeout(id);
  }, [q, open, mode]);

  const phoneLike = useMemo(() => /^[0-9+\-\s]+$/.test(q.trim()) && q.trim().length >= 3, [q]);

  if (!open) return null;

  function startCreate() {
    const term = q.trim();
    setForm({
      name: phoneLike ? "" : term,
      phone: phoneLike ? term.replace(/\s/g, "") : "",
      email: "",
      tax_id: "",
    });
    setMode("create");
  }

  async function submitCreate() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const c = await createCustomer({
        name: form.name,
        phone: form.phone,
        email: form.email,
        tax_id: form.tax_id,
        first_branch_id: branchId ?? null,
      });
      onPick(c);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cxp-wrap" role="dialog" aria-modal="true">
      <style>{GLASS_CSS}</style>
      <div className="cxp-scrim" onClick={onClose} />
      <div className="cxp-sheet cxp-grow">
        <div className="cxp-grip" />
        <button className="cxp-x" onClick={onClose} aria-label={L("ปิด", "Close", "关闭")}><X size={17} /></button>

        <div className="cxp-head">
          <div className="cxp-title">{mode === "create" ? L("ลูกค้าใหม่", "New customer", "新客户") : L("เลือกลูกค้า", "Select customer", "选择客户")}</div>
          <div className="cxp-sub">
            {mode === "create" ? L("กรอกข้อมูลลูกค้าเพื่อผูกกับบิลนี้", "Fill in customer details to link to this order", "填写客户信息以绑定此单") : L("ค้นหาด้วยชื่อ เบอร์โทร หรือรหัสสมาชิก", "Search by name, phone, or member code", "按姓名、电话或会员号搜索")}
          </div>
        </div>

        {mode === "search" ? (
          <>
            <div className="cxp-searchbar">
              <Search size={18} className="cxp-search-ic" />
              <input
                ref={searchRef}
                className="cxp-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={L("ชื่อ หรือ 08x-xxx-xxxx", "Name or 08x-xxx-xxxx", "姓名或 08x-xxx-xxxx")}
                inputMode="text"
                autoComplete="off"
              />
            </div>

            <div className="cxp-list cxp-grow">
              {q.trim() && (
                <button className="cxp-create" onClick={startCreate}>
                  <span className="cxp-ava" style={{ width: 34, height: 34, fontSize: 0, background: "rgba(121,80,216,.18)", boxShadow: "none", color: "#7950D8" }}>
                    <UserPlus size={17} />
                  </span>
                  {L("สร้างลูกค้าใหม่", "Create new customer", "创建新客户")} “{q.trim()}”
                </button>
              )}

              {loading && (
                <div className="cxp-empty"><Loader2 size={18} className="inline animate-spin" /> {L("กำลังค้นหา…", "Searching…", "搜索中…")}</div>
              )}

              {!loading && results.map((c) => (
                <button key={c.id} className="cxp-row" onClick={() => { onPick(c); onClose(); }}>
                  <Avatar name={c.name} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="cxp-nm block truncate">{c.name}</span>
                    <span className="cxp-meta">
                      {c.phone && <span className="inline-flex items-center gap-1"><Phone size={12} />{c.phone}</span>}
                      {c.member_code && <span className="inline-flex items-center gap-1"><IdCard size={12} />{c.member_code}</span>}
                      {!!c.points && <span className="cxp-chip"><Star size={11} />{c.points} {L("แต้ม", "pts", "积分")}</span>}
                    </span>
                  </span>
                  <Check size={18} style={{ opacity: 0, color: "#7950D8" }} />
                </button>
              ))}

              {!loading && q.trim() && results.length === 0 && (
                <div className="cxp-empty">{L("ไม่พบลูกค้า — กด “สร้างลูกค้าใหม่” ด้านบน", "No customers found — tap “Create new customer” above", "未找到客户 — 点击上方“创建新客户”")}</div>
              )}
              {!loading && !q.trim() && (
                <div className="cxp-empty">{L("เริ่มพิมพ์เพื่อค้นหา หรือสร้างลูกค้าใหม่", "Start typing to search or create a customer", "开始输入以搜索或创建客户")}</div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="cxp-form cxp-grow" style={{ overflowY: "auto" }}>
              <div className="cxp-field">
                <input className="cxp-inp" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={L("ชื่อลูกค้า *", "Customer name *", "客户姓名 *")} />
              </div>
              <div className="cxp-field">
                <Phone size={16} className="cxp-inp-ic" />
                <input className="cxp-inp cxp-inp2" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={L("เบอร์โทร", "Phone", "电话")} inputMode="tel" />
              </div>
              <div className="cxp-field">
                <input className="cxp-inp" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={L("อีเมล (ไม่บังคับ)", "Email (optional)", "邮箱(选填)")} inputMode="email" />
              </div>
              <div className="cxp-field">
                <IdCard size={16} className="cxp-inp-ic" />
                <input className="cxp-inp cxp-inp2" value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} placeholder={L("เลขผู้เสียภาษี (ไม่บังคับ)", "Tax ID (optional)", "纳税人识别号(选填)")} inputMode="numeric" />
              </div>
            </div>
            <div className="cxp-foot">
              <button className="cxp-btn cxp-btn-ghost" onClick={() => setMode("search")}>{L("ย้อนกลับ", "Back", "返回")}</button>
              <button className="cxp-btn cxp-btn-primary" disabled={!form.name.trim() || saving} onClick={submitCreate}>
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                {L("บันทึกและเลือก", "Save & select", "保存并选择")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
