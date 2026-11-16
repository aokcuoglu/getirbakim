import { db } from "@/lib/db";
import { adminApiAccount } from "@/modules/auth/session";
import { loadFitmentCopySources, previewFitmentCopy } from "@/modules/admin/product-fitment-copy";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Başka üründen kopyala" (#662): `?source=` previews copying that product's fitments, otherwise `?q=` lists the products to copy from. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!await adminApiAccount()) return Response.json({ error: "Yönetici girişi gerekiyor." }, { status: 403, headers });
  const { id } = await params;
  if (!uuid.test(id)) return Response.json({ error: "Geçersiz ürün kimliği." }, { status: 400, headers });
  const search = new URL(request.url).searchParams;
  const source = search.get("source");
  if (source !== null) {
    if (!uuid.test(source)) return Response.json({ error: "Geçersiz kaynak ürün kimliği." }, { status: 400, headers });
    const preview = await previewFitmentCopy(db, id, source);
    if (!preview) return Response.json({ error: "Kaynak ürün bulunamadı ya da başka bir ürünle birleştirilmiş." }, { status: 404, headers });
    return Response.json(preview, { headers });
  }
  return Response.json(await loadFitmentCopySources(db, id, search.get("q")?.slice(0, 100) ?? undefined), { headers });
}
