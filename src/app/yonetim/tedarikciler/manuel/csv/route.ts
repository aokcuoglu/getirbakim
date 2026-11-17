import type { NextRequest } from "next/server";
import { requireAdmin } from "@/modules/auth/session";
import { adminManualBulkExport } from "@/modules/admin/manual";
import { buildManualBulkCsv } from "@/modules/suppliers/manual-bulk-csv";

// The selected list's price/stock CSV (#832), filtered like the product tab; edited in Excel and uploaded back.
// ?tum=1: every list in one file with a leading Liste column (#844).
export async function GET(request: NextRequest) {
  await requireAdmin();
  const data = await adminManualBulkExport(Object.fromEntries(request.nextUrl.searchParams));
  if (!data) return new Response("Liste bulunamadı.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const name = data.list ? data.list.list_group : "tum-listeler";
  return new Response(buildManualBulkCsv(data.rows, data.combined), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="manuel-${name}-fiyat-stok-${day}.csv"`,
    "Cache-Control": "no-store",
  } });
}
