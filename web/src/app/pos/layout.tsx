"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/store/session";
import { getBranch } from "@/lib/data/repo";
import { PosTopBar } from "@/components/pos/top-bar";
import { useI18n } from "@/lib/i18n/provider";

export default function PosLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { employee, branchId } = useSession();
  const { pick } = useI18n();
  const [branchName, setBranchName] = useState<string>();

  const isLogin = pathname === "/pos";
  const isDisplay = pathname === "/pos/display";

  useEffect(() => {
    if (!isLogin && !isDisplay && !employee) router.replace("/pos");
  }, [employee, isLogin, isDisplay, router]);

  useEffect(() => {
    if (!branchId) return;
    void getBranch(branchId).then((b) => {
      if (b) setBranchName(pick({ th: b.name_th, en: b.name, zh: b.name }));
    });
  }, [branchId, pick]);

  if (isDisplay) return <>{children}</>;

  // ยังไม่ล็อกอิน + ไม่ใช่หน้า login → ไม่ render เนื้อหาเลย (กัน flash ก่อนเด้งไป /pos)
  if (!isLogin && !employee) return null;

  return (
    <div className="min-h-screen flex flex-col">
      {!isLogin && employee ? <PosTopBar branchName={branchName} /> : null}
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}
