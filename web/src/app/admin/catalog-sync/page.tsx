"use client";
import Link from "next/link";
import { catalogDemo } from "@/lib/catalog-sync/demo";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CloudDownload,
  Play,
  Pause,
  RefreshCw,
  CheckCheck,
  AlertTriangle,
  Search,
  Eye,
  Link2,
  PackageCheck,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Card,
  Button,
  Badge,
  Input,
  Select,
  Modal,
  Drawer,
} from "@/components/ui";
import { refreshCatalogCache } from "@/lib/offline/catalog";
import { formatTHB } from "@/lib/money";
import type { StageItem, Match } from "@/lib/catalog-sync/model";
interface Run {
  id: string;
  phase: string;
  version: number;
  warehouse_id: string | null;
  page_count: number;
  last_error: string | null;
  created_at: string;
  environment: string;
}
interface Preview extends StageItem {
  match: Match;
  blockers: string[];
}
interface Stats {
  found: number;
  pending: number;
  hydrated: number;
  errors: number;
  conflicts: number;
  created: number;
  updated: number;
  imported: number;
}
const empty: Stats = {
  found: 0,
  pending: 0,
  hydrated: 0,
  errors: 0,
  conflicts: 0,
  created: 0,
  updated: 0,
  imported: 0,
};
interface Meta {
  runs: Run[];
  environment: string;
  warehouses: { warehouse_id: string; name_en: string; status: string }[];
  branches: {
    id: string;
    code: string;
    name: string;
    name_th: string | null;
  }[];
  mappings: { warehouse_id: string; branch_id: string }[];
}
async function api(action: string, data: Record<string, unknown> = {}) {
  const response = await fetch("/api/admin/catalog-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...data }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || "ทำรายการไม่สำเร็จ");
  return body;
}
const phaseLabel: Record<string, string> = {
  enumerating: "กำลังอ่านรายการ",
  hydrating: "เติมรายละเอียด",
  review: "รอตรวจนำเข้า",
  completed: "นำเข้ารอบนี้แล้ว",
};
export default function CatalogSyncPage() {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
  const [meta, setMeta] = useState<Meta | null>(null),
    [run, setRun] = useState<Run | null>(null),
    [stats, setStats] = useState<Stats>(empty),
    [items, setItems] = useState<Preview[]>([]);
  const [warehouse, setWarehouse] = useState(""),
    [branch, setBranch] = useState(""),
    [offset, setOffset] = useState(0),
    [mappedBranch, setMappedBranch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
    [priceUpdate, setPriceUpdate] = useState(false),
    [detail, setDetail] = useState<Preview | null>(null),
    [confirm, setConfirm] = useState(false),
    [tab, setTab] = useState<"run" | "review" | "map">("run");
  const openedTab = useRef(false);
  const stop = useRef(false),
    running = useRef(false),
    generation = useRef(0);
  async function metadata() {
    const r = await fetch("/api/admin/catalog-sync", { cache: "no-store" }),
      data = await r.json();
    if (!r.ok) throw Error(data.error);
    setMeta(data);
    return data as Meta;
  }
  async function load(id: string, page = 0) {
    const token = ++generation.current;
    const r = await fetch(
        `/api/admin/catalog-sync?run_id=${encodeURIComponent(id)}&offset=${page}`,
        { cache: "no-store" },
      ),
      data = await r.json();
    if (!r.ok) throw Error(data.error);
    if (token !== generation.current) return;
    setRun(data.run);
    setStats(data.stats || empty);
    setItems(data.items);
    setMappedBranch(data.mappedBranch);
    setBranch(data.mappedBranch || "");
    setWarehouse(data.run.warehouse_id || "");
    setOffset(page);
    setSelected([]);
    if (!openedTab.current) { openedTab.current = true; if (["review", "completed"].includes(data.run.phase)) setTab("review"); }
  }
  useEffect(() => {
    if (demo) {
      const data = catalogDemo();
      setMeta(data.meta);
      setRun(data.run);
      setItems(data.items);
      setStats(data.stats);
      setMappedBranch(data.mappedBranch);
      setBranch(data.mappedBranch);
      setWarehouse(data.run.warehouse_id);
      return;
    }
    void metadata()
      .then((data) => {
        if (data.runs[0]) return load(data.runs[0].id);
      })
      .catch((e) => setError(e.message));
    return () => {
      stop.current = true;
      generation.current++;
    };
  }, []);
  async function perform(fn: () => Promise<void>) {
    if (demo) {
      setError("โหมดตัวอย่างไม่อ่านหรือเขียนข้อมูลจริง");
      return;
    }
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function create() {
    await perform(async () => {
      const data = await api("create", { warehouse_id: warehouse || null });
      await metadata();
      await load(data.run.id);
    });
  }
  async function resume() {
    if (!run) return;
    const initial = run;
    await perform(async () => {
      stop.current = false;
      let current = initial,
        steps = 0;
      try {
        while (
          !stop.current &&
          ["enumerating", "hydrating"].includes(current.phase)
        ) {
          const data = await api(
            current.phase === "enumerating" ? "page" : "hydrate",
            { run_id: current.id, version: current.version },
          );
          current = data.run;
          setRun(current);
          if (data.stats) setStats(data.stats);
          steps++;
          if (
            steps % 20 === 0 ||
            !["enumerating", "hydrating"].includes(current.phase)
          )
            await load(current.id, 0);
        }
      } finally {
        await load(current.id, 0);
        await metadata();
      }
    });
  }
  async function retry(keys?: string[]) {
    if (!run) return;
    await perform(async () => {
      const data = await api("retry", {
        run_id: run.id,
        version: run.version,
        ...(keys ? { keys } : {}),
      });
      await load(data.run.id, offset);
    });
  }
  async function importSelected() {
    if (!run) return;
    setConfirm(false);
    await perform(async () => {
      const expected = Object.fromEntries(
        items
          .filter((i) => selected.includes(i.sku_key))
          .map((i) => [
            i.sku_key,
            {
              id: i.match.product?.id ?? null,
              updated_at: i.match.product?.updated_at ?? null,
            },
          ]),
      );
      await api("import", {
        run_id: run.id,
        version: run.version,
        keys: selected,
        expected,
        update_prices: priceUpdate,
      });
      await load(run.id, offset);
      await metadata();
      try {
        await refreshCatalogCache(true);
      } catch {
        setError(
          "นำเข้าฐานข้อมูลกลางแล้ว แต่รีเฟรชแคตตาล็อกในเครื่องไม่สำเร็จ กรุณาโหลดใหม่โดยไม่ต้องนำเข้าซ้ำ",
        );
      }
    });
  }
  const canSelect = (i: Preview) =>
    i.detail_status === "ok" && i.match.kind !== "conflict" && !i.import_kind;
  const visible = items.filter(
    (i) =>
      (!query ||
        `${i.sku} ${i.detail?.name || i.summary.name || ""}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (filter === "all" ||
        (filter === "error" &&
          (i.detail_status === "error" ||
            i.detail_status === "missing" ||
            i.stock_error ||
            i.import_error)) ||
        (filter === "conflict" && i.match.kind === "conflict") ||
        (filter === "imported" && Boolean(i.import_kind)) ||
        filter === i.match.kind),
  );
  const currentWarehouse = run?.warehouse_id || warehouse;
  const stepIndex = run ? ["enumerating", "hydrating", "review", "completed"].indexOf(run.phase) : -1;
  const readyCount = items.filter(canSelect).length;
  const mapName = (id: string | null) => {
    const b = meta?.branches.find((x) => x.id === id);
    return b ? `${b.name_th || b.name} · ${b.code}` : "—";
  };
  return (
    <div className="max-w-[1500px] mx-auto p-4 sm:p-6 space-y-4">
      {/* ── หัวแถวเดียว: ชื่อ · แท็บขั้นตอน · สถานะ/ปุ่ม ── */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <div className="min-w-0">
          <Link href="/admin/onewarehouse" className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-brand">
            <ArrowLeft size={12} />คลังกลาง
          </Link>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CloudDownload size={20} className="text-brand" />นำเข้าแคตตาล็อก OneWarehouse
          </h1>
        </div>
        <nav className="flex rounded-2xl bg-surface/65 border border-line/70 p-1 gap-0.5 overflow-x-auto max-w-full">
          {([
            ["run", "1", "อ่าน & เติมรายละเอียด"],
            ["review", "2", "ตรวจ & นำเข้า"],
            ["map", "3", "ผูกคลังกับสาขา"],
          ] as const).map(([k, n, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`h-8 px-3 rounded-xl text-xs whitespace-nowrap inline-flex items-center gap-1.5 transition ${tab === k ? "bg-brand text-brandInk shadow-sm" : "text-muted hover:bg-surface"}`}>
              <span className={`h-4 w-4 rounded-full grid place-items-center text-[10px] ${tab === k ? "bg-white/25" : "bg-surface2"}`}>{n}</span>
              {label}
              {k === "review" && readyCount ? <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] grid place-items-center ${tab === k ? "bg-white/20" : "bg-ok/15 text-ok"}`}>{readyCount}</span> : null}
              {k === "map" && currentWarehouse && !mappedBranch ? <span className="h-1.5 w-1.5 rounded-full bg-warn" /> : null}
            </button>
          ))}
        </nav>
        <div className="flex gap-2 items-center ml-auto">
          <Badge tone="info">{meta?.environment?.toUpperCase() || "ยังไม่เชื่อมต่อ"}</Badge>
          <Button disabled={demo || busy} onClick={() => void perform(async () => { await metadata(); if (run) await load(run.id, offset); })}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />โหลดล่าสุด
          </Button>
        </div>
      </header>

      {demo ? <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-2.5 text-xs text-brand font-medium">โหมดแสดงตัวอย่าง UI · ข้อมูลสมมติ · ปิดการนำเข้าและการเขียนข้อมูลจริงทั้งหมด</div> : null}
      {error ? (
        <div role="alert" className="rounded-xl border border-danger/25 bg-danger/5 px-4 py-2.5 text-sm text-danger flex gap-2">
          <AlertTriangle size={17} className="shrink-0" />{error}
        </div>
      ) : null}

      {/* ── แถบสถานะรอบ (เห็นทุกแท็บ, สูงคงที่) ── */}
      <section className="rounded-2xl border border-line/70 bg-surface p-3 sm:p-4 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-center">
        <div className="flex items-center gap-2 min-w-0">
          {["enumerating", "hydrating", "review", "completed"].map((ph, i) => (
            <div key={ph} className="flex items-center gap-2 flex-1 min-w-0">
              <div className={`h-7 w-7 rounded-full grid place-items-center text-[11px] font-semibold shrink-0 ${i < stepIndex ? "bg-ok text-white" : i === stepIndex ? "bg-brand text-brandInk" : "bg-surface2 text-muted"}`}>{i < stepIndex ? "✓" : i + 1}</div>
              <span className={`text-[11px] truncate ${i === stepIndex ? "font-semibold text-ink" : "text-muted"}`}>{phaseLabel[ph]}</span>
              {i < 3 ? <span className={`h-px flex-1 min-w-[8px] ${i < stepIndex ? "bg-ok" : "bg-line"}`} /> : null}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {([
            ["พบจากต้นทาง", stats.found, "text-ink"],
            ["เติมแล้ว", stats.hydrated, "text-ok"],
            ["รอเติม", stats.pending, "text-muted"],
            ["อ่านไม่ได้", stats.errors, stats.errors ? "text-warn" : "text-muted"],
            ["ขัดแย้ง", stats.conflicts, stats.conflicts ? "text-danger" : "text-muted"],
            ["นำเข้าแล้ว", stats.imported, "text-ok"],
          ] as const).map(([l, v, tone]) => (
            <div key={l} className="rounded-xl bg-surface2/50 px-2 py-1.5 text-center">
              <p className={`text-base font-semibold tnum ${tone}`}>{v}</p>
              <p className="text-[9.5px] text-muted leading-tight">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {tab === "run" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card className="p-4 sm:p-5 space-y-4">
            <h2 className="text-sm font-semibold">เริ่มรอบใหม่ หรือทำต่อจากรอบเดิม</h2>
            <label className="block text-xs text-muted space-y-1.5">
              <span>คลังที่ใช้ตรวจยอด (บันทึกกับรอบนี้ ไม่เปลี่ยนกลางทาง)</span>
              <Select disabled={demo || busy} value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                <option value="">ยังไม่ตรวจสต๊อก</option>
                {meta?.warehouses.filter((w) => w.status === "active").map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>{w.name_en} · {w.warehouse_id}</option>
                ))}
              </Select>
            </label>
            <Button variant="primary" disabled={demo || busy || !meta} onClick={() => void create()}>
              <Plus size={15} />สร้างรอบซิงก์ใหม่
            </Button>
            <div className="border-t border-line pt-4">
              <label className="block text-xs text-muted space-y-1.5">
                <span>ทำต่อจากรอบเดิม</span>
                <Select disabled={demo || busy} value={run?.id || ""} onChange={(e) => void perform(() => load(e.target.value))}>
                  <option value="">เลือกรอบซิงก์</option>
                  {meta?.runs.map((r) => (
                    <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString("th-TH")} · {phaseLabel[r.phase]}</option>
                  ))}
                </Select>
              </label>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-4">
            <h2 className="text-sm font-semibold">รอบปัจจุบัน</h2>
            {run ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={run.phase === "review" || run.phase === "completed" ? "ok" : "info"}>{phaseLabel[run.phase]}</Badge>
                  <span className="text-xs text-muted">อ่านแล้ว {run.page_count} หน้า · คลัง {run.warehouse_id || "ไม่ได้เลือก"} · version {run.version}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {busy ? (
                    <Button onClick={() => { stop.current = true; }}><Pause size={14} />พักหลังจบรายการนี้</Button>
                  ) : (
                    <Button variant="primary" disabled={!["enumerating", "hydrating"].includes(run.phase)} onClick={() => void resume()}>
                      <Play size={14} />ทำต่อจนพร้อมตรวจนำเข้า
                    </Button>
                  )}
                  <Button disabled={demo || busy || !["hydrating", "review", "completed"].includes(run.phase)} onClick={() => void retry()}>
                    <RefreshCw size={14} />ลองใหม่เฉพาะที่ผิดพลาด
                  </Button>
                  {["review", "completed"].includes(run.phase) ? (
                    <Button variant="soft" onClick={() => setTab("review")}>ไปตรวจ & นำเข้า →</Button>
                  ) : null}
                </div>
                {run.last_error ? <p className="text-xs text-danger">ครั้งก่อนหยุด: {run.last_error} · ข้อมูลและจุดทำต่อยังเก็บไว้</p> : null}
              </>
            ) : <p className="text-sm text-muted">ยังไม่มีรอบ — สร้างรอบซิงก์ใหม่ทางซ้าย</p>}
            <div className="rounded-xl bg-brand/5 border border-brand/15 p-3 flex gap-2.5 text-[11px] leading-relaxed">
              <PackageCheck size={18} className="text-brand shrink-0" />
              <p><b>นำเข้าแคตตาล็อก ไม่ใช่รับสินค้าเข้าคลัง</b> · สินค้าใหม่ปิดขายไว้ก่อนเสมอ · ค่าว่างจากต้นทางไม่ลบข้อมูลเดิม · เก็บชื่อ/รูป/ต้นทุน/นโยบาย SN เดิม · ยอดคลังเป็นข้อมูลสังเกต ไม่แก้สต๊อก POS และไม่ปิดสินค้าที่ไม่พบ</p>
            </div>
          </Card>
        </div>
      ) : tab === "map" ? (
        <Card className="p-4 sm:p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><Link2 size={15} />ผูกคลัง OneWarehouse กับสาขา POS</h2>
            <p className="text-xs text-muted mt-1">ใช้เทียบยอดคลังกับสต๊อกสาขา · ผูกแล้วหน้าคลังกลางจะเทียบยอดให้อัตโนมัติ</p>
          </div>
          {currentWarehouse ? (
            <div className="grid sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-end rounded-xl border border-line/70 p-3">
              <label className="text-xs text-muted space-y-1.5 min-w-0">
                <span>คลัง {currentWarehouse} → สาขา</span>
                <Select value={branch} disabled={demo || busy} onChange={(e) => setBranch(e.target.value)}>
                  <option value="">เลือกสาขาเพื่อยืนยันการจับคู่</option>
                  {meta?.branches.map((b) => <option key={b.id} value={b.id}>{b.name_th || b.name} · {b.code}</option>)}
                </Select>
              </label>
              <Button variant="primary" disabled={demo || busy || !branch}
                onClick={() => void perform(async () => { await api("map", { warehouse_id: currentWarehouse, branch_id: branch }); await metadata(); if (run) await load(run.id, offset); })}>
                บันทึกการผูกคลัง
              </Button>
              <Badge tone={mappedBranch ? "ok" : "warn"}>{mappedBranch ? "ผูกคลังแล้ว" : "ยังไม่ผูกคลัง"}</Badge>
            </div>
          ) : <p className="text-sm text-muted">เลือกคลังในขั้นที่ 1 ก่อน แล้วกลับมาผูกที่นี่</p>}
          <div>
            <p className="text-xs font-medium mb-2">การผูกที่มีอยู่ ({meta?.mappings.length ?? 0})</p>
            {meta?.mappings.length ? (
              <div className="rounded-xl border border-line/70 divide-y divide-line/60">
                {meta.mappings.map((m) => (
                  <div key={m.warehouse_id + m.branch_id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="font-mono">{m.warehouse_id}</span><span className="text-muted">→</span><span className="font-medium">{mapName(m.branch_id)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted">ยังไม่มีการผูกคลัง</p>}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="p-3 sm:p-4 flex flex-wrap gap-2 items-center border-b border-line">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute top-1/2 -translate-y-1/2 left-3 text-muted" />
              <Input className="pl-9 h-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นหา SKU / ชื่อ ในหน้านี้" />
            </div>
            <div className="flex rounded-xl bg-surface2/70 p-0.5 overflow-x-auto">
              {([["all", "ทั้งหมด"], ["new", "ใหม่"], ["existing", "สินค้าเดิม"], ["conflict", "ขัดแย้ง"], ["error", "ผิดพลาด"], ["imported", "นำเข้าแล้ว"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={`h-8 px-2.5 rounded-lg text-xs whitespace-nowrap ${filter === k ? "bg-surface text-ink shadow-sm font-medium" : "text-muted"}`}>{l}</button>
              ))}
            </div>
            <Button disabled={demo || busy} onClick={() => setSelected(visible.filter(canSelect).slice(0, 50).map((i) => i.sku_key))}>
              <CheckCheck size={14} />เลือกที่พร้อม (สูงสุด 50)
            </Button>
            <Button variant="primary" disabled={demo || busy || !selected.length || !run || !["review", "completed"].includes(run.phase)}
              onClick={() => { setPriceUpdate(false); setConfirm(true); }}>
              ตรวจและนำเข้า {selected.length} รายการ
            </Button>
          </div>
          <div className="overflow-auto max-h-[calc(100vh-330px)] min-h-[320px]">
            <table className="w-full text-xs">
              <thead className="bg-surface2 text-muted sticky top-0 z-10">
                <tr>
                  {["", "สินค้า / SKU", "ผลจับคู่", "ราคา POS → JST", "ยอดคลัง", "ความพร้อม", ""].map((h, i) => (
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap" key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((i) => (
                  <tr key={i.sku_key} className={`hover:bg-surface2/50 ${selected.includes(i.sku_key) ? "bg-brand/[0.04]" : ""}`}>
                    <td className="px-4 py-2.5">
                      <input aria-label={`เลือก ${i.sku}`} type="checkbox" disabled={demo || busy || !canSelect(i)} checked={selected.includes(i.sku_key)}
                        onChange={(e) => setSelected((s) => (e.target.checked ? (s.length < 50 ? [...s, i.sku_key] : s) : s.filter((k) => k !== i.sku_key)))} />
                    </td>
                    <td className="px-4 py-2.5 max-w-[320px]">
                      <p className="font-medium text-ink truncate">{i.detail?.name || i.summary.name || i.sku}</p>
                      <p className="font-mono text-muted mt-0.5">{i.sku}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={i.import_kind ? "ok" : i.match.kind === "conflict" ? "danger" : i.match.kind === "new" ? "info" : "neutral"}>
                        {i.import_kind ? "นำเข้าแล้ว" : i.match.kind === "conflict" ? "ขัดแย้ง" : i.match.kind === "new" ? "ใหม่" : "สินค้าเดิม"}
                      </Badge>
                      {i.detail_status !== "ok" ? <p className="mt-1 text-[10px] text-muted">{i.detail_status === "pending" ? "รอเติมรายละเอียด" : i.detail_status === "missing" ? "ไม่พบ exact SKU" : "อ่านไม่สำเร็จ"}</p> : null}
                    </td>
                    <td className="px-4 py-2.5 tnum whitespace-nowrap">
                      {i.match.product ? formatTHB(i.match.product.price, false) : "—"} → {i.detail?.sale_price == null ? <span className="text-muted">ยังไม่ทราบ</span> : formatTHB(i.detail.sale_price, false)}
                    </td>
                    <td className="px-4 py-2.5 tnum">{i.stock_qty == null ? <span className="text-muted">ยังไม่ยืนยัน</span> : i.stock_qty}</td>
                    <td className="px-4 py-2.5 max-w-[240px]">
                      <Badge tone={i.blockers.length ? "warn" : "ok"}>{i.blockers.length ? `รอตรวจ ${i.blockers.length} จุด` : "ข้อมูลครบ"}</Badge>
                      {i.import_error || i.detail_error || i.blockers[0] ? <p className="text-muted mt-1 truncate" title={i.import_error || i.detail_error || i.blockers[0]}>{i.import_error || i.detail_error || i.blockers[0]}</p> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" onClick={() => setDetail(i)}><Eye size={15} />ดู</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length ? <div className="text-center p-10 text-sm text-muted">{run ? "ยังไม่มีรายการในหน้านี้" : "สร้างรอบซิงก์ในขั้นที่ 1 เพื่อเริ่มอ่านรายการสินค้า"}</div> : null}
          </div>
          <div className="px-4 py-3 border-t border-line flex flex-wrap justify-between items-center gap-3 text-xs text-muted">
            <span>เพิ่มใหม่ {stats.created} · อัปเดต {stats.updated} · แสดง {items.length ? offset + 1 : 0}–{offset + items.length} จาก {stats.found}</span>
            <div className="flex gap-2">
              <Button disabled={demo || busy || !run || offset === 0} onClick={() => run && void perform(() => load(run.id, Math.max(0, offset - 100)))}><ChevronLeft size={14} />ก่อนหน้า</Button>
              <Button disabled={demo || busy || !run || offset + 100 >= stats.found} onClick={() => run && void perform(() => load(run.id, offset + 100))}>ถัดไป<ChevronRight size={14} /></Button>
            </div>
          </div>
        </Card>
      )}

      {/* รายละเอียดสินค้า — Drawer ขวา (ไม่ดันหน้า) */}
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width="lg" title={detail ? `ตรวจสินค้า · ${detail.sku}` : "รายละเอียด"}>
        {detail ? (
          <div className="p-5 space-y-4 text-sm">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-muted">สินค้า POS เดิม</p>
                <p className="mt-2 font-medium">{detail.match.product?.name_th || "ยังไม่มีสินค้า"}</p>
                <p className="text-xs font-mono mt-1 break-all text-muted">{detail.match.product?.id || "จะสร้างรหัสใหม่เพียงครั้งเดียว"}</p>
                <p className="mt-2">ราคา {detail.match.product ? formatTHB(detail.match.product.price) : "—"}</p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-muted">ข้อมูล JST จาก exact lookup</p>
                <p className="mt-2 font-medium">{detail.detail?.name || "รอรายละเอียด"}</p>
                <p className="mt-2">ราคา {detail.detail?.sale_price == null ? "ยังไม่ทราบ" : formatTHB(detail.detail.sale_price)}</p>
                <p className="text-xs text-muted mt-2">
                  SN: {detail.detail?.serial_tracking == null ? "ยังไม่ทราบ" : detail.detail.serial_tracking ? "ต้องสแกน" : "ไม่ใช้ SN"} · สินค้าชุด: {detail.detail?.is_combined == null ? "ยังไม่ทราบ" : detail.detail.is_combined ? "ใช่" : "ไม่ใช่"}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted">รูป ชื่อที่ใช้งาน ต้นทุน และการตั้งค่าเดิมจะไม่ถูกลบทับ บาร์โค้ดใหม่จะเพิ่มโดยไม่ลบรายการเดิม</p>
            {detail.blockers.map((b) => <p key={b} className="text-xs text-amber-700 flex gap-2"><AlertTriangle size={14} className="shrink-0" />{b}</p>)}
            {detail.stock_error ? <p className="text-xs text-danger">สต๊อก: {detail.stock_error}</p> : null}
            {detail.import_error ? <p className="text-xs text-danger">นำเข้า: {detail.import_error}</p> : null}
            <Button disabled={demo || busy || Boolean(detail.import_kind)} onClick={() => { const key = detail.sku_key; setDetail(null); void retry([key]); }}>
              ลองใหม่รายการที่ผิดพลาดนี้
            </Button>
          </div>
        ) : null}
      </Drawer>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="ยืนยันขอบเขตการนำเข้า"
        footer={<><Button onClick={() => setConfirm(false)}>กลับไปตรวจ</Button><Button variant="primary" onClick={() => void importSelected()}>นำเข้า {selected.length} รายการ</Button></>}>
        <div className="space-y-4 text-sm">
          <p>สินค้าใหม่จะสร้างแบบ <strong>ปิดขาย</strong> ส่วนสินค้าเดิมรักษา product_id และสถานะเดิม ไม่แก้สต๊อกหรือประวัติ</p>
          <label className="flex gap-2 items-start rounded-xl border border-line bg-surface2 p-4">
            <input type="checkbox" checked={priceUpdate} onChange={(e) => setPriceUpdate(e.target.checked)} />
            <span>อัปเดตราคาขายสินค้าเดิมด้วยค่าจาก exact lookup
              <p className="text-xs text-muted mt-1">ค่าเริ่มต้นคือเก็บราคาเดิม · ราคา null ไม่ทับค่าเดิม · ราคา 0 จะคงเป็น 0 และถูกเตือนว่ารออนุมัติราคา</p>
            </span>
          </label>
          <p className="text-xs text-muted">หากข้อมูล POS เปลี่ยนหลังดูตัวอย่าง ระบบจะข้ามรายการนั้นและแจ้งให้ตรวจใหม่ การนำเข้ารอบนี้ไม่ใช่ delta sync และไม่ปิดสินค้าที่ไม่พบ</p>
        </div>
      </Modal>
    </div>
  );
}
