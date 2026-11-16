import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { loadProductFitments } from "@/modules/admin/product-fitment-store";
import { loadProductFitmentSources } from "@/modules/admin/product-fitment-hide-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductFitmentsManager } from "./product-fitments-manager";
import { ProductFitmentHidesManager } from "./product-fitment-hides";

/**
 * The vehicles the product fits (#583): engine types added by hand and automatic fitments removed from the store; and,
 * when the sources have any, the rows no catalog type is linked to, which can be left out of the store (#661).
 */
export async function ProductFitmentsCard({ productId }: { productId: string }) {
  await requireAdmin();
  const [fitments, sources] = await Promise.all([loadProductFitments(db, productId), loadProductFitmentSources(db, productId)]);
  const hasSources = sources.vehicles.length > 0 || sources.models.length > 0 || sources.descriptionModels.length > 0 || sources.orphans.length > 0;
  return <>
    <Card id="arac-uyumu">
      <CardHeader><CardTitle><h2>Araç uyumu</h2></CardTitle>
        <CardDescription>Elle eklenen motor tipi mağazada otomatik uyum gibi görünür, yanlış otomatik uyum “Çıkar” ile kaldırılır. Tedarikçi güncellemeleri ve zenginleştirme bu kararları değiştirmez.</CardDescription></CardHeader>
      <CardContent><ProductFitmentsManager productId={productId} fitments={fitments}/></CardContent>
    </Card>
    {hasSources && <Card id="arac-uyumu-kaynak">
      <CardHeader><CardTitle><h2>Kaynak satırları ve model listeleri</h2></CardTitle>
        <CardDescription>Katalogdaki bir motor tipine bağlanmamış satırlar. Yanlış olanı “Çıkar” ile mağazadan kaldırın; tedarikçi güncellemeleri ve zenginleştirme bu kararı değiştirmez.</CardDescription></CardHeader>
      <CardContent><ProductFitmentHidesManager productId={productId} sources={sources}/></CardContent>
    </Card>}
  </>;
}
