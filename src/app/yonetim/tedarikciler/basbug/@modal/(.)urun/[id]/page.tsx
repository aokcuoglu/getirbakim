import { BasbugItemDetail } from "@/components/admin/basbug-item-detail";
import { requireAdmin } from "@/modules/auth/session";

// The product page's body in a dialog over the list; urun/[id]/page.tsx renders the same body as a full page.
export default async function ProductDialog({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  return <BasbugItemDetail id={(await params).id} modal/>;
}
