"use client";
import { useEffect, useRef, useState } from "react";
import {
  Card,
  Button,
  Badge,
  Input,
  Drawer,
  EmptyState,
  Avatar,
} from "@/components/ui";
import {
  Clock,
  RefreshCw,
  FileClock,
  CheckCircle2,
  Pin,
  UserRound,
  ArrowUpRight,
} from "lucide-react";
import {
  deferredList,
  deferredRequest,
  paidTotal,
  issueLabels,
  type DeferredSale,
} from "@/lib/deferred-sales";
import { formatTHB } from "@/lib/money";
import { PaymentModal } from "./payment-modal";
import { workList, workWrite, personName, type WorkItem } from "@/lib/work";
import { WorkTaskDialog } from "@/components/work/task-dialog";
import { refreshBranchSnapshot } from "@/lib/offline/refresh";
export function DeferredSalesPanel({
  branchId,
  focusId,
}: {
  branchId: string;
  focusId?: string;
}) {
  const [work, setWork] = useState<any>({ items: [], branches: [] }),
    [handoff, setHandoff] = useState<string | null>(null);
  const [items, setItems] = useState<DeferredSale[]>([]),
    [selected, setSelected] = useState<DeferredSale | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [pay, setPay] = useState(false),
    [search, setSearch] = useState(""),
    [history, setHistory] = useState(false),
    [truncated, setTruncated] = useState(false),
    [serials, setSerials] = useState<string[]>([]),
    [delivered, setDelivered] = useState(false),
    [cancelReason, setCancelReason] = useState("");
  const current = useRef<DeferredSale | null>(null);
  const scopeRef = useRef(`${branchId}:${history}`);
  async function load() {
    const scope = `${branchId}:${history}`;
    try {
      const [r, h] = await Promise.all([
        deferredList(branchId),
        history
          ? deferredList(branchId, true)
          : Promise.resolve({ items: [], truncated: false }),
      ]);
      if (scopeRef.current !== scope) return;
      setItems(
        [...r.items, ...h.items].sort(
          (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
        ),
      );
      setTruncated(r.truncated || h.truncated);
      setError("");
    } catch (e) {
      if (scopeRef.current === scope)
        setError(e instanceof Error ? e.message : "อ่านรายการไม่สำเร็จ");
    } finally {
      if (scopeRef.current === scope) setLoading(false);
    }
  }
  useEffect(() => {
    scopeRef.current = `${branchId}:${history}`;
    setSelected(null);
    current.current = null;
    setItems([]);
    setLoading(true);
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => {
      scopeRef.current = "";
      clearInterval(t);
    };
  }, [branchId, history]);
  async function loadWork() {
    try {
      const j = await workList({ branch_id: branchId, kind: "deferred_sale" });
      setWork(j);
    } catch {
      /* Financial record remains usable if task service is unavailable. */
    }
  }
  useEffect(() => {
    void loadWork();
    const refresh = () => void loadWork();
    window.addEventListener("shd:work-changed", refresh);
    return () => window.removeEventListener("shd:work-changed", refresh);
  }, [branchId]);
  useEffect(() => {
    if (!focusId) return;
    let alive = true;
    void fetch(
      "/api/pos/deferred-sales?" +
        new URLSearchParams({ branch_id: branchId, id: focusId }),
      { cache: "no-store" },
    )
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw Error(j.error);
        if (alive) open(j.items[0]);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [branchId, focusId]);
  const workFor = (d: DeferredSale) =>
    work.items.find((t: WorkItem) => t.source_id === d.id) as
      | WorkItem
      | undefined;
  async function pinWork(t: WorkItem) {
    try {
      await workWrite({ action: "pin", id: t.id, pinned: !t.pinned });
      await loadWork();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ปักหมุดไม่สำเร็จ");
    }
  }
  function taskActions(d: DeferredSale) {
    const t = workFor(d);
    return t ? (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted truncate flex-1">
          {personName(t.assignee)}
        </span>
        <Button
          size="icon"
          variant="soft"
          aria-label={t.pinned ? "เลิกปักหมุดบิล" : "ปักหมุดบิล"}
          onClick={() => void pinWork(t)}
        >
          <Pin size={12} fill={t.pinned ? "currentColor" : "none"} />
        </Button>
        <Button size="sm" variant="soft" onClick={() => setHandoff(t.id)}>
          <UserRound size={12} />
          ส่งต่อ
        </Button>
      </div>
    ) : null;
  }
  function open(d: DeferredSale) {
    current.current = d;
    setSelected(d);
    setSerials(d.draft.items.map((i: any) => (i.serials ?? []).join("\n")));
    setDelivered(d.delivered);
    setError("");
    setCancelReason("");
  }
  function update(d: DeferredSale) {
    current.current = d;
    setSelected(d);
    setItems((old) => old.map((i) => (i.id === d.id ? d : i)));
  }
  const pending = items.filter((d) => d.state === "pending"),
    received = pending.reduce((s, d) => s + paidTotal(d), 0),
    overdue = pending.filter(
      (d) => Date.now() - Date.parse(d.occurred_at) > 86400000,
    ).length;
  const rows = items
    .filter((d) => (history ? d.state !== "pending" : d.state === "pending"))
    .filter((d) =>
      JSON.stringify([
        d.id,
        d.reason,
        d.draft.customer_name,
        d.draft.items.map((i: any) => [i.sku, i.name]),
      ])
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const parsed = () =>
    serials.map((text) =>
      text
        .split(/[\n,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    );
  async function action(kind: "update" | "post" | "cancel") {
    const d = current.current;
    if (!d) return;
    setBusy(true);
    setError("");
    try {
      const r = await deferredRequest(kind, d.id, branchId, {
        version: d.version,
        serials: parsed(),
        delivered,
        reason: cancelReason,
      });
      if (kind === "post") {
        setSelected(null);
        current.current = null;
        await load();
      } else {
        update(r.item);
        if (kind === "cancel") setSelected(null);
      }
      await refreshBranchSnapshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          ["รอปิดบิล", String(pending.length)],
          ["รับเงินแล้ว รอลงบิล", formatTHB(received)],
          ["ค้างเกิน 24 ชั่วโมง", String(overdue)],
        ].map(([label, value]) => (
          <Card
            key={label}
            className="!rounded-[20px] !bg-surface/70 !border-line/60 p-4 backdrop-blur-xl"
          >
            <p className="text-[11px] text-muted">{label}</p>
            <p className="text-[24px] font-semibold mt-2 tnum">{value}</p>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          className="flex-1 min-w-[180px] !h-9 !text-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา SKU ลูกค้า เหตุผล หรือเลขรายการ"
        />
        <Button
          size="sm"
          variant="soft"
          onClick={() => {
            setHistory(!history);
          }}
        >
          {history ? "กลับไปรายการรอปิดบิล" : "ดูประวัติที่ปิดแล้ว"}
        </Button>
        <Button size="sm" variant="soft" onClick={() => void load()}>
          <RefreshCw size={14} />
          โหลดใหม่
        </Button>
      </div>
      {error && !selected ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      {truncated ? (
        <p className="text-xs text-warn">
          ข้อมูลมีจำนวนมากและยังอ่านไม่ครบ
          กรุณาตรวจรายการเพิ่มเติมก่อนใช้ยอดสรุป
        </p>
      ) : null}
      <p className="text-xs text-muted leading-relaxed">
        บันทึกบนเซิร์ฟเวอร์ ใช้ต่อจากเครื่องอื่นในสาขาได้
        ยอดรับเงินส่วนนี้ยังแยกจากบิลขายที่ปิดแล้ว
        สต๊อกขายถูกกันจำนวนในรายการที่มีสต๊อก ส่วน On Hand
        จะตัดเมื่อปิดบิลสำเร็จ
      </p>
      {loading ? (
        <p className="text-sm text-muted">กำลังโหลดรายการ…</p>
      ) : rows.length ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((d) => (
            <Card
              key={d.id}
              className="work-card !shadow-none p-4 h-full hover:border-brand/30 transition-colors"
            >
              <button onClick={() => open(d)} className="w-full text-left">
                <div className="flex justify-between gap-2">
                  <p className="font-mono text-xs text-muted">
                    PEND-{d.id.slice(0, 8).toUpperCase()}
                  </p>
                  <Badge
                    tone={
                      d.state === "posted"
                        ? "ok"
                        : d.state === "cancelled"
                          ? "neutral"
                          : "warn"
                    }
                  >
                    {d.state === "posted"
                      ? "ปิดบิลแล้ว"
                      : d.state === "cancelled"
                        ? "ยกเลิก"
                        : "รอปิดบิล"}
                  </Badge>
                </div>
                <p className="font-semibold mt-3 truncate">
                  {d.draft.customer_name ||
                    d.draft.items[0]?.name ||
                    "ลูกค้าทั่วไป"}
                </p>
                <p className="text-xs text-muted mt-1">
                  {d.draft.items.length} รายการ · ขายจริง{" "}
                  {new Date(d.occurred_at).toLocaleString("th-TH")}
                </p>
                <div className="mt-3 flex justify-between items-end">
                  <strong className="text-lg tnum">
                    {formatTHB(Number(d.agreed_total))}
                  </strong>
                  <span className="text-xs text-muted">
                    รับแล้ว {formatTHB(paidTotal(d))}
                  </span>
                </div>
                <p className="text-xs mt-3 line-clamp-2 text-muted">
                  {d.reason}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {[...new Set(d.issues.map((i) => i.code))]
                    .slice(0, 3)
                    .map((code) => (
                      <Badge key={code} tone="warn">
                        {issueLabels[code] || code}
                      </Badge>
                    ))}
                </div>
              </button>
              <div className="border-t border-line/50 mt-3 pt-2.5">
                {taskActions(d) || (
                  <button
                    onClick={() => open(d)}
                    className="text-[11px] text-muted inline-flex items-center gap-1"
                  >
                    ดูรายละเอียด <ArrowUpRight size={11} />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileClock size={26} />}
          title="ไม่มีรายการในมุมมองนี้"
          body="สร้างจากหน้าขาย โดยเลือกโหมดขายก่อน รอเติมข้อมูล"
        />
      )}
      <Drawer
        width="md"
        footer={
          selected?.state === "pending" ? (
            <div className="flex w-full items-center justify-end gap-2">
              <Button
                size="sm"
                variant="soft"
                disabled={busy}
                onClick={() => void action("update")}
              >
                บันทึกข้อมูล
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                disabled={
                  busy ||
                  !delivered ||
                  paidTotal(selected) !== Number(selected.agreed_total)
                }
                onClick={() => void action("post")}
              >
                <CheckCircle2 size={13} />
                ตรวจและปิดบิล
              </Button>
            </div>
          ) : undefined
        }
        open={!!selected && !pay && !handoff}
        onClose={() => {
          setSelected(null);
          current.current = null;
        }}
        title={
          selected
            ? `PEND-${selected.id.slice(0, 8).toUpperCase()}`
            : "รายละเอียด"
        }
      >
        {selected ? (
          <div className="p-4 space-y-4">
            {error ? (
              <p
                role="alert"
                className="text-danger text-sm rounded-xl bg-danger/5 p-3"
              >
                {error}
              </p>
            ) : null}
            <div className="rounded-2xl bg-surface2/65 p-3.5 space-y-1.5 text-[11px] leading-relaxed">
              <p>
                ขายจริง:{" "}
                {new Date(selected.occurred_at).toLocaleString("th-TH")}
              </p>
              <p>
                บันทึกเข้าระบบ:{" "}
                {new Date(selected.created_at).toLocaleString("th-TH")}
              </p>
              <p>เหตุผล: {selected.reason}</p>
              <p>
                สถานะส่งมอบ:{" "}
                {selected.delivered ? "ส่งมอบแล้ว" : "ยังไม่ยืนยันส่งมอบ"}
              </p>
              <p>
                ยอดขาย {formatTHB(Number(selected.agreed_total))} · รับแล้ว{" "}
                {formatTHB(paidTotal(selected))}
              </p>
            </div>
            <div className="rounded-xl border border-line/60 p-2.5">
              {taskActions(selected) || (
                <p className="work-caption">
                  รายการนี้ยังไม่มีงานที่คุณมีสิทธิ์จัดการ
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {[...new Set(selected.issues.map((i) => i.code))].map((code) => (
                <Badge key={code} tone="warn">
                  {issueLabels[code] || code}
                </Badge>
              ))}
            </div>
            {selected.draft.items.map((i: any, index: number) => (
              <div key={index} className="rounded-xl border border-line p-3">
                <p className="text-sm font-medium">{i.name}</p>
                <p className="text-xs text-muted">
                  {i.sku} · {i.qty} ชิ้น × {formatTHB(i.unit_price)}
                </p>
                <label className="block text-xs mt-3">
                  SN ที่ส่งมอบจริง · หนึ่งเลขต่อบรรทัด
                  <textarea
                    rows={Math.min(Math.max(i.qty, 2), 4)}
                    disabled={selected.state !== "pending"}
                    value={serials[index] ?? ""}
                    onChange={(e) =>
                      setSerials((old) =>
                        old.map((s, n) => (n === index ? e.target.value : s)),
                      )
                    }
                    className="w-full mt-1 rounded-lg border border-line bg-surface2 p-2 text-xs font-mono"
                  />
                </label>
              </div>
            ))}
            {selected.payments.length ? (
              <div className="rounded-xl border border-line p-3 space-y-2">
                <p className="text-sm font-medium">รับชำระที่บันทึกแล้ว</p>
                {selected.payments.map((p, index) => (
                  <p key={index} className="text-xs break-all">
                    {p.method} · {formatTHB(p.amount)} · {p.reference_no}
                  </p>
                ))}
                <p className="text-xs text-muted">
                  เก็บเลขอ้างอิงเดิม ห้ามรับเงินซ้ำ
                </p>
              </div>
            ) : null}
            {selected.state === "pending" ? (
              <>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={delivered}
                    disabled={selected.delivered}
                    onChange={(e) => setDelivered(e.target.checked)}
                  />
                  ยืนยันว่าส่งมอบสินค้าแล้ว
                </label>
                <div className="flex flex-wrap gap-2">
                  {paidTotal(selected) < Number(selected.agreed_total) ? (
                    <Button
                      size="sm"
                      variant="soft"
                      disabled={busy}
                      onClick={() => setPay(true)}
                    >
                      รับชำระเพิ่ม
                    </Button>
                  ) : (
                    <Badge tone="ok">รับชำระครบแล้ว</Badge>
                  )}
                </div>
                <p className="text-xs text-muted">
                  ต้องเปิดใช้งานสินค้า ตรวจราคา สต๊อก และ SN ก่อนปิดบิล
                  การปิดบิลไม่เรียกเก็บเงินใหม่
                  และเก็บวันขายจริงแยกจากวันที่ปิดบิล
                </p>
                {!selected.delivered && !selected.payments.length ? (
                  <div className="pt-3 border-t border-line">
                    <Input
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="เหตุผลยกเลิก (ยังไม่รับเงินและยังไม่ส่งของ)"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || cancelReason.trim().length < 3}
                      onClick={() => void action("cancel")}
                    >
                      ยกเลิกรายการ
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm">
                {selected.state === "posted"
                  ? "ปิดบิลสำเร็จแล้ว"
                  : "ยกเลิกรายการแล้ว"}{" "}
                · {selected.result?.order_no ?? ""}
              </p>
            )}
          </div>
        ) : null}
      </Drawer>
      <WorkTaskDialog
        open={!!handoff}
        id={handoff ?? undefined}
        branchId={branchId}
        branches={work.branches}
        onClose={() => setHandoff(null)}
        onSaved={() => void loadWork()}
      />
      <PaymentModal
        open={pay && !!selected}
        title="บันทึกเงินรับของรายการรอปิดบิล"
        confirmLabel="เก็บเงินรับไว้กับรายการ"
        onClose={() => setPay(false)}
        checkoutId={selected?.id}
        grandTotal={Number(selected?.agreed_total ?? 0)}
        restoredPayments={selected?.payments}
        onRecordPayment={async (payment) => {
          const d = current.current;
          if (!d) throw Error("ไม่พบรายการ");
          const r = await deferredRequest("record", d.id, branchId, {
            version: d.version,
            payment,
          });
          update(r.item);
        }}
        onConfirm={() => {
          setPay(false);
          void load();
        }}
      />
    </div>
  );
}
