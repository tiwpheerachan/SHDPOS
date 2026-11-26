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
import { useL } from "@/lib/i18n/provider";
import { tr } from "@/lib/i18n/tr";
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
  if (!response.ok) throw Error(body.error || tr("ทำรายการไม่สำเร็จ", "Action failed", "操作失败"));
  return body;
}
const phaseLabels = (): Record<string, string> => ({
  enumerating: tr("กำลังอ่านรายการ", "Reading list", "正在读取列表"),
  hydrating: tr("เติมรายละเอียด", "Filling details", "补充详情"),
  review: tr("รอตรวจนำเข้า", "Awaiting import review", "待审核导入"),
  completed: tr("นำเข้ารอบนี้แล้ว", "Run imported", "本轮已导入"),
});
export default function CatalogSyncPage() {
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
  const L = useL();
  const phaseLabel = phaseLabels();
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
      setError(L("โหมดตัวอย่างไม่อ่านหรือเขียนข้อมูลจริง", "Demo mode doesn't read or write real data", "演示模式不读写真实数据"));
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
          L("นำเข้าฐานข้อมูลกลางแล้ว แต่รีเฟรชแคตตาล็อกในเครื่องไม่สำเร็จ กรุณาโหลดใหม่โดยไม่ต้องนำเข้าซ้ำ", "Imported to the central database, but refreshing the local catalog failed. Please reload — no need to import again.", "已导入中央数据库，但本机目录刷新失败。请重新加载，无需重复导入。"),
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
            <ArrowLeft size={12} />{L("คลังกลาง", "Central warehouse", "中央仓库")}
          </Link>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CloudDownload size={20} className="text-brand" />{L("นำเข้าแคตตาล็อก OneWarehouse", "OneWarehouse catalog import", "OneWarehouse 目录导入")}
          </h1>
        </div>
        <nav className="flex rounded-2xl bg-surface/65 border border-line/70 p-1 gap-0.5 overflow-x-auto max-w-full">
          {([
            ["run", "1", L("อ่าน & เติมรายละเอียด", "Read & fill details", "读取并补充详情")],
            ["review", "2", L("ตรวจ & นำเข้า", "Review & import", "审核并导入")],
            ["map", "3", L("ผูกคลังกับสาขา", "Map warehouse to branch", "仓库关联门店")],
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
          <Badge tone="info">{meta?.environment?.toUpperCase() || L("ยังไม่เชื่อมต่อ", "Not connected", "未连接")}</Badge>
          <Button disabled={demo || busy} onClick={() => void perform(async () => { await metadata(); if (run) await load(run.id, offset); })}>
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />{L("โหลดล่าสุด", "Reload latest", "加载最新")}
          </Button>
        </div>
      </header>

      {demo ? <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-2.5 text-xs text-brand font-medium">{L("โหมดแสดงตัวอย่าง UI · ข้อมูลสมมติ · ปิดการนำเข้าและการเขียนข้อมูลจริงทั้งหมด", "UI demo mode · sample data · all imports and real writes disabled", "UI 演示模式 · 模拟数据 · 已禁用所有导入和真实写入")}</div> : null}
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
            [L("พบจากต้นทาง", "Found at source", "源端发现"), stats.found, "text-ink"],
            [L("เติมแล้ว", "Filled", "已补充"), stats.hydrated, "text-ok"],
            [L("รอเติม", "Pending", "待补充"), stats.pending, "text-muted"],
            [L("อ่านไม่ได้", "Unreadable", "无法读取"), stats.errors, stats.errors ? "text-warn" : "text-muted"],
            [L("ขัดแย้ง", "Conflicts", "冲突"), stats.conflicts, stats.conflicts ? "text-danger" : "text-muted"],
            [L("นำเข้าแล้ว", "Imported", "已导入"), stats.imported, "text-ok"],
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
            <h2 className="text-sm font-semibold">{L("เริ่มรอบใหม่ หรือทำต่อจากรอบเดิม", "Start a new run or resume a previous one", "开始新一轮或继续之前的轮次")}</h2>
            <label className="block text-xs text-muted space-y-1.5">
              <span>{L("คลังที่ใช้ตรวจยอด (บันทึกกับรอบนี้ ไม่เปลี่ยนกลางทาง)", "Warehouse for stock check (saved with this run, can't change midway)", "用于核对库存的仓库（随本轮保存，中途不可更改）")}</span>
              <Select disabled={demo || busy} value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                <option value="">{L("ยังไม่ตรวจสต๊อก", "Don't check stock", "不检查库存")}</option>
                {meta?.warehouses.filter((w) => w.status === "active").map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>{w.name_en} · {w.warehouse_id}</option>
                ))}
              </Select>
            </label>
            <Button variant="primary" disabled={demo || busy || !meta} onClick={() => void create()}>
              <Plus size={15} />{L("สร้างรอบซิงก์ใหม่", "New sync run", "新建同步轮次")}
            </Button>
            <div className="border-t border-line pt-4">
              <label className="block text-xs text-muted space-y-1.5">
                <span>{L("ทำต่อจากรอบเดิม", "Resume previous run", "继续之前的轮次")}</span>
                <Select disabled={demo || busy} value={run?.id || ""} onChange={(e) => void perform(() => load(e.target.value))}>
                  <option value="">{L("เลือกรอบซิงก์", "Select sync run", "选择同步轮次")}</option>
                  {meta?.runs.map((r) => (
                    <option key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString("th-TH")} · {phaseLabel[r.phase]}</option>
                  ))}
                </Select>
              </label>
            </div>
          </Card>

          <Card className="p-4 sm:p-5 space-y-4">
            <h2 className="text-sm font-semibold">{L("รอบปัจจุบัน", "Current run", "当前轮次")}</h2>
            {run ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={run.phase === "review" || run.phase === "completed" ? "ok" : "info"}>{phaseLabel[run.phase]}</Badge>
                  <span className="text-xs text-muted">{L(`อ่านแล้ว ${run.page_count} หน้า · คลัง ${run.warehouse_id || "ไม่ได้เลือก"} · version ${run.version}`, `Read ${run.page_count} pages · Warehouse ${run.warehouse_id || "not selected"} · version ${run.version}`, `已读取 ${run.page_count} 页 · 仓库 ${run.warehouse_id || "未选择"} · version ${run.version}`)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {busy ? (
                    <Button onClick={() => { stop.current = true; }}><Pause size={14} />{L("พักหลังจบรายการนี้", "Pause after this item", "完成此项后暂停")}</Button>
                  ) : (
                    <Button variant="primary" disabled={!["enumerating", "hydrating"].includes(run.phase)} onClick={() => void resume()}>
                      <Play size={14} />{L("ทำต่อจนพร้อมตรวจนำเข้า", "Continue until ready for review", "继续至可审核导入")}
                    </Button>
                  )}
                  <Button disabled={demo || busy || !["hydrating", "review", "completed"].includes(run.phase)} onClick={() => void retry()}>
                    <RefreshCw size={14} />{L("ลองใหม่เฉพาะที่ผิดพลาด", "Retry failed only", "仅重试失败项")}
                  </Button>
                  {["review", "completed"].includes(run.phase) ? (
                    <Button variant="soft" onClick={() => setTab("review")}>{L("ไปตรวจ & นำเข้า →", "Go to review & import →", "前往审核并导入 →")}</Button>
                  ) : null}
                </div>
                {run.last_error ? <p className="text-xs text-danger">{L("ครั้งก่อนหยุด:", "Last stopped:", "上次停止：")} {run.last_error} · {L("ข้อมูลและจุดทำต่อยังเก็บไว้", "data and resume point are kept", "数据和续传点已保留")}</p> : null}
              </>
            ) : <p className="text-sm text-muted">{L("ยังไม่มีรอบ — สร้างรอบซิงก์ใหม่ทางซ้าย", "No runs yet — create a new sync run on the left", "暂无轮次 — 请在左侧新建同步轮次")}</p>}
            <div className="rounded-xl bg-brand/5 border border-brand/15 p-3 flex gap-2.5 text-[11px] leading-relaxed">
              <PackageCheck size={18} className="text-brand shrink-0" />
              <p><b>{L("นำเข้าแคตตาล็อก ไม่ใช่รับสินค้าเข้าคลัง", "Catalog import, not goods receipt", "导入目录，而非入库收货")}</b> · {L("สินค้าใหม่ปิดขายไว้ก่อนเสมอ · ค่าว่างจากต้นทางไม่ลบข้อมูลเดิม · เก็บชื่อ/รูป/ต้นทุน/นโยบาย SN เดิม · ยอดคลังเป็นข้อมูลสังเกต ไม่แก้สต๊อก POS และไม่ปิดสินค้าที่ไม่พบ", "New products always start disabled for sale · empty source values never erase existing data · existing name/image/cost/SN policy kept · warehouse qty is informational only, doesn't change POS stock or disable missing products", "新商品默认停售 · 源端空值不会删除现有数据 · 保留原名称/图片/成本/SN 策略 · 仓库数量仅供参考，不修改 POS 库存，也不停用未找到的商品")}</p>
            </div>
          </Card>
        </div>
      ) : tab === "map" ? (
        <Card className="p-4 sm:p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><Link2 size={15} />{L("ผูกคลัง OneWarehouse กับสาขา POS", "Map OneWarehouse warehouse to POS branch", "将 OneWarehouse 仓库关联到 POS 门店")}</h2>
            <p className="text-xs text-muted mt-1">{L("ใช้เทียบยอดคลังกับสต๊อกสาขา · ผูกแล้วหน้าคลังกลางจะเทียบยอดให้อัตโนมัติ", "Used to compare warehouse qty with branch stock · once mapped, the central warehouse page reconciles automatically", "用于对比仓库数量与门店库存 · 关联后中央仓库页面将自动对账")}</p>
          </div>
          {currentWarehouse ? (
            <div className="grid sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-end rounded-xl border border-line/70 p-3">
              <label className="text-xs text-muted space-y-1.5 min-w-0">
                <span>{L("คลัง", "Warehouse", "仓库")} <span translate="no">{currentWarehouse}</span> → {L("สาขา", "Branch", "门店")}</span>
                <Select value={branch} disabled={demo || busy} onChange={(e) => setBranch(e.target.value)}>
                  <option value="">{L("เลือกสาขาเพื่อยืนยันการจับคู่", "Select a branch to confirm mapping", "选择门店以确认关联")}</option>
                  {meta?.branches.map((b) => <option key={b.id} value={b.id}>{b.name_th || b.name} · {b.code}</option>)}
                </Select>
              </label>
              <Button variant="primary" disabled={demo || busy || !branch}
                onClick={() => void perform(async () => { await api("map", { warehouse_id: currentWarehouse, branch_id: branch }); await metadata(); if (run) await load(run.id, offset); })}>
                {L("บันทึกการผูกคลัง", "Save mapping", "保存关联")}
              </Button>
              <Badge tone={mappedBranch ? "ok" : "warn"}>{mappedBranch ? L("ผูกคลังแล้ว", "Mapped", "已关联") : L("ยังไม่ผูกคลัง", "Not mapped", "未关联")}</Badge>
            </div>
          ) : <p className="text-sm text-muted">{L("เลือกคลังในขั้นที่ 1 ก่อน แล้วกลับมาผูกที่นี่", "Select a warehouse in step 1 first, then come back to map it here", "请先在第 1 步选择仓库，再回到此处关联")}</p>}
          <div>
            <p className="text-xs font-medium mb-2">{L("การผูกที่มีอยู่", "Existing mappings", "现有关联")} ({meta?.mappings.length ?? 0})</p>
            {meta?.mappings.length ? (
              <div className="rounded-xl border border-line/70 divide-y divide-line/60">
                {meta.mappings.map((m) => (
                  <div key={m.warehouse_id + m.branch_id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="font-mono" translate="no">{m.warehouse_id}</span><span className="text-muted">→</span><span className="font-medium">{mapName(m.branch_id)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted">{L("ยังไม่มีการผูกคลัง", "No mappings yet", "暂无关联")}</p>}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="p-3 sm:p-4 flex flex-wrap gap-2 items-center border-b border-line">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute top-1/2 -translate-y-1/2 left-3 text-muted" />
              <Input className="pl-9 h-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L("ค้นหา SKU / ชื่อ ในหน้านี้", "Search SKU / name on this page", "在本页搜索 SKU / 名称")} />
            </div>
            <div className="flex rounded-xl bg-surface2/70 p-0.5 overflow-x-auto">
              {([["all", L("ทั้งหมด", "All", "全部")], ["new", L("ใหม่", "New", "新")], ["existing", L("สินค้าเดิม", "Existing", "现有")], ["conflict", L("ขัดแย้ง", "Conflict", "冲突")], ["error", L("ผิดพลาด", "Error", "错误")], ["imported", L("นำเข้าแล้ว", "Imported", "已导入")]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setFilter(k)} className={`h-8 px-2.5 rounded-lg text-xs whitespace-nowrap ${filter === k ? "bg-surface text-ink shadow-sm font-medium" : "text-muted"}`}>{l}</button>
              ))}
            </div>
            <Button disabled={demo || busy} onClick={() => setSelected(visible.filter(canSelect).slice(0, 50).map((i) => i.sku_key))}>
              <CheckCheck size={14} />{L("เลือกที่พร้อม (สูงสุด 50)", "Select ready (max 50)", "选择就绪项（最多 50）")}
            </Button>
            <Button variant="primary" disabled={demo || busy || !selected.length || !run || !["review", "completed"].includes(run.phase)}
              onClick={() => { setPriceUpdate(false); setConfirm(true); }}>
              {L(`ตรวจและนำเข้า ${selected.length} รายการ`, `Review & import ${selected.length} items`, `审核并导入 ${selected.length} 项`)}
            </Button>
          </div>
          <div className="overflow-auto max-h-[calc(100vh-330px)] min-h-[320px]">
            <table className="w-full text-xs">
              <thead className="bg-surface2 text-muted sticky top-0 z-10">
                <tr>
                  {["", L("สินค้า / SKU", "Product / SKU", "商品 / SKU"), L("ผลจับคู่", "Match", "匹配结果"), L("ราคา POS → JST", "Price POS → JST", "价格 POS → JST"), L("ยอดคลัง", "Warehouse qty", "仓库数量"), L("ความพร้อม", "Readiness", "就绪状态"), ""].map((h, i) => (
                    <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap" key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((i) => (
                  <tr key={i.sku_key} className={`hover:bg-surface2/50 ${selected.includes(i.sku_key) ? "bg-brand/[0.04]" : ""}`}>
                    <td className="px-4 py-2.5">
                      <input aria-label={L(`เลือก ${i.sku}`, `Select ${i.sku}`, `选择 ${i.sku}`)} type="checkbox" disabled={demo || busy || !canSelect(i)} checked={selected.includes(i.sku_key)}
                        onChange={(e) => setSelected((s) => (e.target.checked ? (s.length < 50 ? [...s, i.sku_key] : s) : s.filter((k) => k !== i.sku_key)))} />
                    </td>
                    <td className="px-4 py-2.5 max-w-[320px]">
                      <p className="font-medium text-ink truncate" translate="no">{i.detail?.name || i.summary.name || i.sku}</p>
                      <p className="font-mono text-muted mt-0.5" translate="no">{i.sku}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={i.import_kind ? "ok" : i.match.kind === "conflict" ? "danger" : i.match.kind === "new" ? "info" : "neutral"}>
                        {i.import_kind ? L("นำเข้าแล้ว", "Imported", "已导入") : i.match.kind === "conflict" ? L("ขัดแย้ง", "Conflict", "冲突") : i.match.kind === "new" ? L("ใหม่", "New", "新") : L("สินค้าเดิม", "Existing", "现有")}
                      </Badge>
                      {i.detail_status !== "ok" ? <p className="mt-1 text-[10px] text-muted">{i.detail_status === "pending" ? L("รอเติมรายละเอียด", "Awaiting details", "待补充详情") : i.detail_status === "missing" ? L("ไม่พบ exact SKU", "Exact SKU not found", "未找到精确 SKU") : L("อ่านไม่สำเร็จ", "Read failed", "读取失败")}</p> : null}
                    </td>
                    <td className="px-4 py-2.5 tnum whitespace-nowrap">
                      {i.match.product ? formatTHB(i.match.product.price, false) : "—"} → {i.detail?.sale_price == null ? <span className="text-muted">{L("ยังไม่ทราบ", "Unknown", "未知")}</span> : formatTHB(i.detail.sale_price, false)}
                    </td>
                    <td className="px-4 py-2.5 tnum">{i.stock_qty == null ? <span className="text-muted">{L("ยังไม่ยืนยัน", "Unconfirmed", "未确认")}</span> : i.stock_qty}</td>
                    <td className="px-4 py-2.5 max-w-[240px]">
                      <Badge tone={i.blockers.length ? "warn" : "ok"}>{i.blockers.length ? L(`รอตรวจ ${i.blockers.length} จุด`, `${i.blockers.length} to review`, `待审核 ${i.blockers.length} 处`) : L("ข้อมูลครบ", "Complete", "信息完整")}</Badge>
                      {i.import_error || i.detail_error || i.blockers[0] ? <p className="text-muted mt-1 truncate" title={i.import_error || i.detail_error || i.blockers[0]}>{i.import_error || i.detail_error || i.blockers[0]}</p> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" onClick={() => setDetail(i)}><Eye size={15} />{L("ดู", "View", "查看")}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length ? <div className="text-center p-10 text-sm text-muted">{run ? L("ยังไม่มีรายการในหน้านี้", "No items on this page", "本页暂无项目") : L("สร้างรอบซิงก์ในขั้นที่ 1 เพื่อเริ่มอ่านรายการสินค้า", "Create a sync run in step 1 to start reading products", "在第 1 步新建同步轮次以开始读取商品")}</div> : null}
          </div>
          <div className="px-4 py-3 border-t border-line flex flex-wrap justify-between items-center gap-3 text-xs text-muted">
            <span>{L(`เพิ่มใหม่ ${stats.created} · อัปเดต ${stats.updated} · แสดง ${items.length ? offset + 1 : 0}–${offset + items.length} จาก ${stats.found}`, `Created ${stats.created} · Updated ${stats.updated} · Showing ${items.length ? offset + 1 : 0}–${offset + items.length} of ${stats.found}`, `新增 ${stats.created} · 更新 ${stats.updated} · 显示 ${items.length ? offset + 1 : 0}–${offset + items.length} / 共 ${stats.found}`)}</span>
            <div className="flex gap-2">
              <Button disabled={demo || busy || !run || offset === 0} onClick={() => run && void perform(() => load(run.id, Math.max(0, offset - 100)))}><ChevronLeft size={14} />{L("ก่อนหน้า", "Previous", "上一页")}</Button>
              <Button disabled={demo || busy || !run || offset + 100 >= stats.found} onClick={() => run && void perform(() => load(run.id, offset + 100))}>{L("ถัดไป", "Next", "下一页")}<ChevronRight size={14} /></Button>
            </div>
          </div>
        </Card>
      )}

      {/* รายละเอียดสินค้า — Drawer ขวา (ไม่ดันหน้า) */}
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width="lg" title={detail ? L(`ตรวจสินค้า · ${detail.sku}`, `Review product · ${detail.sku}`, `审核商品 · ${detail.sku}`) : L("รายละเอียด", "Details", "详情")}>
        {detail ? (
          <div className="p-5 space-y-4 text-sm">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-muted">{L("สินค้า POS เดิม", "Existing POS product", "现有 POS 商品")}</p>
                <p className="mt-2 font-medium" translate="no">{detail.match.product?.name_th || L("ยังไม่มีสินค้า", "No product yet", "暂无商品")}</p>
                <p className="text-xs font-mono mt-1 break-all text-muted">{detail.match.product?.id || L("จะสร้างรหัสใหม่เพียงครั้งเดียว", "A new ID will be created once", "将仅创建一次新编码")}</p>
                <p className="mt-2">{L("ราคา", "Price", "价格")} {detail.match.product ? formatTHB(detail.match.product.price) : "—"}</p>
              </div>
              <div className="rounded-xl border border-line p-4">
                <p className="text-xs text-muted">{L("ข้อมูล JST จาก exact lookup", "JST data from exact lookup", "来自精确查询的 JST 数据")}</p>
                <p className="mt-2 font-medium" translate="no">{detail.detail?.name || L("รอรายละเอียด", "Awaiting details", "等待详情")}</p>
                <p className="mt-2">{L("ราคา", "Price", "价格")} {detail.detail?.sale_price == null ? L("ยังไม่ทราบ", "Unknown", "未知") : formatTHB(detail.detail.sale_price)}</p>
                <p className="text-xs text-muted mt-2">
                  SN: {detail.detail?.serial_tracking == null ? L("ยังไม่ทราบ", "Unknown", "未知") : detail.detail.serial_tracking ? L("ต้องสแกน", "Scan required", "需扫描") : L("ไม่ใช้ SN", "No SN", "不使用 SN")} · {L("สินค้าชุด", "Bundle", "套装")}: {detail.detail?.is_combined == null ? L("ยังไม่ทราบ", "Unknown", "未知") : detail.detail.is_combined ? L("ใช่", "Yes", "是") : L("ไม่ใช่", "No", "否")}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted">{L("รูป ชื่อที่ใช้งาน ต้นทุน และการตั้งค่าเดิมจะไม่ถูกลบทับ บาร์โค้ดใหม่จะเพิ่มโดยไม่ลบรายการเดิม", "Existing image, display name, cost and settings won't be overwritten. New barcodes are added without removing existing ones.", "现有图片、显示名称、成本和设置不会被覆盖。新条码将追加，不删除现有条码。")}</p>
            {detail.blockers.map((b) => <p key={b} className="text-xs text-amber-700 flex gap-2"><AlertTriangle size={14} className="shrink-0" />{b}</p>)}
            {detail.stock_error ? <p className="text-xs text-danger">{L("สต๊อก:", "Stock:", "库存：")} {detail.stock_error}</p> : null}
            {detail.import_error ? <p className="text-xs text-danger">{L("นำเข้า:", "Import:", "导入：")} {detail.import_error}</p> : null}
            <Button disabled={demo || busy || Boolean(detail.import_kind)} onClick={() => { const key = detail.sku_key; setDetail(null); void retry([key]); }}>
              {L("ลองใหม่รายการที่ผิดพลาดนี้", "Retry this failed item", "重试此失败项")}
            </Button>
          </div>
        ) : null}
      </Drawer>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={L("ยืนยันขอบเขตการนำเข้า", "Confirm import scope", "确认导入范围")}
        footer={<><Button onClick={() => setConfirm(false)}>{L("กลับไปตรวจ", "Back to review", "返回审核")}</Button><Button variant="primary" onClick={() => void importSelected()}>{L(`นำเข้า ${selected.length} รายการ`, `Import ${selected.length} items`, `导入 ${selected.length} 项`)}</Button></>}>
        <div className="space-y-4 text-sm">
          <p>{L("สินค้าใหม่จะสร้างแบบ", "New products are created as", "新商品将以")} <strong>{L("ปิดขาย", "not for sale", "停售")}</strong> {L("ส่วนสินค้าเดิมรักษา product_id และสถานะเดิม ไม่แก้สต๊อกหรือประวัติ", "; existing products keep their product_id and status — stock and history are untouched", "状态创建；现有商品保留 product_id 与原状态，不修改库存或历史")}</p>
          <label className="flex gap-2 items-start rounded-xl border border-line bg-surface2 p-4">
            <input type="checkbox" checked={priceUpdate} onChange={(e) => setPriceUpdate(e.target.checked)} />
            <span>{L("อัปเดตราคาขายสินค้าเดิมด้วยค่าจาก exact lookup", "Update existing products' sale prices from exact lookup", "用精确查询的值更新现有商品售价")}
              <p className="text-xs text-muted mt-1">{L("ค่าเริ่มต้นคือเก็บราคาเดิม · ราคา null ไม่ทับค่าเดิม · ราคา 0 จะคงเป็น 0 และถูกเตือนว่ารออนุมัติราคา", "Default keeps existing prices · null prices don't overwrite · price 0 stays 0 and is flagged as awaiting price approval", "默认保留原价 · null 价格不覆盖原值 · 价格 0 保持为 0 并提示待批准价格")}</p>
            </span>
          </label>
          <p className="text-xs text-muted">{L("หากข้อมูล POS เปลี่ยนหลังดูตัวอย่าง ระบบจะข้ามรายการนั้นและแจ้งให้ตรวจใหม่ การนำเข้ารอบนี้ไม่ใช่ delta sync และไม่ปิดสินค้าที่ไม่พบ", "If POS data changes after preview, that item is skipped and flagged for re-review. This import is not a delta sync and doesn't disable products that aren't found.", "如果预览后 POS 数据发生变化，系统将跳过该项并提示重新审核。本次导入不是增量同步，也不会停用未找到的商品。")}</p>
        </div>
      </Modal>
    </div>
  );
}
