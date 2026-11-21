// Explicit demo-mode preview only. These rows are never fetched from or written to a real system.
import {
  decodeProduct,
  matchProduct,
  readiness,
  type StageItem,
  type CatalogProduct,
} from "./model";
export function catalogDemo() {
  const branch = "00000000-0000-4000-8000-000000000099";
  const run = {
    id: "00000000-0000-4000-8000-000000000088",
    phase: "review",
    version: 3,
    warehouse_id: "DEMO-WH",
    page_count: 1,
    last_error: null,
    created_at: "2026-11-22T02:00:00Z",
    environment: "ตัวอย่าง",
  };
  const products: CatalogProduct[] = [
    {
      id: "00000000-0000-4000-8000-000000000077",
      sku: "DEMO-EXIST-001",
      name_th: "หูฟังไร้สาย · ชื่อที่ POS ดูแล",
      price: 1490,
      cost: 900,
      track_serial: false,
      kind: "goods",
      brand_id: branch,
      category_id: branch,
      barcodes: ["LOCAL-BAR"],
      updated_at: "2026-11-22T02:00:00Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000076",
      sku: "OTHER",
      name_th: "สินค้าเจ้าของบาร์โค้ดเดิม",
      price: 100,
      cost: 50,
      track_serial: false,
      kind: "goods",
      brand_id: branch,
      category_id: branch,
      barcodes: ["TAKEN"],
    },
  ];
  const definitions = [
    {
      sku: "DEMO-NEW-001",
      name: "พาวเวอร์แบงค์ · สินค้าใหม่",
      sale_price: 1290,
      cost_price: 700,
      serial_tracking: false,
      is_combined: false,
      qty: 24,
    },
    {
      sku: "DEMO-EXIST-001",
      name: "Wireless headphones · ชื่อต้นทาง",
      sale_price: 1390,
      cost_price: 950,
      serial_tracking: false,
      is_combined: false,
      qty: 12,
    },
    {
      sku: "DEMO-CONFLICT",
      name: "สายชาร์จ · บาร์โค้ดชน",
      sale_price: 290,
      cost_price: 100,
      barcode: "TAKEN",
      serial_tracking: false,
      is_combined: false,
      qty: 8,
    },
    {
      sku: "DEMO-UNKNOWN",
      name: "อุปกรณ์ที่รอข้อมูล SN / ราคา",
      sale_price: null,
      cost_price: null,
      serial_tracking: null,
      is_combined: null,
      qty: null,
    },
    {
      sku: "DEMO-MISSING",
      name: "รายการที่ยังไม่พบ exact SKU",
      sale_price: null,
      cost_price: null,
      serial_tracking: null,
      is_combined: null,
      qty: null,
    },
  ];
  const items = definitions.map((d, index) => {
    const product = decodeProduct(d);
    const stage: StageItem = {
      sku: d.sku,
      sku_key: d.sku,
      summary: product,
      detail: index === 4 ? null : product,
      detail_status: index === 4 ? "missing" : "ok",
      detail_error: index === 4 ? "ตัวอย่าง: ไม่พบ SKU จาก exact lookup" : null,
      stock_qty: d.qty,
      stock_error: index === 3 ? "ตัวอย่าง: อ่านยอดคลังไม่สำเร็จ" : null,
      bom_status: "unknown",
    };
    const match = matchProduct(stage, products);
    return { ...stage, match, blockers: readiness(stage, match, true) };
  });
  return {
    run,
    items,
    stats: {
      found: 5,
      pending: 0,
      hydrated: 4,
      errors: 2,
      conflicts: 1,
      created: 0,
      updated: 0,
      imported: 0,
    },
    mappedBranch: branch,
    meta: {
      runs: [run],
      environment: "ตัวอย่าง",
      warehouses: [
        {
          warehouse_id: "DEMO-WH",
          name_en: "คลังสำหรับแสดงตัวอย่าง",
          status: "active",
        },
      ],
      branches: [
        {
          id: branch,
          code: "DEMO",
          name: "Demo branch",
          name_th: "สาขาตัวอย่าง",
        },
      ],
      mappings: [{ warehouse_id: "DEMO-WH", branch_id: branch }],
    },
  };
}
