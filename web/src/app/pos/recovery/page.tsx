"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  RefreshCw,
  ShieldCheck,
  Clock3,
  AlertTriangle,
  ArrowLeft,
  ReceiptText,
} from "lucide-react";
import { useSession } from "@/lib/store/session";
import { useCart } from "@/lib/store/cart";
import { useI18n } from "@/lib/i18n/provider";
import { useToast } from "@/components/toast-host";
import { Card, Button, Badge, KpiTile } from "@/components/ui";
import { formatTHB } from "@/lib/money";
import { isLiveMode } from "@/lib/supabase/client";
import { checkoutRequest, clearCheckoutIdentity } from "@/lib/checkout";
interface Hold {
  payments?: { amount: number; reference_no: string }[];
  id: string;
  status: string;
  expires_at: string;
  created_at: string;
  total: number;
  result?: { order_no?: string };
  items: { sku: string; qty: number; serials: string[] }[];
}
export default function RecoveryPage() {
  const { employee, branchId } = useSession(),
    { locale } = useI18n(),
    toast = useToast();
  const L = (th: string, en: string, zh: string) => (locale === "th" ? th : locale === "zh" ? zh : en);
  const [rows, setRows] = useState<Hold[]>([]),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    if (!branchId) return;
    if (!isLiveMode()) {
      setRows([]);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/pos/checkout?branch_id=${encodeURIComponent(branchId)}`,
        { cache: "no-store" },
      );
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setRows(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [branchId]);
  async function release(row: Hold) {
    if (!branchId || !employee) return;
    const recorded = JSON.parse(
      localStorage.getItem(`shdpos.payment:${row.id}`) || "[]",
    );
    if (recorded.length || row.payments?.length) {
      toast.push({
        tone: "danger",
        title: L("มีการบันทึกรับชำระบางส่วนแล้ว กรุณาให้หัวหน้าตรวจสอบก่อนปลดจอง", "Recorded payments exist. Ask a supervisor to review before releasing.", "已有部分收款记录，请主管核查后再解除预留"),
      });
      return;
    }
    if (
      !window.confirm(
        L("ยืนยันว่ารายการนี้ยังไม่ได้รับเงิน? หากมีการหักเงินหรือไม่แน่ใจ ให้เก็บรายการไว้และแจ้งหัวหน้าตรวจสอบ", "Confirm no money was collected. If charged or uncertain, keep the checkout for review.", "确认此项目尚未收款？如已扣款或不确定，请保留项目并通知主管核查"),
      )
    )
      return;
    setBusy(true);
    try {
      await checkoutRequest("release", row.id, branchId);
      const key = `shdpos.checkout:${employee.id}:${branchId}`;
      const local = JSON.parse(localStorage.getItem(key) || "null");
      if (local?.id === row.id) clearCheckoutIdentity(branchId, employee.id);
      await load();
    } catch (e) {
      toast.push({ tone: "danger", title: String(e) });
    } finally {
      setBusy(false);
    }
  }
  function acknowledge(row: Hold) {
    if (!branchId || !employee) return;
    const key = `shdpos.checkout:${employee.id}:${branchId}`;
    const local = JSON.parse(localStorage.getItem(key) || "null");
    if (local?.id === row.id) {
      clearCheckoutIdentity(branchId, employee.id);
      useCart.getState().clear();
    }
    toast.push({
      tone: "ok",
      title: L("รับทราบบิลที่บันทึกกลางแล้ว ไม่ต้องรับเงินซ้ำ", "Central sale recorded. Do not collect payment again.", "已确认中央记录的单据，请勿重复收款"),
      body: row.result?.order_no,
    });
  }
  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/pos/sell"
            className="text-xs text-muted inline-flex items-center gap-1"
          >
            <ArrowLeft size={13} />
            {L("กลับหน้าขาย", "Back to sales", "返回销售页")}
          </Link>
          <h1 className="text-xl font-semibold mt-2">
            {L("ตรวจสอบรายการรับชำระ", "Checkout recovery", "收款核查")}
          </h1>
          <p className="text-xs text-muted mt-1">
            {L("รายการของคุณในสาขาปัจจุบัน · ตรวจสถานะเดิมก่อนรับเงินซ้ำ", "Your checkouts in this branch · Check existing results before collecting again", "您在当前门店的项目 · 重复收款前请核查原状态")}
          </p>
        </div>
        <Button onClick={() => void load()} loading={busy}>
          <RefreshCw size={15} />
          {L("ตรวจสอบล่าสุด", "Refresh", "刷新")}
        </Button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <KpiTile
          label={L("รอตรวจสอบ / กำลังรับชำระ", "Active / needs review", "待核查 / 收款中")}
          value={String(rows.filter((r) => r.status === "active").length)}
          icon={<Clock3 size={18} />}
          tone="warn"
        />
        <KpiTile
          label={L("บันทึกกลางแล้ว", "Recorded centrally", "已中央记录")}
          value={String(rows.filter((r) => r.status === "committed").length)}
          icon={<ShieldCheck size={18} />}
          tone="ok"
        />
        <KpiTile
          label={L("ยกเลิกก่อนรับเงิน", "Released unpaid", "收款前取消")}
          value={String(rows.filter((r) => r.status === "released").length)}
          icon={<ReceiptText size={18} />}
          tone="brand"
        />
      </div>
      <Card className="p-4 border-amber-500/25 bg-amber-500/5">
        <div className="flex gap-3">
          <AlertTriangle size={20} className="shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed text-muted">
            {L("สถานะบันทึกกลางยืนยันว่ามีบิลใน POS ส่วนกลาง ไม่ได้หมายความว่าเงินเข้าบัญชีธนาคารแล้ว หากลูกค้าถูกหักเงินแต่รายการยังไม่จบ ให้ตรวจสลิป/เครื่อง EDC และแจ้งหัวหน้า ห้ามเรียกเก็บใหม่โดยไม่ตรวจสอบ", "A central record confirms a POS order, not bank settlement. If charged but unfinished, verify the bank/terminal and escalate before charging again.", "中央记录状态仅确认 POS 中有单据，并不代表款项已到银行账户。如客户已被扣款但交易未完成，请核对凭条/EDC 并通知主管，未经核查不得重新收款。")}
          </p>
        </div>
      </Card>
      {error ? <Card className="p-4 text-danger text-sm">{error}</Card> : null}
      <div className="space-y-3">
        {rows.map((row) => (
          <Card key={row.id} className="p-4 sm:p-5">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <Badge
                  tone={
                    row.status === "committed"
                      ? "ok"
                      : row.status === "active"
                        ? "warn"
                        : "neutral"
                  }
                >
                  {row.status === "committed"
                    ? L("บันทึกกลางแล้ว", "Recorded", "已中央记录")
                    : row.status === "released"
                      ? L("ยกเลิกก่อนรับเงิน", "Released", "收款前取消")
                      : new Date(row.expires_at) < new Date()
                        ? L("หมดเวลาจอง · รอตรวจผล", "Expired · review", "预留超时 · 待核查")
                        : L("กำลังรับชำระ", "In progress", "收款中")}
                </Badge>
                <p className="font-semibold mt-2" translate="no">
                  {row.result?.order_no || row.id}
                </p>
                <p className="text-xs text-muted mt-1">
                  {new Date(row.created_at).toLocaleString(
                    locale === "th" ? "th-TH" : "en-GB",
                  )}{" "}
                  · {row.items.map((i) => `${i.sku} × ${i.qty}`).join(" · ")}
                </p>
                <p className="text-xs text-muted mt-1">
                  {L("บันทึกรับชำระแล้ว", "Recorded payments", "已记录收款")}:{" "}
                  {formatTHB(
                    (row.payments ?? []).reduce(
                      (s, p) => s + Number(p.amount),
                      0,
                    ),
                  )}
                </p>
                <p className="text-xs text-muted mt-1">
                  {row.items.flatMap((i) => i.serials).join(" · ")}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-xl font-semibold tnum">
                  {formatTHB(row.total)}
                </p>
                <div className="mt-3">
                  {row.status === "active" ? (
                    <Button disabled={busy} onClick={() => void release(row)}>
                      {L("ยืนยันว่าไม่ได้รับเงิน / ปลดจอง", "Confirm unpaid / release", "确认未收款 / 解除预留")}
                    </Button>
                  ) : row.status === "committed" ? (
                    <Button onClick={() => acknowledge(row)}>
                      {L("รับทราบผลบันทึกบิล", "Acknowledge recorded sale", "确认已记录单据")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
        ))}
        {!busy && !error && !rows.length ? (
          <Card className="p-10 text-center text-sm text-muted">
            {L("ยังไม่มีรายการรับชำระกลาง", "No central checkouts yet", "暂无中央收款项目")}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
