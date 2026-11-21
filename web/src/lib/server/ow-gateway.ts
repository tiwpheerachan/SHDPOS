export function owConfig() {
  const base = process.env.ONEWAREHOUSE_BASE?.replace(/\/+$/, "") || "";
  const token = process.env.ONEWAREHOUSE_SERVICE_TOKEN || "",
    sub = process.env.ONEWAREHOUSE_SUB || "";
  if (!base || !token || !/^\d+$/.test(sub))
    throw Error("ยังไม่ได้ตั้งค่าการเชื่อม OneWarehouse");
  const environment = process.env.ONEWAREHOUSE_ENV || "uat";
  if (!["uat", "production"].includes(environment))
    throw Error("ONEWAREHOUSE_ENV ต้องเป็น uat หรือ production");
  const sourceId = process.env.ONEWAREHOUSE_SOURCE_ID || "onewarehouse";
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(sourceId))
    throw Error("ONEWAREHOUSE_SOURCE_ID ไม่ถูกต้อง");
  return {
    base,
    token,
    sub,
    source: `${sourceId}:${environment}`,
    environment,
  };
}
export class GatewayError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function gatewayRead(path: string) {
  const c = owConfig();
  let response: Response;
  try {
    response = await fetch(`${c.base}/v1/${path}`, {
      headers: {
        accept: "application/json",
        "X-Service-Token": c.token,
        "X-On-Behalf-Of-Sub": c.sub,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GatewayError("เชื่อมคลังกลางไม่สำเร็จ กรุณาลองใหม่", 502);
  }
  if (!response.ok)
    throw new GatewayError(
      `OneWarehouse ตอบ HTTP ${response.status}`,
      response.status,
    );
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new GatewayError("คลังกลางตอบข้อมูลที่ไม่ใช่ JSON", 502);
  }
}
