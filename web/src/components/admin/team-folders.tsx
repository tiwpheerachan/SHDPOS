"use client";

// โฟลเดอร์ทีม (glass-folder) — หน้า landing ของ /admin/org
// กรอบแบ่งตาม "แบรนด์" (สีประจำแบรนด์ + art ชุดเดียวกันทั้งแบรนด์) · พื้นหลัง dot
// ฟิลเตอร์: ชิปแบรนด์ + ค้นหาสาขา/แบรนด์/ชื่อพนักงาน · โฟลเดอร์เล็ก ป้ายชื่ออยู่ใต้ (ตัวอักษรปกติ)
// กดโฟลเดอร์ (= 1 ร้าน) → เปิดผังองค์กรของร้านนั้น (onOpenStore) → ไปตั้งสิทธิ์รายคนต่อ
import { useMemo, useState } from "react";
import { Search, Store, Users2, X } from "lucide-react";
import GlassFolder, { type FolderFile, type ArtPreset } from "@/components/ui/glass-folder-cards";
import { EmptyState } from "@/components/ui";
import type { Branch, Brand, Employee } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/permissions";

const PRESETS: ArtPreset[] = ["aurora", "dusk", "verdant", "ember", "glacier"];
// สีประจำแบรนด์ (ตาม design token ของแอป) — บอกว่าแบรนด์ไหนอยู่ตรงไหน
const TONE_VARS = ["--c-lavender", "--c-aqua", "--c-mint", "--c-peach", "--c-brand"];
const toneOf = (i: number) => `rgb(var(${TONE_VARS[i % TONE_VARS.length]}))`;
const toneSoft = (i: number, a: number) => `rgb(var(${TONE_VARS[i % TONE_VARS.length]}) / ${a})`;

const FOLDER_W = 150;
type Locale = "th" | "en" | "zh";
type StoreGroup = { branch: Branch | null; emps: Employee[] };
type BrandFrame = { key: string; name: string; stores: StoreGroup[]; people: number };

function fullName(e: Employee) {
  return [e.first_name, e.last_name].filter(Boolean).join(" ").trim() || e.employee_code;
}
function displayFor(e: Employee) {
  return e.nickname ? `${fullName(e)} (${e.nickname})` : fullName(e);
}
function empMatches(e: Employee, term: string) {
  return (
    fullName(e).toLowerCase().includes(term) ||
    (e.nickname ?? "").toLowerCase().includes(term) ||
    (e.employee_code ?? "").toLowerCase().includes(term)
  );
}

