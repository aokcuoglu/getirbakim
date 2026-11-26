import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { loadProductImages } from "@/modules/admin/product-image-store";
import { supplierNames } from "@/modules/admin/products";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductImagesManager } from "./product-images-manager";

/** The product's store gallery (#581): uploads, their order and the automatic enrichment image. */
export async function ProductImagesCard({ productId }: { productId: string }) {
  await requireAdmin();
  const { images, hideAutomatic, automatic } = await loadProductImages(db, productId);
  return <Card id="gorseller">
    <CardHeader><CardTitle><h2>Görseller</h2></CardTitle>
      <CardDescription>Yüklenen görseller mağazada otomatik (zenginleştirme) görselin önünde gösterilir; tedarikçi güncellemeleri ve yenilemeler onları değiştirmez. İlk görsel ana görseldir: ürün kartlarında, sepette ve bayi API&apos;sinde o görünür. Otomatik görseli ana görsel yapmak için “Yüklemeye çevir”i kullanın. Güncel listede bulunmayan tedarikçi kaydının görseli mağazada gösterilmez, yalnız burada önizlenir.</CardDescription></CardHeader>
    <CardContent>
      <ProductImagesManager productId={productId} images={images} hideAutomatic={hideAutomatic}
        automatic={automatic.map(image => ({ ...image, supplier: supplierNames[image.supplier] ?? image.supplier }))}/>
    </CardContent>
  </Card>;
}
