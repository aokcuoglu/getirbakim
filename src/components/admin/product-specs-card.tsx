import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { loadProductSpecs } from "@/modules/admin/product-spec-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductSpecsManager } from "./product-specs-manager";

/** The product's technical specifications (#603): values set by hand, added keys and hidden automatic keys. */
export async function ProductSpecsCard({ productId }: { productId: string }) {
  await requireAdmin();
  const specs = await loadProductSpecs(db, productId);
  return <Card id="ozellikler">
    <CardHeader><CardTitle><h2>Teknik özellikler</h2></CardTitle>
      <CardDescription>Elle girilen değer otomatik değerin yerine geçer ya da yeni bir özellik ekler; ürün sayfasında, kartlarda ve katalog süzgeçlerinde görünür. Yanlış otomatik özelliği “Gizle” ile mağazadan çıkarın. Tedarikçi güncellemeleri ve zenginleştirme bu kararları değiştirmez.</CardDescription></CardHeader>
    <CardContent><ProductSpecsManager productId={productId} specs={specs}/></CardContent>
  </Card>;
}
