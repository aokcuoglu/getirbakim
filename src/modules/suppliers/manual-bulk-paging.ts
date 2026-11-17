/** Rows per page of the bulk CSV draft's change and finding tables (#840). */
export const manualBulkPageSize = 100;
/** URL params of the two tables' pages; `taslak` and the list filters are carried alongside. */
export const manualBulkPageParams = { changes: "degisiklik", issues: "bulgu" } as const;

/** A page number from the URL, clamped to 1..pages (junk and 0 fall back to the first page). */
export function manualBulkPage(raw: string | undefined, total: number, size = manualBulkPageSize) {
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = /^\d{1,9}$/.test(raw ?? "") ? Number(raw) : 1;
  const page = Math.min(Math.max(requested, 1), pages);
  return { page, pages, offset: (page - 1) * size };
}
