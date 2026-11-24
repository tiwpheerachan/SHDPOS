"use client";
import { useEffect, useState } from "react";
import { listProducts } from "../data/repo";
import { useSession } from "../store/session";
import type { Product } from "../types";

/** All operational product selectors observe the same canonical local catalog updates. */
export function useCatalogProducts() {
  const state = useState<Product[]>([]);
  const [,setProducts] = state;
  const actor = useSession(s=>s.employee?.id);
  useEffect(()=>{
    let alive=true;
    const refresh=()=>{void listProducts().then(rows=>{if(alive)setProducts(rows)}).catch(()=>undefined)};
    refresh();
    window.addEventListener("pos-catalog-refreshed",refresh);
    return ()=>{alive=false;window.removeEventListener("pos-catalog-refreshed",refresh)};
  },[actor,setProducts]);
  return state;
}
