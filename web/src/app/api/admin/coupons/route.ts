// Coupon analytics uses redemption and order snapshots; never manufactures products or customers.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/sso/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { visibleBranchIds } from "@/lib/sso/scope";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) return NextResponse.json({error:"forbidden"},{status:403});
  try {
    const sb=supabaseAdmin();
    const results=await Promise.all([
      sb.from("campaigns").select("id,code,name,discount_type,discount_value,active,promo_type,starts_at,ends_at,min_spend,max_discount,brand_ids,branch_ids"),
      sb.from("coupon_redemptions").select("id,campaign_id,discount_amount,order_total,created_at,customer_id,order_id").order("created_at",{ascending:false}).limit(5000),
      sb.from("branches").select("id,name,name_th,brand_id"),
      sb.from("brands").select("id,name,name_th"),
      sb.from("employees").select("id,first_name,last_name,nickname"),
    ]);
    if(results.some(r=>r.error))throw Error("อ่านรายงานคูปองไม่สำเร็จ");
    const camps=results[0].data ?? [], reds=results[1].data ?? [], branches=results[2].data ?? [], brands=results[3].data ?? [], employees=results[4].data ?? [];
    const ids=[...new Set(reds.map(r=>r.order_id).filter(Boolean))];
    const orders:any[]=[],items:any[]=[];
    for(let i=0;i<ids.length;i+=200){
      const batch=ids.slice(i,i+200);
      const fetched=await Promise.all([
        sb.from("orders").select("id,order_no,branch_id,cashier_id,customer_name").in("id",batch),
        sb.from("order_items").select("order_id,sku,name,qty").in("order_id",batch),
      ]);
      if(fetched.some(r=>r.error))throw Error("อ่านรายละเอียดบิลคูปองไม่สำเร็จ");
      orders.push(...(fetched[0].data ?? []));items.push(...(fetched[1].data ?? []));
    }
    const vBranch=await visibleBranchIds(ctx.authz);
    const orderMap=new Map(orders.map(o=>[o.id,o])),campMap=new Map(camps.map(c=>[c.id,c]));
    const branchMap=new Map(branches.map(b=>[b.id,b])),brandMap=new Map(brands.map(b=>[b.id,b]));
    const employeeMap=new Map(employees.map(e=>[e.id,e]));
    const usages=reds.filter(r=>vBranch===null||vBranch.includes(orderMap.get(r.order_id)?.branch_id)).map(r=>{
      const order=orderMap.get(r.order_id),camp=campMap.get(r.campaign_id);
      const branch=branchMap.get(order?.branch_id),brand=brandMap.get(branch?.brand_id),employee=employeeMap.get(order?.cashier_id);
      return {id:r.id,order_id:r.order_id,order_no:order?.order_no ?? "—",at:r.created_at,
        branch_id:order?.branch_id ?? "",branch_name:branch?.name_th || branch?.name || "—",
        brand_id:brand?.id ?? "",brand_name:brand?.name_th || brand?.name || "—",
        employee_id:order?.cashier_id ?? "",employee_name:employee?.nickname || [employee?.first_name,employee?.last_name].filter(Boolean).join(" ") || "—",
        customer_name:order?.customer_name ?? null,code:camp?.code ?? "—",campaign_id:r.campaign_id,campaign_name:camp?.name ?? "คูปอง",promo_type:camp?.promo_type ?? "discount",
        discount:Number(r.discount_amount ?? 0),bill_total:Number(r.order_total ?? 0),
        products:items.filter(i=>i.order_id===r.order_id).map(i=>({sku:i.sku,name:i.name,qty:Number(i.qty)})),details_unavailable:!order,
      };
    });
    const scoped=camps.filter(c=>vBranch===null||!(c.branch_ids ?? []).length||(c.branch_ids ?? []).some((id:string)=>vBranch.includes(id)));
    return NextResponse.json({campaigns:scoped.map(c=>({...c,discount_value:Number(c.discount_value ?? 0),min_spend:Number(c.min_spend ?? 0)})),usages,truncated:reds.length===5000},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:"อ่านรายงานไม่สำเร็จ"},{status:503});}
}
