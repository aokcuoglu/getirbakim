import { adminApiAccount } from "@/modules/auth/session";
import { enrichmentRow } from "@/modules/admin/enrichment-data";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!await adminApiAccount()) return Response.json({ error: "Yönetici girişi gerekiyor." }, { status: 403, headers });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Geçersiz ürün kimliği." }, { status: 400, headers });
  const row = await enrichmentRow(id);
  if (!row) return Response.json({ error: "Ürün kaydı bulunamadı." }, { status: 404, headers });
  return Response.json(row, { headers });
}
