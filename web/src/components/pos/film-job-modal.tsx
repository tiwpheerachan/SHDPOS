"use client";
// =====================================================================
// งานติดฟิล์มรถ (หน้าร้าน) — 1 เลือกรถ → 2 รุ่นฟิล์ม → 3 ตำแหน่ง/ความเข้ม → สรุปราคา + ม้วนที่ใช้ → ใส่ตะกร้า
//   คำนวณด้วยตัวคิดกลาง lib/film/quote (เซิร์ฟเวอร์คิดซ้ำตอนชำระเงิน ต้องตรงกัน)
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { Car, Search, Check, Loader2, AlertTriangle, Layers, Ruler } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n/provider";
import { formatTHB } from "@/lib/money";
import { quoteFilmJob, FilmError, priceKey, type FilmConfigData, type FilmJob, type FilmQuote } from "@/lib/film/quote";

type Cfg = FilmConfigData & { brand_id: string | null; cars: { make: string; model: string; size_code: string }[] };
let cache: { branch: string; at: number; cfg: Cfg } | null = null;

export async function loadPosFilmConfig(branchId: string): Promise<Cfg> {
  if (cache && cache.branch === branchId && Date.now() - cache.at < 5 * 60_000) return cache.cfg;
  const r = await fetch(`/api/pos/film-config?branch_id=${branchId}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw Error(j.error ?? `HTTP ${r.status}`);
  cache = { branch: branchId, at: Date.now(), cfg: j };
  return j;
}

export function FilmJobModal({ open, onClose, branchId, stockOf, onAdd }: {
  open: boolean; onClose: () => void; branchId: string | null;
  stockOf: (productId: string) => number | null;
  onAdd: (job: FilmJob, quote: FilmQuote) => void;
}) {
  const { L, locale } = useI18n();
  const [cfg, setCfg] = useState<Cfg | null>(null), [err, setErr] = useState("");
  const [size, setSize] = useState(""), [car, setCar] = useState(""), [q, setQ] = useState("");
  const [series, setSeries] = useState("");
  const [picked, setPicked] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (!open || !branchId) return;
    setErr("");
    loadPosFilmConfig(branchId).then((c) => {
      setCfg(c);
      setSeries((s) => s || c.series.find((x) => x.active)?.code || "");
      setPicked((p) => (Object.keys(p).length ? p : Object.fromEntries(c.positions.map((x) => [x.code, null]))));
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [open, branchId]);

  // เปลี่ยนรุ่น → ความเข้มเดิมที่ไม่มีในรุ่นใหม่ ให้เลือกใหม่
  const shadesOf = (se: string) => (cfg?.shades ?? []).filter((s) => s.series_code === se && s.active).map((s) => s.shade).sort((a, b) => a - b);
  useEffect(() => {
    if (!cfg || !series) return;
    const ok = shadesOf(series);
    setPicked((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v != null && ok.includes(v) ? v : null])));
  }, [series, cfg]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (x: { name_th: string; name_en: string; name_zh: string }) => (locale === "th" ? x.name_th : locale === "zh" ? x.name_zh : x.name_en);
  const cars = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, " ");
    if (!cfg || s.length < 2) return [];
    return cfg.cars.filter((c) => `${c.make} ${c.model}`.toLowerCase().includes(s) || c.model.toLowerCase().replace(/\s+/g, "").includes(s.replace(/\s+/g, ""))).slice(0, 8);
  }, [cfg, q]);

  const job: FilmJob | null = size && series ? { size, series, positions: Object.entries(picked).filter(([, v]) => v != null).map(([code, shade]) => ({ code, shade: shade! })) } : null;
  const result = useMemo((): { quote?: FilmQuote; error?: string } => {
    if (!cfg || !job) return {};
    try { return { quote: quoteFilmJob(cfg, job, L) }; } catch (e) { return { error: e instanceof FilmError ? e.message : String(e) }; }
  }, [cfg, JSON.stringify(job), L]); // eslint-disable-line react-hooks/exhaustive-deps

  const fullCarOnly = !!cfg?.rules.full_car_only;
  const setAll = (shade: number) => cfg && setPicked(Object.fromEntries(cfg.positions.map((p) => [p.code, shade])));
  const short = (result.quote?.lines ?? []).reduce((m, l) => m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.qty), new Map<string, number>());
  const shortages = [...short.entries()].filter(([pid, need]) => { const have = stockOf(pid); return have != null && have < need; });

  function reset() { setSize(""); setCar(""); setQ(""); if (cfg) setPicked(Object.fromEntries(cfg.positions.map((x) => [x.code, null]))); }

  return (
    <Modal open={open} onClose={onClose} size="xl" title={<span className="inline-flex items-center gap-2"><Car size={18} />{L("งานติดฟิล์มรถยนต์", "Car window film job", "汽车贴膜")}</span>}
      footer={<div className="flex items-center justify-between gap-3 w-full">
        <span className="text-xs text-muted">{result.quote ? L(`ใช้ฟิล์มรวม ${result.quote.feet} ฟุต`, `${result.quote.feet} ft of film`, `共用膜 ${result.quote.feet} 英尺`) : ""}</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{L("ยกเลิก", "Cancel", "取消")}</Button>
          <Button variant="primary" disabled={!result.quote || !job} onClick={() => { if (job && result.quote) { onAdd(job, result.quote); reset(); } }}>
            <Check size={15} />{result.quote ? L(`ใส่ตะกร้า · ${formatTHB(result.quote.price)}`, `Add to cart · ${formatTHB(result.quote.price)}`, `加入购物车 · ${formatTHB(result.quote.price)}`) : L("ใส่ตะกร้า", "Add to cart", "加入购物车")}
          </Button>
        </div>
      </div>}>
      {err ? <p className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p> : !cfg ? (
        <div className="h-60 grid place-items-center text-muted"><Loader2 className="animate-spin" /></div>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5">
          <div className="space-y-5 min-w-0">
            {/* 1 รถ */}
            <section>
              <Step n={1} text={L("รถของลูกค้า", "Customer's car", "顾客车辆")} />
              <div className="relative mb-2.5">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("พิมพ์ยี่ห้อ/รุ่นรถ เช่น Vios, Fortuner, Civic", "Type make/model e.g. Vios, Fortuner, Civic", "输入品牌/车型，如 Vios、Fortuner")}
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-line bg-surface text-sm" />
                {cars.length ? (
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-line bg-surface shadow-pop p-1 max-h-72 overflow-auto">
                    {cars.map((c) => (
                      <button key={`${c.make}|${c.model}`} type="button" onClick={() => { setSize(c.size_code); setCar(`${c.make} ${c.model}`); setQ(""); }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface2 flex items-center justify-between text-sm">
                        <span translate="no">{c.make} <b>{c.model}</b></span>
                        <span className="text-xs text-muted">{name(cfg.sizes.find((s) => s.code === c.size_code) ?? { name_th: c.size_code, name_en: c.size_code, name_zh: c.size_code })}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {car ? <p className="text-xs mb-2"><span className="text-muted">{L("รถ", "Car", "车辆")}: </span><b translate="no">{car}</b></p> : null}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {cfg.sizes.map((s) => (
                  <button key={s.code} type="button" onClick={() => { setSize(s.code); if (car && cfg.cars.find((c) => `${c.make} ${c.model}` === car)?.size_code !== s.code) setCar(""); }}
                    className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${size === s.code ? "border-brand bg-brand/[0.07] ring-1 ring-brand/30" : "border-line hover:bg-surface2"}`}>
                    <span className="block text-[13px] font-semibold">{name(s)}</span>
                    {s.hint_th ? <span className="block text-[10.5px] text-muted truncate" translate="no">{s.hint_th}</span> : null}
                  </button>
                ))}
              </div>
            </section>

            {/* 2 รุ่นฟิล์ม */}
            <section>
              <Step n={2} text={L("รุ่นฟิล์ม", "Film series", "膜系列")} hint={cfg.rules.one_series_per_car ? L("รุ่นเดียวทั้งคัน", "One series per car", "整车同系列") : undefined} />
              <div className="grid sm:grid-cols-3 gap-2">
                {cfg.series.filter((s) => s.active).map((s) => {
                  const p = size ? cfg.prices[priceKey(s.code, size, "ALL")] : undefined;
                  return (
                    <button key={s.code} type="button" onClick={() => setSeries(s.code)}
                      className={`text-left rounded-xl border px-3 py-3 transition-colors ${series === s.code ? "border-brand bg-brand/[0.07] ring-1 ring-brand/30" : "border-line hover:bg-surface2"}`}>
                      <span className="block text-sm font-semibold">{s.name}</span>
                      <span className="block text-[11px] text-muted">{locale === "th" ? s.tagline_th : locale === "zh" ? s.tagline_zh : s.tagline_en} · {shadesOf(s.code).join("/")}%</span>
                      <span className="block mt-1 text-[13px] font-semibold tnum">{p ? `${formatTHB(p)} ${L("รอบคัน", "full car", "全车")}` : <span className="text-muted font-normal text-[11px]">{size ? L("ยังไม่ตั้งราคา", "No price", "未定价") : L("เลือกขนาดรถก่อน", "Pick a size", "先选尺寸")}</span>}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 3 ตำแหน่ง + ความเข้ม */}
            <section>
              <Step n={3} text={L("ตำแหน่งและความเข้ม", "Positions & shade", "位置与深度")} hint={fullCarOnly ? L("ตอนนี้ขายรอบคันเท่านั้น", "Full car only for now", "目前仅限全车") : undefined} />
              <div className="flex flex-wrap items-center gap-1.5 mb-2 text-xs">
                <span className="text-muted">{L("ทุกบานเข้ม", "All windows", "全部")}</span>
                {shadesOf(series).map((sh) => <button key={sh} type="button" onClick={() => setAll(sh)} className="px-2.5 h-7 rounded-lg border border-line hover:bg-surface2 tnum">{sh}%</button>)}
              </div>
              <div className="rounded-2xl border border-line divide-y divide-line/70">
                {cfg.positions.map((p) => {
                  const v = picked[p.code];
                  const sqft = size ? cfg.areas[size]?.[p.code] : undefined;
                  return (
                    <div key={p.code} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <label className="flex items-center gap-2 min-w-[150px] flex-1 text-sm">
                        <input type="checkbox" checked={v != null} disabled={fullCarOnly && v != null && Object.values(picked).every((x) => x != null)}
                          onChange={(e) => setPicked({ ...picked, [p.code]: e.target.checked ? shadesOf(series)[shadesOf(series).length - 1] ?? null : null })} className="accent-[rgb(var(--c-brand))]" />
                        <span className="font-medium">{name(p)}</span>
                        {sqft ? <span className="text-[11px] text-muted tnum">{sqft} {L("ตร.ฟุต", "sq ft", "平方英尺")} · {Math.round((sqft / (cfg.rules.roll_width_ft || 5)) * 10) / 10} {L("ฟุต", "ft", "英尺")}</span> : null}
                      </label>
                      <div className="flex gap-1">
                        {shadesOf(series).map((sh) => (
                          <button key={sh} type="button" onClick={() => setPicked({ ...picked, [p.code]: sh })}
                            className={`h-8 min-w-[52px] px-2 rounded-lg border text-xs tnum ${v === sh ? "border-brand bg-brand text-brandInk" : "border-line hover:bg-surface2"}`}>{sh}%</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* สรุป */}
          <aside className="rounded-2xl border border-line bg-surface2/60 p-4 space-y-3 self-start lg:sticky lg:top-0">
            <p className="text-sm font-semibold">{L("สรุปงาน", "Job summary", "工单摘要")}</p>
            {result.error ? <p className="text-xs text-warn flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{result.error}</p>
              : !result.quote ? <p className="text-xs text-muted">{L("เลือกขนาดรถ รุ่น และความเข้มให้ครบ", "Choose size, series and shades", "请选择尺寸、系列与深度")}</p> : (
              <>
                <p className="text-[12px] leading-snug" translate="no">{result.quote.label}</p>
                <p className="text-3xl font-bold tnum">{formatTHB(result.quote.price)}</p>
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted flex items-center gap-1"><Layers size={12} />{L("ตัดสต๊อกม้วนฟิล์ม", "Film rolls used", "扣减膜卷")}</p>
                  {[...short.entries()].map(([pid, need]) => {
                    const sh = cfg.shades.find((s) => s.stock_product_id === pid);
                    const have = stockOf(pid);
                    return (
                      <div key={pid} className="flex items-center justify-between text-xs rounded-lg bg-surface px-2.5 py-1.5 border border-line">
                        <span translate="no"><b>{sh?.model_code}</b> <span className="text-muted">{sh?.sku}</span></span>
                        <span className={`tnum ${have != null && have < need ? "text-danger font-semibold" : ""}`}>{need} {L("ฟุต", "ft", "英尺")}{have != null ? <span className="text-muted"> / {L("มี", "have", "有")} {have}</span> : null}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted flex items-center gap-1"><Ruler size={12} />{result.quote.positions.map((p) => `${p.model_code} ${p.feet}${L("ฟุต", "ft", "英尺")}`).join(" · ")}</p>
                {shortages.length ? <p className="text-xs text-danger flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{L("ม้วนฟิล์มในสาขาไม่พอ", "Not enough film in this branch", "本店膜卷不足")}</p> : null}
              </>
            )}
          </aside>
        </div>
      )}
    </Modal>
  );
}

function Step({ n, text, hint }: { n: number; text: string; hint?: string }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
      <span className="h-5 w-5 rounded-full bg-brand/12 text-brand grid place-items-center text-[11px] tnum">{n}</span>{text}
      {hint ? <span className="text-[11px] font-normal text-muted">· {hint}</span> : null}
    </p>
  );
}
