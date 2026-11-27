"use client";
// =====================================================================
// ใครออนไลน์อยู่หน้าไหน — รูปโปรไฟล์ซ้อนกันบนแถบด้านบน (แบบ Lark) · กดดูรายชื่อ + หน้าที่เปิดอยู่ · กดชื่อเพื่อไปหน้านั้น
//   ทุกคนส่งสัญญาณทุก 30 วิ + ตอนเปลี่ยนหน้า · เห็นรายชื่อเฉพาะผู้มีสิทธิ์ presence.view
// =====================================================================
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/store/session";
import { can } from "@/lib/permissions";
import { tr } from "@/lib/i18n/tr";

type Person = { key: string; me: boolean; name: string; avatar_url: string | null; path: string; label: string | null; at: string };
const BEAT_MS = 30_000, POLL_MS = 15_000;
// สีพื้นรูปย่อ (โทนนุ่มแบบ Lark) — เลือกตามชื่อให้คงที่
const TONES = ["#5B8DEF", "#9B6EE8", "#E8789B", "#3FB27F", "#F0A23B", "#34A9C8", "#7C83FD", "#D9795F"];
const tone = (s: string) => TONES[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];
const initials = (n: string) => { const w = n.replace(/[-–—(].*$/, "").trim().split(/\s+/).filter(Boolean); return ((w[0]?.[0] ?? "?") + (w[1]?.[0] ?? "")).toUpperCase(); };

function Avatar({ p, size = 32, ring = true }: { p: Person; size?: number; ring?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`relative inline-grid place-items-center rounded-full shrink-0 ${ring ? "ring-2 ring-surface" : ""}`} style={{ width: size, height: size, background: tone(p.name) }}>
      {p.avatar_url && !broken
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={p.avatar_url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="w-full h-full rounded-full object-cover" />
        : <span className="text-white font-semibold" style={{ fontSize: size * 0.36 }}>{initials(p.name)}</span>}
      <span className="absolute -bottom-0 -right-0 rounded-full bg-ok ring-2 ring-surface" style={{ width: size * 0.3, height: size * 0.3 }} />
    </span>
  );
}

const ago = (iso: string) => { const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000); return s < 45 ? tr("อยู่ตอนนี้", "Active now", "当前在线") : tr(`${Math.round(s / 60)} นาทีที่แล้ว`, `${Math.round(s / 60)} min ago`, `${Math.round(s / 60)} 分钟前`); };

export function OnlinePresence({ pageLabel }: { pageLabel?: string }) {
  const { employee } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const allowed = !!employee && can(employee, "presence.view");
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const labelRef = useRef(pageLabel);
  labelRef.current = pageLabel;

  // ส่งสัญญาณ: ตอนเปลี่ยนหน้า + ทุก 30 วิ (หยุดเมื่อแท็บซ่อน) · ปิดแท็บ = ออก
  useEffect(() => {
    if (!employee) return;
    const beat = () => { if (document.visibilityState === "visible") void fetch("/api/admin/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: window.location.pathname + window.location.search, label: labelRef.current }), keepalive: true }).catch(() => {}); };
    beat();
    const id = setInterval(beat, BEAT_MS);
    const vis = () => beat();
    const leave = () => navigator.sendBeacon?.("/api/admin/presence", new Blob([JSON.stringify({ path: "/", leave: true })], { type: "application/json" }));
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", leave);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); window.removeEventListener("pagehide", leave); };
  }, [employee, pathname, pageLabel]);

  // รายชื่อ (เฉพาะผู้มีสิทธิ์)
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try { const r = await fetch("/api/admin/presence", { cache: "no-store" }); if (!r.ok) return; const j = await r.json(); if (alive) setPeople(j.people ?? []); } catch { /* เครือข่ายสะดุด */ }
    };
    void load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [allowed, pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!allowed || !people.length) return null;
  const others = people.filter((p) => !p.me);
  const shown = people.slice(0, 4);
  const extra = people.length - shown.length;
  const samePage = (p: Person) => p.path.split("?")[0] === pathname;

  return (
    <div className="relative hidden md:block" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        aria-label={tr(`ออนไลน์ ${people.length} คน`, `${people.length} online`, `${people.length} 人在线`)}
        className="flex items-center h-9 pl-1 pr-1.5 rounded-xl hover:bg-surface2 transition-colors">
        <span className="flex -space-x-2">
          {shown.map((p) => <span key={p.key} title={`${p.name} · ${p.label ?? p.path}`}><Avatar p={p} size={28} /></span>)}
          {extra > 0 ? <span className="w-7 h-7 rounded-full grid place-items-center bg-surface2 ring-2 ring-surface text-[10.5px] font-semibold text-muted">+{extra}</span> : null}
        </span>
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-line bg-surface shadow-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <span className="text-sm font-semibold inline-flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-ok" />{tr("ออนไลน์ตอนนี้", "Online now", "当前在线")}</span>
            <span className="text-xs text-muted tnum">{people.length} {tr("คน", "people", "人")}</span>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {[...people.filter((p) => p.me), ...others].map((p) => (
              <li key={p.key}>
                <button type="button" disabled={p.me || samePage(p)} onClick={() => { setOpen(false); router.push(p.path); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface2 disabled:hover:bg-transparent disabled:cursor-default">
                  <Avatar p={p} size={34} ring={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate" translate="no">{p.name}{p.me ? <span className="text-muted font-normal"> ({tr("คุณ", "you", "你")})</span> : null}</span>
                    <span className="block text-xs text-muted truncate">{p.label ?? p.path}{samePage(p) && !p.me ? ` · ${tr("หน้าเดียวกับคุณ", "same page", "同一页面")}` : ""}</span>
                  </span>
                  <span className="text-[10.5px] text-muted shrink-0">{ago(p.at)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="px-4 py-2 border-t border-line text-[10.5px] text-muted">{tr("กดชื่อเพื่อไปหน้าที่เขาเปิดอยู่", "Click a name to open their page", "点击姓名打开其所在页面")}</p>
        </div>
      ) : null}
    </div>
  );
}
