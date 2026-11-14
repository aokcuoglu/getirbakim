import { adminApiAccount } from "@/modules/auth/session";
import { brandDialogData } from "@/modules/admin/product-matching";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!await adminApiAccount()) return Response.json({ error: "Yönetici girişi gerekiyor." }, { status: 403, headers });
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return Response.json({ error: "Geçersiz marka kimliği." }, { status: 400, headers });
  return Response.json(await brandDialogData(id), { headers });
}
