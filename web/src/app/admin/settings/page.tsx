"use client";

import { useEffect, useState } from "react";
import { Settings2, Database, Building2, Receipt, Percent, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/components/toast-host";
import { listBranches, listBrands, resetLocalData } from "@/lib/data/repo";
import { isLiveMode } from "@/lib/supabase/client";
import { flush, getSyncState } from "@/lib/offline/sync";
import { db } from "@/lib/offline/db";
import type { Branch, Brand } from "@/lib/types";
import { Card, CardHeader, Button, Input, Field, Badge, Table, Th, Td, KpiTile } from "@/components/ui";
import { can } from "@/lib/permissions";

export default function AdminSettingsPage() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { employee } = useSession();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  const [company, setCompany] = useState({
    name: "บริษัท เอส เอช ดี เทคโนโลยี จำกัด",
    taxId: "0000000000000",
    address: "กรุงเทพมหานคร",
    phone: "02-000-0000",
  });

  useEffect(() => {
    void (async () => {
      setBranches(await listBranches());
      setBrands(await listBrands());
      setPending(await db().pending.where("status").anyOf("pending", "syncing").count());
      setFailed(await db().pending.where("status").equals("failed").count());
    })();
  }, []);

  const sync = getSyncState();

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label={t.common.branch} value={String(branches.length)} icon={<Building2 size={15} />} />
        <KpiTile label={t.common.brand} value={String(brands.length)} />
        <KpiTile label={t.offline.pending} value={String(pending)} tone={pending ? "warn" : "neutral"} />
        <KpiTile label={t.offline.failed} value={String(failed)} tone={failed ? "danger" : "neutral"} />
      </div>

      <Card>
        <CardHeader
          title={t.settings.dataMode}
          subtitle={isLiveMode() ? "เชื่อมต่อ Supabase แล้ว" : "โหมดสาธิต — ข้อมูลอยู่ใน IndexedDB ของเครื่องนี้"}
          right={<Badge tone={isLiveMode() ? "ok" : "warn"}>{isLiveMode() ? "Supabase" : "Demo"}</Badge>}
        />
        <div className="p-5 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void flush()}>
            <RefreshCw size={15} /> {t.offline.syncNow}
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await resetLocalData();
              toast.push({ tone: "ok", title: t.common.reset });
              location.reload();
            }}
          >
            <Database size={15} /> ล้างข้อมูลในเครื่อง
          </Button>
          {!sync.online ? <Badge tone="warn">{t.offline.offline}</Badge> : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="ข้อมูลบริษัท (หัวใบเสร็จ / ใบกำกับภาษี)" subtitle="แก้ที่นี่แล้วจะใช้กับสลิปทุกสาขา" />
        <div className="p-5 grid sm:grid-cols-2 gap-3">
          <Field label="ชื่อบริษัท">
            <Input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี">
            <Input value={company.taxId} onChange={(e) => setCompany({ ...company, taxId: e.target.value })} className="font-mono" />
          </Field>
          <Field label="ที่อยู่">
            <Input value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
          </Field>
          <Field label="โทรศัพท์">
            <Input value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Button
              variant="primary"
              disabled={!can(employee, "admin.settings")}
              onClick={() => toast.push({ tone: "ok", title: t.common.save, body: "settings.company.profile" })}
            >
              {t.common.save}
            </Button>
            {!can(employee, "admin.settings") ? (
              <p className="text-[11px] text-muted mt-2">ต้องเป็นระดับ HQ จึงจะแก้ค่าระบบได้</p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="ภาษี / e-Tax Invoice" subtitle="VAT 7% แบบราคารวมภาษี (inclusive)" />
        <div className="p-5 space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Receipt size={15} className="text-muted" />
            ใบกำกับภาษีอย่างย่อออกอัตโนมัติทุกบิล · ใบกำกับเต็มรูปออกเมื่อลูกค้าให้เลขผู้เสียภาษี
          </div>
          <div className="flex items-center gap-2">
            <Percent size={15} className="text-muted" />
            เลขที่เอกสารรันแยกรายสาขา/รายเครื่อง เพื่อไม่ชนกันตอนออฟไลน์
          </div>
          <p className="text-xs text-muted">
            การเชื่อม e-Tax Invoice by Email / ผู้ให้บริการ (INET, Frank, Ksher) อยู่ในเอกสาร docs/07-etax-invoice.md
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title={t.common.branch} subtitle={`${branches.length} สาขา`} />
        <Table>
          <thead>
            <tr>
              <Th>รหัส</Th>
              <Th>{t.common.branch}</Th>
              <Th>{t.common.brand}</Th>
              <Th>จังหวัด</Th>
              <Th align="center">สาขาภาษี</Th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <Td className="font-mono text-[11px] text-muted">{b.code}</Td>
                <Td className="text-xs font-medium">{locale === "th" ? b.name_th ?? b.name : b.name}</Td>
                <Td className="text-xs">{brands.find((x) => x.id === b.brand_id)?.name ?? "—"}</Td>
                <Td className="text-xs text-muted">{b.province ?? "—"}</Td>
                <Td align="center" className="text-xs font-mono">{b.tax_branch_no}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
