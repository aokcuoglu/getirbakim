import { db } from "@/lib/db";
import { currentAccount } from "@/modules/auth/session";
import { supplierActivity, type SupplierName } from "@/modules/suppliers/activity";

export const dynamic = "force-dynamic";
const suppliers: SupplierName[] = ["basbug", "seta", "dinamik"];

// Polled by the supplier pages' status badge while a fetch may be running.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const account = await currentAccount();
  if (!account?.approved || account.role !== "admin") return Response.json({ error: "Yönetici girişi gerekiyor." }, { status: 403, headers });
  const supplier = new URL(request.url).searchParams.get("supplier") as SupplierName;
  if (!suppliers.includes(supplier)) return Response.json({ error: "Geçersiz tedarikçi." }, { status: 400, headers });
  return Response.json(await supplierActivity(db, supplier), { headers });
}
