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
  KpiTile,
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
    [confirm, setConfirm] = useState(false);
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
  return (
    <div className="max-w-[1500px] mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <Link
            href="/admin/onewarehouse"
            className="inline-flex items-center gap-1 text-xs text-muted"
          >
            <ArrowLeft size={13} />
            คลังกลาง
          </Link>
          <h1 className="text-xl font-semibold mt-2 flex items-center gap-2">
            <CloudDownload size={23} className="text-brand" />
            นำเข้าแคตตาล็อก OneWarehouse
          </h1>
          <p className="text-xs text-muted mt-1">
            อ่านครบทุกหน้า → เติมรายละเอียด → ตรวจจับคู่ → นำเข้าอย่างปลอดภัย
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge tone="info">
            {meta?.environment?.toUpperCase() || "ยังไม่เชื่อมต่อ"}
          </Badge>
          <Button
            disabled={demo || busy}
            onClick={() =>
              void perform(async () => {
                await metadata();
                if (run) await load(run.id, offset);
              })
            }
          >
            <RefreshCw size={14} />
            โหลดล่าสุด
          </Button>
        </div>
      </div>
      {demo ? (
        <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 text-sm text-brand font-medium">
          โหมดแสดงตัวอย่าง UI · ข้อมูลสมมติ ·
          ปิดการนำเข้าและการเขียนข้อมูลจริงทั้งหมด
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger flex gap-2"
        >
          <AlertTriangle size={18} className="shrink-0" />
          {error}
        </div>
      ) : null}
      <Card className="p-4 sm:p-5">
        <div className="grid sm:grid-cols-4 gap-3 items-end">
          <label className="text-xs text-muted space-y-1.5">
            <span>คลังที่ใช้ตรวจยอด</span>
            <Select
              disabled={demo || busy}
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
            >
              <option value="">ยังไม่ตรวจสต๊อก</option>
              {meta?.warehouses
                .filter((w) => w.status === "active")
                .map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>
                    {w.name_en} · {w.warehouse_id}
                  </option>
                ))}
            </Select>
          </label>
          <div className="sm:col-span-2">
            <Button
              disabled={demo || busy || !meta}
              onClick={() => void create()}
            >
              <Plus size={15} />
              สร้างรอบซิงก์ใหม่
            </Button>
            <p className="text-[11px] text-muted mt-2">
              คลังที่เลือกจะถูกบันทึกกับรอบนี้ ไม่เปลี่ยนคลังกลางทาง
            </p>
          </div>
          <label className="text-xs text-muted space-y-1.5">
            <span>ทำต่อจากรอบเดิม</span>
            <Select
              disabled={demo || busy}
              value={run?.id || ""}
              onChange={(e) => void perform(() => load(e.target.value))}
            >
              <option value="">เลือกรอบซิงก์</option>
              {meta?.runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.created_at).toLocaleString("th-TH")} ·{" "}
                  {phaseLabel[r.phase]}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>
      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {[
          ["พบจากต้นทาง", stats.found, "brand"],
          ["เติมรายละเอียดแล้ว", stats.hydrated, "ok"],
          ["รอเติมรายละเอียด", stats.pending, "neutral"],
          ["อ่านไม่สำเร็จ", stats.errors, "warn"],
          ["พบข้อขัดแย้ง", stats.conflicts, "danger"],
          ["นำเข้าแล้ว", stats.imported, "ok"],
        ].map(([label, value, tone]) => (
          <KpiTile
            key={String(label)}
            label={String(label)}
            value={String(value)}
            tone={tone as "brand" | "ok" | "neutral" | "warn" | "danger"}
          />
        ))}
      </div>
      {run ? (
        <Card className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <Badge
                tone={
                  run.phase === "review" || run.phase === "completed"
                    ? "ok"
                    : "info"
                }
              >
                {phaseLabel[run.phase]}
              </Badge>
              <p className="text-xs text-muted mt-2">
                อ่านแล้ว {run.page_count} หน้า · คลัง{" "}
                {run.warehouse_id || "ไม่ได้เลือก"} · version {run.version}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {busy ? (
                <Button
                  onClick={() => {
                    stop.current = true;
                  }}
                >
                  <Pause size={14} />
                  พักหลังจบรายการนี้
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={!["enumerating", "hydrating"].includes(run.phase)}
                  onClick={() => void resume()}
                >
                  <Play size={14} />
                  ทำต่อจนพร้อมตรวจนำเข้า
                </Button>
              )}
              <Button
                disabled={
                  demo ||
                  busy ||
                  !["hydrating", "review", "completed"].includes(run.phase)
                }
                onClick={() => void retry()}
              >
                <RefreshCw size={14} />
                ลองใหม่เฉพาะที่ผิดพลาด
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {["enumerating", "hydrating", "review", "completed"].map(
              (phase, index) => (
                <div
                  key={phase}
                  className={`rounded-lg border px-2 py-2 text-[11px] ${run.phase === phase ? "border-brand bg-brand/10 text-brand font-semibold" : "border-line text-muted"}`}
                >
                  {index + 1}. {phaseLabel[phase]}
                </div>
              ),
            )}
          </div>
          {run.last_error ? (
            <p className="text-xs text-danger">
              ครั้งก่อนหยุด: {run.last_error} · ข้อมูลและจุดทำต่อยังเก็บไว้
            </p>
          ) : null}
        </Card>
      ) : null}
      <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 flex gap-3 text-xs leading-relaxed">
        <PackageCheck size={21} className="text-brand shrink-0" />
        <div>
          <p className="font-semibold">
            นำเข้าแคตตาล็อก ไม่ใช่รับสินค้าเข้าคลัง
          </p>
          <p className="text-muted mt-1">
            สินค้าใหม่จะปิดขายไว้ก่อนเสมอ · ค่าว่างจากต้นทางไม่ลบข้อมูลเดิม ·
            เก็บชื่อ/รูป/ต้นทุนและนโยบาย SN เดิม · ยอดคลังเป็นข้อมูลสังเกต
            ไม่เพิ่มหรือลดสต๊อก POS และไม่ปิดสินค้าที่ไม่พบในรอบนี้
          </p>
        </div>
      </div>
      {currentWarehouse ? (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <p className="text-xs font-medium flex gap-1 items-center">
                <Link2 size={14} />
                ผูกคลัง {currentWarehouse} กับสาขา POS
              </p>
              <Select
                className="mt-2"
                value={branch}
                disabled={demo || busy}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="">เลือกสาขาเพื่อยืนยันการจับคู่</option>
                {meta?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name_th || b.name} · {b.code}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              disabled={demo || busy || !branch}
              onClick={() =>
                void perform(async () => {
                  await api("map", {
                    warehouse_id: currentWarehouse,
                    branch_id: branch,
                  });
                  await metadata();
                  if (run) await load(run.id, offset);
                })
              }
            >
              บันทึกการผูกคลัง
            </Button>
            <Badge tone={mappedBranch ? "ok" : "warn"}>
              {mappedBranch ? "ผูกคลังแล้ว" : "ยังไม่ผูกคลัง"}
            </Badge>
          </div>
        </Card>
      ) : null}
      <Card className="overflow-hidden">
        <div className="p-4 flex flex-wrap gap-3 items-center border-b border-line">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute top-3 left-3 text-muted" />
            <Input
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหา SKU / ชื่อ ในหน้านี้"
            />
          </div>
          <Select
            className="!w-auto"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">ทั้งหมดในหน้านี้</option>
            <option value="new">สินค้าใหม่</option>
            <option value="existing">ตรงกับสินค้าเดิม</option>
            <option value="conflict">ขัดแย้ง</option>
            <option value="error">ผิดพลาด</option>
            <option value="imported">นำเข้าแล้ว</option>
          </Select>
          <Button
            disabled={demo || busy}
            onClick={() =>
              setSelected(
                visible
                  .filter(canSelect)
                  .slice(0, 50)
                  .map((i) => i.sku_key),
              )
            }
          >
            <CheckCheck size={14} />
            เลือกได้สูงสุด 50
          </Button>
          <Button
            variant="primary"
            disabled={
              demo ||
              busy ||
              !selected.length ||
              !run ||
              !["review", "completed"].includes(run.phase)
            }
            onClick={() => {
              setPriceUpdate(false);
              setConfirm(true);
            }}
          >
            ตรวจและนำเข้า {selected.length} รายการ
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface2 text-muted">
              <tr>
                {[
                  "เลือก",
                  "สินค้า / SKU",
                  "ผลจับคู่",
                  "ราคา POS → JST",
                  "ข้อมูลคลัง",
                  "ความพร้อม",
                  "รายละเอียด",
                ].map((h) => (
                  <th
                    className="px-4 py-3 text-left font-medium whitespace-nowrap"
                    key={h}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((i) => (
                <tr key={i.sku_key} className="hover:bg-surface2/50">
                  <td className="px-4 py-3">
                    <input
                      aria-label={`เลือก ${i.sku}`}
                      type="checkbox"
                      disabled={demo || busy || !canSelect(i)}
                      checked={selected.includes(i.sku_key)}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? s.length < 50
                              ? [...s, i.sku_key]
                              : s
                            : s.filter((k) => k !== i.sku_key),
                        )
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">
                      {i.detail?.name || i.summary.name || i.sku}
                    </p>
                    <p className="font-mono text-muted mt-1">{i.sku}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        i.import_kind
                          ? "ok"
                          : i.match.kind === "conflict"
                            ? "danger"
                            : i.match.kind === "new"
                              ? "info"
                              : "neutral"
                      }
                    >
                      {i.import_kind
                        ? "นำเข้าแล้ว"
                        : i.match.kind === "conflict"
                          ? "ขัดแย้ง"
                          : i.match.kind === "new"
                            ? "ใหม่"
                            : "สินค้าเดิม"}
                    </Badge>
                    <p className="mt-1 text-[10px] text-muted">
                      {i.detail_status === "pending"
                        ? "รอเติมรายละเอียด"
                        : i.detail_status === "missing"
                          ? "ไม่พบ exact SKU"
                          : i.detail_status === "error"
                            ? "อ่านไม่สำเร็จ"
                            : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 tnum whitespace-nowrap">
                    {i.match.product
                      ? formatTHB(i.match.product.price, false)
                      : "—"}{" "}
                    →{" "}
                    {i.detail?.sale_price == null
                      ? "ยังไม่ทราบ"
                      : formatTHB(i.detail.sale_price, false)}
                  </td>
                  <td className="px-4 py-3 tnum">
                    {i.stock_qty == null ? "ยังไม่ยืนยัน" : i.stock_qty}
                  </td>
                  <td className="px-4 py-3 max-w-[240px]">
                    <Badge tone={i.blockers.length ? "warn" : "ok"}>
                      {i.blockers.length
                        ? `รอตรวจ ${i.blockers.length} จุด`
                        : "ข้อมูลครบ · ตรวจเปิดขาย"}
                    </Badge>
                    <p className="text-muted mt-1">
                      {i.import_error || i.detail_error || i.blockers[0]}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" onClick={() => setDetail(i)}>
                      <Eye size={15} />
                      ดู
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length ? (
            <div className="text-center p-10 text-sm text-muted">
              {run
                ? "ยังไม่มีรายการในหน้านี้"
                : "สร้างรอบซิงก์เพื่อเริ่มอ่านรายการสินค้า"}
            </div>
          ) : null}
        </div>
        <div className="p-4 border-t border-line flex flex-wrap justify-between items-center gap-3 text-xs text-muted">
          <span>
            เพิ่มใหม่ {stats.created} · อัปเดต {stats.updated} · แสดง{" "}
            {offset + 1}–{offset + items.length} จาก {stats.found}
          </span>
          <div className="flex gap-2">
            <Button
              disabled={demo || busy || !run || offset === 0}
              onClick={() =>
                run &&
                void perform(() => load(run.id, Math.max(0, offset - 100)))
              }
            >
              <ChevronLeft size={14} />
              ก่อนหน้า
            </Button>
            <Button
              disabled={demo || busy || !run || offset + 100 >= stats.found}
              onClick={() =>
                run && void perform(() => load(run.id, offset + 100))
              }
            >
              ถัดไป
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      </Card>
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? `ตรวจสินค้า · ${detail.sku}` : "รายละเอียด"}
        size="lg"
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="grid sm:grid-cols-2 gap-3">
              <Card className="p-4">
                <p className="text-xs text-muted">สินค้า POS เดิม</p>
                <p className="mt-2 font-medium">
                  {detail.match.product?.name_th || "ยังไม่มีสินค้า"}
                </p>
                <p className="text-xs font-mono mt-1 break-all">
                  {detail.match.product?.id || "จะสร้างรหัสใหม่เพียงครั้งเดียว"}
                </p>
                <p className="mt-2">
                  ราคา{" "}
                  {detail.match.product
                    ? formatTHB(detail.match.product.price)
                    : "—"}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-muted">
                  ข้อมูล JST จาก exact lookup
                </p>
                <p className="mt-2 font-medium">
                  {detail.detail?.name || "รอรายละเอียด"}
                </p>
                <p className="mt-2">
                  ราคา{" "}
                  {detail.detail?.sale_price == null
                    ? "ยังไม่ทราบ"
                    : formatTHB(detail.detail.sale_price)}
                </p>
                <p className="text-xs text-muted mt-2">
                  SN:{" "}
                  {detail.detail?.serial_tracking == null
                    ? "ยังไม่ทราบ"
                    : detail.detail.serial_tracking
                      ? "ต้องสแกน"
                      : "ไม่ใช้ SN"}{" "}
                  · สินค้าชุด:{" "}
                  {detail.detail?.is_combined == null
                    ? "ยังไม่ทราบ"
                    : detail.detail.is_combined
                      ? "ใช่"
                      : "ไม่ใช่"}
                </p>
              </Card>
            </div>
            <p className="text-xs text-muted">
              รูป ชื่อที่ใช้งาน ต้นทุน และการตั้งค่าเดิมจะไม่ถูกลบทับ
              บาร์โค้ดใหม่จะเพิ่มโดยไม่ลบรายการเดิม
            </p>
            {detail.blockers.map((b) => (
              <p key={b} className="text-xs text-amber-700 flex gap-2">
                <AlertTriangle size={14} />
                {b}
              </p>
            ))}
            {detail.stock_error ? (
              <p className="text-xs text-danger">สต๊อก: {detail.stock_error}</p>
            ) : null}
            {detail.import_error ? (
              <p className="text-xs text-danger">
                นำเข้า: {detail.import_error}
              </p>
            ) : null}
            <Button
              disabled={demo || busy || Boolean(detail.import_kind)}
              onClick={() => {
                const key = detail.sku_key;
                setDetail(null);
                void retry([key]);
              }}
            >
              ลองใหม่รายการที่ผิดพลาดนี้
            </Button>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="ยืนยันขอบเขตการนำเข้า"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>กลับไปตรวจ</Button>
            <Button variant="primary" onClick={() => void importSelected()}>
              นำเข้า {selected.length} รายการ
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <p>
            สินค้าใหม่จะสร้างแบบ <strong>ปิดขาย</strong> ส่วนสินค้าเดิมรักษา
            product_id และสถานะเดิม ไม่แก้สต๊อกหรือประวัติ
          </p>
          <label className="flex gap-2 items-start rounded-xl border border-line bg-surface2 p-4">
            <input
              type="checkbox"
              checked={priceUpdate}
              onChange={(e) => setPriceUpdate(e.target.checked)}
            />
            <span>
              อัปเดตราคาขายสินค้าเดิมด้วยค่าจาก exact lookup
              <p className="text-xs text-muted mt-1">
                ค่าเริ่มต้นคือเก็บราคาเดิม · ราคา null ไม่ทับค่าเดิม · ราคา 0
                จะคงเป็น 0 และถูกเตือนว่ารออนุมัติราคา
              </p>
            </span>
          </label>
          <p className="text-xs text-muted">
            หากข้อมูล POS เปลี่ยนหลังดูตัวอย่าง
            ระบบจะข้ามรายการนั้นและแจ้งให้ตรวจใหม่ การนำเข้ารอบนี้ไม่ใช่ delta
            sync และไม่ปิดสินค้าที่ไม่พบ
          </p>
        </div>
      </Modal>
    </div>
  );
}
