"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/store/session";
import { PosTopBar } from "@/components/pos/top-bar";

export default function PosLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { employee } = useSession();

  const isLogin = pathname === "/pos";
  const isDisplay = pathname === "/pos/display";

  useEffect(() => {
    if (!isLogin && !isDisplay && !employee) router.replace("/pos");
  }, [employee, isLogin, isDisplay, router]);

  if (isDisplay) return <>{children}</>;

  // ยังไม่ล็อกอิน + ไม่ใช่หน้า login → ไม่ render เนื้อหาเลย (กัน flash ก่อนเด้งไป /pos)
  if (!isLogin && !employee) return null;

  return (
    <div className="min-h-screen flex flex-col">
      {!isLogin && employee ? <PosTopBar /> : null}
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}
