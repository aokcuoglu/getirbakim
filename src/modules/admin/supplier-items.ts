import "server-only";
import type { QueryResultRow } from "pg";
import { db } from "@/lib/db";

/** Rows per page on the supplier product lists (Başbuğ, Dinamik, SETA, Manuel). */
export const SUPPLIER_PAGE_SIZE = 50;
/**
 * Deepest reachable page. OFFSET paging sorts everything before the page (Dinamik page 18000 spilled ~800 MB to disk),
 * so deeper results are reached by narrowing the filters instead.
 */
export const SUPPLIER_MAX_PAGE = 200;

export type CatalogSale = { id: string; price_kurus: number | null; available: boolean | null; stock_label: string | null };
export type SaleFields = { sale_price_kurus: number | null; sale_available: boolean | null; sale_stock_label: string | null };
export type SupplierItemQuery = <T extends QueryResultRow>(text: string, values: unknown[]) => Promise<{ rows: T[] }>;

const pooled: SupplierItemQuery = (text, values) => db.query(text, values);

/** `?page=` as a 1-based page no deeper than the cap; anything unreadable is page 1. */
export function requestedPage(raw: string | undefined) {
  const page = Number(raw);
  return Number.isSafeInteger(page) ? Math.min(SUPPLIER_MAX_PAGE, Math.max(1, page)) : 1;
}

/** Page count for `total` rows, capped at SUPPLIER_MAX_PAGE; `capped` says rows exist past the last reachable page. */
export function pageBounds(total: number, pageSize = SUPPLIER_PAGE_SIZE) {
  const all = Math.max(1, Math.ceil(total / pageSize));
  return { pages: Math.min(all, SUPPLIER_MAX_PAGE), capped: all > SUPPLIER_MAX_PAGE };
}

/** Storefront price/stock of each row (null when it is not on sale), keeping the rows' order. */
export function withSale<T extends { id: string }>(rows: T[], sales: CatalogSale[]): (T & SaleFields)[] {
  const byId = new Map<string, CatalogSale>();
  for (const sale of sales) if (!byId.has(sale.id)) byId.set(sale.id, sale);
  return rows.map(row => {
    const sale = byId.get(row.id);
    return { ...row, sale_price_kurus: sale?.price_kurus ?? null, sale_available: sale?.available ?? null, sale_stock_label: sale?.stock_label ?? null };
  });
}

/**
 * One page of `supplier_items` for the admin supplier lists. `where`/`order`/`select` are SQL written by the caller
 * (URL values only through `values`). The count and the page run together; only a request past the last page re-reads
 * the clamped one. The storefront fields come from one `commerce_catalog` read for the page's ids — joining the view
 * per row re-sorted its `latest` CTE for every row (~1.8 ms × 50). `total`, when given, replaces the count.
 */
export async function supplierItemPage<T extends QueryResultRow & { id: string }>(options: {
  where: string;
  values: unknown[];
  order: string;
  page: string | undefined;
  select?: string;
  total?: number | Promise<number>;
  pageSize?: number;
  query?: SupplierItemQuery;
}) {
  const { where, values, order, select = "*", pageSize = SUPPLIER_PAGE_SIZE, query = pooled } = options;
  const rowsAt = async (page: number) => (await query<T>(
    `SELECT ${select} FROM supplier_items WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  )).rows;
  const wanted = requestedPage(options.page);
  const [total, wantedRows] = await Promise.all([
    options.total ?? query<{ count: number }>(`SELECT count(*)::int AS count FROM supplier_items WHERE ${where}`, values).then(result => result.rows[0].count),
    rowsAt(wanted),
  ]);
  const { pages, capped } = pageBounds(total, pageSize);
  const page = Math.min(wanted, pages);
  const rows = page === wanted ? wantedRows : await rowsAt(page);
  const sales = rows.length ? (await query<CatalogSale>(
    "SELECT id,price_kurus,available,stock_label FROM commerce_catalog WHERE id = ANY($1::uuid[])", [rows.map(row => row.id)],
  )).rows : [];
  return { items: withSale(rows, sales), total, page, pages, capped };
}
