// ชนิดข้อมูลร่วม (client + server) สำหรับเชื่อมต่อระบบสิทธิ์กลาง (sso.shd-technology.co.th)
// ไม่มี secret ในไฟล์นี้ — import ได้ทั้งฝั่ง client และ server

/** โปรไฟล์พนักงานจาก directory ของระบบกลาง (sync จาก Lark) */
export interface CentralPerson {
  union_id: string;
  name: string;
  en_name?: string;
  email: string;
  job_title?: string;
  city?: string;
  country?: string;
  manager?: string;
  manager_union_id?: string;
  avatar_url?: string;
  status?: string;
  departments?: string[];
}

/** หนึ่ง "หมวก" (assignment) ของพนักงาน — บริษัท/สาขา/แผนก/ตำแหน่ง */
export interface CentralAssignment {
  assignment_id: string;
  is_primary: boolean;
  is_acting: boolean;
  company?: string;
  branch?: string;
  department?: string;
  job_title?: string;
  effective_to?: string | null;
}

export interface CentralEmployment {
  employee_id: string;
  status: string;
  last_working_date?: string | null;
  access_end_date?: string | null;
  phase?: string;
  clearing_until?: string | null;
  type?: string;
}

/** ผลจาก /authz/effective — สิทธิ์ทั้งหมดของผู้ใช้ */
export interface CentralEffective {
  ok?: boolean;
  hasAccess: boolean;
  roles: string[];
  base_level?: string;
  can_share?: boolean;
  /** resource -> ระดับสิทธิ์ เช่น { orders: "manage" } */
  resources: Record<string, string>;
  capabilities: string[];
  masked_fields: string[];
  /** ขอบเขตข้อมูล: มิติ -> ค่าที่ผูก เช่น { brand: ["anker"] } · "ไม่มีคีย์" = เห็นทุกค่า */
  scopes: Record<string, string[]>;
  employment?: CentralEmployment;
  assignments?: CentralAssignment[] | null;
  assignment_id?: string | null;
  assignments_version?: string;
  grants_version?: string;
}

/** โปรไฟล์ที่เก็บใน session cookie (เบา ๆ ไม่เก็บ PII เกินจำเป็น) */
export interface SsoSessionProfile {
  email: string;
  union_id: string;
  name: string;
  avatar_url?: string;
  department?: string;
  branch?: string;
}

/** สิทธิ์ระดับแอปที่ resolve แล้ว (จากตาราง employees หรือ superadmin) */
export interface AppAuthz {
  allowed: boolean; // ล็อกอินเข้าแอปได้ไหม (มี employee ที่ active หรือเป็น superadmin)
  isSuperadmin: boolean;
  /** uuid จริงของ employees (มีไว้ให้บันทึกขาย/audit ได้) */
  employee_id?: string | null;
  role: string;
  data_scope: string;
  branch_ids: string[];
  brand_ids: string[];
  max_discount_percent: number;
  can_open_drawer?: boolean;
  permission_overrides: Record<string, string>;
}

/** รูปร่างคำตอบของ /api/me */
export interface MeResponse {
  authenticated: boolean;
  profile: SsoSessionProfile | null;
  authz: AppAuthz | null;
}
