"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Modal, Button, Badge } from "@/components/ui";
import {
  workRead,
  workWrite,
  workStatus,
  workPriority,
  personName,
  type WorkItem,
  type WorkPerson,
} from "@/lib/work";
import { uuidv4 } from "@/lib/uuid";
function localInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function WorkTaskDialog({
  open,
  onClose,
  id,
  branchId,
  branches,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  id?: string;
  branchId?: string;
  branches: { id: string; name: string; name_th?: string }[];
  onSaved: () => void;
}) {
  const path = usePathname(),
    [task, setTask] = useState<WorkItem | null>(null),
    [form, setForm] = useState<any>(null),
    [people, setPeople] = useState<WorkPerson[]>([]),
    [activity, setActivity] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [createId, setCreateId] = useState("");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError("");
    setForm(null);
    setTask(null);
    setActivity([]);
    setCreateId(uuidv4());
    void (async () => {
      const data = await workRead(id ? { id } : {});
      if (!alive) return;
      const t = data.items?.[0];
      if (id && !t) throw Error("ไม่พบงาน");
      setTask(id ? t : null);
      setActivity(data.activity ?? []);
      setForm(
        id
          ? {
              title: t.title,
              description: t.description,
              branch_id: t.branch_id,
              assigned_to: t.assigned_to,
              status: t.status,
              priority: t.priority,
              due_at: localInput(t.due_at),
              comment: "",
            }
          : {
              title: "",
              description: "",
              branch_id: branchId || branches[0]?.id || "",
              assigned_to: data.actor,
              status: "todo",
              priority: "normal",
              due_at: "",
              comment: "",
            },
      );
    })().catch((e) => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [open, id]);
  useEffect(() => {
    if (!form?.branch_id) return;
    let alive = true;
    setPeople([]);
    void workRead({ branch_id: form.branch_id, people: "true" })
      .then((j) => {
        if (alive) setPeople(j.people);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [form?.branch_id]);
  const change = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  async function save() {
    setBusy(true);
    setError("");
    try {
      const patch: any = {
        title: form.title,
        description: form.description,
        assigned_to: form.assigned_to,
        priority: form.priority,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      };
      if (task) patch.status = form.status;
      else patch.branch_id = form.branch_id;
      await workWrite({
        action: "save",
        id: task?.id || createId,
        version: task?.version ?? 0,
        patch,
        comment: form.comment,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={id ? "รายละเอียดงาน / ส่งต่อ" : "สร้างงานใหม่"}
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!form?.title?.trim() || !form?.assigned_to}
            onClick={() => void save()}
          >
            บันทึก
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <p
            role="alert"
            className="text-xs text-danger rounded-xl bg-danger/5 p-3"
          >
            {error}
          </p>
        ) : null}
        {!form && !error ? <p className="work-caption">กำลังโหลดงาน…</p> : null}
        {form ? (
          <>
            <label className="block text-xs font-medium">
              ชื่องาน
              <input
                className="work-field mt-1.5"
                value={form.title}
                maxLength={200}
                onChange={(e) => change("title", e.target.value)}
                placeholder="งานที่ต้องทำให้เสร็จ"
              />
            </label>
            <label className="block text-xs font-medium">
              รายละเอียด
              <textarea
                className="work-field mt-1.5 !h-20 py-2 resize-y"
                value={form.description}
                onChange={(e) => change("description", e.target.value)}
                placeholder="บริบท สิ่งที่ขาด และผลลัพธ์ที่ต้องการ"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs">
                สาขา
                <select
                  className="work-field mt-1.5"
                  aria-label="สาขา"
                  disabled={!!task}
                  value={form.branch_id}
                  onChange={(e) => change("branch_id", e.target.value)}
                >
                  <option value="">เลือกสาขา</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name_th || b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                ผู้รับผิดชอบ
                <select
                  className="work-field mt-1.5"
                  aria-label="ผู้รับผิดชอบ"
                  value={form.assigned_to}
                  onChange={(e) => change("assigned_to", e.target.value)}
                >
                  <option value="">เลือกผู้ใช้</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {personName(p)}
                      {[
                        "owner",
                        "hq",
                        "manager",
                        "supervisor",
                        "brand_admin",
                      ].includes(p.role ?? "")
                        ? " · หัวหน้า"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs">
                สถานะ
                <select
                  disabled={
                    !task ||
                    (task.source_kind === "deferred_sale" &&
                      ["done", "cancelled"].includes(task.status))
                  }
                  className="work-field mt-1.5"
                  aria-label="สถานะงาน"
                  value={form.status}
                  onChange={(e) => change("status", e.target.value)}
                >
                  {Object.entries(workStatus).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                ความสำคัญ
                <select
                  className="work-field mt-1.5"
                  aria-label="ความสำคัญ"
                  value={form.priority}
                  onChange={(e) => change("priority", e.target.value)}
                >
                  {Object.entries(workPriority).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs">
              กำหนดเสร็จ
              <input
                className="work-field mt-1.5"
                type="datetime-local"
                value={form.due_at}
                onChange={(e) => change("due_at", e.target.value)}
                onInput={(e) => change("due_at", e.currentTarget.value)}
              />
            </label>
            <label className="block text-xs">
              ข้อความอัปเดต / เหตุผลส่งต่อ
              <textarea
                className="work-field mt-1.5 !h-16 py-2"
                value={form.comment}
                onChange={(e) => change("comment", e.target.value)}
                placeholder="ผู้รับงานต่อควรรู้อะไรบ้าง"
              />
            </label>
            {task?.source_kind === "deferred_sale" ? (
              <div className="rounded-xl bg-surface2 p-3">
                <p className="work-caption mb-2">
                  ผูกกับบิลรอปิด งานจะเสร็จตามสถานะบิลจริง
                </p>
                <Link
                  className="text-xs font-medium underline underline-offset-4"
                  href={`${path.startsWith("/admin") ? "/admin" : "/pos"}/deferred-sales?branch_id=${task.branch_id}&deferred=${task.source_id}`}
                >
                  เปิดบิลต้นทาง ↗
                </Link>
              </div>
            ) : null}
            {task?.source_kind === "ow_sale" || task?.source_kind === "ow_transfer" ? (
              <div className="rounded-xl bg-danger/5 p-3">
                <p className="work-caption mb-2">
                  ระบบสร้างจากการเชื่อมคลังกลาง/JST · ปิดเองเมื่อ{task.source_kind === "ow_sale" ? " JST ยืนยันบิล" : "ตรวจแล้วตรงกัน"}
                </p>
                <Link
                  className="text-xs font-medium underline underline-offset-4"
                  href={
                    path.startsWith("/admin")
                      ? `/admin/onewarehouse?tab=${task.source_kind === "ow_sale" ? "sales" : "recon"}`
                      : task.source_kind === "ow_sale" ? "/pos/orders" : "/pos/transfers"
                  }
                >
                  {task.source_kind === "ow_sale" ? "เปิดหน้าส่งบิลขาย ↗" : "เปิดหน้าตรวจความตรงกัน ↗"}
                </Link>
              </div>
            ) : null}
            {activity.length ? (
              <details>
                <summary className="text-xs text-muted cursor-pointer">
                  ประวัติการทำงาน ({activity.length})
                </summary>
                <ol className="mt-3 border-l border-line ml-1 pl-4 space-y-3">
                  {activity.map((a) => (
                    <li key={a.id} className="text-xs">
                      <p>
                        {a.body ||
                          (
                            {
                              created: "สร้างงาน",
                              updated: "อัปเดตงาน",
                              handoff: "ส่งต่องาน",
                              source_closed: "ปิดตามรายการต้นทาง",
                            } as any
                          )[a.action] ||
                          a.action}
                      </p>
                      <p className="work-caption">
                        {new Date(a.created_at).toLocaleString("th-TH")}
                      </p>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
