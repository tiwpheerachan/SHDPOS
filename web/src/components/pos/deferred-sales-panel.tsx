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
import { useL } from "@/lib/i18n/provider";
export function DeferredSalesPanel({
  branchId,
  focusId,
}: {
  branchId: string;
  focusId?: string;
}) {
  const L = useL();
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
        setError(e instanceof Error ? e.message : L("อ่านรายการไม่สำเร็จ", "Failed to load list", "读取列表失败"));
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
      setError(e instanceof Error ? e.message : L("ปักหมุดไม่สำเร็จ", "Pin failed", "置顶失败"));
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
          aria-label={t.pinned ? L("เลิกปักหมุดบิล", "Unpin bill", "取消置顶单据") : L("ปักหมุดบิล", "Pin bill", "置顶单据")}
          onClick={() => void pinWork(t)}
        >
          <Pin size={12} fill={t.pinned ? "currentColor" : "none"} />
        </Button>
        <Button size="sm" variant="soft" onClick={() => setHandoff(t.id)}>
          <UserRound size={12} />
          {L("ส่งต่อ", "Hand off", "转交")}
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
      setError(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          [L("รอปิดบิล", "Awaiting close", "待结单"), String(pending.length)],
          [L("รับเงินแล้ว รอลงบิล", "Paid, not yet billed", "已收款 待入单"), formatTHB(received)],
          [L("ค้างเกิน 24 ชั่วโมง", "Over 24 hours", "超过 24 小时"), String(overdue)],
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
          placeholder={L("ค้นหา SKU ลูกค้า เหตุผล หรือเลขรายการ", "Search SKU, customer, reason or ID", "搜索 SKU、客户、原因或编号")}
        />
        <Button
          size="sm"
          variant="soft"
          onClick={() => {
            setHistory(!history);
          }}
        >
          {history ? L("กลับไปรายการรอปิดบิล", "Back to pending list", "返回待结单列表") : L("ดูประวัติที่ปิดแล้ว", "View closed history", "查看已结历史")}
        </Button>
        <Button size="sm" variant="soft" onClick={() => void load()}>
          <RefreshCw size={14} />
          {L("โหลดใหม่", "Reload", "重新加载")}
        </Button>
      </div>
      {error && !selected ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      {truncated ? (
        <p className="text-xs text-warn">
          {L("ข้อมูลมีจำนวนมากและยังอ่านไม่ครบ กรุณาตรวจรายการเพิ่มเติมก่อนใช้ยอดสรุป", "Too many records, not all loaded. Check more items before relying on the totals.", "数据量大且未完全读取，使用汇总前请检查更多项目")}
        </p>
      ) : null}
      <p className="text-xs text-muted leading-relaxed">
        {L("บันทึกบนเซิร์ฟเวอร์ ใช้ต่อจากเครื่องอื่นในสาขาได้ ยอดรับเงินส่วนนี้ยังแยกจากบิลขายที่ปิดแล้ว สต๊อกขายถูกกันจำนวนในรายการที่มีสต๊อก ส่วน On Hand จะตัดเมื่อปิดบิลสำเร็จ", "Saved on the server; continue from any device in this branch. These payments are kept separate from closed bills. Sellable stock is reserved for stocked items; On Hand is deducted when the bill closes.", "保存在服务器，可在本门店其他设备继续。此部分收款与已结单据分开。有库存的项目会预留可售库存，On Hand 在结单成功后扣减。")}
      </p>
      {loading ? (
        <p className="text-sm text-muted">{L("กำลังโหลดรายการ…", "Loading…", "加载中…")}</p>
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
                      ? L("ปิดบิลแล้ว", "Closed", "已结单")
                      : d.state === "cancelled"
                        ? L("ยกเลิก", "Cancelled", "已取消")
                        : L("รอปิดบิล", "Awaiting close", "待结单")}
                  </Badge>
                </div>
                <p className="font-semibold mt-3 truncate">
                  {d.draft.customer_name ||
                    d.draft.items[0]?.name ||
                    L("ลูกค้าทั่วไป", "Walk-in customer", "散客")}
                </p>
                <p className="text-xs text-muted mt-1">
                  {d.draft.items.length} {L("รายการ", "items", "项")} · {L("ขายจริง", "Sold", "实际销售")}{" "}
                  {new Date(d.occurred_at).toLocaleString("th-TH")}
                </p>
                <div className="mt-3 flex justify-between items-end">
                  <strong className="text-lg tnum">
                    {formatTHB(Number(d.agreed_total))}
                  </strong>
                  <span className="text-xs text-muted">
                    {L("รับแล้ว", "Received", "已收")} {formatTHB(paidTotal(d))}
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
                        {issueLabels()[code] || code}
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
                    {L("ดูรายละเอียด", "View details", "查看详情")} <ArrowUpRight size={11} />
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileClock size={26} />}
          title={L("ไม่มีรายการในมุมมองนี้", "No items in this view", "此视图中没有项目")}
          body={L("สร้างจากหน้าขาย โดยเลือกโหมดขายก่อน รอเติมข้อมูล", "Create from the sell screen using \"Sell now, complete later\" mode", "在销售页面选择“先售后补资料”模式创建")}
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
                {L("บันทึกข้อมูล", "Save", "保存资料")}
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
                {L("ตรวจและปิดบิล", "Verify & close bill", "核对并结单")}
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
            : L("รายละเอียด", "Details", "详情")
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
                {L("ขายจริง", "Sold", "实际销售")}:{" "}
                {new Date(selected.occurred_at).toLocaleString("th-TH")}
              </p>
              <p>
                {L("บันทึกเข้าระบบ", "Recorded", "录入系统")}:{" "}
                {new Date(selected.created_at).toLocaleString("th-TH")}
              </p>
              <p>{L("เหตุผล", "Reason", "原因")}: {selected.reason}</p>
              <p>
                {L("สถานะส่งมอบ", "Delivery", "交付状态")}:{" "}
                {selected.delivered ? L("ส่งมอบแล้ว", "Delivered", "已交付") : L("ยังไม่ยืนยันส่งมอบ", "Delivery not confirmed", "尚未确认交付")}
              </p>
              <p>
                {L("ยอดขาย", "Sale total", "销售额")} {formatTHB(Number(selected.agreed_total))} · {L("รับแล้ว", "Received", "已收")}{" "}
                {formatTHB(paidTotal(selected))}
              </p>
            </div>
            <div className="rounded-xl border border-line/60 p-2.5">
              {taskActions(selected) || (
                <p className="work-caption">
                  {L("รายการนี้ยังไม่มีงานที่คุณมีสิทธิ์จัดการ", "No task here that you can manage", "此项目暂无您有权处理的任务")}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {[...new Set(selected.issues.map((i) => i.code))].map((code) => (
                <Badge key={code} tone="warn">
                  {issueLabels()[code] || code}
                </Badge>
              ))}
            </div>
            {selected.draft.items.map((i: any, index: number) => (
              <div key={index} className="rounded-xl border border-line p-3">
                <p className="text-sm font-medium" translate="no">{i.name}</p>
                <p className="text-xs text-muted">
                  <span translate="no">{i.sku}</span> · {i.qty} {L("ชิ้น", "pcs", "件")} × {formatTHB(i.unit_price)}
                </p>
                <label className="block text-xs mt-3">
                  {L("SN ที่ส่งมอบจริง · หนึ่งเลขต่อบรรทัด", "Delivered SN · one per line", "实际交付 SN · 每行一个")}
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
                <p className="text-sm font-medium">{L("รับชำระที่บันทึกแล้ว", "Recorded payments", "已记录收款")}</p>
                {selected.payments.map((p, index) => (
                  <p key={index} className="text-xs break-all">
                    {p.method} · {formatTHB(p.amount)} · {p.reference_no}
                  </p>
                ))}
                <p className="text-xs text-muted">
                  {L("เก็บเลขอ้างอิงเดิม ห้ามรับเงินซ้ำ", "Original references kept — do not collect twice", "保留原参考号，禁止重复收款")}
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
                  {L("ยืนยันว่าส่งมอบสินค้าแล้ว", "Confirm goods delivered", "确认已交付商品")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {paidTotal(selected) < Number(selected.agreed_total) ? (
                    <Button
                      size="sm"
                      variant="soft"
                      disabled={busy}
                      onClick={() => setPay(true)}
                    >
                      {L("รับชำระเพิ่ม", "Take more payment", "追加收款")}
                    </Button>
                  ) : (
                    <Badge tone="ok">{L("รับชำระครบแล้ว", "Fully paid", "已全额收款")}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {L("ต้องเปิดใช้งานสินค้า ตรวจราคา สต๊อก และ SN ก่อนปิดบิล การปิดบิลไม่เรียกเก็บเงินใหม่ และเก็บวันขายจริงแยกจากวันที่ปิดบิล", "Products must be active and price, stock and SN verified before closing. Closing does not charge again, and the actual sale date is kept separate from the close date.", "结单前需启用商品并核对价格、库存和 SN。结单不会重新收款，实际销售日期与结单日期分开保存。")}
                </p>
                {!selected.delivered && !selected.payments.length ? (
                  <div className="pt-3 border-t border-line">
                    <Input
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder={L("เหตุผลยกเลิก (ยังไม่รับเงินและยังไม่ส่งของ)", "Cancel reason (not paid, not delivered)", "取消原因（未收款且未发货）")}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || cancelReason.trim().length < 3}
                      onClick={() => void action("cancel")}
                    >
                      {L("ยกเลิกรายการ", "Cancel item", "取消项目")}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm">
                {selected.state === "posted"
                  ? L("ปิดบิลสำเร็จแล้ว", "Bill closed", "已成功结单")
                  : L("ยกเลิกรายการแล้ว", "Item cancelled", "项目已取消")}{" "}
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
        title={L("บันทึกเงินรับของรายการรอปิดบิล", "Record payment for pending bill", "记录待结单收款")}
        confirmLabel={L("เก็บเงินรับไว้กับรายการ", "Keep payment with item", "将收款保存到项目")}
        onClose={() => setPay(false)}
        checkoutId={selected?.id}
        grandTotal={Number(selected?.agreed_total ?? 0)}
        restoredPayments={selected?.payments}
        onRecordPayment={async (payment) => {
          const d = current.current;
          if (!d) throw Error(L("ไม่พบรายการ", "Item not found", "未找到项目"));
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
