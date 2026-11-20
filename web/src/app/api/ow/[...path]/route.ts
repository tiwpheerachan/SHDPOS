// =====================================================================
// OneWarehouse `/v1` — secure server-side proxy (reads)
//   • แนบ 2 headers (X-Service-Token, X-On-Behalf-Of-Sub) ฝั่ง server เท่านั้น
//     → service token ไม่หลุดไป browser (เรียกผ่าน same-origin /api/ow/*)
//   • whitelist path กัน SSRF / proxy มั่ว (เฉพาะ endpoint อ่านใน packet)
//   • passthrough สถานะ+บอดี้จาก OW ตรง ๆ (401/403/404/501/502/503 โผล่ถึง client)
//   • ห้าม log token/sub เด็ดขาด
// env (server-side, อย่าใช้ NEXT_PUBLIC): ONEWAREHOUSE_BASE · ONEWAREHOUSE_SERVICE_TOKEN · ONEWAREHOUSE_SUB
// =====================================================================
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// เฉพาะ path อ่านที่อยู่ในสเปก packet (GET ทั้งหมด)
const ALLOW: RegExp[] = [
  /^products$/,
  /^products\/[^/]+\/components$/,
  /^stock$/,
  /^warehouses$/,
  /^serials\/[^/]+$/,
  /^carriers$/,
  /^openapi\.json$/,
];

function cfg() {
  const base = process.env.ONEWAREHOUSE_BASE?.replace(/\/+$/, "") || "";
  const token = process.env.ONEWAREHOUSE_SERVICE_TOKEN || "";
  const sub = process.env.ONEWAREHOUSE_SUB || "";
  return { base, token, sub };
}

export async function GET(req: NextRequest, { params }: { params: { path?: string[] } }) {
  const parts = params.path ?? [];
  const path = parts.join("/");

  // สถานะการตั้งค่า — ให้ client รู้ว่าเปิดอ่าน OW ได้ไหม (ไม่เปิดเผยค่า secret)
  if (path === "status") {
    const { base, token, sub } = cfg();
    return NextResponse.json({
      configured: Boolean(base),
      authConfigured: Boolean(base && token && sub),
      subNumeric: sub ? /^\d+$/.test(sub) : null,
    });
  }

  if (!ALLOW.some((re) => re.test(path))) {
    return NextResponse.json({ error: "path_not_allowed", path }, { status: 404 });
  }

  const { base, token, sub } = cfg();
  if (!base) return NextResponse.json({ error: "ow_not_configured", configured: false }, { status: 503 });

  const isPublic = path === "openapi.json"; // OpenAPI เปิด ไม่ต้อง auth
  if (!isPublic && (!token || !sub)) {
    return NextResponse.json({ error: "ow_auth_not_configured", configured: false, authConfigured: false }, { status: 503 });
  }

  const url = `${base}/v1/${path}${req.nextUrl.search}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (!isPublic) {
    headers["X-Service-Token"] = token;
    headers["X-On-Behalf-Of-Sub"] = sub;
  }

  try {
    const upstream = await fetch(url, { headers, cache: "no-store" });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch {
    // อย่าสะท้อน error object (กันหลุด header/token ใน stack)
    return NextResponse.json({ error: "ow_upstream_unreachable" }, { status: 502 });
  }
}
