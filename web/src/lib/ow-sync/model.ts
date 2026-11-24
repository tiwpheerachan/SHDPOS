export type ResourceState = "ok" | "empty" | "unavailable" | "error";
export interface OwResource { key:string; kind:string; scope:string|null; state:ResourceState; count:number; fetched_at:string; data:unknown; error?:string }
export interface OwSnapshot { version:1; mode?:"full"|"operational"; id:string; source:string; started_at:string; completed_at:string|null; actor_id:string; resources:OwResource[]; summary:{products:number;warehouses:number;stock_rows:number;carriers:number;transfers:number;serials:number;errors:number;unavailable:number}; catalog?:{error?:string;matches?:{sku:string;product_id:string|null;state:"linked"|"conflict"|"not_imported"}[]} }
export function serialReferences(value:unknown):string[]{
  const found=new Set<string>();
  const visit=(v:unknown)=>{if(Array.isArray(v)){v.forEach(visit);return;}if(!v||typeof v!=="object")return;for(const [key,item]of Object.entries(v)){if(key==="serialNo"&&typeof item==="string"&&item.trim())found.add(item.trim());else if(item&&typeof item==="object")visit(item);}};
  visit(value);return [...found];
}
export async function pool<T>(items:T[],fn:(item:T)=>Promise<void>,size=3){let index=0;await Promise.all(Array.from({length:Math.min(size,items.length)},async()=>{for(;;){const at=index++;if(at>=items.length)return;await fn(items[at]);}}));}
