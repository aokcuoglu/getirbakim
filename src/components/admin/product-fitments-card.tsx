import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { loadProductFitments } from "@/modules/admin/product-fitment-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFitmentsManager } from "./product-fitments-manager";

/** The vehicles the product fits (#583): engine types added by hand and automatic fitments removed from the store. */
export async function ProductFitmentsCard({ productId }: { productId: string }) {
  await requireAdmin();
  const fitments = await loadProductFitments(db, productId);
  return <Card id="arac-uyumu">
    <CardHeader><CardTitle><h2>Araç uyumu</h2></CardTitle>
      <CardDescription>Elle eklenen motor tipi mağazada otomatik uyum gibi görünür, yanlış otomatik uyum “Çıkar” ile kaldırılır. Tedarikçi güncellemeleri ve zenginleştirme bu kararları değiştirmez.</CardDescription></CardHeader>
    <CardContent><ProductFitmentsManager productId={productId} fitments={fitments}/></CardContent>
  </Card>;
}
