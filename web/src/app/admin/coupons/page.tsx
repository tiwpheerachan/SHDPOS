import { redirect } from "next/navigation";

// หน้าคูปองถูกยุบรวมเข้าหน้า "แคมเปญ" (แท็บ "วิเคราะห์การใช้งาน") แล้ว
export default function CouponsRedirect() {
  redirect("/admin/campaigns");
}
