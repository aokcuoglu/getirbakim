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
      <CardDescription>Elle eklenen OEM numaraları, muadil kodlar ve barkodlar ürün sayfasında gösterilir ve kod aramasında ürünü bulur. Yanlış otomatik (zenginleştirme) numarayı “Gizle” ile mağazadan çıkarın. Tedarikçi güncellemeleri ve yenilemeler bu kararları değiştirmez.</CardDescription></CardHeader>
    <CardContent><ProductReferencesManager productId={productId} references={references}/></CardContent>
  </Card>;
}
