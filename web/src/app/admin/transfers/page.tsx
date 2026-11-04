"use client";

import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ArrowLeftRight, Plus, Trash2, Check, Truck, PackageCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches, listProducts, adjustStock, writeAudit } from "@/lib/data/repo";
import { db } from "@/lib/offline/db";
import type { Branch, Product, Transfer, TransferStatus } from "@/lib/types";
import { Button, Card, CardHeader, Input, Field, Select, Table, Th, Td, Badge, EmptyState, Modal } from "@/components/ui";
import { can, visibleBranchIds } from "@/lib/permissions";

const FLOW: TransferStatus[] = [
  "draft", "pending_approval", "approved", "picking", "packed", "shipped",
  "in_transit", "received", "partial_received", "completed",
];

const TONE: Record<string, "neutral" | "info" | "warn" | "ok" | "danger"> = {
  draft: "neutral", pending_approval: "warn", approved: "info", picking: "info",
  packed: "info", shipped: "info", in_transit: "info", received: "ok",
  partial_received: "warn", completed: "ok", cancelled: "danger", rejected: "danger",
};

export default function AdminTransfersPage() {
  const { t, locale, pick } = useI18n();
  const toast = useToast();
  const { employee } = useSession();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [list, setList] = useState<Transfer[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Transfer | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState<{ id: string; product_id: string; qty: number }[]>([]);
  const [pickId, setPickId] = useState("");
  const [note, setNote] = useState("");

  async function reload() {
    setList(await db().transfers.reverse().sortBy("created_at"));
  }

  useEffect(() => {
    void (async () => {
      const [b, p] = await Promise.all([listBranches(), listProducts()]);
      setBranches(b);
      setProducts(p);
      setFrom(b[0]?.id ?? "");
      setTo(b[1]?.id ?? "");
      await reload();
    })();
  }, []);

  const allowed = useMemo(() => visibleBranchIds(employee, branches.map((b) => b.id)), [employee, branches]);
  const visible = useMemo(
    () => list.filter((x) => allowed.includes(x.from_branch_id) || allowed.includes(x.to_branch_id)),
    [list, allowed]
  );
  const bName = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? (locale === "th" ? b.name_th ?? b.name : b.name) : id;
  };

  async function create() {
    if (!employee || !from || !to || from === to || !lines.length) return;
    const tr: Transfer = {
      id: nanoid(),
      transfer_no: `TF-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${nanoid(4).toUpperCase()}`,
      from_branch_id: from,
      to_branch_id: to,
      status: can(employee, "transfer.approve") ? "approved" : "pending_approval",
      items: lines.map((l) => {
        const p = products.find((x) => x.id === l.product_id)!;
        return { product_id: p.id, sku: p.sku, name: p.name_th, qty_requested: l.qty, qty_shipped: 0, qty_received: 0 };
      }),
      requested_by: employee.id,
      note,
      created_at: new Date().toISOString(),
    };
    await db().transfers.put(tr);
    await writeAudit({
      action: "transfer", actor_id: employee.id, branch_id: from,
      ref_table: "transfers", ref_no: tr.transfer_no, amount: null,
      after_data: { to: to, items: tr.items.length }, is_offline: false,
    });
    setOpen(false);
    setLines([]);
    setNote("");
    await reload();
    toast.push({ tone: "ok", title: t.transfer.title, body: tr.transfer_no });
  }

  async function advance(tr: Transfer, next: TransferStatus) {
    await db().transfers.update(tr.id, { status: next });
    // ตัดสต๊อกต้นทางตอน "shipped" และเพิ่มปลายทางตอน "completed"
    if (next === "shipped") {
      for (const it of tr.items) await adjustStock(tr.from_branch_id, it.product_id, -it.qty_requested);
    }
    if (next === "completed") {
      for (const it of tr.items) await adjustStock(tr.to_branch_id, it.product_id, it.qty_received || it.qty_requested);
    }
    await writeAudit({
      action: "transfer", actor_id: employee?.id ?? null, branch_id: tr.from_branch_id,
      ref_table: "transfers", ref_no: tr.transfer_no, amount: null,
      after_data: { status: next }, is_offline: false,
    });
    await reload();
    setDetail(null);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ArrowLeftRight size={16} className="text-brand" /> {t.transfer.title}
        </h2>
        {can(employee, "transfer.request") ? (
          <Button variant="primary" className="ml-auto h-9" onClick={() => setOpen(true)}>
            <Plus size={15} /> {t.transfer.request}
          </Button>
        ) : null}
      </div>

      <Card>
        {visible.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{t.transfer.title}</Th>
                <Th>{t.transfer.from}</Th>
                <Th>{t.transfer.to}</Th>
                <Th align="center">SKU</Th>
                <Th align="center">{t.common.status}</Th>
                <Th align="right">{t.common.action}</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((tr) => (
                <tr key={tr.id} className="hover:bg-surface2/60">
                  <Td>
                    <button onClick={() => setDetail(tr)} className="font-mono text-xs text-brand hover:underline">
                      {tr.transfer_no}
                    </button>
                    <p className="text-[10px] text-muted">{new Date(tr.created_at).toLocaleDateString("th-TH")}</p>
                  </Td>
                  <Td className="text-xs truncate max-w-[160px]">{bName(tr.from_branch_id)}</Td>
                  <Td className="text-xs truncate max-w-[160px]">{bName(tr.to_branch_id)}</Td>
                  <Td align="center" className="text-xs">{tr.items.length}</Td>
                  <Td align="center">
                    <Badge tone={TONE[tr.status] ?? "neutral"}>{tr.status}</Badge>
                  </Td>
                  <Td align="right">
                    <button onClick={() => setDetail(tr)} className="text-xs text-brand hover:underline">
                      {t.common.edit}
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<ArrowLeftRight size={26} />} title={t.common.empty} body="สร้างใบโอนย้ายเพื่อย้ายสินค้าระหว่างสาขา" />
        )}
      </Card>

      {/* สร้างใบโอน */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t.transfer.request}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
            <Button variant="primary" disabled={!lines.length || from === to} onClick={() => void create()}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t.transfer.from}>
              <Select value={from} onChange={(e) => setFrom(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t.transfer.to}>
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{locale === "th" ? b.name_th ?? b.name : b.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          {from === to ? <p className="text-xs text-danger">ต้นทางและปลายทางต้องไม่ใช่สาขาเดียวกัน</p> : null}

          <div className="flex gap-2">
            <Select value={pickId} onChange={(e) => setPickId(e.target.value)} className="flex-1">
              <option value="">{t.common.add}...</option>
              {products.filter((p) => p.is_stocked).map((p) => (
                <option key={p.id} value={p.id}>{p.sku} · {pick({ th: p.name_th, en: p.name_en, zh: p.name_zh })}</option>
              ))}
            </Select>
            <Button
              variant="soft"
              disabled={!pickId}
              onClick={() => {
                setLines((l) => [...l, { id: nanoid(), product_id: pickId, qty: 1 }]);
                setPickId("");
              }}
            >
              <Plus size={16} />
            </Button>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>{t.admin.products}</Th>
                <Th align="center">{t.common.qty}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = products.find((x) => x.id === l.product_id);
                return (
                  <tr key={l.id}>
                    <Td className="text-xs">{p?.name_th}</Td>
                    <Td align="center">
                      <Input
                        value={l.qty}
                        inputMode="numeric"
                        onChange={(e) => setLines((list) => list.map((x) => (x.id === l.id ? { ...x, qty: Number(e.target.value.replace(/\D/g, "") || 0) } : x)))}
                        className="h-8 w-20 text-center tnum"
                      />
                    </Td>
                    <Td align="right">
                      <button onClick={() => setLines((list) => list.filter((x) => x.id !== l.id))} className="text-muted hover:text-danger">
                        <Trash2 size={14} />
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <Field label={t.common.note}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* รายละเอียด + เดินสถานะ */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.transfer_no} size="md">
        {detail ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">{bName(detail.from_branch_id)}</span>
              <ArrowLeftRight size={13} className="text-brand" />
              <span className="text-muted">{bName(detail.to_branch_id)}</span>
              <Badge tone={TONE[detail.status] ?? "neutral"} className="ml-auto">{detail.status}</Badge>
            </div>

            {/* timeline */}
            <div className="flex flex-wrap gap-1">
              {FLOW.map((s) => {
                const idx = FLOW.indexOf(detail.status);
                const passed = FLOW.indexOf(s) <= idx;
                return (
                  <span
                    key={s}
                    className={`text-[10px] px-2 py-1 rounded-md border ${
                      passed ? "border-brand/40 bg-brand/8 text-brand" : "border-line text-muted"
                    }`}
                  >
                    {passed ? <Check size={9} className="inline -mt-0.5 mr-0.5" /> : null}
                    {s}
                  </span>
                );
              })}
            </div>

            <Table>
              <thead>
                <tr>
                  <Th>{t.admin.products}</Th>
                  <Th align="right">{t.transfer.requested}</Th>
                  <Th align="right">{t.transfer.received}</Th>
                  <Th align="right">{t.transfer.missing}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((it) => (
                  <tr key={it.product_id}>
                    <Td className="text-xs">{it.name}</Td>
                    <Td align="right" className="text-xs">{it.qty_requested}</Td>
                    <Td align="right">
                      <Input
                        value={it.qty_received}
                        inputMode="numeric"
                        onChange={(e) => {
                          const v = Number(e.target.value.replace(/\D/g, "") || 0);
                          setDetail((d) =>
                            d ? { ...d, items: d.items.map((x) => (x.product_id === it.product_id ? { ...x, qty_received: v } : x)) } : d
                          );
                        }}
                        className="h-8 w-20 text-center tnum"
                      />
                    </Td>
                    <Td align="right" className={it.qty_requested - it.qty_received > 0 ? "text-danger text-xs" : "text-xs text-muted"}>
                      {it.qty_requested - it.qty_received}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="flex gap-2">
              {detail.status === "pending_approval" && can(employee, "transfer.approve") ? (
                <Button variant="primary" className="flex-1" onClick={() => void advance(detail, "approved")}>
                  <Check size={15} /> {t.transfer.approve}
                </Button>
              ) : null}
              {(detail.status === "approved" || detail.status === "packed") ? (
                <Button variant="primary" className="flex-1" onClick={() => void advance(detail, "shipped")}>
                  <Truck size={15} /> {t.transfer.ship}
                </Button>
              ) : null}
              {(detail.status === "shipped" || detail.status === "in_transit") && can(employee, "transfer.receive") ? (
                <Button
                  variant="ok"
                  className="flex-1"
                  onClick={async () => {
                    await db().transfers.update(detail.id, { items: detail.items });
                    const partial = detail.items.some((i) => i.qty_received < i.qty_requested);
                    await advance(detail, partial ? "partial_received" : "completed");
                  }}
                >
                  <PackageCheck size={15} /> {t.transfer.receive}
                </Button>
              ) : null}
              {detail.status === "partial_received" ? (
                <Button variant="ok" className="flex-1" onClick={() => void advance(detail, "completed")}>
                  {t.common.done}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
