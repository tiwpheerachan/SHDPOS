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
import { useL } from "@/lib/i18n/provider";
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
  const L = useL();
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
      if (id && !t) throw Error(L("ไม่พบงาน", "Task not found", "未找到任务"));
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
      setError(e instanceof Error ? e.message : L("บันทึกไม่สำเร็จ", "Save failed", "保存失败"));
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
      title={id ? L("รายละเอียดงาน / ส่งต่อ", "Task details / hand off", "任务详情 / 转派") : L("สร้างงานใหม่", "New task", "新建任务")}
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            {L("ยกเลิก", "Cancel", "取消")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!form?.title?.trim() || !form?.assigned_to}
            onClick={() => void save()}
          >
            {L("บันทึก", "Save", "保存")}
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
        {!form && !error ? <p className="work-caption">{L("กำลังโหลดงาน…", "Loading task…", "正在加载任务…")}</p> : null}
        {form ? (
          <>
            <label className="block text-xs font-medium">
              {L("ชื่องาน", "Title", "任务名称")}
              <input
                className="work-field mt-1.5"
                value={form.title}
                maxLength={200}
                onChange={(e) => change("title", e.target.value)}
                placeholder={L("งานที่ต้องทำให้เสร็จ", "What needs to be done", "需要完成的工作")}
              />
            </label>
            <label className="block text-xs font-medium">
              {L("รายละเอียด", "Details", "详情")}
              <textarea
                className="work-field mt-1.5 !h-20 py-2 resize-y"
                value={form.description}
                onChange={(e) => change("description", e.target.value)}
                placeholder={L("บริบท สิ่งที่ขาด และผลลัพธ์ที่ต้องการ", "Context, what is missing and the expected outcome", "背景、缺少的内容及期望结果")}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs">
                {L("สาขา", "Branch", "门店")}
                <select
                  className="work-field mt-1.5"
                  aria-label={L("สาขา", "Branch", "门店")}
                  disabled={!!task}
                  value={form.branch_id}
                  onChange={(e) => change("branch_id", e.target.value)}
                >
                  <option value="">{L("เลือกสาขา", "Select branch", "选择门店")}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name_th || b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                {L("ผู้รับผิดชอบ", "Assignee", "负责人")}
                <select
                  className="work-field mt-1.5"
                  aria-label={L("ผู้รับผิดชอบ", "Assignee", "负责人")}
                  value={form.assigned_to}
                  onChange={(e) => change("assigned_to", e.target.value)}
                >
                  <option value="">{L("เลือกผู้ใช้", "Select user", "选择用户")}</option>
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
                        ? L(" · หัวหน้า", " · lead", " · 主管")
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs">
                {L("สถานะ", "Status", "状态")}
                <select
                  disabled={
                    !task ||
                    (task.source_kind === "deferred_sale" &&
                      ["done", "cancelled"].includes(task.status))
                  }
                  className="work-field mt-1.5"
                  aria-label={L("สถานะงาน", "Task status", "任务状态")}
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
                {L("ความสำคัญ", "Priority", "优先级")}
                <select
                  className="work-field mt-1.5"
                  aria-label={L("ความสำคัญ", "Priority", "优先级")}
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
              {L("กำหนดเสร็จ", "Due", "截止时间")}
              <input
                className="work-field mt-1.5"
                type="datetime-local"
                value={form.due_at}
                onChange={(e) => change("due_at", e.target.value)}
                onInput={(e) => change("due_at", e.currentTarget.value)}
              />
            </label>
            <label className="block text-xs">
              {L("ข้อความอัปเดต / เหตุผลส่งต่อ", "Update note / hand-off reason", "更新说明 / 转派原因")}
              <textarea
                className="work-field mt-1.5 !h-16 py-2"
                value={form.comment}
                onChange={(e) => change("comment", e.target.value)}
                placeholder={L("ผู้รับงานต่อควรรู้อะไรบ้าง", "What should the next assignee know?", "接手人需要了解什么？")}
              />
            </label>
            {task?.source_kind === "deferred_sale" ? (
              <div className="rounded-xl bg-surface2 p-3">
                <p className="work-caption mb-2">
                  {L("ผูกกับบิลรอปิด งานจะเสร็จตามสถานะบิลจริง", "Linked to a pending bill — completes with the actual bill status", "已关联待结单据，任务将随单据实际状态完成")}
                </p>
                <Link
                  className="text-xs font-medium underline underline-offset-4"
                  href={`${path.startsWith("/admin") ? "/admin" : "/pos"}/deferred-sales?branch_id=${task.branch_id}&deferred=${task.source_id}`}
                >
                  {L("เปิดบิลต้นทาง ↗", "Open source bill ↗", "打开来源单据 ↗")}
                </Link>
              </div>
            ) : null}
            {task?.source_kind === "ow_sale" || task?.source_kind === "ow_transfer" ? (
              <div className="rounded-xl bg-danger/5 p-3">
                <p className="work-caption mb-2">
                  {L("ระบบสร้างจากการเชื่อมคลังกลาง/JST · ปิดเองเมื่อ", "Auto-created from central warehouse/JST sync · closes when ", "由中央仓库/JST 对接自动创建 · 自动关闭条件：")}{task.source_kind === "ow_sale" ? L(" JST ยืนยันบิล", "JST confirms the bill", "JST 确认单据") : L("ตรวจแล้วตรงกัน", "reconciled", "核对一致")}
                </p>
                <Link
                  className="text-xs font-medium underline underline-offset-4"
                  href={
                    path.startsWith("/admin")
                      ? `/admin/onewarehouse?tab=${task.source_kind === "ow_sale" ? "sales" : "recon"}`
                      : task.source_kind === "ow_sale" ? "/pos/orders" : "/pos/transfers"
                  }
                >
                  {task.source_kind === "ow_sale" ? L("เปิดหน้าส่งบิลขาย ↗", "Open sales sync page ↗", "打开销售单据同步页 ↗") : L("เปิดหน้าตรวจความตรงกัน ↗", "Open reconciliation page ↗", "打开核对页 ↗")}
                </Link>
              </div>
            ) : null}
            {activity.length ? (
              <details>
                <summary className="text-xs text-muted cursor-pointer">
                  {L(`ประวัติการทำงาน (${activity.length})`, `Activity (${activity.length})`, `操作记录 (${activity.length})`)}
                </summary>
                <ol className="mt-3 border-l border-line ml-1 pl-4 space-y-3">
                  {activity.map((a) => (
                    <li key={a.id} className="text-xs">
                      <p>
                        {a.body ||
                          (
                            {
                              created: L("สร้างงาน", "Created", "创建任务"),
                              updated: L("อัปเดตงาน", "Updated", "更新任务"),
                              handoff: L("ส่งต่องาน", "Handed off", "转派任务"),
                              source_closed: L("ปิดตามรายการต้นทาง", "Closed by source", "随来源关闭"),
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
