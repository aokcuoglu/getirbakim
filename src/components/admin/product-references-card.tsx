import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { loadProductReferences } from "@/modules/admin/product-reference-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductReferencesManager } from "./product-references-manager";

/** The product's OEM numbers, cross-reference codes and barcodes (#582): added by hand or hidden from the automatic ones. */
export async function ProductReferencesCard({ productId }: { productId: string }) {
  await requireAdmin();
  const references = await loadProductReferences(db, productId);
  return <Card id="referanslar">
    <CardHeader><CardTitle><h2>Referans numaraları</h2></CardTitle>
      <CardDescription>Elle eklenen OEM, muadil ve barkod numaraları ürün sayfasında görünür ve kod aramasında ürünü bulur; yanlış otomatik numarayı “Gizle” ile mağazadan ve aramadan çıkarın; tedarikçi OEM alanı ürün genelinde tek seferde gizlenir. Tedarikçi güncellemeleri bu kararları değiştirmez.</CardDescription></CardHeader>
    <CardContent><ProductReferencesManager productId={productId} references={references}/></CardContent>
  </Card>;
}
