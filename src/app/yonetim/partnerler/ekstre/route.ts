import type { NextRequest } from "next/server";
import { requireAdmin } from "@/modules/auth/session";
import { adminPartnerStatement } from "@/modules/admin/partners";
import { buildPartnerStatementCsv } from "@/modules/partner/statement-csv";

// A partner's monthly statement CSV (#1200): ?partner=<code>&donem=YYYY-MM, from /yonetim/partnerler.
export async function GET(request: NextRequest) {
  await requireAdmin();
  const statement = await adminPartnerStatement(Object.fromEntries(request.nextUrl.searchParams));
  if (!statement) return new Response("Ekstre bulunamadı.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const partner = statement.partner.replace(/[^A-Za-z0-9_-]/g, "_");
  return new Response(buildPartnerStatementCsv(statement), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="ekstre-${partner}-${statement.period}.csv"`,
    "Cache-Control": "no-store",
  } });
}