export function TeamFolders({
  branches, brands, employees, locale, L, onOpenStore,
}: {
  branches: Branch[];
  brands: Brand[];
  employees: Employee[];
  locale: Locale;
  L: (th: string, en: string, zh: string) => string;
  /** branchId ของร้าน (null = ทีมส่วนกลาง/ไม่ระบุร้าน) + คนที่เลือก (ถ้าคลิกการ์ดคน) */
  onOpenStore: (branchId: string | null, person?: Employee) => void;
}) {
  const [q, setQ] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const branchLabel = (b: Branch) => b.name_th || b.name || b.code;
  const brandName = (id: string | null) => brands.find((x) => x.id === id)?.name ?? L("อื่นๆ", "Other", "其他");

  // จัดกลุ่มทั้งหมดก่อน (ยังไม่กรอง) — ใช้ทำชิปแบรนด์
  const allFrames = useMemo<BrandFrame[]>(() => {
    const active = employees.filter((e) => e.status === "active");
    const stores: StoreGroup[] = branches
      .map((b) => ({ branch: b, emps: active.filter((e) => e.home_branch_id === b.id || (e.branch_ids ?? []).includes(b.id)) }))
      .filter((g) => g.emps.length > 0);
    const assigned = new Set(stores.flatMap((s) => s.emps.map((e) => e.id)));
    const central = active.filter((e) => !assigned.has(e.id));

    const byBrand = new Map<string, StoreGroup[]>();
    for (const s of stores) {
      const bk = s.branch?.brand_id ?? "__nobrand__";
      if (!byBrand.has(bk)) byBrand.set(bk, []);
      byBrand.get(bk)!.push(s);
    }
    const out: BrandFrame[] = [];
    for (const [bk, list] of byBrand) {
      list.sort((a, b) => b.emps.length - a.emps.length);
      out.push({
        key: bk,
        name: bk === "__nobrand__" ? L("ไม่ระบุแบรนด์", "No brand", "无品牌") : brandName(bk),
        stores: list,
        people: list.reduce((n, s) => n + s.emps.length, 0),
      });
    }
    out.sort((a, b) => b.people - a.people);
    if (central.length) out.push({ key: "__central__", name: L("ทีมส่วนกลาง", "Central team", "中央团队"), stores: [{ branch: null, emps: central }], people: central.length });
    return out;
  }, [branches, brands, employees]); // eslint-disable-line react-hooks/exhaustive-deps

  // map แบรนด์ → index สี (คงที่ตามลำดับ allFrames)
  const toneIndex = useMemo(() => {
    const m = new Map<string, number>();
    allFrames.forEach((f, i) => m.set(f.key, i));
    return m;
  }, [allFrames]);

  // กรอง: แบรนด์ + คำค้น (สาขา/แบรนด์/ชื่อพนักงาน)
  const frames = useMemo<BrandFrame[]>(() => {
    const term = q.trim().toLowerCase();
    let fs = allFrames;
    if (brandFilter !== "all") fs = fs.filter((f) => f.key === brandFilter);
    if (!term) return fs;
    return fs
      .map((f) => {
        const frameHit = f.name.toLowerCase().includes(term);
        return {
          ...f,
          stores: f.stores.filter((s) => {
            const sName = s.branch ? branchLabel(s.branch) : f.name;
            return frameHit || sName.toLowerCase().includes(term) || s.emps.some((e) => empMatches(e, term));
          }),
        };
      })
      .filter((f) => f.stores.length > 0);
  }, [allFrames, brandFilter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalStores = frames.reduce((n, f) => n + f.stores.length, 0);
  const term = q.trim().toLowerCase();

  return (
    <div
      className="rounded-2xl border border-line p-4 sm:p-5"
      style={{ backgroundImage: "radial-gradient(rgb(var(--c-muted) / 0.2) 1px, transparent 1.4px)", backgroundSize: "20px 20px" }}
    >
      {/* ── ฟิลเตอร์ ── */}
      <div className="space-y-3 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L("ค้นหาสาขา / แบรนด์ / ชื่อพนักงาน…", "Search store / brand / staff name…", "搜索门店/品牌/员工姓名…")}
              className="w-full h-9 pl-9 pr-8 rounded-xl bg-surface border border-line text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
            {q ? (
              <button onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink" aria-label="clear"><X size={14} /></button>
            ) : null}
          </div>
          <span className="text-[11px] text-muted whitespace-nowrap">{totalStores} {L("ร้าน", "stores", "门店")}</span>
        </div>

        {/* ชิปแบรนด์ */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setBrandFilter("all")}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium border transition-colors ${brandFilter === "all" ? "bg-brand text-brandInk border-brand" : "bg-surface border-line text-muted hover:text-ink hover:bg-surface2"}`}
          >
            {L("ทุกแบรนด์", "All brands", "所有品牌")} <span className="opacity-70">· {allFrames.length}</span>
          </button>
          {allFrames.map((f) => {
            const ti = toneIndex.get(f.key) ?? 0;
            const on = brandFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setBrandFilter(on ? "all" : f.key)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium border transition-colors"
                style={on
                  ? { background: toneSoft(ti, 0.16), borderColor: toneOf(ti), color: "rgb(var(--c-ink))" }
                  : { background: "rgb(var(--c-surface))", borderColor: "rgb(var(--c-line))", color: "rgb(var(--c-muted))" }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: toneOf(ti) }} />
                {f.name} <span className="opacity-60">· {f.stores.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── กรอบแบรนด์ ── */}
      {frames.length ? (
        <div className="space-y-5">
          {frames.map((frame) => {
            const ti = toneIndex.get(frame.key) ?? 0;
            const framePreset = PRESETS[ti % PRESETS.length];
            return (
              <section
                key={frame.key}
                className="rounded-2xl border overflow-hidden"
                style={{ borderColor: toneSoft(ti, 0.35), background: `linear-gradient(180deg, ${toneSoft(ti, 0.07)} 0%, rgb(var(--c-surface) / 0.25) 60px)` }}
              >
                {/* หัวกรอบ = แบรนด์ */}
                <div className="flex items-center gap-2.5 px-4 py-2.5 border-b" style={{ borderColor: toneSoft(ti, 0.25), background: toneSoft(ti, 0.1) }}>
                  <span className="w-7 h-7 rounded-xl grid place-items-center text-white text-[13px] font-bold shrink-0" style={{ background: toneOf(ti) }}>
                    {frame.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <h3 className="text-sm font-semibold">{frame.name}</h3>
                  <span className="text-[11px] text-muted">{frame.stores.length} {L("ร้าน", "stores", "门店")} · {frame.people} {L("คน", "people", "人")}</span>
                  <Store size={14} className="ml-auto opacity-50" style={{ color: toneOf(ti) }} />
                </div>

                {/* โฟลเดอร์ของแบรนด์ */}
                <div className="p-4 flex flex-wrap gap-x-4 gap-y-2">
                  {frame.stores.map((g, i) => {
                    const files: FolderFile[] = g.emps.map((e, idx) => ({
                      name: displayFor(e),
                      meta: ROLE_LABEL[e.role]?.[locale] ?? e.role,
                      image: e.photo_url || undefined,
                      art: e.photo_url ? undefined : framePreset,
                    }));
                    const label = g.branch ? branchLabel(g.branch) : L("ทีมส่วนกลาง", "Central team", "中央团队");
                    const nameHits = term && g.emps.filter((e) => empMatches(e, term)).length;
                    return (
                      <div key={`${g.branch?.id ?? "central"}:${g.emps.length}`} className="relative" style={{ width: FOLDER_W }} title={label}>
                        <GlassFolder
                          label=""
                          meta=""
                          tone="light"
                          art={framePreset}
                          seed={ti * 23 + i * 5 + 3}
                          width={FOLDER_W}
                          action="none"
                          appearDelay={i * 50}
                          files={files}
                          onOpenChange={(o) => { if (o) onOpenStore(g.branch?.id ?? null); }}
                          onFileSelect={(_f, idx) => { const e = g.emps[idx]; onOpenStore(g.branch?.id ?? null, e); }}
                        />
                        {/* ป้ายชื่ออยู่บนตัวโฟลเดอร์ (บนกระจกหน้า) — ตัวอักษรขนาดปกติ ไม่ย่อตามโฟลเดอร์ */}
                        <div className="pointer-events-none absolute inset-x-0 bottom-[9px] px-3">
                          <p className="text-[11.5px] font-semibold leading-[1.15] line-clamp-2" style={{ color: "#1b1b1f" }}>{label}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: "rgba(27,27,31,0.6)" }}>
                            {g.emps.length} {L("คน", "people", "人")}
                            {nameHits ? <span style={{ color: "rgb(var(--c-brand))" }}> · {L("พบ", "match", "匹配")} {nameHits}</span> : null}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<Users2 size={24} />} title={q || brandFilter !== "all" ? L("ไม่พบผลลัพธ์", "No results", "无结果") : L("ยังไม่มีร้าน/พนักงาน", "No stores / staff yet", "暂无门店/员工")} />
      )}
    </div>
  );
}
