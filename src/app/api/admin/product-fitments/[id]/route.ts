import { adminApiAccount } from "@/modules/auth/session";
import { parseFitmentPaging } from "@/modules/admin/fitment-details";
import { adminFitmentDetails } from "@/modules/admin/fitment-details.server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!await adminApiAccount()) return Response.json({ error: "Yönetici girişi gerekiyor." }, { status: 403, headers });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Geçersiz ürün kimliği." }, { status: 400, headers });
  const paging = parseFitmentPaging(new URL(request.url).searchParams);
  if (!paging) return Response.json({ error: "Geçersiz sayfalama değeri." }, { status: 400, headers });
  const details = await adminFitmentDetails(id, paging);
  if (!details) return Response.json({ error: "Ürün kaydı bulunamadı." }, { status: 404, headers });
  return Response.json(details, { headers });
}
