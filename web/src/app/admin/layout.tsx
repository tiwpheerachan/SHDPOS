"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/admin/shell";
import { useSession } from "@/lib/store/session";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { employee } = useSession();

  useEffect(() => {
    if (!employee) router.replace("/pos");
  }, [employee, router]);

  if (!employee) return null;
  return <AdminShell>{children}</AdminShell>;
}
