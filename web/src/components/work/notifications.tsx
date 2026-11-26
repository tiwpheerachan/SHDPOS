"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ArrowUpRight } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { useL } from "@/lib/i18n/provider";
export function WorkNotifications({ admin = false }: { admin?: boolean }) {
  const L = useL();
  const router = useRouter(),
    [open, setOpen] = useState(false),
    [data, setData] = useState<any>({ items: [], unread: 0 }),
    [error, setError] = useState("");
  async function load() {
    try {
      const r = await fetch("/api/work/notifications", {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        }),
        j = await r.json();
      if (!r.ok) throw Error(j.error);
      setData(j);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : L("อ่านแจ้งเตือนไม่สำเร็จ", "Failed to load notifications", "读取通知失败"));
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 20000);
    const refresh = () => void load();
    window.addEventListener("shd:work-changed", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("shd:work-changed", refresh);
    };
  }, []);
  async function read(id?: string) {
    const r = await fetch("/api/work/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : {}),
    });
    if (!r.ok) throw Error(L("บันทึกการอ่านไม่สำเร็จ", "Failed to mark as read", "标记已读失败"));
    await load();
  }
  return (
    <>
      <button
        aria-label={L("การแจ้งเตือนงาน", "Task notifications", "任务通知")}
        title={error ? L("แจ้งเตือนงาน: เชื่อมต่อไม่สำเร็จ", "Task notifications: connection failed", "任务通知：连接失败") : L("การแจ้งเตือนงาน", "Task notifications", "任务通知")}
        onClick={() => {
          setOpen(true);
          void load();
        }}
        className="relative h-9 w-9 grid place-items-center rounded-xl text-muted hover:bg-surface2"
      >
        <Bell size={17} />
        {data.unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 bg-brand text-brandInk text-[9px] min-w-4 h-4 px-1 rounded-full grid place-items-center">
            {data.unread > 99 ? "99+" : data.unread}
          </span>
        ) : error ? (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-warn" />
        ) : null}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={L("การแจ้งเตือนงาน", "Task notifications", "任务通知")}
        size="md"
        footer={
          <>
            <Button
              size="sm"
              variant="soft"
              onClick={() => void read().catch((e) => setError(e.message))}
            >
              <CheckCheck size={13} />
              {L("อ่านทั้งหมด", "Mark all read", "全部已读")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setOpen(false);
                router.push(admin ? "/admin/work" : "/pos/work");
              }}
            >
              {L("งานของฉัน", "My work", "我的工作")}
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-xs text-danger mb-3">
            {error}
          </p>
        ) : null}
        <div className="divide-y divide-line/60">
          {data.items.length ? (
            data.items.map((n: any) => (
              <button
                key={n.id}
                className="w-full text-left py-3 flex items-start gap-3 group"
                onClick={() => {
                  void read(n.id).catch(() => {});
                  setOpen(false);
                  router.push(
                    `${admin ? "/admin" : "/pos"}/work?task=${n.task_id}`,
                  );
                }}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.read_at ? "bg-line" : "bg-brand"}`}
                />
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-medium block break-words">
                    {n.title}
                  </span>
                  <span className="work-caption">
                    {new Date(n.created_at).toLocaleString("th-TH")}
                  </span>
                </span>
                <ArrowUpRight size={13} className="text-muted" />
              </button>
            ))
          ) : (
            <p className="text-sm text-muted text-center py-10">
              {L("ยังไม่มีการแจ้งเตือนงาน", "No task notifications yet", "暂无任务通知")}
            </p>
          )}
        </div>
        <p className="work-caption mt-3">
          {L("แจ้งเตือนในระบบ อัปเดตทุกประมาณ 20 วินาทีขณะเปิดหน้าเว็บ", "In-app notifications, refreshed about every 20 seconds while the page is open", "系统内通知，页面打开时约每 20 秒更新")}
        </p>
      </Modal>
    </>
  );
}
