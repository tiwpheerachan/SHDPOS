"use client";
// ผลงานพนักงานย้ายไปอยู่ในหน้ายอดขาย (แท็บ "ผลงานพนักงาน") — หน้าเดิมพาไปที่นั่น พร้อม deep-link ?person=
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminEmployeesRedirect() {
  const router = useRouter();
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("person");
    router.replace(`/admin/sales?tab=staff${pid ? `&person=${encodeURIComponent(pid)}` : ""}`);
  }, [router]);
  return null;
}
