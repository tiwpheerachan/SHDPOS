/** Literal PostgreSQL ILIKE matching, including %, _, quotes and PostgREST punctuation in actual SKUs. */
export function catalogSearchFilter(query: string): string {
  const pattern = `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
  return ["sku", "name_th", "name_en", "short_name"].map(field => `${field}.ilike.${JSON.stringify(pattern)}`).join(",");
}
