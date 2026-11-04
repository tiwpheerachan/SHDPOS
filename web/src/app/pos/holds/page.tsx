"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, Play, Trash2, ShoppingCart, Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useCart } from "@/lib/store/cart";
import { listHolds, removeHold } from "@/lib/data/repo";
import type { HeldBill } from "@/lib/offline/db";
import { PosPage } from "@/components/pos/page-shell";
import { Card, Button, Badge, EmptyState, Avatar, Skeleton } from "@/components/ui";
import { computeTotals, formatTHB } from "@/lib/money";

export default function HeldOrdersPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const cart = useCart();
  const { employee, branchId } = useSession();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);

  const [holds, setHolds] = useState<HeldBill[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    if (!branchId) return;
    setLoading(true);
    setHolds(await listHolds(branchId));
    setLoading(false);
  }
  useEffect(() => { void reload(); /* eslint-disable-next-line */ }, [branchId]);

  async function resume(b: HeldBill) {
    cart.clear();
    cart.loadLines(b.lines);
    if (b.customer_name) cart.setCustomer(b.customer_name, "");
    await removeHold(b.id);
    router.push("/pos/sell");
  }
  async function drop(id: string) {
    await removeHold(id);
    await reload();
  }

  if (!employee) return null;

  return (
    <PosPage
      title={t.cmd.heldOrders}
      icon={<PauseCircle size={18} />}
      actions={<Badge tone={holds.length ? "warn" : "neutral"}>{holds.length} {L("บิลที่พัก", "held", "挂单")}</Badge>}
    >
      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-[22px]" />)}
          </div>
        ) : holds.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {holds.map((b) => {
              const totals = computeTotals(b.lines);
              return (
                <Card key={b.id} className="p-4 flex flex-col">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={b.label || "?"} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{b.label || L("ไม่มีชื่อ", "Untitled", "未命名")}</p>
                      <p className="text-[11px] text-muted flex items-center gap-1">
                        <Clock size={11} /> {new Date(b.created_at).toLocaleString(locale === "th" ? "th-TH" : "en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                  {b.customer_name ? <p className="text-xs text-muted mt-2 truncate">{t.common.customer}: {b.customer_name}</p> : null}
                  <div className="mt-3 rounded-xl bg-surface2 px-3 py-2 flex items-center justify-between">
                    <span className="text-xs text-muted">{totals.itemCount} {L("รายการ", "items", "项")} · {totals.unitCount} {t.common.qty}</span>
                    <span className="text-sm font-semibold tnum">{formatTHB(totals.grandTotal, false)}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button variant="primary" className="flex-1" onClick={() => void resume(b)}>
                      <Play size={15} /> {t.cmd.resumeBill}
                    </Button>
                    <Button variant="ghost" onClick={() => void drop(b.id)} aria-label="delete">
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<ShoppingCart size={26} />}
            title={L("ยังไม่มีบิลที่พักไว้", "No held orders", "暂无挂单")}
            body={L("พักบิลจากหน้าขายเมื่อลูกค้าไปหยิบของเพิ่ม แล้วกลับมาเรียกที่นี่", "Hold a cart from the sell screen and resume it here", "在销售页挂单后可在此恢复")}
          />
        )}
      </div>
    </PosPage>
  );
}
