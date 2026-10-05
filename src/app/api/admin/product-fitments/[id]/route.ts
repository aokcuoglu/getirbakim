import { currentAccount } from "@/modules/auth/session";
import { adminFitmentDetails } from "@/modules/admin/fitment-details.server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = await currentAccount();
  const headers = { "Cache-Control": "private, no-store" };
  if (!account?.approved || account.role !== "admin") return Response.json({ error: "Yönetici girişi gerekiyor." }, { status: 403, headers });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ error: "Geçersiz ürün kimliği." }, { status: 400, headers });
  const details = await adminFitmentDetails(id);
  if (!details) return Response.json({ error: "Ürün kaydı bulunamadı." }, { status: 404, headers });
  return Response.json(details, { headers });
}
