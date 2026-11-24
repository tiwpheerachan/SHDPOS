// ย้ายไปเป็นแท็บย่อย "ติดตามลูกค้า" ในหน้าลูกค้าแล้ว — เก็บ URL เดิมไว้ให้ลิงก์เก่ายังใช้ได้
import { redirect } from "next/navigation";

export default function AdminTasksRedirect() {
  redirect("/admin/customers?tab=followup");
}
