-- 0100 ลิงก์สาธารณะของมุมมอง: เลือก "ข้อมูลสด" (อัปเดตตลอด + ตามการแก้มุมมอง) หรือ "ภาพนิ่ง" (ข้อมูล+มุมมอง ณ เวลาที่สร้าง ไม่เปลี่ยน)
alter table pos_report_views
  add column if not exists link_mode text not null default 'live' check (link_mode in ('live', 'snapshot')),
  add column if not exists link_snapshot jsonb,
  add column if not exists link_snapshot_at timestamptz;
